-- Migration 0038 — Ofrendas Partner role: view + edit
-- ofrendas_vendor_applications only.
--
-- New role 'ofrendas_partner' for the 2 outside partners who need to
-- work the Ofrendas vendor-call queue (approve/mark-paid, trigger the
-- form emails) and nothing else in Maquina — no Events, DJs, Vendors,
-- budgets, Settings.
--
-- ofrendas_vendor_applications has RLS enabled with zero
-- anon/authenticated policies (migrations 0032/0033) — even 'admin'
-- reads/writes it exclusively through a service-role client in
-- src/app/ofrendas-vendor-applications/{page,actions}.tsx, never the
-- cookie-bound SSR client. These two policies don't change that; the
-- app-level role check in actions.ts (updated alongside this migration
-- to allow 'ofrendas_partner' as well as 'admin') is what actually
-- gates the page and every write. This is the same defense-in-depth
-- backstop finance (0030) and contract (0020/0028) already have on
-- their own scoped tables — if a future code change ever swaps in the
-- SSR client for this table, an ofrendas_partner session still can't
-- see anything beyond what these policies allow, and no other table
-- gains any access at all.
--
-- Row-level only (not column-level): the UPDATE policy allows updating
-- any column on a matching row, same coarseness as every other role's
-- policies in this app. The actual write surface is still narrowed by
-- application code — setApplicationApproved/setApplicationPaid in
-- actions.ts only ever touch approved/approved_at/
-- approved_email_sent_at/paid/paid_at/paid_email_sent_at.
--
-- No self-registration path. Grant it the same way viewer/finance/
-- contract are granted: Supabase Studio → Authentication → Add user
-- (auto-confirm on) → Table Editor → profiles → set roles to
-- '{ofrendas_partner}'.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom.
-- Run after 0037.

DROP POLICY IF EXISTS "ofrendas_vendor_applications_select_ofrendas_partner" ON ofrendas_vendor_applications;
CREATE POLICY "ofrendas_vendor_applications_select_ofrendas_partner"
  ON ofrendas_vendor_applications FOR SELECT
  USING (has_role('ofrendas_partner'));

DROP POLICY IF EXISTS "ofrendas_vendor_applications_update_ofrendas_partner" ON ofrendas_vendor_applications;
CREATE POLICY "ofrendas_vendor_applications_update_ofrendas_partner"
  ON ofrendas_vendor_applications FOR UPDATE
  USING (has_role('ofrendas_partner'))
  WITH CHECK (has_role('ofrendas_partner'));

NOTIFY pgrst, 'reload schema';
