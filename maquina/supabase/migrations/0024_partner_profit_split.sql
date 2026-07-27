-- ============================================================================
-- Migration 0024 — Partner profit-split payout tracking on event_budgets
-- ============================================================================
-- Final budgets get a "profit split" section at the bottom (Chase 40%,
-- Elvis 60% of final profit). The split percentages are fixed org
-- constants (see CHASE_SHARE_PCT / ELVIS_SHARE_PCT in lib/budget.ts) and
-- the dollar amounts are always derived from the live profit calculation
-- at render time — nothing about the split itself is persisted, matching
-- the "truth lives in the inputs" rule the rest of this table follows.
--
-- What IS persisted is payout status per partner, same shape as the
-- existing inline Paid/Method controls on event_budget_expenses (binary
-- unpaid/paid, freeform method text). These columns exist on every
-- event_budgets row (estimated + final) for schema simplicity, but the
-- UI only ever shows/edits them on the Final budget.
-- ============================================================================

ALTER TABLE event_budgets
  ADD COLUMN IF NOT EXISTS chase_payment_status varchar NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS chase_payment_method varchar,
  ADD COLUMN IF NOT EXISTS elvis_payment_status varchar NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS elvis_payment_method varchar;

ALTER TABLE event_budgets
  DROP CONSTRAINT IF EXISTS event_budgets_chase_payment_status_check;
ALTER TABLE event_budgets
  ADD CONSTRAINT event_budgets_chase_payment_status_check
  CHECK (chase_payment_status IN ('unpaid', 'paid'));

ALTER TABLE event_budgets
  DROP CONSTRAINT IF EXISTS event_budgets_elvis_payment_status_check;
ALTER TABLE event_budgets
  ADD CONSTRAINT event_budgets_elvis_payment_status_check
  CHECK (elvis_payment_status IN ('unpaid', 'paid'));

NOTIFY pgrst, 'reload schema';
