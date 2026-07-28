import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isPastDate } from '@/lib/utils'
import {
  FIELD_BY_KEY,
  type EventViewRow,
  type FieldDef,
} from '@/lib/view-fields'
import { formatUSD } from '@/lib/budget'

/**
 * /contract/view — Phase 17i, renamed from 'designer' in migration
 * 0029 to cover photographers/videographers too, not just flyer
 * designers.
 *
 * The only page a `contract`-role account can see. Loads the first
 * custom view marked `audience = 'contract'` and renders it as a
 * read-only table. Stripped of:
 *   - admin sidebar (contract layout supplies its own slim header)
 *   - per-row link to /events/[id]/edit (contract users can't see that)
 *   - any budget / financial loading — even if the underlying view
 *     accidentally includes a financial field, this page never asks
 *     for it. Defence in depth on top of RLS migration 0020/0029.
 *
 * Data access:
 *   - `views`, `view_fields` are gated by RLS — migration 0020/0029
 *     lets contract users SELECT only rows where audience='contract'.
 *   - `events`, `event_dj_slots` get a contract SELECT in 0020/0029.
 *   - `venues` was already authenticated-readable (0002).
 *   - `djs` does NOT have a contract SELECT policy as of migration
 *     0028/0029 — that row-level grant would have exposed pay/contact
 *     columns to any contract user's REST session, not just `dj_name`.
 *     DJ names for the lineup come from the `contract_dj_names(uuid[])`
 *     RPC instead (SECURITY DEFINER, returns only id + dj_name, gated
 *     to contract/admin callers). Don't reintroduce a `djs(dj_name)`
 *     embed on this page — it'll silently return null now.
 *
 * Keep this page in sync with /(admin)/views/[id]/page.tsx when the
 * lineup loader or field catalog changes — they're intentionally a
 * near-copy until we factor out a shared loader.
 */
export default async function ContractViewPage() {
  const supabase = await createServerSupabaseClient()

  // ---- 1. Find the contract view -----------------------------------------
  // RLS (migration 0020/0029) already restricts this query to views
  // with audience='contract'. We additionally filter is_system=false
  // so built-in views (Posting Calendar etc.) never win the picker —
  // contract users only see Chase's own custom views. If multiple
  // custom contract views exist, we take the most-recently-updated
  // one. If multiple contract views ever become a real workflow, we'd
  // add an assigned_view_id column on profiles per the handoff's Path
  // B note.
  const { data: view } = await supabase
    .from('views')
    .select('id, name, description, audience, is_system, slug, updated_at')
    .eq('audience', 'contract')
    .eq('is_system', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!view) {
    // No contract-audience view exists yet. Show a friendly empty
    // state instead of a 404 so Chase knows what to do.
    return (
      <div className="flex-1 px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-2xl rounded-md border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
          <h1 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            No contract view available
          </h1>
          <p>
            Your account is set up, but no custom view has been marked
            for the contract audience yet. Ask the admin to open the
            View Builder, edit a custom view, and change its{' '}
            <strong>Audience</strong> dropdown to <em>Contract</em>.
            (Built-in views like Posting Calendar don&apos;t count —
            this page only picks up your own views.)
          </p>
        </div>
      </div>
    )
  }

  // ---- 2. Load view_fields ---------------------------------------------
  const { data: rawFields } = await supabase
    .from('view_fields')
    .select('field_key, label, position, visible')
    .eq('view_id', view.id as string)
    .order('position', { ascending: true })

  const visibleFields: { key: string; label: string; def: FieldDef }[] =
    (rawFields ?? [])
      .filter((f) => f.visible)
      .map((f) => {
        const def = FIELD_BY_KEY.get(f.field_key as string)
        return def
          ? {
              key: f.field_key as string,
              label: f.label as string,
              def,
            }
          : null
      })
      .filter((f): f is { key: string; label: string; def: FieldDef } => !!f)

  const visibleKeys = new Set(visibleFields.map((f) => f.key))

  // Contract page intentionally never loads budgets. Lineup is still
  // conditional so a contract view that doesn't include DJ fields
  // doesn't pay for the extra join.
  const needsLineup =
    visibleKeys.has('dj_count') ||
    visibleKeys.has('headliner_name') ||
    visibleKeys.has('dj_list')

  // ---- 3. Load events ---------------------------------------------------
  const { data: rawEvents } = await supabase
    .from('events')
    .select(
      'id, event_id, title, type, status, collab, date, day_of_week, weekend_number, weekend_flag, year, city, state, capacity, doors_time, end_time, stages, rent, split_pct, venue_tix_fee, guarantee, bar_included, announce_date, begin_art_date, art_due_date, on_sale_date, advance_contact_email, advance_contact_phone, venues(name, address)'
    )
    .order('date', { ascending: true })

  type RawEvent = {
    id: string
    event_id: string
    title: string
    type: string
    status: string
    collab: boolean
    date: string
    day_of_week: string
    weekend_number: number
    weekend_flag: string
    year: number
    city: string
    state: string
    capacity: number | null
    doors_time: string
    end_time: string
    stages: number
    rent: number | null
    split_pct: number | null
    venue_tix_fee: number | null
    guarantee: boolean | null
    bar_included: boolean | null
    announce_date: string | null
    begin_art_date: string | null
    art_due_date: string | null
    on_sale_date: string | null
    advance_contact_email: string | null
    advance_contact_phone: string | null
    venues:
      | { name: string; address: string | null }
      | { name: string; address: string | null }[]
      | null
  }
  const events = (rawEvents ?? []) as RawEvent[]
  const eventIds = events.map((e) => e.id)

  // ---- 4. Lineup (only if any DJ field is visible) ----------------------
  const djCountByEvent = new Map<string, number>()
  const headlinerByEvent = new Map<string, string>()
  const djNamesByEvent = new Map<string, string[]>()
  if (needsLineup && eventIds.length > 0) {
    const { data: slots } = await supabase
      .from('event_dj_slots')
      .select('event_id, dj_id, slot_type, slot_order')
      .in('event_id', eventIds)

    type Slot = {
      event_id: string
      dj_id: string
      slot_type: string
      slot_order: number | null
    }
    const slotRows = (slots ?? []) as Slot[]

    // DJ names come from a SECURITY DEFINER RPC (migration 0028,
    // renamed 0029), not a `djs(dj_name)` embed — contract users don't
    // have a row-level SELECT policy on `djs` anymore, so the embed
    // would silently return null for every slot. The RPC returns only
    // (id, dj_name) and is gated to contract/admin callers server-side.
    const distinctDjIds = [...new Set(slotRows.map((s) => s.dj_id))]
    const nameById = new Map<string, string>()
    if (distinctDjIds.length > 0) {
      const { data: names } = await supabase.rpc('contract_dj_names', {
        p_dj_ids: distinctDjIds,
      })
      for (const row of (names ?? []) as { id: string; dj_name: string }[]) {
        nameById.set(row.id, row.dj_name)
      }
    }

    const slotTypePriority: Record<string, number> = {
      headline: 0,
      main_support: 1,
      support_2: 2,
      support_1: 3,
      open: 4,
      resident: 5,
      close: 6,
    }
    const orderedByEvent = new Map<string, Slot[]>()
    for (const s of slotRows) {
      const arr = orderedByEvent.get(s.event_id) ?? []
      arr.push(s)
      orderedByEvent.set(s.event_id, arr)
    }
    for (const [eid, arr] of orderedByEvent) {
      arr.sort((a, b) => {
        const pa = slotTypePriority[a.slot_type] ?? 99
        const pb = slotTypePriority[b.slot_type] ?? 99
        if (pa !== pb) return pa - pb
        return (a.slot_order ?? 0) - (b.slot_order ?? 0)
      })
      const djIds = new Set<string>()
      const seenNames = new Set<string>()
      const names: string[] = []
      let headliner: string | undefined
      for (const s of arr) {
        djIds.add(s.dj_id)
        const name = nameById.get(s.dj_id)
        if (name && !seenNames.has(name)) {
          seenNames.add(name)
          names.push(name)
        }
        if (s.slot_type === 'headline' && !headliner && name) {
          headliner = name
        }
      }
      djCountByEvent.set(eid, djIds.size)
      if (headliner) headlinerByEvent.set(eid, headliner)
      djNamesByEvent.set(eid, names)
    }
  }

  // ---- 5. Compose EventViewRow per event --------------------------------
  // All financial fields are forced to null — even if a contract
  // view accidentally has a financial column on, it renders empty.
  type Row = { event: RawEvent; row: EventViewRow }
  const rows: Row[] = events.map((e) => {
    const venue = Array.isArray(e.venues) ? e.venues[0] : e.venues
    const row: EventViewRow = {
      id: e.id,
      event_id: e.event_id,
      title: e.title,
      type: e.type,
      status: e.status,
      collab: e.collab,
      date: e.date,
      day_of_week: e.day_of_week,
      weekend_number: e.weekend_number,
      weekend_flag: e.weekend_flag,
      year: e.year,
      city: e.city,
      state: e.state,
      capacity: e.capacity,
      doors_time: e.doors_time,
      end_time: e.end_time,
      stages: e.stages,
      rent: e.rent,
      split_pct: e.split_pct,
      venue_tix_fee: e.venue_tix_fee,
      guarantee: e.guarantee,
      bar_included: e.bar_included,
      announce_date: e.announce_date,
      begin_art_date: e.begin_art_date,
      art_due_date: e.art_due_date,
      on_sale_date: e.on_sale_date,
      advance_contact_email: e.advance_contact_email,
      advance_contact_phone: e.advance_contact_phone,
      venue_name: venue?.name ?? null,
      venue_address: venue?.address ?? null,
      dj_count: djCountByEvent.get(e.id) ?? 0,
      headliner_name: headlinerByEvent.get(e.id) ?? null,
      dj_names: djNamesByEvent.get(e.id) ?? null,
      est_expenses: null,
      est_income: null,
      est_profit: null,
      walkout: null,
      losgothsco_tix_net: null,
      gross_tix_sold: null,
      gross_tix_total: null,
      paid_attendance: null,
      total_attendance: null,
      bar_gross: null,
      losgothsco_bar: null,
      merch_gross: null,
      net_merch: null,
      sponsor_income: null,
      vendor_income: null,
    }
    return { event: e, row }
  })

  // ---- 6. Render --------------------------------------------------------
  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {view.name as string}
          </h1>
          {view.description ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {view.description as string}
            </p>
          ) : null}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {rows.length} {rows.length === 1 ? 'event' : 'events'} ·{' '}
            {visibleFields.length}{' '}
            {visibleFields.length === 1 ? 'field' : 'fields'}
          </p>
        </header>

        {visibleFields.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            This view has no visible fields yet.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            No events yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  {visibleFields.map((f) => (
                    <th
                      key={f.key}
                      className={`whitespace-nowrap px-4 py-2.5 font-medium ${alignClassFor(
                        f.def.kind
                      )}`}
                    >
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {rows.map(({ event, row }) => (
                  <tr
                    key={event.id}
                    className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                      isPastDate(event.date) ? 'opacity-45' : ''
                    }`}
                  >
                    {visibleFields.map((f) => (
                      <td
                        key={f.key}
                        className={`${
                          f.def.wrap ? 'whitespace-normal' : 'whitespace-nowrap'
                        } px-4 py-3 text-zinc-700 dark:text-zinc-300 ${alignClassFor(
                          f.def.kind
                        )}`}
                      >
                        {renderCell(f.def, row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cell rendering — same shape as the admin renderer, except `link` is
// rendered as plain text. Contract users must not be able to navigate into
// /events/[id]/edit (which would expose financials).
// ---------------------------------------------------------------------------

function renderCell(def: FieldDef, row: EventViewRow) {
  const raw = def.accessor(row)

  if (def.key === 'status') {
    return <StatusBadge status={String(raw ?? '')} />
  }

  if (def.kind === 'link') {
    const text = String(raw ?? '') || '—'
    return (
      <span className="font-medium text-zinc-900 dark:text-zinc-100">
        {text}
      </span>
    )
  }

  if (def.kind === 'bool') {
    return raw ? (
      <span aria-label="yes">✓</span>
    ) : (
      <span className="text-zinc-400 dark:text-zinc-600" aria-label="no">
        —
      </span>
    )
  }

  if (def.kind === 'currency') {
    return formatUSD(Number(raw ?? 0))
  }

  if (def.kind === 'percent') {
    const n = Number(raw ?? 0)
    return `${Number.isFinite(n) ? n : 0}%`
  }

  if (def.kind === 'number') {
    const n = Number(raw ?? 0)
    return new Intl.NumberFormat('en-US').format(Number.isFinite(n) ? n : 0)
  }

  if (def.kind === 'date') {
    const s = String(raw ?? '')
    if (!s) return '—'
    const d = new Date(`${s}T00:00:00`)
    if (Number.isNaN(d.getTime())) return s
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  if (def.kind === 'time') {
    const s = String(raw ?? '')
    if (!s) return '—'
    const [hStr, mStr] = s.split(':')
    const h = parseInt(hStr ?? '', 10)
    const m = parseInt(mStr ?? '', 10)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return s
    const hour12 = ((h + 11) % 12) + 1
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const text = String(raw ?? '')
  return text || '—'
}

function alignClassFor(kind: FieldDef['kind']): string {
  switch (kind) {
    case 'number':
    case 'currency':
    case 'percent':
      return 'text-right'
    default:
      return 'text-left'
  }
}

/**
 * Small colored pill matching the admin events page. Tentative
 * (default) is amber, confirmed is green. Renders status text inside
 * a rounded badge so contract users can scan the page at a glance.
 *
 * Kept as a local function for parity with the other list pages
 * (events/page.tsx, viewer/year/page.tsx, etc.) which all duplicate
 * this component. If we ever extract a shared component, this is one
 * of the obvious consolidation targets.
 */
function StatusBadge({ status }: { status: string }) {
  const isConfirmed = status === 'confirmed'
  return (
    <span
      className={
        isConfirmed
          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
          : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
      }
    >
      {status || '—'}
    </span>
  )
}

