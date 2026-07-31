import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { BudgetForm } from './budget-form'
import { BudgetCompare } from './budget-compare'
import { ViewToolbar } from './view-toolbar'

/**
 * Admin budget page.
 *
 * Phase 9 (estimated only) shipped here first; Phase 10 layered on the
 * final budget + compare view via a `?view=` query param:
 *
 *   ?view=estimated  (default) — editable estimated budget
 *   ?view=final                — editable final/actuals budget
 *                                (only valid once the event has been
 *                                 actualized — auto-redirects to
 *                                 estimated if no final exists)
 *   ?view=compare              — read-only side-by-side variance
 *
 * Loading strategy:
 *   - Always fetch the estimated budget. If missing, 404 (the seed and
 *     createEvent both insert one — this only fires for partially failed
 *     legacy inserts).
 *   - Fetch the final budget if it exists. Its presence drives whether
 *     the toolbar shows "Actualize" vs the Final/Compare tabs.
 *   - For the active view, fetch that budget's expenses + tiers.
 */
export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view: viewParam } = await searchParams
  const supabase = await createServerSupabaseClient()

  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select(
      'id, event_id, title, date, city, state, type, status, split_pct, bar_included'
    )
    .eq('id', id)
    .maybeSingle()

  if (eventErr || !event) notFound()

  // Estimated is required.
  const { data: estimated } = await supabase
    .from('event_budgets')
    .select(
      'id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct, chase_share_pct, elvis_share_pct, chase_payment_status, chase_payment_method, elvis_payment_status, elvis_payment_method'
    )
    .eq('event_id', id)
    .eq('budget_type', 'estimated')
    .maybeSingle()

  if (!estimated) notFound()

  // Vendors assigned to this event (migration 0031) — shared between
  // Estimated and Final (event_vendors is keyed by event_id, not budget),
  // so this one fetch feeds both the editable views and the compare view.
  // Drives the budget's "Vendors" expense category: one row per assigned
  // vendor, name auto-populated, admin fills in Rate + Type.
  const { data: eventVendorRows } = await supabase
    .from('event_vendors')
    .select('vendor_id, vendors(company_name)')
    .eq('event_id', id)
  const eventVendors = (eventVendorRows ?? []).map((r) => {
    const vendor = Array.isArray(r.vendors) ? r.vendors[0] : r.vendors
    return {
      vendor_id: r.vendor_id as string,
      company_name: (vendor?.company_name as string | undefined) ?? 'Vendor',
    }
  })

  // Final is optional — only present once the admin has actualized.
  const { data: finalBudget } = await supabase
    .from('event_budgets')
    .select(
      'id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct, chase_share_pct, elvis_share_pct, chase_payment_status, chase_payment_method, elvis_payment_status, elvis_payment_method'
    )
    .eq('event_id', id)
    .eq('budget_type', 'final')
    .maybeSingle()

  // Resolve the active view. Asking for final/compare without a final
  // budget existing redirects you back to estimated (clean URL beats
  // surfacing a "view doesn't exist yet" error).
  const requested =
    viewParam === 'final' || viewParam === 'compare' || viewParam === 'estimated'
      ? viewParam
      : 'estimated'
  if ((requested === 'final' || requested === 'compare') && !finalBudget) {
    redirect(`/events/${id}/budget?view=estimated`)
  }
  const view: 'estimated' | 'final' | 'compare' = requested

  // For non-compare views, fetch only the active budget's children.
  // Compare needs both — fetch in parallel below.
  const eventCommon = {
    id: event.id as string,
    split_pct: Number(event.split_pct ?? 0),
    bar_included: !!event.bar_included,
  }

  // ---------------- Header (shared across all views) ----------------------
  // Export PDF only applies to the editable views (estimated/final).
  // Compare exports aren't part of Phase 12 scope.
  const exportHref =
    view === 'compare'
      ? null
      : `/api/pdf?view=budget&eventId=${id}&budget=${view}`

  const headerEl = (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {view === 'estimated'
            ? 'Estimated budget'
            : view === 'final'
              ? 'Final budget'
              : 'Compare: estimated vs final'}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {event.title} ·{' '}
          {new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}{' '}
          · {event.city}, {event.state}
        </p>
        <p className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
          {event.event_id}
        </p>
      </div>
      {exportHref ? (
        <a
          href={exportHref}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Export PDF
        </a>
      ) : null}
    </header>
  )

  // ---------------- Compare view -----------------------------------------
  if (view === 'compare' && finalBudget) {
    const [
      { data: estExpenses },
      { data: estTiers },
      { data: finalExpenses },
      { data: finalTiers },
    ] = await Promise.all([
      supabase
        .from('event_budget_expenses')
        .select('id, category, item, qty, price, vendor_id')
        .eq('budget_id', estimated.id)
        .order('category', { ascending: true })
        .order('item', { ascending: true }),
      supabase
        .from('event_tix_tiers')
        .select('id, tier_number, price, sold')
        .eq('budget_id', estimated.id)
        .order('tier_number', { ascending: true }),
      supabase
        .from('event_budget_expenses')
        .select('id, category, item, qty, price, vendor_id')
        .eq('budget_id', finalBudget.id)
        .order('category', { ascending: true })
        .order('item', { ascending: true }),
      supabase
        .from('event_tix_tiers')
        .select('id, tier_number, price, sold')
        .eq('budget_id', finalBudget.id)
        .order('tier_number', { ascending: true }),
    ])

    return (
      <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-6xl space-y-8">
          <div>
            <Link
              href={`/events/${id}/edit`}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              ← Back to event
            </Link>
          </div>
          {headerEl}
          <ViewToolbar
            eventId={id}
            currentView={view}
            hasFinal={!!finalBudget}
          />
          <BudgetCompare
            event={eventCommon}
            estimated={{
              drop_off: Number(estimated.drop_off ?? 0),
              guests: Number(estimated.guests ?? 0),
              tix_tax: Number(estimated.tix_tax ?? 0),
              deductions: Number(estimated.deductions ?? 0),
              sponsor_income: Number(estimated.sponsor_income ?? 0),
              vendor_income: Number(estimated.vendor_income ?? 0),
              merch_gross: Number(estimated.merch_gross ?? 400),
              merch_pct_after_fees: Number(estimated.merch_pct_after_fees ?? 0.97),
              merch_cogs_pct: Number(estimated.merch_cogs_pct ?? 0.35),
              merch_seller_fee: Number(estimated.merch_seller_fee ?? 120),
              bar_per_head: Number(estimated.bar_per_head ?? 24),
              bar_pct: Number(estimated.bar_pct ?? 0.16),
            }}
            final={{
              drop_off: Number(finalBudget.drop_off ?? 0),
              guests: Number(finalBudget.guests ?? 0),
              tix_tax: Number(finalBudget.tix_tax ?? 0),
              deductions: Number(finalBudget.deductions ?? 0),
              sponsor_income: Number(finalBudget.sponsor_income ?? 0),
              vendor_income: Number(finalBudget.vendor_income ?? 0),
              merch_gross: Number(finalBudget.merch_gross ?? 400),
              merch_pct_after_fees: Number(finalBudget.merch_pct_after_fees ?? 0.97),
              merch_cogs_pct: Number(finalBudget.merch_cogs_pct ?? 0.35),
              merch_seller_fee: Number(finalBudget.merch_seller_fee ?? 120),
              bar_per_head: Number(finalBudget.bar_per_head ?? 24),
              bar_pct: Number(finalBudget.bar_pct ?? 0.16),
            }}
            eventVendors={eventVendors}
            estimatedExpenses={(estExpenses ?? []).map((e) => ({
              category: e.category as string,
              item: e.item as string,
              qty: Number(e.qty ?? 0),
              price: Number(e.price ?? 0),
              vendor_id: (e.vendor_id as string | null) ?? null,
            }))}
            finalExpenses={(finalExpenses ?? []).map((e) => ({
              category: e.category as string,
              item: e.item as string,
              qty: Number(e.qty ?? 0),
              price: Number(e.price ?? 0),
              vendor_id: (e.vendor_id as string | null) ?? null,
            }))}
            estimatedTiers={(estTiers ?? []).map((t) => ({
              tier_number: t.tier_number as number,
              price: Number(t.price ?? 0),
              sold: Number(t.sold ?? 0),
            }))}
            finalTiers={(finalTiers ?? []).map((t) => ({
              tier_number: t.tier_number as number,
              price: Number(t.price ?? 0),
              sold: Number(t.sold ?? 0),
            }))}
          />
        </div>
      </div>
    )
  }

  // ---------------- Estimated / Final editable views ---------------------
  const activeBudget = view === 'final' && finalBudget ? finalBudget : estimated

  const [{ data: expenses }, { data: tiers }] = await Promise.all([
    supabase
      .from('event_budget_expenses')
      .select(
        'id, category, item, qty, price, payment_status, payment_method, vendor_id'
      )
      .eq('budget_id', activeBudget.id)
      .order('category', { ascending: true })
      .order('item', { ascending: true }),
    supabase
      .from('event_tix_tiers')
      .select('id, tier_number, price, sold')
      .eq('budget_id', activeBudget.id)
      .order('tier_number', { ascending: true }),
  ])

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <Link
            href={`/events/${id}/edit`}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← Back to event
          </Link>
        </div>

        {headerEl}

        <ViewToolbar
          eventId={id}
          currentView={view}
          hasFinal={!!finalBudget}
        />

        <BudgetForm
          key={activeBudget.id}
          event={eventCommon}
          isFinal={view === 'final'}
          budget={{
            id: activeBudget.id as string,
            drop_off: Number(activeBudget.drop_off ?? 0),
            guests: Number(activeBudget.guests ?? 0),
            tix_tax: Number(activeBudget.tix_tax ?? 0),
            deductions: Number(activeBudget.deductions ?? 0),
            sponsor_income: Number(activeBudget.sponsor_income ?? 0),
            vendor_income: Number(activeBudget.vendor_income ?? 0),
            merch_gross: Number(activeBudget.merch_gross ?? 400),
            merch_pct_after_fees: Number(activeBudget.merch_pct_after_fees ?? 0.97),
            merch_cogs_pct: Number(activeBudget.merch_cogs_pct ?? 0.35),
            merch_seller_fee: Number(activeBudget.merch_seller_fee ?? 120),
            bar_per_head: Number(activeBudget.bar_per_head ?? 24),
            bar_pct: Number(activeBudget.bar_pct ?? 0.16),
            chase_share_pct: Number(activeBudget.chase_share_pct ?? 0.4),
            elvis_share_pct: Number(activeBudget.elvis_share_pct ?? 0.6),
            chase_payment_status: normalizePaymentStatus(
              activeBudget.chase_payment_status
            ),
            chase_payment_method:
              activeBudget.chase_payment_method == null
                ? ''
                : String(activeBudget.chase_payment_method),
            elvis_payment_status: normalizePaymentStatus(
              activeBudget.elvis_payment_status
            ),
            elvis_payment_method:
              activeBudget.elvis_payment_method == null
                ? ''
                : String(activeBudget.elvis_payment_method),
          }}
          eventVendors={eventVendors}
          initialExpenses={(expenses ?? []).map((e) => ({
            id: e.id as string,
            category: e.category as string,
            item: e.item as string,
            qty: e.qty == null ? '0' : String(e.qty),
            price: e.price == null ? '0' : String(e.price),
            payment_status: normalizePaymentStatus(e.payment_status),
            payment_method:
              e.payment_method == null ? '' : String(e.payment_method),
            vendor_id: (e.vendor_id as string | null) ?? null,
          }))}
          initialTiers={(tiers ?? []).map((t) => ({
            id: t.id as string,
            tier_number: t.tier_number as number,
            price: t.price == null ? '0' : String(t.price),
            sold: t.sold == null ? '0' : String(t.sold),
          }))}
        />
      </div>
    </div>
  )
}

/** Defensive coerce — DB column is now binary unpaid/paid (migration 0013).
 *  Anything unexpected falls back to 'unpaid'. */
function normalizePaymentStatus(raw: unknown): 'unpaid' | 'paid' {
  return raw === 'paid' ? 'paid' : 'unpaid'
}
