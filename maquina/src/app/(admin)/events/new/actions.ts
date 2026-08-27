'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  EVENT_TYPES,
  PRESENTED_BY_OPTIONS,
  DEFAULT_PRESENTED_BY,
  SLOT_TYPES,
  SLOT_DEFAULT_RATES,
  DEFAULT_EVENT_EXPENSES,
  buildEventId,
  dayOfWeek,
  weekendNumber,
  weekendFlag,
  yearOf,
  type SlotType,
} from '@/lib/event-defaults'
import { sendConfirmedEventCalendarInvite } from '@/lib/calendar-invite'

/**
 * Admin creates a new event. This is the heart of Phase 7a.
 *
 * The action does a lot, intentionally — keeping it in one server action
 * means a single round-trip from the form, and a clear failure surface
 * (we either created everything or we report which step blew up). The
 * inserts go in dependency order:
 *
 *   1. Find-or-create the venue (case-insensitive on name + city + state)
 *   2. INSERT events
 *   3. INSERT event_stages (one per stage_number 1..stages)
 *   4. INSERT event_dj_slots (only the rows the admin actually filled)
 *   5. INSERT event_budgets (budget_type='estimated')
 *   6. INSERT event_budget_expenses
 *        - one row per DEFAULT_EVENT_EXPENSES line (qty=1, price=0)
 *        - one row per DJ slot, category='djs', price=SLOT_DEFAULT_RATES
 *   7. INSERT event_tix_tiers (3 default tiers: $10 / $15 / $20, sold=0)
 *
 * Auth: re-checks admin role server-side (defence in depth on top of the
 * (admin) layout gate). DB writes go through a service-role client because
 * the multi-table cascade is easier to reason about with RLS bypassed —
 * the role check above is the only gate that matters here.
 */

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{2}:\d{2}$/
const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const StageInput = z.object({
  stage_number: z.number().int().min(1).max(4),
  stage_name: z.string().trim().min(1, 'Stage name is required').max(80),
})

const SlotInput = z.object({
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

const CreateEventInput = z.object({
  // Core
  type: z.enum(EVENT_TYPES),
  date: z.string().regex(ISO_DATE, 'Invalid date'),
  title: z.string().trim().min(1, 'Title is required').max(200),
  city: z.string().trim().min(1, 'City is required').max(80),
  state: z
    .string()
    .trim()
    .min(2, 'State is required')
    .max(40),
  venue_name: z.string().trim().min(1, 'Venue is required').max(200),
  presented_by: z.enum(PRESENTED_BY_OPTIONS).default(DEFAULT_PRESENTED_BY),

  // Optional event details
  status: z.enum(['tentative', 'confirmed']).default('tentative'),
  collab: z.boolean().default(false),
  doors_time: z.string().regex(HHMM, 'Invalid doors time'),
  end_time: z.string().regex(HHMM, 'Invalid end time'),
  losgoths_load_in_time: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().regex(HHMM, 'Invalid load-in time').optional()
  ),
  dj_load_in_time: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().regex(HHMM, 'Invalid load-in time').optional()
  ),
  capacity: optionalNumber,
  guarantee: z.boolean().default(false),
  bar_included: z.boolean().default(false),
  rent: optionalNumber,
  split_pct: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0).max(100).optional()
  ),
  venue_tix_fee: optionalNumber,
  advance_contact_email: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z
      .string()
      .trim()
      .toLowerCase()
      .max(254, 'Invalid contact email')
      .email('Invalid contact email')
      .optional()
  ),
  advance_contact_phone: optionalString(40),

  // Milestone overrides — derived defaults are pre-filled in the form
  // but admins can edit them before submit.
  announce_date: z.string().regex(ISO_DATE, 'Invalid date'),
  begin_art_date: z.string().regex(ISO_DATE, 'Invalid date'),
  art_due_date: z.string().regex(ISO_DATE, 'Invalid date'),
  on_sale_date: z.string().regex(ISO_DATE, 'Invalid date'),

  // Children
  stages: z.array(StageInput).min(1).max(4),
  slots: z.array(SlotInput).max(36),
  vendor_ids: z.array(z.string().regex(UUID_LIKE, 'Invalid vendor id')).max(100).default([]),
})

export type CreateEventValues = z.input<typeof CreateEventInput>
export type ValidationIssue = { path: string; message: string }

export type CreateEventResult =
  | { ok: true; eventId: string; eventCode: string }
  | { ok: false; reason: 'unauth' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'invalid'; issues: ValidationIssue[] }
  | { ok: false; reason: 'db_failed'; message: string }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function createEvent(
  input: CreateEventValues
): Promise<CreateEventResult> {
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
  const parsed = CreateEventInput.safeParse(input)
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

  // 3a. Find-or-create venue (case + whitespace insensitive on name/city/state).
  // The unique index in 0005 enforces this at the DB; we match here so we
  // can reuse an existing row's id when there's a hit.
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

  // 3b. Build derived event fields.
  const year = yearOf(data.date)
  const wn = weekendNumber(data.date)
  const wflag = weekendFlag(data.date)
  const dow = dayOfWeek(data.date)
  const eventCode = buildEventId(data.date, data.city, data.state)
  const stagesCount = data.stages.length

  // 3c. INSERT events.
  const { data: eventRow, error: eErr } = await admin
    .from('events')
    .insert({
      year,
      date: data.date,
      event_id: eventCode,
      weekend_number: wn,
      weekend_flag: wflag,
      day_of_week: dow,
      title: data.title.trim(),
      type: data.type,
      venue_id: venueId,
      city: data.city.trim(),
      state: data.state.trim(),
      presented_by: data.presented_by,
      status: data.status,
      collab: data.collab,
      stages: stagesCount,
      doors_time: data.doors_time,
      end_time: data.end_time,
      losgoths_load_in_time: data.losgoths_load_in_time ?? null,
      dj_load_in_time: data.dj_load_in_time ?? null,
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
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (eErr || !eventRow) {
    return {
      ok: false,
      reason: 'db_failed',
      message: eErr?.message ?? 'Event insert failed',
    }
  }
  const eventId = eventRow.id

  // 3d. INSERT event_stages.
  const { data: stageRows, error: sErr } = await admin
    .from('event_stages')
    .insert(
      data.stages.map((s) => ({
        event_id: eventId,
        stage_number: s.stage_number,
        stage_name: s.stage_name.trim(),
      }))
    )
    .select('id, stage_number')

  if (sErr || !stageRows) {
    return {
      ok: false,
      reason: 'db_failed',
      message: sErr?.message ?? 'Stage insert failed',
    }
  }

  const stageIdByNumber = new Map(
    stageRows.map((r) => [r.stage_number as number, r.id as string])
  )

  // 3e. INSERT event_dj_slots.
  if (data.slots.length > 0) {
    const { error: slotErr } = await admin.from('event_dj_slots').insert(
      data.slots.map((slot) => ({
        event_id: eventId,
        stage_id: stageIdByNumber.get(slot.stage_number)!,
        slot_order: slot.slot_order,
        dj_id: slot.dj_id,
        slot_type: slot.slot_type,
        rate: slot.rate ?? SLOT_DEFAULT_RATES[slot.slot_type as SlotType],
        start_time: slot.start_time ?? null,
        end_time: slot.end_time ?? null,
      }))
    )
    if (slotErr) {
      return { ok: false, reason: 'db_failed', message: slotErr.message }
    }
  }

  // 3f. INSERT event_budgets (estimated).
  const { data: budgetRow, error: bErr } = await admin
    .from('event_budgets')
    .insert({
      event_id: eventId,
      budget_type: 'estimated',
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (bErr || !budgetRow) {
    return {
      ok: false,
      reason: 'db_failed',
      message: bErr?.message ?? 'Budget insert failed',
    }
  }
  const budgetId = budgetRow.id

  // 3g. INSERT event_budget_expenses.
  // Two sources:
  //  - 17 default lines (qty=1, price=0) from DEFAULT_EVENT_EXPENSES
  //  - one line per booked DJ slot, category='djs', price = slot rate
  const expenseRows: Array<{
    budget_id: string
    category: string
    item: string
    qty: number
    price: number
  }> = []

  for (const ex of DEFAULT_EVENT_EXPENSES) {
    expenseRows.push({
      budget_id: budgetId,
      category: ex.category,
      item: ex.label,
      qty: 1,
      price: 0,
    })
  }

  // DJ expense lines: pull dj_name for each slot so the line is human-readable.
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
    for (const slot of data.slots) {
      const djName = djNameById.get(slot.dj_id) ?? 'DJ'
      const rate =
        slot.rate ?? SLOT_DEFAULT_RATES[slot.slot_type as SlotType] ?? 0
      expenseRows.push({
        budget_id: budgetId,
        category: 'djs',
        item: djName,
        qty: 1,
        price: rate,
      })
    }
  }

  if (expenseRows.length > 0) {
    const { error: exErr } = await admin
      .from('event_budget_expenses')
      .insert(expenseRows)
    if (exErr) {
      return { ok: false, reason: 'db_failed', message: exErr.message }
    }
  }

  // 3h. INSERT default tix tiers (3 tiers: $10 / $15 / $20, sold=0).
  // Admins edit prices, sold counts, and add up to 8 tiers in the budget UI.
  const { error: tierErr } = await admin.from('event_tix_tiers').insert([
    { budget_id: budgetId, tier_number: 1, price: 10, sold: 0 },
    { budget_id: budgetId, tier_number: 2, price: 15, sold: 0 },
    { budget_id: budgetId, tier_number: 3, price: 20, sold: 0 },
  ])
  if (tierErr) {
    return { ok: false, reason: 'db_failed', message: tierErr.message }
  }

  // 3i. INSERT event_vendors (migration 0031) — plain many-to-many, no
  // rate/time/slot fields like DJs get.
  if (data.vendor_ids.length > 0) {
    const { error: vendorLinkErr } = await admin.from('event_vendors').insert(
      data.vendor_ids.map((vendorId) => ({
        event_id: eventId,
        vendor_id: vendorId,
      }))
    )
    if (vendorLinkErr) {
      return { ok: false, reason: 'db_failed', message: vendorLinkErr.message }
    }
  }

  // 3j. Calendar invite — only if the admin created it already confirmed
  // (the common path is confirm-on-edit later, handled in
  // events/[id]/edit/actions.ts; this covers the "create straight into
  // confirmed" case). Best-effort — the function itself never throws —
  // but we `await` rather than fire-and-forget because Vercel can freeze
  // the serverless function as soon as this action returns, which would
  // kill an in-flight, un-awaited email send.
  if (data.status === 'confirmed') {
    await sendConfirmedEventCalendarInvite({
      id: eventId,
      event_id: eventCode,
      title: data.title.trim(),
      date: data.date,
      city: data.city.trim(),
      state: data.state.trim(),
      doors_time: data.doors_time,
      end_time: data.end_time,
      announce_date: data.announce_date,
      begin_art_date: data.begin_art_date,
      art_due_date: data.art_due_date,
      on_sale_date: data.on_sale_date,
    })
  }

  // 4. Cache invalidation.
  revalidatePath('/events')
  revalidatePath(`/events/${eventId}`)

  return { ok: true, eventId, eventCode }
}
