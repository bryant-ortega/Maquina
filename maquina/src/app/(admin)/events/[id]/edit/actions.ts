'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  EVENT_TYPES,
  SLOT_TYPES,
  SLOT_DEFAULT_RATES,
  buildEventId,
  dayOfWeek,
  weekendNumber,
  weekendFlag,
  yearOf,
  type SlotType,
} from '@/lib/event-defaults'

/**
 * Admin updates an existing event. Mirror of createEvent but with diff-aware
 * stages/slots and an auto-regenerating event_id.
 *
 * Order of operations:
 *   1. Auth + admin gate (re-checked server-side).
 *   2. Validate via zod (CreateEventInput-shaped, plus an `id`).
 *   3. Find-or-create venue (case + whitespace insensitive).
 *   4. Diff stages by id:
 *        - keep + UPDATE existing rows (stage_number, stage_name)
 *        - INSERT brand-new rows (no id from form)
 *        - DELETE rows present in DB but not in payload
 *        - BUT first verify no slots reference a stage we'd delete; if
 *          they do, return invalid with a clear error per Chase's choice
 *          (option A: block, never cascade).
 *   5. Diff slots by id, same shape.
 *   6. UPDATE events row, including a regenerated event_id when
 *        date/city/state changed (option B: auto-update).
 *
 * Budget scalars and non-DJ expense lines are NOT touched here — those are
 * admin-edited on the budget page (Phase 9). The ONE exception is the DJ
 * expense section: every save rebuilds category='djs' lines from the
 * current slot list so the budget can never drift out of sync with the
 * roster (delete all 'djs' rows, re-insert one per slot at the slot's
 * rate). Admins edit DJ prices on the event edit form, not on the budget.
 *
 * Auth: re-checks admin role server-side (defence in depth on top of the
 * (admin) layout gate). DB writes go through a service-role client so the
 * multi-table cascade doesn't fight RLS — the role check above is the only
 * gate that matters here.
 */

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{2}:\d{2}$/
const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const StageInput = z.object({
  // Existing rows have an id; new rows omit it.
  id: z.string().regex(UUID_LIKE).optional(),
  stage_number: z.number().int().min(1).max(4),
  stage_name: z.string().trim().min(1, 'Stage name is required').max(80),
})

const SlotInput = z.object({
  id: z.string().regex(UUID_LIKE).optional(),
  stage_number: z.number().int().min(1).max(4),
  slot_order: z.number().int().min(1).max(6),
  slot_type: z.enum(SLOT_TYPES),
  dj_id: z.string().regex(UUID_LIKE, 'Invalid DJ id'),
  rate: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().nonnegative().optional()
  ),
  start_time: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().regex(HHMM, 'Invalid time').optional()
  ),
  end_time: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().regex(HHMM, 'Invalid time').optional()
  ),
})

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number().nonnegative().optional()
)
const optionalString = (max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().trim().max(max).optional()
  )

const UpdateEventInput = z.object({
  id: z.string().regex(UUID_LIKE, 'Invalid event id'),

  // Core
  type: z.enum(EVENT_TYPES),
  date: z.string().regex(ISO_DATE, 'Invalid date'),
  title: z.string().trim().min(1, 'Title is required').max(200),
  city: z.string().trim().min(1, 'City is required').max(80),
  state: z.string().trim().min(2, 'State is required').max(40),
  venue_name: z.string().trim().min(1, 'Venue is required').max(200),

  // Optional event details
  status: z.enum(['tentative', 'confirmed']),
  collab: z.boolean(),
  doors_time: z.string().regex(HHMM, 'Invalid doors time'),
  end_time: z.string().regex(HHMM, 'Invalid end time'),
  capacity: optionalNumber,
  guarantee: z.boolean(),
  bar_included: z.boolean(),
  rent: optionalNumber,
  split_pct: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(100).optional()
  ),
  venue_tix_fee: optionalNumber,
  advance_contact_email: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().trim().toLowerCase().email('Invalid contact email').optional()
  ),
  advance_contact_phone: optionalString(40),

  // Milestones
  announce_date: z.string().regex(ISO_DATE, 'Invalid date'),
  begin_art_date: z.string().regex(ISO_DATE, 'Invalid date'),
  art_due_date: z.string().regex(ISO_DATE, 'Invalid date'),
  on_sale_date: z.string().regex(ISO_DATE, 'Invalid date'),

  // Children
  stages: z.array(StageInput).min(1).max(4),
  slots: z.array(SlotInput).max(36),
})

export type UpdateEventValues = z.input<typeof UpdateEventInput>
export type ValidationIssue = { path: string; message: string }

export type UpdateEventResult =
  | { ok: true; eventId: string; eventCode: string }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; issues: ValidationIssue[] }
  | { ok: false; reason: 'db_failed'; message: string }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function updateEvent(
  input: UpdateEventValues
): Promise<UpdateEventResult> {
  // 1. Auth + admin gate via the user-scoped client.
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauth' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.roles?.includes('admin')) return { ok: false, reason: 'forbidden' }

  // 2. Validate.
  const parsed = UpdateEventInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.map(String).join('.') || '(form)',
        message: i.message,
      })),
    }
  }
  const data = parsed.data

  // Slot sanity: every slot's stage_number must reference a real stage.
  const stageNumbers = new Set(data.stages.map((s) => s.stage_number))
  for (const slot of data.slots) {
    if (!stageNumbers.has(slot.stage_number)) {
      return {
        ok: false,
        reason: 'invalid',
        issues: [
          {
            path: 'slots',
            message: `Slot references stage ${slot.stage_number}, which doesn't exist.`,
          },
        ],
      }
    }
  }

  // 3. Service-role client for the multi-table cascade.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // 3a. Confirm the event exists. Pulls existing fields we need below.
  const { data: existing } = await admin
    .from('events')
    .select('id, event_id, date, city, state')
    .eq('id', data.id)
    .maybeSingle()
  if (!existing) return { ok: false, reason: 'not_found' }

  // 3b. Find-or-create venue.
  const norm = (s: string) => s.trim().toLowerCase()
  const venueNameN = norm(data.venue_name)
  const cityN = norm(data.city)
  const stateN = norm(data.state)

  let venueId: string | null = null
  {
    const { data: matches, error: vqErr } = await admin
      .from('venues')
      .select('id, name, city, state')
      .ilike('city', data.city.trim())
      .ilike('state', data.state.trim())

    if (vqErr) return { ok: false, reason: 'db_failed', message: vqErr.message }

    const hit = (matches ?? []).find(
      (v) =>
        norm(v.name) === venueNameN &&
        norm(v.city) === cityN &&
        norm(v.state) === stateN
    )
    if (hit) {
      venueId = hit.id
    } else {
      const { data: inserted, error: vErr } = await admin
        .from('venues')
        .insert({
          name: data.venue_name.trim(),
          city: data.city.trim(),
          state: data.state.trim(),
        })
        .select('id')
        .single()
      if (vErr || !inserted) {
        return {
          ok: false,
          reason: 'db_failed',
          message: vErr?.message ?? 'Venue insert failed',
        }
      }
      venueId = inserted.id
    }
  }

  // 3c. Pull current stages + slots for the diff.
  const [{ data: dbStages, error: dsErr }, { data: dbSlots, error: dlErr }] =
    await Promise.all([
      admin
        .from('event_stages')
        .select('id, stage_number, stage_name')
        .eq('event_id', data.id),
      admin
        .from('event_dj_slots')
        .select(
          'id, stage_id, slot_order, slot_type, dj_id, rate, start_time, end_time'
        )
        .eq('event_id', data.id),
    ])
  if (dsErr) return { ok: false, reason: 'db_failed', message: dsErr.message }
  if (dlErr) return { ok: false, reason: 'db_failed', message: dlErr.message }

  // 3d. Stage diff: keep + update / insert / delete.
  const formStageIds = new Set(
    data.stages.map((s) => s.id).filter((x): x is string => !!x)
  )
  const stagesToDelete = (dbStages ?? []).filter(
    (s) => !formStageIds.has(s.id as string)
  )
  // If any stage we're about to delete still has slots referencing it,
  // block the save with a precise message — option A from the design call.
  if (stagesToDelete.length > 0) {
    const orphanedStageIds = new Set(stagesToDelete.map((s) => s.id))
    const blockingSlots = (dbSlots ?? []).filter((s) =>
      orphanedStageIds.has(s.stage_id)
    )
    // Only blocking if those slots are also still in the form payload's
    // delete set (i.e., not also being removed). Slots being removed
    // alongside the stage are fine to cascade.
    const formSlotIds = new Set(
      data.slots.map((s) => s.id).filter((x): x is string => !!x)
    )
    const blockingStillKept = blockingSlots.filter((s) =>
      formSlotIds.has(s.id as string)
    )
    if (blockingStillKept.length > 0) {
      return {
        ok: false,
        reason: 'invalid',
        issues: [
          {
            path: 'stages',
            message:
              'A stage you removed still has booked DJs. Remove those slots first.',
          },
        ],
      }
    }
  }

  // 3e. Slot diff: keep + update / insert / delete. Use ids from the form.
  const formSlotIds = new Set(
    data.slots.map((s) => s.id).filter((x): x is string => !!x)
  )
  const slotIdsToDelete = (dbSlots ?? [])
    .map((s) => s.id as string)
    .filter((id) => !formSlotIds.has(id))

  // Apply slot deletes first so they don't conflict with stage deletes.
  if (slotIdsToDelete.length > 0) {
    const { error: delSlotErr } = await admin
      .from('event_dj_slots')
      .delete()
      .in('id', slotIdsToDelete)
    if (delSlotErr) {
      return { ok: false, reason: 'db_failed', message: delSlotErr.message }
    }
  }

  // Now safe to delete stages.
  if (stagesToDelete.length > 0) {
    const { error: delStageErr } = await admin
      .from('event_stages')
      .delete()
      .in(
        'id',
        stagesToDelete.map((s) => s.id)
      )
    if (delStageErr) {
      return { ok: false, reason: 'db_failed', message: delStageErr.message }
    }
  }

  // 3f. Update existing stages + insert new ones, building stageIdByNumber.
  const stageIdByNumber = new Map<number, string>()

  for (const s of data.stages) {
    if (s.id) {
      const { error } = await admin
        .from('event_stages')
        .update({
          stage_number: s.stage_number,
          stage_name: s.stage_name.trim(),
        })
        .eq('id', s.id)
      if (error) {
        return { ok: false, reason: 'db_failed', message: error.message }
      }
      stageIdByNumber.set(s.stage_number, s.id)
    } else {
      const { data: inserted, error } = await admin
        .from('event_stages')
        .insert({
          event_id: data.id,
          stage_number: s.stage_number,
          stage_name: s.stage_name.trim(),
        })
        .select('id')
        .single()
      if (error || !inserted) {
        return {
          ok: false,
          reason: 'db_failed',
          message: error?.message ?? 'Stage insert failed',
        }
      }
      stageIdByNumber.set(s.stage_number, inserted.id)
    }
  }

  // 3g. Update / insert slots.
  for (const slot of data.slots) {
    const stageId = stageIdByNumber.get(slot.stage_number)
    if (!stageId) {
      return {
        ok: false,
        reason: 'invalid',
        issues: [
          {
            path: 'slots',
            message: `Slot references stage ${slot.stage_number}, which doesn't exist.`,
          },
        ],
      }
    }
    const rate = slot.rate ?? SLOT_DEFAULT_RATES[slot.slot_type as SlotType]
    if (slot.id) {
      const { error } = await admin
        .from('event_dj_slots')
        .update({
          stage_id: stageId,
          slot_order: slot.slot_order,
          slot_type: slot.slot_type,
          dj_id: slot.dj_id,
          rate,
          start_time: slot.start_time ?? null,
          end_time: slot.end_time ?? null,
        })
        .eq('id', slot.id)
      if (error) {
        return { ok: false, reason: 'db_failed', message: error.message }
      }
    } else {
      const { error } = await admin.from('event_dj_slots').insert({
        event_id: data.id,
        stage_id: stageId,
        slot_order: slot.slot_order,
        slot_type: slot.slot_type,
        dj_id: slot.dj_id,
        rate,
        start_time: slot.start_time ?? null,
        end_time: slot.end_time ?? null,
      })
      if (error) {
        return { ok: false, reason: 'db_failed', message: error.message }
      }
    }
  }

  // 3g.5. Rebuild DJ expense lines on the estimated budget so the
  // budget's DJ section is always lock-step with the slot roster. This
  // mirrors what createEvent does at insert time, just using a wipe +
  // re-insert instead of a row-by-row diff (DJ expense rows have no
  // user-editable fields beyond what's on the slot itself, so a clean
  // rebuild is simpler and can't drift). If the event somehow doesn't
  // have an estimated budget yet we skip silently — the budget page
  // 404s in that case anyway.
  {
    const { data: budgetRow, error: bqErr } = await admin
      .from('event_budgets')
      .select('id')
      .eq('event_id', data.id)
      .eq('budget_type', 'estimated')
      .maybeSingle()
    if (bqErr) {
      return { ok: false, reason: 'db_failed', message: bqErr.message }
    }
    if (budgetRow) {
      const budgetId = budgetRow.id as string

      // Wipe existing DJ expense rows for this budget.
      const { error: delDjErr } = await admin
        .from('event_budget_expenses')
        .delete()
        .eq('budget_id', budgetId)
        .eq('category', 'djs')
      if (delDjErr) {
        return { ok: false, reason: 'db_failed', message: delDjErr.message }
      }

      // Re-insert one row per current slot, with the DJ name + slot rate.
      if (data.slots.length > 0) {
        const djIds = Array.from(new Set(data.slots.map((s) => s.dj_id)))
        const { data: djRows, error: djErr } = await admin
          .from('djs')
          .select('id, dj_name')
          .in('id', djIds)
        if (djErr) {
          return { ok: false, reason: 'db_failed', message: djErr.message }
        }
        const djNameById = new Map(
          (djRows ?? []).map((r) => [r.id as string, r.dj_name as string])
        )

        const djExpenseRows = data.slots.map((slot) => {
          const djName = djNameById.get(slot.dj_id) ?? 'DJ'
          const rate =
            slot.rate ?? SLOT_DEFAULT_RATES[slot.slot_type as SlotType] ?? 0
          return {
            budget_id: budgetId,
            category: 'djs' as const,
            item: djName,
            qty: 1,
            price: rate,
          }
        })

        const { error: insDjErr } = await admin
          .from('event_budget_expenses')
          .insert(djExpenseRows)
        if (insDjErr) {
          return { ok: false, reason: 'db_failed', message: insDjErr.message }
        }
      }
    }
  }

  // 3h. Build derived event fields. Auto-regenerate event_id whenever
  // the date/city/state changes (option B from the design call).
  const dateChanged = data.date !== existing.date
  const cityChanged = norm(data.city) !== norm(existing.city)
  const stateChanged = norm(data.state) !== norm(existing.state)
  const newEventCode =
    dateChanged || cityChanged || stateChanged
      ? buildEventId(data.date, data.city, data.state)
      : (existing.event_id as string)

  const year = yearOf(data.date)
  const wn = weekendNumber(data.date)
  const wflag = weekendFlag(data.date)
  const dow = dayOfWeek(data.date)
  const stagesCount = data.stages.length

  // 3i. UPDATE events.
  const { error: eErr } = await admin
    .from('events')
    .update({
      year,
      date: data.date,
      event_id: newEventCode,
      weekend_number: wn,
      weekend_flag: wflag,
      day_of_week: dow,
      title: data.title.trim(),
      type: data.type,
      venue_id: venueId,
      city: data.city.trim(),
      state: data.state.trim(),
      status: data.status,
      collab: data.collab,
      stages: stagesCount,
      doors_time: data.doors_time,
      end_time: data.end_time,
      capacity: data.capacity ?? null,
      guarantee: data.guarantee,
      bar_included: data.bar_included,
      rent: data.rent ?? null,
      split_pct: data.split_pct ?? null,
      venue_tix_fee: data.venue_tix_fee ?? null,
      advance_contact_email: data.advance_contact_email ?? null,
      advance_contact_phone: data.advance_contact_phone ?? null,
      announce_date: data.announce_date,
      begin_art_date: data.begin_art_date,
      art_due_date: data.art_due_date,
      on_sale_date: data.on_sale_date,
    })
    .eq('id', data.id)

  if (eErr) {
    return { ok: false, reason: 'db_failed', message: eErr.message }
  }

  // 4. Cache invalidation.
  revalidatePath('/events')
  revalidatePath(`/events/${data.id}/edit`)
  revalidatePath(`/events/${data.id}/budget`)

  return { ok: true, eventId: data.id, eventCode: newEventCode }
}

// ---------------------------------------------------------------------------
// Collaborator actions — Phase 13
// ---------------------------------------------------------------------------

const AddCollabInput = z.object({
  event_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be 128 characters or fewer')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
})

export type AddCollabResult =
  | { ok: true; isNewUser: boolean }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'create_failed'; message: string }
  | { ok: false; reason: 'attach_failed'; message: string }

/**
 * Attach a collaborator to an event.
 *
 * Three cases:
 *   a) Email already belongs to an auth user with role=collab → just
 *      insert event_collaborators row.
 *   b) Email belongs to an auth user with a different role (admin/dj) →
 *      reject. We don't want to silently demote someone, and we don't
 *      want to give a DJ collab access via this route.
 *   c) Email is new → create auth user with provided password (required
 *      for new users), flip profile.role to 'collab', attach.
 *
 * Idempotent on duplicate attaches: the UNIQUE constraint catches them
 * and we return ok with isNewUser=false.
 */
export async function addEventCollaborator(
  raw: unknown
): Promise<AddCollabResult> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const { data: actor } = await supabase
    .from('profiles')
    .select('id, roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!actor || !actor.roles?.includes('admin')) {
    return { ok: false, reason: 'unauthorized' }
  }

  const parsed = AddCollabInput.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message:
        parsed.error.issues[0]?.message ?? 'Please check the form fields.',
    }
  }
  const input = parsed.data

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Look up an existing auth user by email. There's no direct admin API
  // for "get user by email", so we list users (small page) and filter.
  // For a few-thousand-user system this is fine; revisit if it grows.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) {
    return { ok: false, reason: 'create_failed', message: listErr.message }
  }
  const existingAuth = list.users.find((u) => u.email === input.email)

  let targetUserId: string
  let isNewUser = false

  if (existingAuth) {
    // Confirm role is collab. If admin/dj, refuse.
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('roles')
      .eq('user_id', existingAuth.id)
      .maybeSingle()
    const existingRoles: string[] = existingProfile?.roles ?? []
    if (existingRoles.length > 0 && !existingRoles.includes('collab')) {
      return {
        ok: false,
        reason: 'create_failed',
        message: `Email is already in use by a ${existingRoles[0] ?? 'existing'} account. Use a different email for this collaborator.`,
      }
    }
    targetUserId = existingAuth.id
  } else {
    // New user. Need a password.
    if (!input.password) {
      return {
        ok: false,
        reason: 'invalid',
        message:
          'Set an initial password for this collaborator (8+ characters).',
      }
    }
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { role: 'collab' },
      })
    if (createErr || !created.user) {
      return {
        ok: false,
        reason: 'create_failed',
        message:
          createErr?.message ??
          'Could not create account for this collaborator.',
      }
    }
    targetUserId = created.user.id
    isNewUser = true

    // Force role to collab on the profile (the trigger may have set it
    // to 'dj' by default).
    await admin
      .from('profiles')
      .update({ role: 'collab' })
      .eq('user_id', targetUserId)
  }

  // Attach. ON CONFLICT DO NOTHING via upsert with onConflict.
  const { error: attachErr } = await admin
    .from('event_collaborators')
    .upsert(
      {
        event_id: input.event_id,
        user_id: targetUserId,
        added_by: actor.id as string,
      },
      { onConflict: 'event_id,user_id', ignoreDuplicates: true }
    )
  if (attachErr) {
    return { ok: false, reason: 'attach_failed', message: attachErr.message }
  }

  revalidatePath(`/events/${input.event_id}/edit`)
  return { ok: true, isNewUser }
}

const RemoveCollabInput = z.object({
  collaborator_id: z.string().uuid(),
  event_id: z.string().uuid(),
})

export type RemoveCollabResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'db_failed'; message: string }

export async function removeEventCollaborator(
  raw: unknown
): Promise<RemoveCollabResult> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const { data: actor } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!actor || !actor.roles?.includes('admin')) {
    return { ok: false, reason: 'unauthorized' }
  }

  const parsed = RemoveCollabInput.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Bad input.',
    }
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Note: we delete the attachment, not the auth user. The collab
  // account is still valid and may be attached to other events.
  const { error: delErr } = await admin
    .from('event_collaborators')
    .delete()
    .eq('id', parsed.data.collaborator_id)
  if (delErr) {
    return { ok: false, reason: 'db_failed', message: delErr.message }
  }

  revalidatePath(`/events/${parsed.data.event_id}/edit`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteEvent — admin removes an event entirely.
//
// FK cascades clean up everything attached to the event:
//   - event_stages
//   - event_dj_slots
//   - event_budgets (which further cascades to event_budget_expenses
//     and event_tix_tiers)
//   - event_collaborators
//   - event_view_customizations (once migration 0010 is applied)
//
// Returns ok:true with a redirect to /events on success. Form-action
// callers should rely on the redirect; programmatic callers see
// {ok:true} and can navigate themselves.
// ---------------------------------------------------------------------------

const DeleteEventInput = z.object({ event_id: z.string().uuid() })

export type DeleteEventResult =
  | { ok: true }
  | { ok: false; reason: 'unauth' | 'forbidden' | 'invalid' | 'db_failed'; message?: string }

export async function deleteEvent(input: { event_id: string }): Promise<DeleteEventResult> {
  const parsed = DeleteEventInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', message: parsed.error.message }
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauth' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.roles?.includes('admin')) return { ok: false, reason: 'forbidden' }

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', parsed.data.event_id)
  if (error) return { ok: false, reason: 'db_failed', message: error.message }

  revalidatePath('/events')
  revalidatePath('/views/month')
  revalidatePath('/views/year')
  revalidatePath('/views/posting-calendar')
  revalidatePath('/views/dj-analytics')
  redirect('/events')
}

/**
 * Form-action wrapper for deleteEvent — lets <form action={...}> in a
 * server component call it directly. Reads event_id from a hidden
 * input.
 */
export async function deleteEventForm(formData: FormData): Promise<void> {
  const id = String(formData.get('event_id') ?? '')
  await deleteEvent({ event_id: id })
}
