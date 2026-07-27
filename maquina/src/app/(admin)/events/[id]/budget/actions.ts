'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { EXPENSE_CATEGORY_ORDER } from '@/lib/budget'

/**
 * Admin updates the estimated budget for an event.
 *
 * Touches three tables, all under one service-role client so a partial
 * failure is reported back as a single error:
 *   1. event_budgets             — scalar income inputs (drop_off, guests,
 *                                  tix_tax, deductions, sponsor_income,
 *                                  vendor_income)
 *   2. event_budget_expenses     — diff against the form's expense list
 *                                  (keep+update existing rows by id, insert
 *                                  rows with no id, delete rows that no
 *                                  longer appear)
 *   3. event_tix_tiers           — same diff strategy as expenses
 *
 * Auth: re-checks admin role server-side. The (admin) layout already gates
 * the route, but server actions can be invoked from anywhere with a valid
 * Supabase session, so a defence-in-depth check belongs here too.
 *
 * Caveat: this action does NOT recompute the income summary on the server —
 * the BudgetForm computes it client-side for live updates, and we
 * intentionally don't persist the derived totals. The summary is always
 * recomputed from inputs on read; truth lives in the inputs.
 */

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ExpenseInput = z.object({
  /** Empty string when the row is new and has no DB id yet. */
  id: z
    .string()
    .regex(UUID_LIKE, 'Invalid expense id')
    .or(z.literal(''))
    .optional(),
  category: z.enum(EXPENSE_CATEGORY_ORDER),
  item: z.string().trim().min(1, 'Item name is required').max(120),
  // DB CHECK is `qty > 0` (strict), so reject 0 / empty before we ever
  // hit Postgres. Empty/blank coerces to NaN here so Zod surfaces a clean
  // field error instead of a raw constraint violation.
  qty: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? NaN : Number(v)),
    z.number().positive('Qty must be greater than 0')
  ),
  price: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
    z.number().min(0, 'Price must be ≥ 0')
  ),
  // Phase 18 (slim) — inline payment tracking on the expense row.
  // Binary status (no 'partial'); freeform method text after migration
  // 0011 dropped the CHECK constraint. Estimated rows ship the defaults
  // from the form, so these always validate even when controls hide.
  payment_status: z.enum(['unpaid', 'paid']).default('unpaid'),
  payment_method: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null
      const s = String(v).trim()
      return s === '' ? null : s
    },
    z.string().max(80).nullable()
  ),
})

const TierInput = z.object({
  id: z
    .string()
    .regex(UUID_LIKE, 'Invalid tier id')
    .or(z.literal(''))
    .optional(),
  tier_number: z.number().int().min(1).max(8),
  price: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
    z.number().min(0, 'Price must be ≥ 0')
  ),
  sold: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
    z.number().int().min(0, 'Sold must be ≥ 0')
  ),
})

const NonNegNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
  z.number().min(0)
)

const Pct0to1 = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
  z.number().min(0).max(1)
)

const UpdateBudgetInput = z.object({
  event_id: z.string().regex(UUID_LIKE, 'Invalid event id'),
  budget_id: z.string().regex(UUID_LIKE, 'Invalid budget id'),
  drop_off: NonNegNumber,
  guests: NonNegNumber,
  tix_tax: NonNegNumber,
  deductions: NonNegNumber,
  sponsor_income: NonNegNumber,
  vendor_income: NonNegNumber,
  // Merch knobs. Form sends ratios (0..1), not percents — see budget-form.
  merch_gross: NonNegNumber,
  merch_pct_after_fees: Pct0to1,
  merch_cogs_pct: Pct0to1,
  merch_seller_fee: NonNegNumber,
  // Phase 14: per-event bar tunables.
  bar_per_head: NonNegNumber,
  bar_pct: Pct0to1,
  // Partner profit-split payout tracking — Final budget only in the UI,
  // but the fields always round-trip (defaults on estimated rows).
  // Percentages are editable per budget (migration 0025); defaults live
  // in lib/budget.ts (CHASE_SHARE_PCT_DEFAULT / ELVIS_SHARE_PCT_DEFAULT)
  // and only seed new rows.
  chase_share_pct: Pct0to1,
  elvis_share_pct: Pct0to1,
  chase_payment_status: z.enum(['unpaid', 'paid']).default('unpaid'),
  chase_payment_method: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null
      const s = String(v).trim()
      return s === '' ? null : s
    },
    z.string().max(80).nullable()
  ),
  elvis_payment_status: z.enum(['unpaid', 'paid']).default('unpaid'),
  elvis_payment_method: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null
      const s = String(v).trim()
      return s === '' ? null : s
    },
    z.string().max(80).nullable()
  ),
  expenses: z.array(ExpenseInput).max(200),
  tiers: z.array(TierInput).max(8),
})

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type UpdateBudgetResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized'; message: string }
  | {
      ok: false
      reason: 'invalid'
      issues: Array<{ path: string; message: string }>
    }
  | { ok: false; reason: 'db_failed'; message: string }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function updateBudget(
  raw: unknown
): Promise<UpdateBudgetResult> {
  // 1. Auth gate.
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, reason: 'unauthorized', message: 'Not signed in.' }
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.roles?.includes('admin')) {
    return { ok: false, reason: 'unauthorized', message: 'Admin only.' }
  }

  // 2. Validate input.
  const parsed = UpdateBudgetInput.safeParse(raw)
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

  // 3. Tier numbers must be unique within the form payload (otherwise the
  //    UNIQUE (budget_id, tier_number) constraint would blow up at insert
  //    time). Surface as a validation error instead.
  const seenTier = new Set<number>()
  for (const t of data.tiers) {
    if (seenTier.has(t.tier_number)) {
      return {
        ok: false,
        reason: 'invalid',
        issues: [
          {
            path: 'tiers',
            message: `Tier number ${t.tier_number} appears more than once.`,
          },
        ],
      }
    }
    seenTier.add(t.tier_number)
  }

  // 4. Service-role client for the multi-table cascade.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // 5. Sanity: budget belongs to event.
  const { data: budgetCheck, error: bcErr } = await admin
    .from('event_budgets')
    .select('id, event_id')
    .eq('id', data.budget_id)
    .maybeSingle()
  if (bcErr) {
    return { ok: false, reason: 'db_failed', message: bcErr.message }
  }
  if (!budgetCheck || budgetCheck.event_id !== data.event_id) {
    return {
      ok: false,
      reason: 'invalid',
      issues: [{ path: 'budget_id', message: 'Budget does not match event.' }],
    }
  }

  // 6-8. Performance note (2026-07-27): this used to be one sequential
  // `await` per expense/tier row — a budget with 20-30 line items meant
  // 20-30+ round trips to Postgres, one after another, before the save
  // finished. None of those calls actually depend on each other's
  // results, so they're batched into three parallel "waves" instead:
  // wave 1 is the scalar update + both diff selects, wave 2 is the
  // deletes (still ordered before wave 3, since tier deletes must land
  // before tier inserts/updates to avoid a transient UNIQUE
  // (budget_id, tier_number) collision on a tier-number swap), and
  // wave 3 batches every remaining update/insert into one upsert (for
  // existing rows, matched by primary key) and one insert (for new rows)
  // per table. Net effect: a handful of requests regardless of row
  // count, with identical validation, writes, and error handling as
  // before — just concurrent instead of serial. No infra change, no
  // new dependency, works fine on Supabase's free tier.

  // Wave 1: scalar update on event_budgets, plus both diff selects.
  const [scalarRes, dbExpensesRes, dbTiersRes] = await Promise.all([
    admin
      .from('event_budgets')
      .update({
        drop_off: data.drop_off,
        guests: data.guests,
        tix_tax: data.tix_tax,
        deductions: data.deductions,
        sponsor_income: data.sponsor_income,
        vendor_income: data.vendor_income,
        merch_gross: data.merch_gross,
        merch_pct_after_fees: data.merch_pct_after_fees,
        merch_cogs_pct: data.merch_cogs_pct,
        merch_seller_fee: data.merch_seller_fee,
        bar_per_head: data.bar_per_head,
        bar_pct: data.bar_pct,
        chase_share_pct: data.chase_share_pct,
        elvis_share_pct: data.elvis_share_pct,
        chase_payment_status: data.chase_payment_status,
        chase_payment_method: data.chase_payment_method,
        elvis_payment_status: data.elvis_payment_status,
        elvis_payment_method: data.elvis_payment_method,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.budget_id),
    admin
      .from('event_budget_expenses')
      .select('id')
      .eq('budget_id', data.budget_id),
    admin
      .from('event_tix_tiers')
      .select('id')
      .eq('budget_id', data.budget_id),
  ])
  if (scalarRes.error) {
    return { ok: false, reason: 'db_failed', message: scalarRes.error.message }
  }
  if (dbExpensesRes.error) {
    return {
      ok: false,
      reason: 'db_failed',
      message: dbExpensesRes.error.message,
    }
  }
  if (dbTiersRes.error) {
    return { ok: false, reason: 'db_failed', message: dbTiersRes.error.message }
  }
  const dbExpenses = dbExpensesRes.data
  const dbTiers = dbTiersRes.data

  const formExpenseIds = new Set(
    data.expenses.map((e) => e.id).filter((x): x is string => !!x)
  )
  const expensesToDelete = (dbExpenses ?? []).filter(
    (e) => !formExpenseIds.has(e.id as string)
  )
  const formTierIds = new Set(
    data.tiers.map((t) => t.id).filter((x): x is string => !!x)
  )
  const tiersToDelete = (dbTiers ?? []).filter(
    (t) => !formTierIds.has(t.id as string)
  )

  // Wave 2: deletes for both tables, in parallel with each other, but
  // fully awaited before wave 3 writes anything.
  const [expDelRes, tierDelRes] = await Promise.all([
    expensesToDelete.length > 0
      ? admin
          .from('event_budget_expenses')
          .delete()
          .in('id', expensesToDelete.map((e) => e.id as string))
      : Promise.resolve({ error: null }),
    tiersToDelete.length > 0
      ? admin
          .from('event_tix_tiers')
          .delete()
          .in('id', tiersToDelete.map((t) => t.id as string))
      : Promise.resolve({ error: null }),
  ])
  if (expDelRes.error) {
    return { ok: false, reason: 'db_failed', message: expDelRes.error.message }
  }
  if (tierDelRes.error) {
    return { ok: false, reason: 'db_failed', message: tierDelRes.error.message }
  }

  // Wave 3: batched upsert (existing rows, matched by id) + batched
  // insert (new rows) for both tables, all in parallel.
  const expensesToUpdate = data.expenses.filter((e) => e.id)
  const expensesToInsert = data.expenses.filter((e) => !e.id)
  const tiersToUpdate = data.tiers.filter((t) => t.id)
  const tiersToInsert = data.tiers.filter((t) => !t.id)

  const [expUpsertRes, expInsertRes, tierUpsertRes, tierInsertRes] =
    await Promise.all([
      expensesToUpdate.length > 0
        ? admin.from('event_budget_expenses').upsert(
            expensesToUpdate.map((e) => ({
              id: e.id,
              budget_id: data.budget_id,
              category: e.category,
              item: e.item,
              qty: e.qty,
              price: e.price,
              payment_status: e.payment_status,
              payment_method: e.payment_method,
            }))
          )
        : Promise.resolve({ error: null }),
      expensesToInsert.length > 0
        ? admin.from('event_budget_expenses').insert(
            expensesToInsert.map((e) => ({
              budget_id: data.budget_id,
              category: e.category,
              item: e.item,
              qty: e.qty,
              price: e.price,
              payment_status: e.payment_status,
              payment_method: e.payment_method,
            }))
          )
        : Promise.resolve({ error: null }),
      tiersToUpdate.length > 0
        ? admin.from('event_tix_tiers').upsert(
            tiersToUpdate.map((t) => ({
              id: t.id,
              budget_id: data.budget_id,
              tier_number: t.tier_number,
              price: t.price,
              sold: t.sold,
            }))
          )
        : Promise.resolve({ error: null }),
      tiersToInsert.length > 0
        ? admin.from('event_tix_tiers').insert(
            tiersToInsert.map((t) => ({
              budget_id: data.budget_id,
              tier_number: t.tier_number,
              price: t.price,
              sold: t.sold,
            }))
          )
        : Promise.resolve({ error: null }),
    ])
  if (expUpsertRes.error) {
    return {
      ok: false,
      reason: 'db_failed',
      message: expUpsertRes.error.message,
    }
  }
  if (expInsertRes.error) {
    return {
      ok: false,
      reason: 'db_failed',
      message: expInsertRes.error.message,
    }
  }
  if (tierUpsertRes.error) {
    return {
      ok: false,
      reason: 'db_failed',
      message: tierUpsertRes.error.message,
    }
  }
  if (tierInsertRes.error) {
    return {
      ok: false,
      reason: 'db_failed',
      message: tierInsertRes.error.message,
    }
  }

  // 9. Cache invalidation.
  revalidatePath(`/events/${data.event_id}/budget`)
  revalidatePath(`/events/${data.event_id}/edit`)
  revalidatePath('/events')

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Phase 10 — Actualize event
// ---------------------------------------------------------------------------

/**
 * Admin "actualizes" an event after it happens: clones the estimated
 * budget into a brand-new event_budgets row with budget_type='final',
 * copying the scalar inputs, every expense line, and every tix tier
 * verbatim. The admin then edits the final row to reflect what
 * actually happened, and the compare view (Phase 10.4) shows
 * Est / Final / Δ side by side.
 *
 * Single-shot: the (event_id, budget_type) UNIQUE constraint blocks a
 * second 'final' row, so this action refuses up front if one already
 * exists. Phase 14's override system will eventually expose a "reset
 * to estimated" path; until then, recovering from a bad actualize
 * means deleting the final row in the DB.
 */
const ActualizeEventInput = z.object({
  event_id: z.string().regex(UUID_LIKE, 'Invalid event id'),
})

export type ActualizeEventResult =
  | { ok: true; finalBudgetId: string }
  | { ok: false; reason: 'unauthorized'; message: string }
  | { ok: false; reason: 'not_found'; message: string }
  | { ok: false; reason: 'already_final'; message: string }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'db_failed'; message: string }

export async function actualizeEvent(
  raw: unknown
): Promise<ActualizeEventResult> {
  // 1. Auth + admin gate.
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, reason: 'unauthorized', message: 'Not signed in.' }
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, roles')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.roles?.includes('admin')) {
    return { ok: false, reason: 'unauthorized', message: 'Admin only.' }
  }

  // 2. Validate.
  const parsed = ActualizeEventInput.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    }
  }
  const { event_id } = parsed.data

  // 3. Service-role client (matching the rest of this file).
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // 4. Pull the estimated budget (the source of truth we copy from).
  const { data: estBudget, error: ebErr } = await admin
    .from('event_budgets')
    .select(
      'id, drop_off, guests, tix_tax, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct'
    )
    .eq('event_id', event_id)
    .eq('budget_type', 'estimated')
    .maybeSingle()
  if (ebErr) {
    return { ok: false, reason: 'db_failed', message: ebErr.message }
  }
  if (!estBudget) {
    return {
      ok: false,
      reason: 'not_found',
      message: 'No estimated budget exists for this event.',
    }
  }

  // 5. Refuse if a final already exists. (UNIQUE would catch us anyway,
  //    but a polite up-front check beats a raw constraint error.)
  const { data: existingFinal, error: efErr } = await admin
    .from('event_budgets')
    .select('id')
    .eq('event_id', event_id)
    .eq('budget_type', 'final')
    .maybeSingle()
  if (efErr) {
    return { ok: false, reason: 'db_failed', message: efErr.message }
  }
  if (existingFinal) {
    return {
      ok: false,
      reason: 'already_final',
      message: 'This event has already been actualized.',
    }
  }

  // 6. Insert the final budget row, copying scalars verbatim.
  const { data: finalRow, error: finsErr } = await admin
    .from('event_budgets')
    .insert({
      event_id,
      budget_type: 'final',
      created_by: profile.id,
      drop_off: estBudget.drop_off,
      guests: estBudget.guests,
      tix_tax: estBudget.tix_tax,
      deductions: estBudget.deductions,
      sponsor_income: estBudget.sponsor_income,
      vendor_income: estBudget.vendor_income,
      merch_gross: estBudget.merch_gross,
      merch_pct_after_fees: estBudget.merch_pct_after_fees,
      merch_cogs_pct: estBudget.merch_cogs_pct,
      merch_seller_fee: estBudget.merch_seller_fee,
      bar_per_head: estBudget.bar_per_head,
      bar_pct: estBudget.bar_pct,
    })
    .select('id')
    .single()
  if (finsErr || !finalRow) {
    return {
      ok: false,
      reason: 'db_failed',
      message: finsErr?.message ?? 'Final budget insert failed',
    }
  }
  const finalBudgetId = finalRow.id as string

  // 7. Copy expenses.
  const { data: srcExpenses, error: seErr } = await admin
    .from('event_budget_expenses')
    .select('category, item, qty, price')
    .eq('budget_id', estBudget.id)
  if (seErr) {
    return { ok: false, reason: 'db_failed', message: seErr.message }
  }
  if ((srcExpenses ?? []).length > 0) {
    const { error: ieErr } = await admin
      .from('event_budget_expenses')
      .insert(
        (srcExpenses ?? []).map((e) => ({
          budget_id: finalBudgetId,
          category: e.category as string,
          item: e.item as string,
          qty: e.qty as number,
          price: e.price as number,
        }))
      )
    if (ieErr) {
      return { ok: false, reason: 'db_failed', message: ieErr.message }
    }
  }

  // 8. Copy tix tiers.
  const { data: srcTiers, error: stErr } = await admin
    .from('event_tix_tiers')
    .select('tier_number, price, sold')
    .eq('budget_id', estBudget.id)
  if (stErr) {
    return { ok: false, reason: 'db_failed', message: stErr.message }
  }
  if ((srcTiers ?? []).length > 0) {
    const { error: itErr } = await admin.from('event_tix_tiers').insert(
      (srcTiers ?? []).map((t) => ({
        budget_id: finalBudgetId,
        tier_number: t.tier_number as number,
        price: t.price as number,
        sold: t.sold as number,
      }))
    )
    if (itErr) {
      return { ok: false, reason: 'db_failed', message: itErr.message }
    }
  }

  // 9. Cache invalidation.
  revalidatePath(`/events/${event_id}/budget`)
  revalidatePath('/events')

  return { ok: true, finalBudgetId }
}
