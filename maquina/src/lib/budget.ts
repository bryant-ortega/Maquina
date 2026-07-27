/**
 * Pure helpers + org-wide constants for the estimated-budget income summary.
 *
 * The Phase 9 budget view derives its income panel from a small set of
 * formulas (see BUILD_PLAN.md Phase 9). All inputs here are scalars or
 * arrays of {price, sold}; nothing in this module touches Supabase, fetch,
 * or randomness — keep it that way so the BudgetForm can run these on
 * every keystroke without round-tripping the server.
 *
 * Phase 14's override system will eventually let admins overlay per-event
 * values on top of these constants. Until then, edit them here.
 */

// ---------------------------------------------------------------------------
// Org-wide constants — Phase 14 will let admins override per event.
// ---------------------------------------------------------------------------

/** Bar revenue assumed per paid attendee (dollars). Phase 14 will add per-event override. */
export const BAR_PER_HEAD = 24

/** LosGothsCo's slice of the bar gross. Phase 14 will add per-event override. */
export const LOSGOTHSCO_BAR_PCT = 0.16

// Merch knobs are EDITABLE per event in Phase 9; the constants below are
// the seeded defaults (matching BUILD_PLAN.md), used as fallbacks when a
// budget row hasn't been migrated yet or to bootstrap new rows.

/**
 * Default flat merch gross dollars assumed per event. Per Chase, this is
 * a flat number (not derived from attendance); the UI shows a calculated
 * per-head value alongside it for context.
 */
export const MERCH_GROSS_DEFAULT = 400

/** Default share of merch_gross that survives platform fees. */
export const MERCH_PCT_AFTER_FEES = 0.97

/** Default cost-of-goods as a share of merch_gross. */
export const MERCH_COGS_PCT = 0.35

/** Default flat seller fee deducted from merch (dollars). */
export const MERCH_SELLER_FEE = 120

// ---------------------------------------------------------------------------
// Partner profit split — Final budget only.
// ---------------------------------------------------------------------------

/** Chase's fixed share of final profit. Not per-event editable. */
export const CHASE_SHARE_PCT = 0.4

/** Elvis's fixed share of final profit. Not per-event editable. */
export const ELVIS_SHARE_PCT = 0.6

// ---------------------------------------------------------------------------
// Budget computation
// ---------------------------------------------------------------------------

export type BudgetTierInput = {
  /** Per-ticket price in dollars. Negative or non-finite values are clamped to 0. */
  price: number
  /** Number sold. Negative or non-finite values are clamped to 0. */
  sold: number
}

export type BudgetExpenseInput = {
  qty: number
  price: number
}

export type BudgetInputs = {
  /** Tickets sold lookups (one entry per tier). */
  tiers: BudgetTierInput[]
  /**
   * Tickets that were sold but the holder didn't show. Subtracted from
   * gross_tix_sold to get paid_attendance.
   */
  drop_off: number
  /** Comp / guest list attendees who don't show up in tier sales. */
  guests: number
  /**
   * Flat dollar sales tax on ticket revenue. Subtracted from gross_tix_total
   * BEFORE the split_pct cut is applied, so LosGothsCo's percentage is taken
   * on net (post-tax) ticket revenue, not the sticker-price gross.
   */
  tix_tax: number
  /**
   * Flat dollar deductions from walkout (rolled-up "cost of doing business"
   * the admin types in to model what they actually expect to walk with).
   */
  deductions: number
  /** Flat sponsor income to add to est_income. */
  sponsor_income: number
  /** Flat vendor income to add to est_income. */
  vendor_income: number
  /**
   * Event-level split percentage (e.g., 70 means LosGothsCo keeps 70% of
   * gross ticket sales). Values outside 0..100 are clamped.
   */
  split_pct: number
  /** Whether bar revenue applies. From events.bar_included. */
  bar_included: boolean
  /** Per-paid-attendee bar gross. Defaults to BAR_PER_HEAD when undefined. */
  bar_per_head?: number
  /** LosGothsCo's cut of bar gross (0..1). Defaults to LOSGOTHSCO_BAR_PCT. */
  bar_pct?: number
  /** Per-event merch knobs (currently editable in the budget UI). */
  merch_gross: number
  merch_pct_after_fees: number
  merch_cogs_pct: number
  merch_seller_fee: number
  /** Sum of every estimated expense line's qty × price. */
  expenses: BudgetExpenseInput[]
}

export type BudgetSummary = {
  gross_tix_sold: number
  paid_attendance: number
  total_attendance: number
  gross_tix_total: number
  tix_tax: number
  net_tix_total: number
  losgothsco_tix_net: number
  bar_gross: number
  losgothsco_bar: number
  merch_gross: number
  /**
   * merch_gross / paid_attendance, or 0 if paid_attendance is 0. Read-only
   * in the UI — admins type the gross dollar amount; this falls out.
   */
  merch_per_head: number
  merch_net_after_fees: number
  merch_cogs: number
  merch_seller_fee: number
  net_merch: number
  walkout: number
  /** Pass-through of the flat sponsor/vendor income inputs. Both fold
   *  into est_income; surfaced here too so UI summaries can show them
   *  as their own line instead of leaving them invisible inside the
   *  est_income total. */
  sponsor_income: number
  vendor_income: number
  est_income: number
  est_expenses: number
  est_profit: number
}

/**
 * Apply BUILD_PLAN.md Phase 9 income formulas. Treats every nullish/NaN
 * input as 0 so the form can hand us partial inputs without exploding.
 */
export function computeBudget(input: BudgetInputs): BudgetSummary {
  const tiers = input.tiers.map((t) => ({
    price: clampNonNeg(t.price),
    sold: clampNonNeg(t.sold),
  }))

  const drop_off = clampNonNeg(input.drop_off)
  const guests = clampNonNeg(input.guests)
  const tix_tax = clampNonNeg(input.tix_tax)
  const deductions = clampNonNeg(input.deductions)
  const sponsor_income = clampNonNeg(input.sponsor_income)
  const vendor_income = clampNonNeg(input.vendor_income)
  const split_pct = clamp(input.split_pct, 0, 100)

  const gross_tix_sold = tiers.reduce((acc, t) => acc + t.sold, 0)
  const paid_attendance = Math.max(0, gross_tix_sold - drop_off)
  const total_attendance = paid_attendance + guests

  const gross_tix_total = tiers.reduce(
    (acc, t) => acc + t.price * t.sold,
    0
  )
  const net_tix_total = Math.max(0, gross_tix_total - tix_tax)
  const losgothsco_tix_net = net_tix_total * (split_pct / 100)

  const barPerHead = clampNonNeg(
    input.bar_per_head ?? BAR_PER_HEAD
  )
  const barPct = clamp(input.bar_pct ?? LOSGOTHSCO_BAR_PCT, 0, 1)
  const bar_gross = input.bar_included ? paid_attendance * barPerHead : 0
  const losgothsco_bar = bar_gross * barPct

  const merch_gross = clampNonNeg(input.merch_gross)
  const merchAfterFees = clamp(input.merch_pct_after_fees, 0, 1)
  const merchCogs = clamp(input.merch_cogs_pct, 0, 1)
  const merchSellerFee = clampNonNeg(input.merch_seller_fee)

  const merch_per_head = paid_attendance > 0 ? merch_gross / paid_attendance : 0
  const merch_net_after_fees = merch_gross * merchAfterFees
  const merch_cogs = merch_gross * merchCogs
  const merch_seller_fee = merchSellerFee
  const net_merch = merch_net_after_fees - merch_cogs - merch_seller_fee

  const walkout = losgothsco_tix_net + losgothsco_bar - deductions

  const est_income = walkout + net_merch + sponsor_income + vendor_income

  const est_expenses = input.expenses.reduce(
    (acc, e) => acc + clampNonNeg(e.qty) * clampNonNeg(e.price),
    0
  )

  const est_profit = est_income - est_expenses

  return {
    gross_tix_sold,
    paid_attendance,
    total_attendance,
    gross_tix_total,
    tix_tax,
    net_tix_total,
    losgothsco_tix_net,
    bar_gross,
    losgothsco_bar,
    merch_gross,
    merch_per_head,
    merch_net_after_fees,
    merch_cogs,
    merch_seller_fee,
    net_merch,
    walkout,
    sponsor_income,
    vendor_income,
    est_income,
    est_expenses,
    est_profit,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

/** Format a number as USD with no fractional cents (used in budget summary). */
export function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)
}

/** Format a number as USD with 2 fractional cents (used in expense / tier rows). */
export function formatUSDCents(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)
}

// ---------------------------------------------------------------------------
// Expense category helpers
// ---------------------------------------------------------------------------

/** Display order for expense categories on the budget page. */
export const EXPENSE_CATEGORY_ORDER = [
  'digital',
  'consumables',
  'travel',
  'transportation',
  'vendors',
  'staff',
  'rent',
  'djs',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORY_ORDER)[number]

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  digital: 'Digital',
  consumables: 'Consumables',
  travel: 'Travel',
  transportation: 'Transportation',
  vendors: 'Vendors',
  staff: 'Staff',
  rent: 'Rent',
  djs: 'DJs',
}
