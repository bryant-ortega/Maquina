-- ============================================================================
-- Migration 0023: Flat ticket-tax deduction on event_budgets
-- ============================================================================
-- Chase wants to deduct sales tax from ticket revenue before LosGothsCo's
-- split percentage is applied. Modeled as a flat dollar amount per budget
-- (estimated + final both get their own value, same as every other Phase 9
-- scalar) rather than a rate, since Chase's tax bill for an event is a known
-- fixed number rather than a percentage of sales.
--
-- lib/budget.ts (computeBudget) now does:
--   net_tix_total      = max(0, gross_tix_total - tix_tax)
--   losgothsco_tix_net = net_tix_total * (split_pct / 100)
-- instead of basing losgothsco_tix_net directly on gross_tix_total.
-- ============================================================================

ALTER TABLE event_budgets
  ADD COLUMN IF NOT EXISTS tix_tax numeric NOT NULL DEFAULT 0
    CHECK (tix_tax >= 0);

NOTIFY pgrst, 'reload schema';
