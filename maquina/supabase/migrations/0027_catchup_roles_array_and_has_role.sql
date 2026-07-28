-- Migration 0027 — catch-up: document the roles-array migration that
-- already happened live but was never captured in a migration file.
--
-- Sometime around commit da4ea02 ("migrate from role column to roles
-- array — single source of truth", app-code only, no migration in the
-- repo), the live database was hand-edited via the Supabase SQL Editor
-- to:
--   1. Add `profiles.roles text[]` (default '{}').
--   2. Drop the old `profiles.role varchar` column entirely.
--   3. Replace `get_my_role()` (SELECT role FROM profiles WHERE
--      user_id = auth.uid()) with `has_role(check_role text)`
--      (SELECT check_role = ANY(roles) FROM profiles WHERE user_id =
--      auth.uid()), supporting multi-role users.
--   4. Redefine every admin/collab/designer/viewer RLS policy across
--      every table to call has_role(...) instead of get_my_role() = ...
--
-- None of that is reflected anywhere in supabase/migrations/, which
-- means a fresh database built from this folder alone would end up on
-- the old single-role schema and immediately diverge from production.
-- This migration closes that gap. Every statement below is idempotent
-- and — run against the current production database — is a no-op; it
-- only matters for anyone standing up a new environment from scratch.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom.
-- Run this AFTER 0026 (which fixes handle_new_user to populate roles
-- correctly on signup).

-- ---------------------------------------------------------------------------
-- 1. profiles.roles / drop profiles.role
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}';

-- Backfill safety net: if this is ever run on a DB that still has the
-- old singular `role` column and hasn't been hand-migrated, seed
-- `roles` from it before dropping. No-op on production (role is
-- already gone there).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) THEN
    UPDATE profiles SET roles = ARRAY[role] WHERE roles = '{}' AND role IS NOT NULL;
    ALTER TABLE profiles DROP COLUMN role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. has_role() replaces get_my_role()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(check_role text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  SELECT check_role = ANY(roles) FROM profiles WHERE user_id = auth.uid()
$function$;

-- ---------------------------------------------------------------------------
-- 3. Re-point every policy that used get_my_role() at has_role(). Same
--    predicates, just the multi-role-aware function. DROP + CREATE
--    (not OR REPLACE — Postgres doesn't support that for policies) so
--    this is safe to re-run.
-- ---------------------------------------------------------------------------

-- djs
DROP POLICY IF EXISTS "djs_select_admin" ON djs;
CREATE POLICY "djs_select_admin" ON djs FOR SELECT USING (has_role('admin'));
DROP POLICY IF EXISTS "djs_update_admin" ON djs;
CREATE POLICY "djs_update_admin" ON djs FOR UPDATE USING (has_role('admin'));
DROP POLICY IF EXISTS "djs_delete_admin" ON djs;
CREATE POLICY "djs_delete_admin" ON djs FOR DELETE USING (has_role('admin'));
DROP POLICY IF EXISTS "djs_select_collab" ON djs;
CREATE POLICY "djs_select_collab" ON djs FOR SELECT USING (has_role('collab'));
DROP POLICY IF EXISTS "djs_select_designer" ON djs;
CREATE POLICY "djs_select_designer" ON djs FOR SELECT USING (has_role('designer'));

-- vendors
DROP POLICY IF EXISTS "vendors_select_admin" ON vendors;
CREATE POLICY "vendors_select_admin" ON vendors FOR SELECT USING (has_role('admin'));
DROP POLICY IF EXISTS "vendors_update_admin" ON vendors;
CREATE POLICY "vendors_update_admin" ON vendors FOR UPDATE USING (has_role('admin'));
DROP POLICY IF EXISTS "vendors_delete_admin" ON vendors;
CREATE POLICY "vendors_delete_admin" ON vendors FOR DELETE USING (has_role('admin'));

-- venues
DROP POLICY IF EXISTS "venues_insert_admin" ON venues;
CREATE POLICY "venues_insert_admin" ON venues FOR INSERT WITH CHECK (has_role('admin'));
DROP POLICY IF EXISTS "venues_update_admin" ON venues;
CREATE POLICY "venues_update_admin" ON venues FOR UPDATE USING (has_role('admin'));
DROP POLICY IF EXISTS "venues_delete_admin" ON venues;
CREATE POLICY "venues_delete_admin" ON venues FOR DELETE USING (has_role('admin'));
DROP POLICY IF EXISTS "venues_select_collab" ON venues;
CREATE POLICY "venues_select_collab" ON venues FOR SELECT USING (has_role('collab'));

-- events
DROP POLICY IF EXISTS "events_all_admin" ON events;
CREATE POLICY "events_all_admin" ON events FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "events_select_collab" ON events;
CREATE POLICY "events_select_collab" ON events FOR SELECT USING (
  has_role('collab') AND id IN (
    SELECT event_collaborators.event_id FROM event_collaborators
    WHERE event_collaborators.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS "events_select_designer" ON events;
CREATE POLICY "events_select_designer" ON events FOR SELECT USING (has_role('designer'));
DROP POLICY IF EXISTS "events_select_viewer" ON events;
CREATE POLICY "events_select_viewer" ON events FOR SELECT USING (has_role('viewer'));

-- event_stages
DROP POLICY IF EXISTS "event_stages_all_admin" ON event_stages;
CREATE POLICY "event_stages_all_admin" ON event_stages FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "event_stages_select_collab" ON event_stages;
CREATE POLICY "event_stages_select_collab" ON event_stages FOR SELECT USING (
  has_role('collab') AND event_id IN (
    SELECT event_collaborators.event_id FROM event_collaborators
    WHERE event_collaborators.user_id = auth.uid()
  )
);

-- event_dj_slots
DROP POLICY IF EXISTS "event_dj_slots_all_admin" ON event_dj_slots;
CREATE POLICY "event_dj_slots_all_admin" ON event_dj_slots FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "event_dj_slots_select_collab" ON event_dj_slots;
CREATE POLICY "event_dj_slots_select_collab" ON event_dj_slots FOR SELECT USING (
  has_role('collab') AND event_id IN (
    SELECT event_collaborators.event_id FROM event_collaborators
    WHERE event_collaborators.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS "event_dj_slots_select_designer" ON event_dj_slots;
CREATE POLICY "event_dj_slots_select_designer" ON event_dj_slots FOR SELECT USING (has_role('designer'));

-- event_budgets
DROP POLICY IF EXISTS "event_budgets_all_admin" ON event_budgets;
CREATE POLICY "event_budgets_all_admin" ON event_budgets FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "event_budgets_select_collab" ON event_budgets;
CREATE POLICY "event_budgets_select_collab" ON event_budgets FOR SELECT USING (
  has_role('collab') AND event_id IN (
    SELECT event_collaborators.event_id FROM event_collaborators
    WHERE event_collaborators.user_id = auth.uid()
  )
);

-- event_budget_expenses
DROP POLICY IF EXISTS "event_budget_expenses_all_admin" ON event_budget_expenses;
CREATE POLICY "event_budget_expenses_all_admin" ON event_budget_expenses FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "event_budget_expenses_select_collab" ON event_budget_expenses;
CREATE POLICY "event_budget_expenses_select_collab" ON event_budget_expenses FOR SELECT USING (
  has_role('collab') AND budget_id IN (
    SELECT event_budgets.id FROM event_budgets WHERE event_budgets.event_id IN (
      SELECT event_collaborators.event_id FROM event_collaborators
      WHERE event_collaborators.user_id = auth.uid()
    )
  )
);

-- event_budget_income
DROP POLICY IF EXISTS "event_budget_income_all_admin" ON event_budget_income;
CREATE POLICY "event_budget_income_all_admin" ON event_budget_income FOR ALL USING (has_role('admin'));

-- event_tix_tiers
DROP POLICY IF EXISTS "event_tix_tiers_all_admin" ON event_tix_tiers;
CREATE POLICY "event_tix_tiers_all_admin" ON event_tix_tiers FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "event_tix_tiers_select_collab" ON event_tix_tiers;
CREATE POLICY "event_tix_tiers_select_collab" ON event_tix_tiers FOR SELECT USING (
  has_role('collab') AND budget_id IN (
    SELECT event_budgets.id FROM event_budgets WHERE event_budgets.event_id IN (
      SELECT event_collaborators.event_id FROM event_collaborators
      WHERE event_collaborators.user_id = auth.uid()
    )
  )
);

-- event_collaborators
DROP POLICY IF EXISTS "event_collaborators_all_admin" ON event_collaborators;
CREATE POLICY "event_collaborators_all_admin" ON event_collaborators FOR ALL USING (has_role('admin'));

-- event_view_customizations
DROP POLICY IF EXISTS "evc_all_admin" ON event_view_customizations;
CREATE POLICY "evc_all_admin" ON event_view_customizations FOR ALL USING (has_role('admin'));

-- views / view_fields
DROP POLICY IF EXISTS "views_all_admin" ON views;
CREATE POLICY "views_all_admin" ON views FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "views_select_designer" ON views;
CREATE POLICY "views_select_designer" ON views FOR SELECT USING (
  has_role('designer') AND audience = 'designer'
);
DROP POLICY IF EXISTS "view_fields_all_admin" ON view_fields;
CREATE POLICY "view_fields_all_admin" ON view_fields FOR ALL USING (has_role('admin'));
DROP POLICY IF EXISTS "view_fields_select_designer" ON view_fields;
CREATE POLICY "view_fields_select_designer" ON view_fields FOR SELECT USING (
  has_role('designer') AND EXISTS (
    SELECT 1 FROM views v WHERE v.id = view_fields.view_id AND v.audience = 'designer'
  )
);

-- profiles
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT USING (has_role('admin'));

-- w9_reminders
DROP POLICY IF EXISTS "w9_reminders_all_admin" ON w9_reminders;
CREATE POLICY "w9_reminders_all_admin" ON w9_reminders FOR ALL USING (has_role('admin'));

-- ---------------------------------------------------------------------------
-- 4. Drop get_my_role() now that nothing references it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_my_role();

NOTIFY pgrst, 'reload schema';
