import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { BudgetCompare } from '@/app/(admin)/events/[id]/budget/budget-compare'
import { computeBudget, formatUSD, formatUSDCents, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@/lib/budget'

/**
 * Finance budget view — read-only, no edit rights (migration 0030).
 *
 * If a final budget exists, reuses the same BudgetCompare component the
 * admin compare view uses (it's already pure/presentational, no writes).
 * Otherwise renders a lean read-only summary of the estimated budget via
 * computeBudget() — same formulas as the admin BudgetForm, just no inputs.
 *
 * No export/PDF, no toolbar, no edit link — finance only ever sees this
 * one screen per event.
 */
export default async function FinanceEventBudgetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select(
      'id, event_id, title, date, city, state, status, split_pct, bar_included'
    )
    .eq('id', id)
    .maybeSingle()

  if (eventErr || !event) notFound()

  const { data: estimated } = await supabase
    .from('event_budgets')
    .select(
      'id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct'
    )
    .eq('event_id', id)
    .eq('budget_type', 'estimated')
    .maybeSingle()

  if (!estimated) notFound()

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

  const { data: finalBudget } = await supabase
    .from('event_budgets')
    .select(
      'id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct'
    )
    .eq('event_id', id)
    .eq('budget_type', 'final')
    .maybeSingle()

  const eventCommon = {
    id: event.id as string,
    split_pct: Number(event.split_pct ?? 0),
    bar_included: !!event.bar_included,
  }

  const headerEl = (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        {event.title}
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
    </header>
  )

  const backLink = (
    <Link
      href="/finance/events"
      className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      ← All events
    </Link>
  )

  if (finalBudget) {
    const [
      { data: estExpenses },
      { data: estTiers },
      { data: finalExpenses },
      { data: finalTiers },
    ] = await Promise.all([
      supabase
        .from('event_budget_expenses')
        .select('category, item, qty, price, vendor_id')
        .eq('budget_id', estimated.id)
        .order('category', { ascending: true })
        .order('item', { ascending: true }),
      supabase
        .from('event_tix_tiers')
        .select('tier_number, price, sold')
        .eq('budget_id', estimated.id)
        .order('tier_number', { ascending: true }),
      supabase
        .from('event_budget_expenses')
        .select('category, item, qty, price, vendor_id')
        .eq('budget_id', finalBudget.id)
        .order('category', { ascending: true })
        .order('item', { ascending: true }),
      supabase
        .from('event_tix_tiers')
        .select('tier_number, price, sold')
        .eq('budget_id', finalBudget.id)
        .order('tier_number', { ascending: true }),
    ])

    return (
      <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-6xl space-y-8">
          <div>{backLink}</div>
          {headerEl}
          <BudgetCompare
            event={eventCommon}
            estimated={scalars(estimated)}
            final={scalars(finalBudget)}
            eventVendors={eventVendors}
            estimatedExpenses={(estExpenses ?? []).map(mapExpense)}
            finalExpenses={(finalExpenses ?? []).map(mapExpense)}
            estimatedTiers={(estTiers ?? []).map(mapTier)}
            finalTiers={(finalTiers ?? []).map(mapTier)}
          />
        </div>
      </div>
    )
  }

  // Estimated-only: no final budget yet. Render a plain read-only summary
  // instead of the full compare table.
  const [{ data: expenses }, { data: tiers }] = await Promise.all([
    supabase
      .from('event_budget_expenses')
      .select('category, item, qty, price')
      .eq('budget_id', estimated.id)
      .order('category', { ascending: true })
      .order('item', { ascending: true }),
    supabase
      .from('event_tix_tiers')
      .select('tier_number, price, sold')
      .eq('budget_id', estimated.id)
      .order('tier_number', { ascending: true }),
  ])

  const summary = computeBudget({
    tiers: (tiers ?? []).map((t) => ({
      price: Number(t.price ?? 0),
      sold: Number(t.sold ?? 0),
    })),
    drop_off: Number(estimated.drop_off ?? 0),
    guests: Number(estimated.guests ?? 0),
    tix_tax: Number(estimated.tix_tax ?? 0),
    deductions: Number(estimated.deductions ?? 0),
    sponsor_income: Number(estimated.sponsor_income ?? 0),
    vendor_income: Number(estimated.vendor_income ?? 0),
    split_pct: eventCommon.split_pct,
    bar_included: eventCommon.bar_included,
    bar_per_head: Number(estimated.bar_per_head ?? 24),
    bar_pct: Number(estimated.bar_pct ?? 0.16),
    merch_gross: Number(estimated.merch_gross ?? 400),
    merch_pct_after_fees: Number(estimated.merch_pct_after_fees ?? 0.97),
    merch_cogs_pct: Number(estimated.merch_cogs_pct ?? 0.35),
    merch_seller_fee: Number(estimated.merch_seller_fee ?? 120),
    expenses: (expenses ?? []).map((e) => ({
      qty: Number(e.qty ?? 0),
      price: Number(e.price ?? 0),
    })),
  })

  return (
    <div className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>{backLink}</div>
        {headerEl}
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Estimated budget only — no final/actuals yet.
        </p>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Income summary
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <SummaryRow label="Paid attendance" value={String(summary.paid_attendance)} />
            <SummaryRow label="Total attendance" value={String(summary.total_attendance)} />
            <SummaryRow label="Gross tix total" value={formatUSD(summary.gross_tix_total)} />
            <SummaryRow label="Walkout (tix + bar − ded.)" value={formatUSD(summary.walkout)} />
            <SummaryRow label="Net merch" value={formatUSD(summary.net_merch)} />
            <SummaryRow label="Sponsor income" value={formatUSD(summary.sponsor_income)} />
            <SummaryRow label="Vendor income" value={formatUSD(summary.vendor_income)} />
            <SummaryRow label="Est. income" value={formatUSD(summary.est_income)} strong />
            <SummaryRow label="Est. expenses" value={formatUSD(summary.est_expenses)} strong />
            <SummaryRow label="Est. profit" value={formatUSD(summary.est_profit)} strong />
          </dl>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Expenses
          </h2>
          {(expenses ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No expense lines.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Category</th>
                  <th className="py-1.5 pr-3 font-medium">Item</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Price</th>
                  <th className="py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {(expenses ?? []).map((e, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-300">
                      {EXPENSE_CATEGORY_LABELS[e.category as ExpenseCategory] ?? e.category}
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-300">{e.item}</td>
                    <td className="py-1.5 pr-3 text-right text-zinc-700 dark:text-zinc-300">
                      {Number(e.qty ?? 0)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-zinc-700 dark:text-zinc-300">
                      {formatUSDCents(Number(e.price ?? 0))}
                    </td>
                    <td className="py-1.5 text-right font-medium text-zinc-900 dark:text-zinc-100">
                      {formatUSDCents(Number(e.qty ?? 0) * Number(e.price ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd
        className={
          strong
            ? 'font-semibold text-zinc-900 dark:text-zinc-100'
            : 'text-zinc-700 dark:text-zinc-300'
        }
      >
        {value}
      </dd>
    </div>
  )
}

type BudgetRow = {
  id: string
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

function scalars(b: BudgetRow) {
  return {
    drop_off: Number(b.drop_off ?? 0),
    guests: Number(b.guests ?? 0),
    tix_tax: Number(b.tix_tax ?? 0),
    deductions: Number(b.deductions ?? 0),
    sponsor_income: Number(b.sponsor_income ?? 0),
    vendor_income: Number(b.vendor_income ?? 0),
    merch_gross: Number(b.merch_gross ?? 400),
    merch_pct_after_fees: Number(b.merch_pct_after_fees ?? 0.97),
    merch_cogs_pct: Number(b.merch_cogs_pct ?? 0.35),
    merch_seller_fee: Number(b.merch_seller_fee ?? 120),
    bar_per_head: Number(b.bar_per_head ?? 24),
    bar_pct: Number(b.bar_pct ?? 0.16),
  }
}

function mapExpense(e: {
  category: string
  item: string
  qty: number | null
  price: number | null
  vendor_id: string | null
}) {
  return {
    category: e.category,
    item: e.item,
    qty: Number(e.qty ?? 0),
    price: Number(e.price ?? 0),
    vendor_id: e.vendor_id ?? null,
  }
}

function mapTier(t: { tier_number: number; price: number | null; sold: number | null }) {
  return {
    tier_number: t.tier_number,
    price: Number(t.price ?? 0),
    sold: Number(t.sold ?? 0),
  }
}
