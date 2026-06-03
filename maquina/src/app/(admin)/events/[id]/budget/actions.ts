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
 *                                  deductions, sponsor_income, vendor_income)
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

  // 6. Update the per-event scalars on event_budgets.
  const { error: scalarErr } = await admin
    .from('event_budgets')
    .update({
      drop_off: data.drop_off,
      guests: data.guests,
      deductions: data.deductions,
      sponsor_income: data.sponsor_income,
      vendor_income: data.vendor_income,
      merch_gross: data.merch_gross,
      merch_pct_after_fees: data.merch_pct_after_fees,
      merch_cogs_pct: data.merch_cogs_pct,
      merch_seller_fee: data.merch_seller_fee,
      bar_per_head: data.bar_per_head,
      bar_pct: data.bar_pct,
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.budget_id)
  if (scalarErr) {
    return { ok: false, reason: 'db_failed', message: scalarErr.message }
  }

  // 7. Diff expenses against what's currently in the DB.
  const { data: dbExpenses, error: deErr } = await admin
    .from('event_budget_expenses')
    .select('id')
    .eq('budget_id', data.budget_id)
  if (deErr) {
    return { ok: false, reason: 'db_failed', message: deErr.message }
  }

  const formExpenseIds = new Set(
    data.expenses.map((e) => e.id).filter((x): x is string => !!x)
  )
  const expensesToDelete = (dbExpenses ?? []).filter(
    (e) => !formExpenseIds.has(e.id as string)
  )
  if (expensesToDelete.length > 0) {
    const { error: delErr } = await admin
      .from('event_budget_expenses')
      .delete()
      .in(
        'id',
        expensesToDelete.map((e) => e.id as string)
      )
    if (delErr) {
      return { ok: false, reason: 'db_failed', message: delErr.message }
    }
  }

  for (const ex of data.expenses) {
    if (ex.id) {
      // Update existing row.
      const { error: uErr } = await admin
        .from('event_budget_expenses')
        .update({
          category: ex.category,
          item: ex.item,
          qty: ex.qty,
          price: ex.price,
          payment_status: ex.payment_status,
          payment_method: ex.payment_method,
        })
        .eq('id', ex.id)
      if (uErr) {
        return { ok: false, reason: 'db_failed', message: uErr.message }
      }
    } else {
      // Insert new row.
      const { error: iErr } = await admin
        .from('event_budget_expenses')
        .insert({
          budget_id: data.budget_id,
          category: ex.category,
          item: ex.item,
          qty: ex.qty,
          price: ex.price,
          payment_status: ex.payment_status,
          payment_method: ex.payment_method,
        })
      if (iErr) {
        return { ok: false, reason: 'db_failed', message: iErr.message }
      }
    }
  }

  // 8. Diff tiers. Same strategy as expenses, but enforce 0..8 tiers.
  const { data: dbTiers, error: dtErr } = await admin
    .from('event_tix_tiers')
    .select('id')
    .eq('budget_id', data.budget_id)
  if (dtErr) {
    return { ok: false, reason: 'db_failed', message: dtErr.message }
  }

  const formTierIds = new Set(
    data.tiers.map((t) => t.id).filter((x): x is string => !!x)
  )
  const tiersToDelete = (dbTiers ?? []).filter(
    (t) => !formTierIds.has(t.id as string)
  )
  if (tiersToDelete.length > 0) {
    const { error: delErr } = await admin
      .from('event_tix_tiers')
      .delete()
      .in(
        'id',
        tiersToDelete.map((t) => t.id as string)
      )
    if (delErr) {
      return { ok: false, reason: 'db_failed', message: delErr.message }
    }
  }

  // Tier inserts/updates run after deletes so we don't ever briefly have
  // two tiers with the same tier_number for one budget (would violate the
  // UNIQUE constraint).
  for (const t of data.tiers) {
    if (t.id) {
      const { error: uErr } = await admin
        .from('event_tix_tiers')
        .update({
          tier_number: t.tier_number,
          price: t.price,
          sold: t.sold,
        })
        .eq('id', t.id)
      if (uErr) {
        return { ok: false, reason: 'db_failed', message: uErr.message }
      }
    } else {
      const { error: iErr } = await admin.from('event_tix_tiers').insert({
        budget_id: data.budget_id,
        tier_number: t.tier_number,
        price: t.price,
        sold: t.sold,
      })
      if (iErr) {
        return { ok: false, reason: 'db_failed', message: iErr.message }
      }
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
      'id, drop_off, guests, deductions, sponsor_income, vendor_income, merch_gross, merch_pct_after_fees, merch_cogs_pct, merch_seller_fee, bar_per_head, bar_pct'
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
