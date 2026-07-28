import Link from 'next/link'
import { isPastDate } from '@/lib/utils'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  FIELD_BY_KEY,
  type EventViewRow,
  type FieldDef,
} from '@/lib/view-fields'
import {
  BAR_PER_HEAD,
  LOSGOTHSCO_BAR_PCT,
  MERCH_GROSS_DEFAULT,
  MERCH_PCT_AFTER_FEES,
  MERCH_COGS_PCT,
  MERCH_SELLER_FEE,
  computeBudget,
  formatUSD,
} from '@/lib/budget'

/**
 * /views/[id] — custom-view renderer (Phase 17f, minimum slice).
 *
 * Loads the view + its visible view_fields in `position` order, then
 * loads every event with the joins/aggregates required to satisfy the
 * visible field set. Renders a table whose columns are the visible
 * fields formatted by each field's `kind`.
 *
 * Scope of this renderer:
 *   - admin-only (gated by the (admin) layout)
 *   - no per-event customization yet (Phase 17 has it on the spec but
 *     we left it out of this slice)
 *   - no CSV/PDF export
 *   - no filtering UI — shows every event, ordered by date ascending
 *
 * System views are valid input here (you can still click "Open" on a
 * built-in to see this generic rendering), but the four built-ins
 * each have their own purpose-built page that you'll usually hit
 * first via /views/month, /views/year, etc.
 *
 * Sharing with non-admin users is intentionally out of scope. The
 * data flow is structured so that a future /share/[token] route can
 * reuse the same loaders with a different auth boundary.
 */
export default async function ViewRendererPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  // ---- 1. Load view + visible view_fields -------------------------------
  const { data: view } = await supabase
    .from('views')
    .select('id, name, description, audience, is_system, slug')
    .eq('id', id)
    .maybeSingle()
  if (!view) notFound()

  const { data: rawFields } = await supabase
    .from('view_fields')
    .select('field_key, label, position, visible')
    .eq('view_id', id)
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

  // Decide which expensive joins to actually run.
  const needsLineup =
    visibleKeys.has('dj_count') ||
    visibleKeys.has('headliner_name') ||
    visibleKeys.has('dj_list')
  const FINANCIAL_KEYS = [
    'est_expenses',
    'est_income',
    'est_profit',
    'walkout',
    'losgothsco_tix_net',
    'gross_tix_sold',
    'gross_tix_total',
    'paid_attendance',
    'total_attendance',
    'bar_gross',
    'losgothsco_bar',
    'merch_gross',
    'net_merch',
    'sponsor_income',
    'vendor_income',
  ] as const
  const needsBudget = FINANCIAL_KEYS.some((k) => visibleKeys.has(k))

  // ---- 2. Load events (always join venues — it's cheap) -----------------
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

  // ---- 3. Lineup (only if dj_count or headliner_name is visible) --------
  const djCountByEvent = new Map<string, number>()
  const headlinerByEvent = new Map<string, string>()
  const djNamesByEvent = new Map<string, string[]>()
  if (needsLineup && eventIds.length > 0) {
    const { data: slots } = await supabase
      .from('event_dj_slots')
      .select('event_id, dj_id, slot_type, slot_order, djs(dj_name)')
      .in('event_id', eventIds)

    type Slot = {
      event_id: string
      dj_id: string
      slot_type: string
      slot_order: number | null
      djs: { dj_name: string } | { dj_name: string }[] | null
    }
    // Flyer-style ordering: headliner first, then main support, then
    // the rest of the lineup, then residents, then closers. Within a
    // priority tier we tiebreak by slot_order ascending (the order
    // they were entered on the event form).
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
    for (const s of (slots ?? []) as Slot[]) {
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
        const dj = Array.isArray(s.djs) ? s.djs[0] : s.djs
        const name = dj?.dj_name
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

  // ---- 4. Budget aggregates (only if any financial field is visible) ----
  type BudgetSummary = ReturnType<typeof computeBudget>
  const aggregatesByEvent = new Map<string, BudgetSummary>()
  const sponsorByEvent = new Map<string, number>()
  const vendorByEvent = new Map<string, number>()
  if (needsBudget && eventIds.length > 0) {
    const { data: budgets } = await supabase
      .from('event_budgets')
      .select(
        'id, event_id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct'
      )
      .in('event_id', eventIds)
      .eq('budget_type', 'estimated')

    type Budget = {
      id: string
      event_id: string
      drop_off: number | null
      guests: number | null
      tix_tax: number | null
      deductions: number | null
      sponsor_income: number | null
      vendor_income: number | null
      merch_gross: number | null
      merch_pct_after_fees: number | null
      merch_cogs_pct: number | null
      merch_seller_fee: number | null
      bar_per_head: number | null
      bar_pct: number | null
    }
    const budgetRows = (budgets ?? []) as Budget[]
    const budgetIds = budgetRows.map((b) => b.id)

    // Pull expenses + tiers for ALL budgets in one round trip each.
    type Expense = { budget_id: string; qty: number; price: number }
    type Tier = { budget_id: string; price: number; sold: number }
    let expenses: Expense[] = []
    let tiers: Tier[] = []
    if (budgetIds.length > 0) {
      const [{ data: ex }, { data: ti }] = await Promise.all([
        supabase
          .from('event_budget_expenses')
          .select('budget_id, qty, price')
          .in('budget_id', budgetIds),
        supabase
          .from('event_tix_tiers')
          .select('budget_id, price, sold')
          .in('budget_id', budgetIds),
      ])
      expenses = (ex ?? []) as Expense[]
      tiers = (ti ?? []) as Tier[]
    }

    const expensesByBudget = new Map<string, { qty: number; price: number }[]>()
    for (const e of expenses) {
      const arr = expensesByBudget.get(e.budget_id) ?? []
      arr.push({ qty: Number(e.qty), price: Number(e.price) })
      expensesByBudget.set(e.budget_id, arr)
    }
    const tiersByBudget = new Map<string, { price: number; sold: number }[]>()
    for (const t of tiers) {
      const arr = tiersByBudget.get(t.budget_id) ?? []
      arr.push({ price: Number(t.price), sold: Number(t.sold) })
      tiersByBudget.set(t.budget_id, arr)
    }

    const eventById = new Map<string, RawEvent>()
    for (const e of events) eventById.set(e.id, e)

    for (const b of budgetRows) {
      const event = eventById.get(b.event_id)
      if (!event) continue
      const summary = computeBudget({
        tiers: tiersByBudget.get(b.id) ?? [],
        drop_off: Number(b.drop_off ?? 0),
        guests: Number(b.guests ?? 0),
        tix_tax: Number(b.tix_tax ?? 0),
        deductions: Number(b.deductions ?? 0),
        sponsor_income: Number(b.sponsor_income ?? 0),
        vendor_income: Number(b.vendor_income ?? 0),
        split_pct: Number(event.split_pct ?? 0),
        bar_included: !!event.bar_included,
        bar_per_head: Number(b.bar_per_head ?? BAR_PER_HEAD),
        bar_pct: Number(b.bar_pct ?? LOSGOTHSCO_BAR_PCT),
        merch_gross: Number(b.merch_gross ?? MERCH_GROSS_DEFAULT),
        merch_pct_after_fees: Number(
          b.merch_pct_after_fees ?? MERCH_PCT_AFTER_FEES
        ),
        merch_cogs_pct: Number(b.merch_cogs_pct ?? MERCH_COGS_PCT),
        merch_seller_fee: Number(b.merch_seller_fee ?? MERCH_SELLER_FEE),
        expenses: expensesByBudget.get(b.id) ?? [],
      })
      aggregatesByEvent.set(b.event_id, summary)
      sponsorByEvent.set(b.event_id, Number(b.sponsor_income ?? 0))
      vendorByEvent.set(b.event_id, Number(b.vendor_income ?? 0))
    }
  }

  // ---- 5. Compose EventViewRow per event --------------------------------
  type Row = { event: RawEvent; row: EventViewRow }
  const rows: Row[] = events.map((e) => {
    const venue = Array.isArray(e.venues) ? e.venues[0] : e.venues
    const summary = aggregatesByEvent.get(e.id)
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
      // Budget aggregates fall back to null when there's no estimated
      // budget; accessors null-coalesce to 0 for currency/number kinds.
      est_expenses: summary?.est_expenses ?? null,
      est_income: summary?.est_income ?? null,
      est_profit: summary?.est_profit ?? null,
      walkout: summary?.walkout ?? null,
      losgothsco_tix_net: summary?.losgothsco_tix_net ?? null,
      gross_tix_sold: summary?.gross_tix_sold ?? null,
      gross_tix_total: summary?.gross_tix_total ?? null,
      tix_tax: summary?.tix_tax ?? null,
      net_tix_total: summary?.net_tix_total ?? null,
      paid_attendance: summary?.paid_attendance ?? null,
      total_attendance: summary?.total_attendance ?? null,
      bar_gross: summary?.bar_gross ?? null,
      losgothsco_bar: summary?.losgothsco_bar ?? null,
      merch_gross: summary?.merch_gross ?? null,
      net_merch: summary?.net_merch ?? null,
      sponsor_income: sponsorByEvent.get(e.id) ?? null,
      vendor_income: vendorByEvent.get(e.id) ?? null,
    }
    return { event: e, row }
  })

  // ---- 6. Render --------------------------------------------------------
  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs">
              <Link
                href="/views"
                className="text-zinc-500 hover:underline dark:text-zinc-400"
              >
                ← Back to views
              </Link>
            </p>
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
              {view.is_system ? ' · built-in' : ''}
            </p>
          </div>
          {!view.is_system ? (
            <Link
              href={`/views/${view.id as string}/edit`}
              className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Edit fields
            </Link>
          ) : null}
        </header>

        {visibleFields.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            This view has no visible fields yet.{' '}
            {!view.is_system ? (
              <Link
                href={`/views/${view.id as string}/edit`}
                className="font-medium underline hover:no-underline"
              >
                Pick fields
              </Link>
            ) : null}
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
                        {renderCell(f.def, row, event.id)}
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
// Cell rendering
// ---------------------------------------------------------------------------

/** Format a single cell. Title (`kind: 'link'`) becomes a link to the
 *  event edit page; everything else is a plain formatted value. */
function renderCell(def: FieldDef, row: EventViewRow, eventId: string) {
  const raw = def.accessor(row)

  if (def.key === 'status') {
    return <StatusBadge status={String(raw ?? '')} />
  }

  if (def.kind === 'link') {
    const text = String(raw ?? '') || '—'
    return (
      <Link
        href={`/events/${eventId}/edit`}
        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
      >
        {text}
      </Link>
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
    // Postgres `date` columns come back as YYYY-MM-DD. Anchor at local
    // midnight so we don't drift into the previous day in UTC-positive
    // timezones.
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
    // Postgres `time` columns come back as HH:MM:SS. Reformat to a
    // friendlier clock display.
    const [hStr, mStr] = s.split(':')
    const h = parseInt(hStr ?? '', 10)
    const m = parseInt(mStr ?? '', 10)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return s
    const hour12 = ((h + 11) % 12) + 1
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  // text / enum
  const text = String(raw ?? '')
  return text || '—'
}

/** Right-align numeric / currency / percent columns; everything else
 *  goes left. Keeps long tables scannable. */
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
 * (default) is amber, confirmed is green. Kept as a local function
 * for parity with the other list pages — see the matching
 * components in src/app/(admin)/events/page.tsx,
 * src/app/(admin)/views/month/page.tsx, src/app/viewer/year/page.tsx,
 * and src/app/contract/view/page.tsx. Obvious consolidation target
 * if we ever extract a shared <StatusBadge> component.
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

