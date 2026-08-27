import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { EditEventForm } from './edit-event-form'
import { CollaboratorsSection, type CollaboratorRow } from './collaborators-section'
import { PRESENTED_BY_OPTIONS, DEFAULT_PRESENTED_BY } from '@/lib/event-defaults'

/**
 * Admin event edit page (Phase 7b).
 *
 * Pre-fetches everything the form needs:
 *   - The event row + its joined venue (for the venue_name field default)
 *   - All stages + slots tied to this event (for diff-aware children)
 *   - DJ roster (for the slot DJ dropdown)
 *   - All venues (for the city-filtered autocomplete)
 *   - Vendor roster + this event's current event_vendors (migration 0031)
 *
 * Auth gate: handled by the (admin) layout.
 */
export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const [
    { data: event, error: eventErr },
    { data: stages },
    { data: slots },
    { data: djs },
    { data: venues },
    { data: rawCollaborators },
    { data: vendors },
    { data: eventVendors },
  ] = await Promise.all([
    supabase
      .from('events')
      .select(
        'id, year, date, event_id, weekend_number, weekend_flag, day_of_week, title, type, venue_id, city, state, presented_by, status, collab, stages, doors_time, end_time, losgoths_load_in_time, dj_load_in_time, capacity, guarantee, bar_included, rent, split_pct, venue_tix_fee, advance_contact_email, advance_contact_phone, announce_date, begin_art_date, art_due_date, on_sale_date, venues(name)'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('event_stages')
      .select('id, stage_number, stage_name')
      .eq('event_id', id)
      .order('stage_number', { ascending: true }),
    supabase
      .from('event_dj_slots')
      .select(
        'id, stage_id, slot_order, slot_type, dj_id, rate, start_time, end_time'
      )
      .eq('event_id', id)
      .order('stage_id', { ascending: true })
      .order('slot_order', { ascending: true }),
    supabase
      .from('djs')
      .select('id, dj_name, region')
      .order('dj_name', { ascending: true }),
    supabase
      .from('venues')
      .select('id, name, city, state')
      .order('name', { ascending: true }),
    // Phase 13: collaborators for this event. Join through auth.users
    // for the email — but auth.users isn't directly readable, so we
    // fetch ids here and look up emails via the admin client below.
    supabase
      .from('event_collaborators')
      .select('id, user_id, created_at')
      .eq('event_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('vendors')
      .select('id, company_name')
      .order('company_name', { ascending: true }),
    supabase.from('event_vendors').select('vendor_id').eq('event_id', id),
  ])

  if (eventErr || !event) notFound()

  // Phase 13: hydrate collaborator emails from auth.users via the
  // service-role admin client. This is cheap because Cowork is small;
  // revisit if the user roster grows past ~1k.
  const collabRows: CollaboratorRow[] = []
  if ((rawCollaborators ?? []).length > 0) {
    const { createClient } = await import('@supabase/supabase-js')
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: list } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    })
    const emailById = new Map<string, string>()
    for (const u of list?.users ?? []) {
      if (u.id && u.email) emailById.set(u.id, u.email)
    }
    for (const row of rawCollaborators ?? []) {
      collabRows.push({
        id: row.id as string,
        email: emailById.get(row.user_id as string) ?? '(unknown email)',
        added_at: row.created_at as string,
      })
    }
  }

  // Supabase types the joined venue as either array or single. Coerce.
  const venueName =
    (Array.isArray(event.venues)
      ? event.venues[0]?.name
      : (event.venues as { name: string } | null)?.name) ?? ''

  // Convert each DB stage into the form's expected shape, mapping
  // stage_id → stage_number for the slots so the form can work in
  // stage-number space (matching how createEvent handles it).
  const stageList = (stages ?? []).map((s) => ({
    id: s.id as string,
    stage_number: s.stage_number as number,
    stage_name: s.stage_name as string,
  }))

  const stageNumberById = new Map<string, number>(
    stageList.map((s) => [s.id, s.stage_number])
  )

  const slotList = (slots ?? []).map((s) => ({
    id: s.id as string,
    stage_number: stageNumberById.get(s.stage_id as string) ?? 1,
    slot_order: s.slot_order as number,
    slot_type: s.slot_type as string,
    dj_id: s.dj_id as string,
    rate: s.rate as number | null,
    start_time: s.start_time as string | null,
    end_time: s.end_time as string | null,
  }))

  // Strip 'HH:MM:SS' tail from time fields — Postgres TIME columns return
  // 'HH:MM:SS' but <input type="time"> wants 'HH:MM'.
  const trimTime = (t: string | null) =>
    t ? t.split(':').slice(0, 2).join(':') : ''

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <Link
            href="/events"
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← All events
          </Link>
        </div>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Edit event
            </h1>
            <p className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
              {event.event_id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/events/${id}/runofshow`}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Run of show →
            </Link>
            <Link
              href={`/events/${id}/budget`}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Budget →
            </Link>
          </div>
        </header>

        <EditEventForm
          djs={djs ?? []}
          venues={venues ?? []}
          vendors={vendors ?? []}
          initial={{
            id: event.id as string,
            type: event.type as 'club' | 'concert' | 'festival',
            date: event.date as string,
            title: (event.title as string) ?? '',
            city: (event.city as string) ?? '',
            state: (event.state as string) ?? '',
            venue_name: venueName,
            // Falls back to the default if the stored value isn't one of
            // today's options — e.g. an option removed from the array
            // after this event was created (see event-defaults.ts).
            presented_by: (PRESENTED_BY_OPTIONS as readonly string[]).includes(
              event.presented_by as string
            )
              ? (event.presented_by as (typeof PRESENTED_BY_OPTIONS)[number])
              : DEFAULT_PRESENTED_BY,
            status: event.status as 'tentative' | 'confirmed',
            collab: !!event.collab,
            doors_time: trimTime(event.doors_time as string | null),
            end_time: trimTime(event.end_time as string | null),
            losgoths_load_in_time: trimTime(
              event.losgoths_load_in_time as string | null
            ),
            dj_load_in_time: trimTime(event.dj_load_in_time as string | null),
            capacity: event.capacity == null ? '' : String(event.capacity),
            guarantee: !!event.guarantee,
            bar_included: !!event.bar_included,
            rent: event.rent == null ? '' : String(event.rent),
            split_pct: event.split_pct == null ? '' : String(event.split_pct),
            venue_tix_fee:
              event.venue_tix_fee == null ? '' : String(event.venue_tix_fee),
            advance_contact_email:
              (event.advance_contact_email as string | null) ?? '',
            advance_contact_phone:
              (event.advance_contact_phone as string | null) ?? '',
            announce_date: event.announce_date as string,
            begin_art_date: event.begin_art_date as string,
            art_due_date: event.art_due_date as string,
            on_sale_date: event.on_sale_date as string,
            stages: stageList,
            slots: slotList.map((s) => ({
              ...s,
              rate: s.rate == null ? '' : String(s.rate),
              start_time: trimTime(s.start_time),
              end_time: trimTime(s.end_time),
            })),
            vendor_ids: (eventVendors ?? []).map((v) => v.vendor_id as string),
          }}
        />

        <CollaboratorsSection eventId={event.id as string} initial={collabRows} />
      </div>
    </div>
  )
}
