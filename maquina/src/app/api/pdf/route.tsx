/**
 * PDF export endpoint — Phase 12.
 *
 * GET /api/pdf?view=runofshow&eventId=<uuid>
 * GET /api/pdf?view=budget&eventId=<uuid>&budget=estimated|final
 * GET /api/pdf?view=month&year=YYYY&month=1..12&confirmed_only=0|1
 *
 * Auth gate: admin only. We re-fetch the same data the on-screen pages
 * fetch (using the SSR Supabase client so RLS still applies), then hand
 * it to a react-pdf template and stream the buffer back.
 *
 * react-pdf needs Node primitives (streams + Buffer), so this route runs
 * in the Node runtime, not Edge. It's pinned via `runtime = 'nodejs'`
 * below.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { computeBudget } from '@/lib/budget'
import { renderRunOfShowPdf } from '@/lib/pdf-runofshow'
import { BudgetPDF } from '@/components/pdf-templates/budget-pdf'
import { MonthViewPDF } from '@/components/pdf-templates/month-view-pdf'

export const runtime = 'nodejs'
// PDF generation is not cacheable — always regenerate so admins see the
// latest data the moment they hit Export.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const view = url.searchParams.get('view')

  // Auth: must be signed in AND admin. We piggyback on the same SSR
  // client the rest of the admin pages use; the (admin) layout's role
  // gate normally enforces this, but API routes don't run that layout,
  // so we redo the check inline.
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // Role gate. Note the column is profiles.user_id (FK to auth.users.id),
  // not profiles.id. Admins get full access. Collabs are allowed too —
  // RLS scopes which events they can fetch, so generating a PDF for an
  // event they're not attached to will simply produce a "not_found"
  // response when the queries return zero rows.
  const { data: profile } = await supabase
    .from('profiles')
    .select('roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile || (!profile.roles?.includes('admin') && !profile.roles?.includes('collab'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (view === 'runofshow') {
    return handleRunOfShow(url, supabase)
  }
  if (view === 'budget') {
    return handleBudget(url, supabase)
  }
  if (view === 'month') {
    // Month view exports the whole calendar — admins only. Collabs
    // shouldn't see other LosGothsCo events.
    if (!profile.roles?.includes('admin')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    return handleMonth(url, supabase)
  }

  return NextResponse.json(
    { error: 'unknown_view', supported: ['runofshow', 'budget', 'month'] },
    { status: 400 }
  )
}

// ---------------------------------------------------------------------------
// Run of show
// ---------------------------------------------------------------------------

type SBClient = Awaited<ReturnType<typeof createServerSupabaseClient>>

async function handleRunOfShow(
  url: URL,
  supabase: SBClient
): Promise<Response> {
  const eventId = url.searchParams.get('eventId')
  if (!eventId) {
    return NextResponse.json({ error: 'missing_eventId' }, { status: 400 })
  }

  const result = await renderRunOfShowPdf({ supabase, eventId })
  if (!result.ok) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

async function handleBudget(
  url: URL,
  supabase: SBClient
): Promise<Response> {
  const eventId = url.searchParams.get('eventId')
  if (!eventId) {
    return NextResponse.json({ error: 'missing_eventId' }, { status: 400 })
  }
  const budgetParam = url.searchParams.get('budget')
  const budgetType: 'estimated' | 'final' =
    budgetParam === 'final' ? 'final' : 'estimated'

  // Event scalar fields used in the header + the income calc.
  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select(
      'id, event_id, title, date, city, state, type, status, split_pct, bar_included, presented_by'
    )
    .eq('id', eventId)
    .maybeSingle()
  if (eventErr || !event) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // The active budget row holds the scalar income knobs (drop_off, guests,
  // sponsor/vendor income, merch tunables, deductions). If the requested
  // budget doesn't exist (e.g. asking for ?budget=final on an event that
  // hasn't been actualized), fall through to estimated.
  const tryFetch = async (type: 'estimated' | 'final') =>
    supabase
      .from('event_budgets')
      .select(
        'id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct'
      )
      .eq('event_id', eventId)
      .eq('budget_type', type)
      .maybeSingle()

  let { data: budget } = await tryFetch(budgetType)
  let resolvedType: 'estimated' | 'final' = budgetType
  if (!budget && budgetType === 'final') {
    const fallback = await tryFetch('estimated')
    budget = fallback.data
    resolvedType = 'estimated'
  }
  if (!budget) {
    return NextResponse.json({ error: 'no_budget' }, { status: 404 })
  }

  const [{ data: rawExpenses }, { data: rawTiers }] = await Promise.all([
    supabase
      .from('event_budget_expenses')
      .select('id, category, item, qty, price')
      .eq('budget_id', budget.id)
      .order('category', { ascending: true })
      .order('item', { ascending: true }),
    supabase
      .from('event_tix_tiers')
      .select('id, tier_number, price, sold')
      .eq('budget_id', budget.id)
      .order('tier_number', { ascending: true }),
  ])

  const expenses = (rawExpenses ?? []).map((e) => ({
    category: (e.category as string) ?? '',
    item: (e.item as string) ?? '',
    qty: Number(e.qty ?? 0),
    price: Number(e.price ?? 0),
  }))
  const tiers = (rawTiers ?? []).map((t) => ({
    tier_number: Number(t.tier_number ?? 0),
    price: Number(t.price ?? 0),
    sold: Number(t.sold ?? 0),
  }))

  const summary = computeBudget({
    tiers,
    drop_off: Number(budget.drop_off ?? 0),
    guests: Number(budget.guests ?? 0),
    tix_tax: Number(budget.tix_tax ?? 0),
    deductions: Number(budget.deductions ?? 0),
    sponsor_income: Number(budget.sponsor_income ?? 0),
    vendor_income: Number(budget.vendor_income ?? 0),
    split_pct: Number(event.split_pct ?? 0),
    bar_included: !!event.bar_included,
    merch_gross: Number(budget.merch_gross ?? 0),
    merch_pct_after_fees: Number(budget.merch_pct_after_fees ?? 0),
    merch_cogs_pct: Number(budget.merch_cogs_pct ?? 0),
    merch_seller_fee: Number(budget.merch_seller_fee ?? 0),
    bar_per_head: Number(budget.bar_per_head ?? 24),
    bar_pct: Number(budget.bar_pct ?? 0.16),
    expenses,
  })

  const buffer = await renderToBuffer(
    <BudgetPDF
      event={{
        title: (event.title as string) ?? 'Untitled',
        date: event.date as string,
        city: (event.city as string) ?? '',
        state: (event.state as string) ?? '',
        splitPct: Number(event.split_pct ?? 0),
        barIncluded: !!event.bar_included,
        presentedBy: event.presented_by as string | null,
      }}
      budgetType={resolvedType}
      summary={summary}
      expenses={expenses}
      tiers={tiers}
      generatedAt={new Date().toISOString()}
    />
  )

  const filename = `budget-${resolvedType}-${event.event_id ?? eventId}.pdf`
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parseIntInRange(
  raw: string | null,
  min: number,
  max: number,
  fallback: number
): number {
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

function monthBounds(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const last = new Date(Date.UTC(year, month, 0))
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { firstISO: fmt(first), lastISO: fmt(last) }
}

async function handleMonth(
  url: URL,
  supabase: SBClient
): Promise<Response> {
  const now = new Date()
  const year = parseIntInRange(
    url.searchParams.get('year'),
    2000,
    2100,
    now.getFullYear()
  )
  const month = parseIntInRange(
    url.searchParams.get('month'),
    1,
    12,
    now.getMonth() + 1
  )
  const confirmedOnly = url.searchParams.get('confirmed_only') === '1'

  const { firstISO, lastISO } = monthBounds(year, month)

  let q = supabase
    .from('events')
    .select(
      'id, date, day_of_week, weekend_number, title, type, status, city, state, venues(name)'
    )
    .gte('date', firstISO)
    .lte('date', lastISO)
    .order('weekend_number', { ascending: true })
    .order('date', { ascending: true })
  if (confirmedOnly) q = q.eq('status', 'confirmed')

  const { data: rawEvents } = await q

  type RawRow = {
    date: string
    day_of_week: string
    weekend_number: number
    title: string
    type: string
    status: string
    city: string
    state: string
    venues: { name: string } | { name: string }[] | null
  }

  const events = ((rawEvents ?? []) as RawRow[]).map((e) => ({
    date: e.date,
    day_of_week: e.day_of_week,
    weekend_number: e.weekend_number,
    title: e.title,
    type: e.type,
    status: e.status,
    city: e.city,
    state: e.state,
    venueName: Array.isArray(e.venues) ? e.venues[0]?.name : e.venues?.name,
  }))

  const buffer = await renderToBuffer(
    <MonthViewPDF
      monthName={MONTH_NAMES[month - 1]}
      year={year}
      confirmedOnly={confirmedOnly}
      events={events}
      generatedAt={new Date().toISOString()}
    />
  )

  const filename = `month-${year}-${String(month).padStart(2, '0')}${
    confirmedOnly ? '-confirmed' : ''
  }.pdf`
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
