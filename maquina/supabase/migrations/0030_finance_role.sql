-- Migration 0030 — Finance role: read-only budgets, DJs, vendors, W-9s.
--
-- New role 'finance' for a bookkeeper/accountant. Additive SELECT-only
-- RLS policies (RLS is OR'd across policies, so this can't accidentally
-- grant anything beyond read access — the existing admin-only
-- INSERT/UPDATE/DELETE policies on these tables are untouched). No
-- self-registration path; grant it the same way viewer/collab were
-- granted before it — Supabase Studio → profiles → append 'finance'
-- to the roles array.
--
-- Scope, per Chase: budgets + DJ roster + vendor roster + W-9
-- downloads, nothing else. Does NOT get: view builder, run of show,
-- event create/edit, collaborator management, or any write access
-- anywhere.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom.
-- Run after 0029.

DROP POLICY IF EXISTS "events_select_finance" ON events;
CREATE POLICY "events_select_finance" ON events FOR SELECT USING (has_role('finance'));

DROP POLICY IF EXISTS "event_budgets_select_finance" ON event_budgets;
CREATE POLICY "event_budgets_select_finance" ON event_budgets FOR SELECT USING (has_role('finance'));

DROP POLICY IF EXISTS "event_budget_expenses_select_finance" ON event_budget_expenses;
CREATE POLICY "event_budget_expenses_select_finance" ON event_budget_expenses FOR SELECT USING (has_role('finance'));

DROP POLICY IF EXISTS "event_budget_income_select_finance" ON event_budget_income;
CREATE POLICY "event_budget_income_select_finance" ON event_budget_income FOR SELECT USING (has_role('finance'));

DROP POLICY IF EXISTS "event_tix_tiers_select_finance" ON event_tix_tiers;
CREATE POLICY "event_tix_tiers_select_finance" ON event_tix_tiers FOR SELECT USING (has_role('finance'));

DROP POLICY IF EXISTS "djs_select_finance" ON djs;
CREATE POLICY "djs_select_finance" ON djs FOR SELECT USING (has_role('finance'));

DROP POLICY IF EXISTS "vendors_select_finance" ON vendors;
CREATE POLICY "vendors_select_finance" ON vendors FOR SELECT USING (has_role('finance'));

NOTIFY pgrst, 'reload schema';
