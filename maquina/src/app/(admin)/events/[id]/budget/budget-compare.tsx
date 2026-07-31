import {
  computeBudget,
  formatUSD,
  formatUSDCents,
  EXPENSE_CATEGORY_ORDER,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from '@/lib/budget'

/**
 * Read-only compare view: estimated vs final, with variance per line.
 *
 * Variance convention (per BUILD_PLAN Phase 10):
 *   Δ = Final − Estimated
 *   For EXPENSES, variance under estimate (final < estimated) is GOOD →
 *   we display Δ as a NEGATIVE delta but tint it GREEN. Going over =
 *   RED. To keep the colors consistent across both expenses and the
 *   summary panel (where higher income = good), each row computes its
 *   sign from a `betterWhen: 'lower' | 'higher'` flag.
 *
 * Row matching:
 *   - Expenses: matched by (category, item). Lines that exist on only
 *     one side render with a "—" on the other.
 *   - Tiers: matched by tier_number.
 *
 * This component is a server component — it does no data fetching of its
 * own; the page hands it the rows and it just renders + computes.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type EventCommon = {
  id: string
  split_pct: number
  bar_included: boolean
}

type BudgetScalars = {
  drop_off: number
  guests: number
  tix_tax: number
  deductions: number
  sponsor_income: number
  vendor_income: number
  merch_gross: number
  merch_pct_after_fees: number
  merch_cogs_pct: number
  merch_seller_fee: number
  bar_per_head: number
  bar_pct: number
}

type ExpenseRow = {
  category: string
  item: string
  qty: number
  price: number
  /** Set for rows auto-populated from a vendor assigned to the event
   *  (event_vendors, migration 0031/0034). Null for freeform lines. */
  vendor_id: string | null
}

type TierRow = {
  tier_number: number
  price: number
  sold: number
}

export type BudgetCompareProps = {
  event: EventCommon
  estimated: BudgetScalars
  final: BudgetScalars
  estimatedExpenses: ExpenseRow[]
  finalExpenses: ExpenseRow[]
  estimatedTiers: TierRow[]
  finalTiers: TierRow[]
  /** Vendors assigned to this event (event_vendors) — used to label
   *  vendor-linked expense rows by name instead of item text. */
  eventVendors: Array<{ vendor_id: string; company_name: string }>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BudgetCompare({
  event,
  estimated,
  final,
  estimatedExpenses,
  finalExpenses,
  estimatedTiers,
  finalTiers,
  eventVendors,
}: BudgetCompareProps) {
  // Compute summaries on both sides — we feed identical inputs into the
  // same pure helper, so the variance display is bit-for-bit consistent
  // with what the editable views show.
  const estSummary = computeBudget({
    tiers: estimatedTiers,
    drop_off: estimated.drop_off,
    guests: estimated.guests,
    tix_tax: estimated.tix_tax,
    deductions: estimated.deductions,
    sponsor_income: estimated.sponsor_income,
    vendor_income: estimated.vendor_income,
    split_pct: event.split_pct,
    bar_included: event.bar_included,
    merch_gross: estimated.merch_gross,
    merch_pct_after_fees: estimated.merch_pct_after_fees,
    merch_cogs_pct: estimated.merch_cogs_pct,
    merch_seller_fee: estimated.merch_seller_fee,
    bar_per_head: estimated.bar_per_head,
    bar_pct: estimated.bar_pct,
    expenses: estimatedExpenses,
  })

  const finalSummary = computeBudget({
    tiers: finalTiers,
    drop_off: final.drop_off,
    guests: final.guests,
    tix_tax: final.tix_tax,
    deductions: final.deductions,
    sponsor_income: final.sponsor_income,
    vendor_income: final.vendor_income,
    split_pct: event.split_pct,
    bar_included: event.bar_included,
    merch_gross: final.merch_gross,
    merch_pct_after_fees: final.merch_pct_after_fees,
    merch_cogs_pct: final.merch_cogs_pct,
    merch_seller_fee: final.merch_seller_fee,
    bar_per_head: final.bar_per_head,
    bar_pct: final.bar_pct,
    expenses: finalExpenses,
  })

  return (
    <div className="space-y-8">
      {/* Top-line summary */}
      <SummarySection est={estSummary} fin={finalSummary} />

      {/* Tickets */}
      <TiersSection est={estimatedTiers} fin={finalTiers} />

      {/* Expenses, grouped by category */}
      <ExpensesSection
        est={estimatedExpenses}
        fin={finalExpenses}
        eventVendors={eventVendors}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary section
// ---------------------------------------------------------------------------

function SummarySection({
  est,
  fin,
}: {
  est: ReturnType<typeof computeBudget>
  fin: ReturnType<typeof computeBudget>
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
        Summary
      </h2>
      <CompareTable
        rows={[
          {
            label: 'Paid attendance',
            est: est.paid_attendance,
            fin: fin.paid_attendance,
            betterWhen: 'higher',
            format: 'count',
          },
          {
            label: 'Total attendance',
            est: est.total_attendance,
            fin: fin.total_attendance,
            betterWhen: 'higher',
            format: 'count',
          },
          {
            label: 'Gross ticket sales',
            est: est.gross_tix_total,
            fin: fin.gross_tix_total,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Ticket tax',
            est: est.tix_tax,
            fin: fin.tix_tax,
            betterWhen: 'lower',
            format: 'usd',
          },
          {
            label: 'Net ticket sales (after tax)',
            est: est.net_tix_total,
            fin: fin.net_tix_total,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'LosGothsCo ticket net',
            est: est.losgothsco_tix_net,
            fin: fin.losgothsco_tix_net,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Bar gross',
            est: est.bar_gross,
            fin: fin.bar_gross,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'LosGothsCo bar',
            est: est.losgothsco_bar,
            fin: fin.losgothsco_bar,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Net merch',
            est: est.net_merch,
            fin: fin.net_merch,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Sponsor income',
            est: est.sponsor_income,
            fin: fin.sponsor_income,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Vendor income',
            est: est.vendor_income,
            fin: fin.vendor_income,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Walkout',
            est: est.walkout,
            fin: fin.walkout,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Estimated income',
            est: est.est_income,
            fin: fin.est_income,
            betterWhen: 'higher',
            format: 'usd',
          },
          {
            label: 'Estimated expenses',
            est: est.est_expenses,
            fin: fin.est_expenses,
            betterWhen: 'lower',
            format: 'usd',
          },
          {
            label: 'Profit',
            est: est.est_profit,
            fin: fin.est_profit,
            betterWhen: 'higher',
            format: 'usd',
            emphasize: true,
          },
        ]}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tiers section
// ---------------------------------------------------------------------------

function TiersSection({ est, fin }: { est: TierRow[]; fin: TierRow[] }) {
  // Match by tier_number; show the union 1..8 in numeric order.
  const numbers = new Set<number>()
  for (const t of est) numbers.add(t.tier_number)
  for (const t of fin) numbers.add(t.tier_number)
  if (numbers.size === 0) return null

  const ordered = Array.from(numbers).sort((a, b) => a - b)

  const rows = ordered.flatMap((n) => {
    const e = est.find((t) => t.tier_number === n)
    const f = fin.find((t) => t.tier_number === n)
    return [
      {
        label: `Tier ${n} · price`,
        est: e?.price ?? null,
        fin: f?.price ?? null,
        betterWhen: 'higher' as const,
        format: 'usdc' as const,
      },
      {
        label: `Tier ${n} · sold`,
        est: e?.sold ?? null,
        fin: f?.sold ?? null,
        betterWhen: 'higher' as const,
        format: 'count' as const,
      },
      {
        label: `Tier ${n} · revenue`,
        est: e ? e.price * e.sold : null,
        fin: f ? f.price * f.sold : null,
        betterWhen: 'higher' as const,
        format: 'usd' as const,
      },
    ]
  })

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
        Tickets
      </h2>
      <CompareTable rows={rows} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Expenses section
// ---------------------------------------------------------------------------

function ExpensesSection({
  est,
  fin,
  eventVendors,
}: {
  est: ExpenseRow[]
  fin: ExpenseRow[]
  eventVendors: Array<{ vendor_id: string; company_name: string }>
}) {
  const vendorNameById = new Map(
    eventVendors.map((v) => [v.vendor_id, v.company_name])
  )

  return (
    <section className="space-y-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
        Expenses
      </h2>
      {EXPENSE_CATEGORY_ORDER.map((cat) => {
        const inCat = (rows: ExpenseRow[]) =>
          rows.filter((r) => normalizeCategory(r.category) === cat)
        const e = inCat(est)
        const f = inCat(fin)
        if (e.length === 0 && f.length === 0) return null

        let lineRows: Array<{
          label: string
          est: number | null
          fin: number | null
          betterWhen: 'lower'
          format: 'usdc'
        }>

        if (cat === 'vendors') {
          // Vendor-linked rows match by vendor_id (name comes first in
          // the label, per Chase); freeform vendor-cost lines (no
          // roster vendor) still match by item name, same as every
          // other category.
          const eLinked = e.filter((r) => r.vendor_id)
          const fLinked = f.filter((r) => r.vendor_id)
          const eFreeform = e.filter((r) => !r.vendor_id)
          const fFreeform = f.filter((r) => !r.vendor_id)

          const vendorIds = new Set<string>()
          for (const r of eLinked) vendorIds.add(r.vendor_id as string)
          for (const r of fLinked) vendorIds.add(r.vendor_id as string)

          const linkedRows = Array.from(vendorIds)
            .sort((a, b) =>
              (vendorNameById.get(a) ?? '').localeCompare(
                vendorNameById.get(b) ?? ''
              )
            )
            .map((vid) => {
              const eRow = eLinked.find((r) => r.vendor_id === vid)
              const fRow = fLinked.find((r) => r.vendor_id === vid)
              const name = vendorNameById.get(vid) ?? 'Vendor'
              const type = eRow?.item || fRow?.item || ''
              return {
                label: type ? `${name} — ${type}` : name,
                est: eRow ? eRow.qty * eRow.price : null,
                fin: fRow ? fRow.qty * fRow.price : null,
                betterWhen: 'lower' as const,
                format: 'usdc' as const,
              }
            })

          const freeformItems = new Set<string>()
          for (const r of eFreeform) freeformItems.add(r.item)
          for (const r of fFreeform) freeformItems.add(r.item)
          const freeformRows = Array.from(freeformItems)
            .sort((a, b) => a.localeCompare(b))
            .map((item) => {
              const eRow = eFreeform.find((r) => r.item === item)
              const fRow = fFreeform.find((r) => r.item === item)
              return {
                label: item,
                est: eRow ? eRow.qty * eRow.price : null,
                fin: fRow ? fRow.qty * fRow.price : null,
                betterWhen: 'lower' as const,
                format: 'usdc' as const,
              }
            })

          lineRows = [...linkedRows, ...freeformRows]
        } else {
          // Match by item name within the category. Items present on
          // only one side render with a "—" on the other (subtotal
          // still picks them up, so the variance reflects added/removed
          // lines).
          const items = new Set<string>()
          for (const r of e) items.add(r.item)
          for (const r of f) items.add(r.item)

          const orderedItems = Array.from(items).sort((a, b) =>
            a.localeCompare(b)
          )

          lineRows = orderedItems.map((item) => {
            const eRow = e.find((r) => r.item === item)
            const fRow = f.find((r) => r.item === item)
            return {
              label: item,
              est: eRow ? eRow.qty * eRow.price : null,
              fin: fRow ? fRow.qty * fRow.price : null,
              betterWhen: 'lower' as const,
              format: 'usdc' as const,
            }
          })
        }

        const eSubtotal = e.reduce((acc, r) => acc + r.qty * r.price, 0)
        const fSubtotal = f.reduce((acc, r) => acc + r.qty * r.price, 0)

        return (
          <div
            key={cat}
            className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h3 className="mb-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {EXPENSE_CATEGORY_LABELS[cat]}
            </h3>
            <CompareTable
              rows={[
                ...lineRows,
                {
                  label: 'Subtotal',
                  est: eSubtotal,
                  fin: fSubtotal,
                  betterWhen: 'lower',
                  format: 'usd',
                  emphasize: true,
                },
              ]}
            />
          </div>
        )
      })}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Compare table primitive
// ---------------------------------------------------------------------------

type CompareRow = {
  label: string
  est: number | null
  fin: number | null
  betterWhen: 'higher' | 'lower'
  format: 'usd' | 'usdc' | 'count'
  emphasize?: boolean
}

function CompareTable({ rows }: { rows: CompareRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <th className="py-2 text-left font-medium">Line</th>
          <th className="py-2 text-right font-medium">Estimated</th>
          <th className="py-2 text-right font-medium">Final</th>
          <th className="py-2 text-right font-medium">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <CompareTableRow key={row.label} row={row} />
        ))}
      </tbody>
    </table>
  )
}

function CompareTableRow({ row }: { row: CompareRow }) {
  const eVal = row.est
  const fVal = row.fin
  const delta = eVal != null && fVal != null ? fVal - eVal : null

  // Color logic:
  //   - betterWhen='higher': delta > 0 is green (we did better than estimate).
  //   - betterWhen='lower':  delta < 0 is green (we came in under estimate).
  //   - delta === 0 → neutral.
  let deltaClass = 'text-zinc-500 dark:text-zinc-400'
  if (delta != null && delta !== 0) {
    const isGood =
      row.betterWhen === 'higher' ? delta > 0 : delta < 0
    deltaClass = isGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400'
  }

  const labelClass = row.emphasize
    ? 'py-2 pr-4 text-left font-semibold text-zinc-900 dark:text-zinc-50'
    : 'py-2 pr-4 text-left text-zinc-700 dark:text-zinc-300'
  const numberClass = row.emphasize
    ? 'py-2 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50'
    : 'py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300'

  return (
    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
      <td className={labelClass}>{row.label}</td>
      <td className={numberClass}>{formatValue(eVal, row.format)}</td>
      <td className={numberClass}>{formatValue(fVal, row.format)}</td>
      <td className={`py-2 text-right tabular-nums ${deltaClass}`}>
        {delta == null
          ? '—'
          : `${delta > 0 ? '+' : ''}${formatValue(delta, row.format)}`}
      </td>
    </tr>
  )
}

function formatValue(n: number | null, format: CompareRow['format']): string {
  if (n == null) return '—'
  if (format === 'usd') return formatUSD(n)
  if (format === 'usdc') return formatUSDCents(n)
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a category string from the DB into the typed enum used by the
 * UI maps. Unknown categories fall through to 'digital' to keep the
 * compare view from crashing if the DB ever grows a new category before
 * the UI picks it up.
 */
function normalizeCategory(raw: string): ExpenseCategory {
  return (EXPENSE_CATEGORY_ORDER as readonly string[]).includes(raw)
    ? (raw as ExpenseCategory)
    : 'digital'
}
