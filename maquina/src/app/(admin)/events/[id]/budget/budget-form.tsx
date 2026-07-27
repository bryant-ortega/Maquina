'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  computeBudget,
  formatUSD,
  formatUSDCents,
  EXPENSE_CATEGORY_ORDER,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  BAR_PER_HEAD,
  LOSGOTHSCO_BAR_PCT,
  MERCH_GROSS_DEFAULT,
  MERCH_PCT_AFTER_FEES,
  MERCH_COGS_PCT,
  MERCH_SELLER_FEE,
} from '@/lib/budget'
import { updateBudget, type UpdateBudgetResult } from './actions'

/**
 * Editable estimated-budget UI for an event.
 *
 * Shape:
 *   - Expenses, grouped by category. Each row has qty, unit price, computed
 *     line total, plus a per-category subtotal and an "Add line" button.
 *     Items can be deleted (the row turns into a pending-delete that the
 *     server action removes on save).
 *   - Ticket tiers, 1..8 rows, each with price + sold.
 *   - Income parameter inputs (drop_off, guests, deductions, sponsor_income,
 *     vendor_income) — the only per-event scalars not derived from
 *     expenses/tiers.
 *   - A live income summary computed via /lib/budget. Recomputes on every
 *     keystroke; nothing in this panel is persisted directly — the next
 *     render computes it again from the inputs.
 *
 * Save flow:
 *   - Build a JSON payload that mirrors the server action's Zod schema.
 *   - Hand it off to updateBudget. Surface field-level errors next to the
 *     offending row by id, plus a top-level error banner for anything
 *     non-row-shaped (e.g., db_failed).
 *
 * Why we keep numeric fields as strings:
 *   - <input type="number"> + a numeric React state silently coerces "" to
 *     NaN, which then renders as the string "NaN". Storing as string and
 *     converting at compute/save time avoids that whole class of bug and
 *     matches every other form in this codebase.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentStatus = 'unpaid' | 'paid'

type ExpenseRow = {
  /** Stable React key. NOT the DB id. */
  uid: string
  /** Empty if this row was added in the form and hasn't been saved yet. */
  id: string
  category: ExpenseCategory
  item: string
  qty: string
  price: string
  /**
   * Inline payment tracking — editable in the Final view only. Binary
   * unpaid/paid (no partial). Estimated rows still carry these fields
   * so the row shape stays uniform; controls just don't render there.
   */
  payment_status: PaymentStatus
  /** Freeform method text. Required when payment_status='paid'. */
  payment_method: string
}

type TierRow = {
  uid: string
  id: string
  tier_number: number
  price: string
  sold: string
}

export type BudgetFormProps = {
  event: {
    id: string
    split_pct: number
    bar_included: boolean
  }
  /**
   * True when editing the actualized (final) budget. The Paid status +
   * payment method controls only render in this mode — estimated rows
   * shouldn't be tracking payment state.
   */
  isFinal: boolean
  budget: {
    id: string
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
    chase_share_pct: number
    elvis_share_pct: number
    chase_payment_status: PaymentStatus
    chase_payment_method: string
    elvis_payment_status: PaymentStatus
    elvis_payment_method: string
  }
  initialExpenses: Array<{
    id: string
    category: string
    item: string
    qty: string
    price: string
    payment_status: PaymentStatus
    payment_method: string
  }>
  initialTiers: Array<{
    id: string
    tier_number: number
    price: string
    sold: string
  }>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BudgetForm({
  event,
  isFinal,
  budget,
  initialExpenses,
  initialTiers,
}: BudgetFormProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [topError, setTopError] = useState<string | null>(null)
  const [topSuccess, setTopSuccess] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [expenses, setExpenses] = useState<ExpenseRow[]>(() =>
    initialExpenses.map((e) => ({
      uid: crypto.randomUUID(),
      id: e.id,
      category: normalizeCategory(e.category),
      item: e.item,
      qty: e.qty,
      price: e.price,
      payment_status: e.payment_status,
      payment_method: e.payment_method,
    }))
  )

  const [tiers, setTiers] = useState<TierRow[]>(() =>
    initialTiers.map((t) => ({
      uid: crypto.randomUUID(),
      id: t.id,
      tier_number: t.tier_number,
      price: t.price,
      sold: t.sold,
    }))
  )

  const [dropOff, setDropOff] = useState<string>(String(budget.drop_off))
  const [guests, setGuests] = useState<string>(String(budget.guests))
  const [tixTax, setTixTax] = useState<string>(String(budget.tix_tax))
  const [deductions, setDeductions] = useState<string>(
    String(budget.deductions)
  )
  const [sponsorIncome, setSponsorIncome] = useState<string>(
    String(budget.sponsor_income)
  )
  const [vendorIncome, setVendorIncome] = useState<string>(
    String(budget.vendor_income)
  )
  const [merchGross, setMerchGross] = useState<string>(
    String(budget.merch_gross)
  )
  const [merchPctAfterFees, setMerchPctAfterFees] = useState<string>(
    // Stored as 0..1 in the DB; surfaced as 0..100 in the UI for clarity.
    String(budget.merch_pct_after_fees * 100)
  )
  const [merchCogsPct, setMerchCogsPct] = useState<string>(
    String(budget.merch_cogs_pct * 100)
  )
  const [merchSellerFee, setMerchSellerFee] = useState<string>(
    String(budget.merch_seller_fee)
  )
  // Per-event bar tunables (Phase 14). Stored as $/head and 0..1 ratio
  // in the DB; surfaced as $ and 0..100 in the UI for clarity.
  const [barPerHead, setBarPerHead] = useState<string>(
    String(budget.bar_per_head)
  )
  const [barPct, setBarPct] = useState<string>(
    String(budget.bar_pct * 100)
  )

  // Partner profit-split — Final budget only in the UI. Stored as 0..1 in
  // the DB (defaults 0.4 / 0.6); surfaced as 0..100 for editing, same
  // convention as the merch/bar percent fields above.
  const [chaseSharePct, setChaseSharePct] = useState<string>(
    String(budget.chase_share_pct * 100)
  )
  const [elvisSharePct, setElvisSharePct] = useState<string>(
    String(budget.elvis_share_pct * 100)
  )
  const [chasePaymentStatus, setChasePaymentStatus] = useState<PaymentStatus>(
    budget.chase_payment_status
  )
  const [chasePaymentMethod, setChasePaymentMethod] = useState<string>(
    budget.chase_payment_method
  )
  const [elvisPaymentStatus, setElvisPaymentStatus] = useState<PaymentStatus>(
    budget.elvis_payment_status
  )
  const [elvisPaymentMethod, setElvisPaymentMethod] = useState<string>(
    budget.elvis_payment_method
  )

  // ---------------------------------------------------------------- Derived

  const summary = useMemo(
    () =>
      computeBudget({
        tiers: tiers.map((t) => ({
          price: Number(t.price),
          sold: Number(t.sold),
        })),
        drop_off: Number(dropOff),
        guests: Number(guests),
        tix_tax: Number(tixTax),
        deductions: Number(deductions),
        sponsor_income: Number(sponsorIncome),
        vendor_income: Number(vendorIncome),
        split_pct: event.split_pct,
        bar_included: event.bar_included,
        merch_gross: Number(merchGross),
        // UI percent (0..100) → ratio (0..1) for the formula.
        merch_pct_after_fees: Number(merchPctAfterFees) / 100,
        merch_cogs_pct: Number(merchCogsPct) / 100,
        merch_seller_fee: Number(merchSellerFee),
        bar_per_head: Number(barPerHead),
        bar_pct: Number(barPct) / 100,
        expenses: expenses.map((e) => ({
          qty: Number(e.qty),
          price: Number(e.price),
        })),
      }),
    [
      tiers,
      dropOff,
      guests,
      tixTax,
      deductions,
      sponsorIncome,
      vendorIncome,
      merchGross,
      merchPctAfterFees,
      merchCogsPct,
      merchSellerFee,
      barPerHead,
      barPct,
      expenses,
      event.split_pct,
      event.bar_included,
    ]
  )

  /** Sum of qty × price within a single category. */
  function categorySubtotal(cat: ExpenseCategory): number {
    let total = 0
    for (const e of expenses) {
      if (e.category === cat) {
        total += (Number(e.qty) || 0) * (Number(e.price) || 0)
      }
    }
    return total
  }

  /**
   * Final-only: how much of a category has been marked paid. Only fully
   * 'paid' lines count toward this rough rollup. The exact paid amount
   * (per the expense_payments ledger) lives on /events/[id]/payments.
   */
  function categoryPaid(cat: ExpenseCategory): number {
    let paid = 0
    for (const e of expenses) {
      if (e.category !== cat) continue
      if (e.payment_status === 'paid') {
        paid += (Number(e.qty) || 0) * (Number(e.price) || 0)
      }
    }
    return paid
  }

  // ------------------------------------------------------------- Mutations

  function updateExpense(uid: string, patch: Partial<ExpenseRow>) {
    setExpenses((prev) =>
      prev.map((e) => (e.uid === uid ? { ...e, ...patch } : e))
    )
  }

  function addExpenseInCategory(cat: ExpenseCategory) {
    setExpenses((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
        id: '',
        category: cat,
        item: '',
        qty: '1',
        price: '0',
        payment_status: 'unpaid',
        payment_method: '',
      },
    ])
  }

  function removeExpense(uid: string) {
    setExpenses((prev) => prev.filter((e) => e.uid !== uid))
  }

  function updateTier(uid: string, patch: Partial<TierRow>) {
    setTiers((prev) =>
      prev.map((t) => (t.uid === uid ? { ...t, ...patch } : t))
    )
  }

  function addTier() {
    if (tiers.length >= 8) return
    // Find the smallest available tier_number 1..8.
    const taken = new Set(tiers.map((t) => t.tier_number))
    let next = 1
    while (taken.has(next) && next <= 8) next++
    if (next > 8) return
    setTiers((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
        id: '',
        tier_number: next,
        price: '0',
        sold: '0',
      },
    ])
  }

  function removeTier(uid: string) {
    setTiers((prev) => prev.filter((t) => t.uid !== uid))
  }

  // --------------------------------------------------------------- Submit

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTopError(null)
    setTopSuccess(null)
    setFieldErrors({})

    // Save-time filter: any row whose qty is 0 (or blank) is treated as
    // a delete request. If it had a DB id, the server's diff drops it;
    // if it was brand-new, it just never gets inserted. The row stays
    // visible (greyed out) in the form until save, so typos are
    // recoverable.
    const keptExpenses = expenses.filter(
      (ex) => (Number(ex.qty) || 0) > 0
    )

    // Light client-side guard: every kept expense needs a non-empty item.
    for (const ex of keptExpenses) {
      if (!ex.item.trim()) {
        setTopError('Every expense line needs a name.')
        return
      }
    }

    const payload = {
      event_id: event.id,
      budget_id: budget.id,
      drop_off: Number(dropOff) || 0,
      guests: Number(guests) || 0,
      tix_tax: Number(tixTax) || 0,
      deductions: Number(deductions) || 0,
      sponsor_income: Number(sponsorIncome) || 0,
      vendor_income: Number(vendorIncome) || 0,
      merch_gross: Number(merchGross) || 0,
      merch_pct_after_fees: (Number(merchPctAfterFees) || 0) / 100,
      merch_cogs_pct: (Number(merchCogsPct) || 0) / 100,
      merch_seller_fee: Number(merchSellerFee) || 0,
      bar_per_head: Number(barPerHead) || 0,
      bar_pct: (Number(barPct) || 0) / 100,
      chase_share_pct: (Number(chaseSharePct) || 0) / 100,
      elvis_share_pct: (Number(elvisSharePct) || 0) / 100,
      chase_payment_status: chasePaymentStatus,
      chase_payment_method: chasePaymentMethod.trim(),
      elvis_payment_status: elvisPaymentStatus,
      elvis_payment_method: elvisPaymentMethod.trim(),
      expenses: keptExpenses.map((ex) => ({
        id: ex.id || '',
        category: ex.category,
        item: ex.item.trim(),
        qty: Number(ex.qty) || 0,
        price: Number(ex.price) || 0,
        payment_status: ex.payment_status,
        payment_method: ex.payment_method.trim(),
      })),
      tiers: tiers.map((t) => ({
        id: t.id || '',
        tier_number: t.tier_number,
        price: Number(t.price) || 0,
        sold: Number(t.sold) || 0,
      })),
    }

    startTransition(async () => {
      const result: UpdateBudgetResult = await updateBudget(payload)
      if (result.ok) {
        setTopSuccess('Saved')
        router.refresh()
        return
      }
      if (result.reason === 'invalid') {
        const fErrors: Record<string, string> = {}
        const stray: string[] = []
        for (const issue of result.issues) {
          if (issue.path && !issue.path.startsWith('(')) {
            fErrors[issue.path] = issue.message
          } else {
            stray.push(issue.message)
          }
        }
        setFieldErrors(fErrors)
        setTopError(
          stray.length > 0
            ? stray.join('; ')
            : 'Please fix the highlighted fields.'
        )
        return
      }
      if (result.reason === 'unauthorized') {
        setTopError(result.message)
        return
      }
      setTopError(result.message)
    })
  }

  // ---------------------------------------------------------------- Render

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {topError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {topError}
        </div>
      )}

      {topSuccess && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          {topSuccess}
        </div>
      )}

      {/* ----- Top-level summary card -------------------------------- */}
      <SummaryCard
        summary={summary}
        splitPct={event.split_pct}
        barIncluded={event.bar_included}
        isFinal={isFinal}
      />

      {/* ----- Expenses by category --------------------------------- */}
      <section className="space-y-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Expenses</h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Total: {formatUSDCents(summary.est_expenses)}
          </span>
        </header>

        <div className="space-y-6">
          {EXPENSE_CATEGORY_ORDER.map((cat) => {
            const rows = expenses.filter((e) => e.category === cat)
            return (
              <div
                key={cat}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-baseline justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </h3>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {isFinal && categorySubtotal(cat) > 0 ? (
                      <>
                        {formatUSDCents(categoryPaid(cat))} paid /{' '}
                      </>
                    ) : null}
                    {formatUSDCents(categorySubtotal(cat))}
                  </span>
                </div>

                {rows.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                    No lines.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      <tr className="border-b border-zinc-100 dark:border-zinc-900">
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="w-20 px-4 py-2 font-medium">Qty</th>
                        <th className="w-28 px-4 py-2 font-medium">Price</th>
                        {isFinal && (
                          <>
                            <th className="w-28 px-4 py-2 font-medium">
                              Paid
                            </th>
                            <th className="w-40 px-4 py-2 font-medium">
                              Method
                            </th>
                          </>
                        )}
                        <th className="w-28 px-4 py-2 text-right font-medium">
                          Total
                        </th>
                        <th className="w-10 px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                      {rows.map((row) => {
                        const qtyNum = Number(row.qty) || 0
                        const lineTotal =
                          qtyNum * (Number(row.price) || 0)
                        const idx = expenses.findIndex(
                          (e) => e.uid === row.uid
                        )
                        // qty=0 → "will be removed on save". Fade the row so
                        // the user has visual confirmation before they save.
                        const willBeRemoved = qtyNum <= 0
                        return (
                          <tr
                            key={row.uid}
                            className={
                              willBeRemoved
                                ? 'opacity-50 transition-opacity'
                                : 'transition-opacity'
                            }
                            title={
                              willBeRemoved
                                ? 'Will be removed on save'
                                : undefined
                            }
                          >
                            <td className="px-4 py-2">
                              <input
                                value={row.item}
                                onChange={(e) =>
                                  updateExpense(row.uid, {
                                    item: e.target.value,
                                  })
                                }
                                placeholder={`${EXPENSE_CATEGORY_LABELS[cat]} item`}
                                className={`${inputClass(
                                  fieldErrors[`expenses.${idx}.item`]
                                )} ${willBeRemoved ? 'line-through' : ''}`}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                value={row.qty}
                                onChange={(e) =>
                                  updateExpense(row.uid, {
                                    qty: e.target.value,
                                  })
                                }
                                className={inputClass(
                                  fieldErrors[`expenses.${idx}.qty`]
                                )}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                value={row.price}
                                onChange={(e) =>
                                  updateExpense(row.uid, {
                                    price: e.target.value,
                                  })
                                }
                                className={inputClass(
                                  fieldErrors[`expenses.${idx}.price`]
                                )}
                              />
                            </td>
                            {isFinal && (
                              <>
                                <td className="px-4 py-2">
                                  <select
                                    value={row.payment_status}
                                    onChange={(e) => {
                                      const next = e.target
                                        .value as PaymentStatus
                                      // Clear method when flipping back to
                                      // unpaid so we don't carry stale text.
                                      updateExpense(row.uid, {
                                        payment_status: next,
                                        ...(next === 'unpaid'
                                          ? { payment_method: '' }
                                          : {}),
                                      })
                                    }}
                                    className={selectClass(
                                      fieldErrors[
                                        `expenses.${idx}.payment_status`
                                      ],
                                      row.payment_status
                                    )}
                                  >
                                    <option value="unpaid">Unpaid</option>
                                    <option value="paid">Paid</option>
                                  </select>
                                </td>
                                <td className="px-4 py-2">
                                  <input
                                    value={row.payment_method}
                                    onChange={(e) =>
                                      updateExpense(row.uid, {
                                        payment_method: e.target.value,
                                      })
                                    }
                                    disabled={row.payment_status === 'unpaid'}
                                    placeholder={
                                      row.payment_status === 'unpaid'
                                        ? '—'
                                        : 'Zelle, cash, check #…'
                                    }
                                    maxLength={80}
                                    className={inputClass(
                                      fieldErrors[
                                        `expenses.${idx}.payment_method`
                                      ]
                                    )}
                                  />
                                </td>
                              </>
                            )}
                            <td className="px-4 py-2 text-right text-zinc-700 tabular-nums dark:text-zinc-300">
                              {formatUSDCents(lineTotal)}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => removeExpense(row.uid)}
                                aria-label={`Remove ${row.item || 'line'}`}
                                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}

                <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-900">
                  <button
                    type="button"
                    onClick={() => addExpenseInCategory(cat)}
                    className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    + Add line
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ----- Tickets ---------------------------------------------- */}
      <section className="space-y-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Ticket tiers
          </h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {summary.gross_tix_sold} sold ·{' '}
            {formatUSDCents(summary.gross_tix_total)}
          </span>
        </header>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          {tiers.length === 0 ? (
            <p className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">
              No tiers yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr className="border-b border-zinc-100 dark:border-zinc-900">
                  <th className="w-20 px-4 py-2 font-medium">Tier</th>
                  <th className="w-32 px-4 py-2 font-medium">Price</th>
                  <th className="w-32 px-4 py-2 font-medium">Sold</th>
                  <th className="w-32 px-4 py-2 text-right font-medium">
                    Total
                  </th>
                  <th className="w-10 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {tiers.map((row, idx) => {
                  const lineTotal =
                    (Number(row.price) || 0) * (Number(row.sold) || 0)
                  return (
                    <tr key={row.uid}>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={1}
                          max={8}
                          step="1"
                          value={row.tier_number}
                          onChange={(e) =>
                            updateTier(row.uid, {
                              tier_number: Number(e.target.value),
                            })
                          }
                          className={inputClass(
                            fieldErrors[`tiers.${idx}.tier_number`]
                          )}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={row.price}
                          onChange={(e) =>
                            updateTier(row.uid, { price: e.target.value })
                          }
                          className={inputClass(
                            fieldErrors[`tiers.${idx}.price`]
                          )}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step="1"
                          value={row.sold}
                          onChange={(e) =>
                            updateTier(row.uid, { sold: e.target.value })
                          }
                          className={inputClass(
                            fieldErrors[`tiers.${idx}.sold`]
                          )}
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-700 tabular-nums dark:text-zinc-300">
                        {formatUSDCents(lineTotal)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeTier(row.uid)}
                          aria-label={`Remove tier ${row.tier_number}`}
                          className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-900">
            <button
              type="button"
              onClick={addTier}
              disabled={tiers.length >= 8}
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              + Add tier
            </button>
            {tiers.length >= 8 && (
              <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-500">
                Maximum 8 tiers.
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-zinc-100 px-4 py-4 sm:grid-cols-3 dark:border-zinc-900">
            <NumberField
              label="Sales tax ($)"
              help="Flat $ deducted from gross ticket sales before the split % is applied."
              value={tixTax}
              onChange={setTixTax}
              error={fieldErrors.tix_tax}
            />
            <MerchLine
              label="Gross tix"
              value={formatUSDCents(summary.gross_tix_total)}
            />
            <MerchLine
              label="Net tix (after tax)"
              value={formatUSDCents(summary.net_tix_total)}
            />
          </div>
        </div>
      </section>

      {/* ----- Merch ------------------------------------------------- */}
      <section className="space-y-4">
        <header className="flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Merch</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Per-event merch knobs. Defaults are ${MERCH_GROSS_DEFAULT} gross,{' '}
              {Math.round(MERCH_PCT_AFTER_FEES * 100)}% after fees,{' '}
              {Math.round(MERCH_COGS_PCT * 100)}% COGS, ${MERCH_SELLER_FEE}{' '}
              seller fee.
            </p>
          </div>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Net merch:{' '}
            <strong
              className={
                summary.net_merch >= 0
                  ? 'text-zinc-900 dark:text-zinc-100'
                  : 'text-red-700 dark:text-red-300'
              }
            >
              {formatUSDCents(summary.net_merch)}
            </strong>
          </span>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label="Merch gross ($)"
            help={`${formatUSDCents(summary.merch_per_head)} / paid attendee (calculated)`}
            value={merchGross}
            onChange={setMerchGross}
            error={fieldErrors.merch_gross}
          />
          <NumberField
            label="After-fees %"
            help="Share of merch gross that survives platform fees."
            value={merchPctAfterFees}
            onChange={setMerchPctAfterFees}
            error={fieldErrors.merch_pct_after_fees}
            max={100}
          />
          <NumberField
            label="COGS %"
            help="Cost of goods as a share of merch gross."
            value={merchCogsPct}
            onChange={setMerchCogsPct}
            error={fieldErrors.merch_cogs_pct}
            max={100}
          />
          <NumberField
            label="Seller fee ($)"
            help="Flat fee deducted from merch."
            value={merchSellerFee}
            onChange={setMerchSellerFee}
            error={fieldErrors.merch_seller_fee}
          />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
            <MerchLine
              label="Merch gross"
              value={formatUSDCents(summary.merch_gross)}
            />
            <MerchLine
              label="Per paid attendee"
              value={
                summary.paid_attendance > 0
                  ? `${formatUSDCents(summary.merch_per_head)} / head`
                  : '— / head'
              }
            />
            <MerchLine
              label="After fees"
              value={formatUSDCents(summary.merch_net_after_fees)}
            />
            <MerchLine
              label="COGS"
              value={`− ${formatUSDCents(summary.merch_cogs)}`}
            />
            <MerchLine
              label="Seller fee"
              value={`− ${formatUSDCents(summary.merch_seller_fee)}`}
            />
          </dl>
        </div>
      </section>

      {/* ----- Income inputs ---------------------------------------- */}
      <section className="space-y-4">
        <header>
          <h2 className="text-lg font-semibold tracking-tight">
            Income inputs
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Drives the income summary above. Bar knobs default to $
            {BAR_PER_HEAD}/head and {Math.round(LOSGOTHSCO_BAR_PCT * 100)}%
            but can be overridden per event below.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Drop-off"
            help="Tickets sold but holder didn't show. Subtracted from gross sold."
            value={dropOff}
            onChange={setDropOff}
            error={fieldErrors.drop_off}
          />
          <NumberField
            label="Guests"
            help="Comp / guest list — added to total attendance."
            value={guests}
            onChange={setGuests}
            error={fieldErrors.guests}
          />
          <NumberField
            label="Deductions"
            help="Flat $ subtracted from walkout."
            value={deductions}
            onChange={setDeductions}
            error={fieldErrors.deductions}
          />
          <NumberField
            label="Sponsor income"
            help="Flat $ added to estimated income."
            value={sponsorIncome}
            onChange={setSponsorIncome}
            error={fieldErrors.sponsor_income}
          />
          <NumberField
            label="Vendor income"
            help="Flat $ added to estimated income."
            value={vendorIncome}
            onChange={setVendorIncome}
            error={fieldErrors.vendor_income}
          />
          <NumberField
            label="Bar $ per head"
            help="Per-paid-attendee bar gross. Org default: $24."
            value={barPerHead}
            onChange={setBarPerHead}
            error={fieldErrors.bar_per_head}
          />
          <NumberField
            label="LosGothsCo bar %"
            help="LosGothsCo's cut of bar gross. Org default: 16%."
            value={barPct}
            onChange={setBarPct}
            error={fieldErrors.bar_pct}
            max={100}
          />
        </div>
      </section>

      {/* ----- Profit split (Final budget only) ---------------------- */}
      {isFinal && (
        <section className="space-y-4">
          <header>
            <h2 className="text-lg font-semibold tracking-tight">
              Profit split
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Split of final profit ({formatUSD(summary.est_profit)}).
              Defaults to 40% / 60%, editable per event. Track payout status
              here once each partner is paid.
            </p>
          </header>

          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr className="border-b border-zinc-100 dark:border-zinc-900">
                  <th className="px-4 py-2 font-medium">Partner</th>
                  <th className="w-24 px-4 py-2 font-medium">Share %</th>
                  <th className="w-28 px-4 py-2 font-medium">Amount</th>
                  <th className="w-28 px-4 py-2 font-medium">Paid</th>
                  <th className="w-40 px-4 py-2 font-medium">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                <PartnerRow
                  name="Chase"
                  pctValue={chaseSharePct}
                  onPctChange={setChaseSharePct}
                  pctError={fieldErrors.chase_share_pct}
                  amount={summary.est_profit * ((Number(chaseSharePct) || 0) / 100)}
                  status={chasePaymentStatus}
                  onStatusChange={(next) => {
                    setChasePaymentStatus(next)
                    if (next === 'unpaid') setChasePaymentMethod('')
                  }}
                  method={chasePaymentMethod}
                  onMethodChange={setChasePaymentMethod}
                />
                <PartnerRow
                  name="Elvis"
                  pctValue={elvisSharePct}
                  onPctChange={setElvisSharePct}
                  pctError={fieldErrors.elvis_share_pct}
                  amount={summary.est_profit * ((Number(elvisSharePct) || 0) / 100)}
                  status={elvisPaymentStatus}
                  onStatusChange={(next) => {
                    setElvisPaymentStatus(next)
                    if (next === 'unpaid') setElvisPaymentMethod('')
                  }}
                  method={elvisPaymentMethod}
                  onMethodChange={setElvisPaymentMethod}
                />
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ----- Save bar --------------------------------------------- */}
      <div className="sticky bottom-4 z-10">
        <div className="flex items-center justify-end gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {isFinal ? 'Final' : 'Est.'} profit:{' '}
            <strong
              className={
                summary.est_profit >= 0
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-red-700 dark:text-red-300'
              }
            >
              {formatUSD(summary.est_profit)}
            </strong>
          </span>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending ? 'Saving…' : 'Save budget'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  summary,
  splitPct,
  barIncluded,
  isFinal,
}: {
  summary: ReturnType<typeof computeBudget>
  splitPct: number
  barIncluded: boolean
  isFinal: boolean
}) {
  // Labels read "Est. X" on the estimated budget and "Final X" once the
  // event has been actualized — same four stats, just relabeled per Chase's
  // request so it's obvious at a glance which budget you're looking at.
  const prefix = isFinal ? 'Final' : 'Est.'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryStat
          label={`${prefix} income`}
          value={formatUSD(summary.est_income)}
        />
        <SummaryStat
          label={`${prefix} expenses`}
          value={formatUSD(summary.est_expenses)}
        />
        <SummaryStat
          label={`${prefix} profit`}
          value={formatUSD(summary.est_profit)}
          tone={summary.est_profit >= 0 ? 'positive' : 'negative'}
        />
        <SummaryStat
          label={`${prefix} walkout`}
          value={formatUSD(summary.walkout)}
          help={`Tix net @ ${splitPct}% + bar − deductions`}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4 text-xs sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-900">
        <Mini label="Tix sold" value={String(summary.gross_tix_sold)} />
        <Mini label="Paid attendance" value={String(summary.paid_attendance)} />
        <Mini label="Total attendance" value={String(summary.total_attendance)} />
        <Mini label="Gross tix" value={formatUSDCents(summary.gross_tix_total)} />
        <Mini
          label="Tix tax"
          value={
            summary.tix_tax > 0
              ? `− ${formatUSDCents(summary.tix_tax)}`
              : formatUSDCents(0)
          }
          muted={summary.tix_tax === 0}
        />
        <Mini
          label="LGCo tix net"
          value={formatUSDCents(summary.losgothsco_tix_net)}
        />
        <Mini
          label="Bar gross"
          value={
            barIncluded ? formatUSDCents(summary.bar_gross) : 'Not included'
          }
          muted={!barIncluded}
        />
        <Mini
          label="LGCo bar"
          value={
            barIncluded ? formatUSDCents(summary.losgothsco_bar) : '—'
          }
          muted={!barIncluded}
        />
        <Mini
          label="Net merch"
          value={formatUSDCents(summary.net_merch)}
          tone={summary.net_merch >= 0 ? undefined : 'negative'}
        />
        <Mini
          label="Sponsor income"
          value={formatUSDCents(summary.sponsor_income)}
          muted={summary.sponsor_income === 0}
        />
        <Mini
          label="Vendor income"
          value={formatUSDCents(summary.vendor_income)}
          muted={summary.vendor_income === 0}
        />
      </div>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  help,
  tone,
}: {
  label: string
  value: string
  help?: string
  tone?: 'positive' | 'negative'
}) {
  const valueClass =
    tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'negative'
        ? 'text-red-700 dark:text-red-300'
        : 'text-zinc-900 dark:text-zinc-100'
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
      {help && (
        <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
          {help}
        </p>
      )}
    </div>
  )
}

function Mini({
  label,
  value,
  muted,
  tone,
}: {
  label: string
  value: string
  muted?: boolean
  tone?: 'negative'
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        {label}
      </p>
      <p
        className={`tabular-nums ${
          muted
            ? 'text-zinc-400 dark:text-zinc-600'
            : tone === 'negative'
              ? 'text-red-700 dark:text-red-300'
              : 'text-zinc-700 dark:text-zinc-300'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function NumberField({
  label,
  help,
  value,
  onChange,
  error,
  max,
}: {
  label: string
  help?: string
  value: string
  onChange: (next: string) => void
  error?: string
  max?: number
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full ${inputClass(error)}`}
      />
      {help && (
        <span className="mt-1 block text-[10px] text-zinc-500 dark:text-zinc-500">
          {help}
        </span>
      )}
      {error && (
        <span className="mt-1 block text-xs text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </label>
  )
}

/** One row in the Final-budget "Profit split" table (Chase / Elvis). */
function PartnerRow({
  name,
  pctValue,
  onPctChange,
  pctError,
  amount,
  status,
  onStatusChange,
  method,
  onMethodChange,
}: {
  name: string
  pctValue: string
  onPctChange: (next: string) => void
  pctError?: string
  amount: number
  status: PaymentStatus
  onStatusChange: (next: PaymentStatus) => void
  method: string
  onMethodChange: (next: string) => void
}) {
  return (
    <tr>
      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">
        {name}
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.1"
          value={pctValue}
          onChange={(e) => onPctChange(e.target.value)}
          className={`w-20 ${inputClass(pctError)}`}
        />
      </td>
      <td className="px-4 py-2 text-zinc-700 tabular-nums dark:text-zinc-300">
        {formatUSDCents(amount)}
      </td>
      <td className="px-4 py-2">
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as PaymentStatus)}
          className={selectClass(undefined, status)}
        >
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          value={method}
          onChange={(e) => onMethodChange(e.target.value)}
          disabled={status === 'unpaid'}
          placeholder={status === 'unpaid' ? '—' : 'Zelle, cash, check #…'}
          maxLength={80}
          className={inputClass()}
        />
      </td>
    </tr>
  )
}

function MerchLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="tabular-nums text-zinc-700 dark:text-zinc-300">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputClass(err?: string): string {
  return [
    'rounded-md border bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 dark:bg-zinc-900 dark:text-zinc-100 dark:disabled:bg-zinc-900/50 dark:disabled:text-zinc-600',
    err
      ? 'border-red-400 focus:border-red-500 focus:ring-red-300 dark:border-red-700 dark:focus:border-red-500 dark:focus:ring-red-700'
      : 'border-zinc-300 focus:border-zinc-500 focus:ring-zinc-300 dark:border-zinc-700 dark:focus:border-zinc-500 dark:focus:ring-zinc-700',
  ].join(' ')
}

/** inputClass + a colored left accent reflecting Paid status. */
function selectClass(err: string | undefined, status: PaymentStatus): string {
  const base = inputClass(err)
  const tone =
    status === 'paid'
      ? 'border-l-4 border-l-emerald-500 dark:border-l-emerald-400'
      : 'border-l-4 border-l-zinc-300 dark:border-l-zinc-700'
  return `${base} ${tone}`
}

/** Anything not in the known list lands in 'staff' as a safe default. */
function normalizeCategory(cat: string): ExpenseCategory {
  return (EXPENSE_CATEGORY_ORDER as readonly string[]).includes(cat)
    ? (cat as ExpenseCategory)
    : 'staff'
}
