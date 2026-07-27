-- ============================================================================
-- Migration 0025 — Editable partner profit-split percentages
-- ============================================================================
-- Migration 0024 added Chase/Elvis payout status tracking with fixed
-- 40%/60% split constants in code. Chase wants the percentages themselves
-- editable per Final budget (still defaulting to 40/60 for new rows), so
-- they move from lib/budget.ts constants to real columns.
-- ============================================================================

ALTER TABLE event_budgets
  ADD COLUMN IF NOT EXISTS chase_share_pct numeric NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS elvis_share_pct numeric NOT NULL DEFAULT 0.6;

ALTER TABLE event_budgets
  DROP CONSTRAINT IF EXISTS event_budgets_chase_share_pct_check;
ALTER TABLE event_budgets
  ADD CONSTRAINT event_budgets_chase_share_pct_check
  CHECK (chase_share_pct >= 0 AND chase_share_pct <= 1);

ALTER TABLE event_budgets
  DROP CONSTRAINT IF EXISTS event_budgets_elvis_share_pct_check;
ALTER TABLE event_budgets
  ADD CONSTRAINT event_budgets_elvis_share_pct_check
  CHECK (elvis_share_pct >= 0 AND elvis_share_pct <= 1);

NOTIFY pgrst, 'reload schema';
