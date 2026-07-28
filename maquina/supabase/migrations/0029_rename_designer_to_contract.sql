-- Migration 0029 — rename the 'designer' role to 'contract'.
--
-- Chase wants to fold the designer role and a forthcoming videographer
-- use case into one generic "Contract" role — an admin-granted,
-- read-only, locked-to-one-view role that's typically layered on top
-- of an existing vendor account (a photographer/videographer/flyer
-- designer who's already in the `vendors` table, plus this role for
-- event visibility). "designer" was too narrow a name for that.
--
-- There is no CHECK constraint on `profiles.roles` (it's a plain
-- text[] — the old profiles_role_check was tied to the singular
-- `role` column, which was dropped; see migration 0027's notes). So
-- this migration only needs to touch: existing data, `views.audience`
-- (which DOES have a CHECK, from 0010), and the RLS policies /
-- function that reference 'designer'.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom.
-- Run after 0026, 0027, 0028.

-- ---------------------------------------------------------------------------
-- 1. Data: swap 'designer' -> 'contract' in any existing profiles.roles.
-- ---------------------------------------------------------------------------
UPDATE profiles
SET roles = array_replace(roles, 'designer', 'contract')
WHERE 'designer' = ANY(roles);

-- ---------------------------------------------------------------------------
-- 2. views.audience — swap the CHECK constraint and any existing rows.
--
-- Two failed attempts before this one, both confirmed to roll back
-- cleanly on the live DB (no partial writes either time):
--   Attempt 1: UPDATE before widening the constraint — the UPDATE
--     tried to write 'contract' while the OLD constraint (allows
--     'designer', not 'contract') was still in force.
--   Attempt 2: widen the constraint before the UPDATE, but the new
--     constraint's allowed list already excluded 'designer' — so
--     ADD CONSTRAINT itself failed immediately against the existing
--     'designer' rows, before the UPDATE ever ran.
-- Fix: add the new constraint NOT VALID (Postgres only enforces NOT
-- VALID constraints against new/updated rows, not pre-existing ones),
-- do the UPDATE, then VALIDATE CONSTRAINT once no 'designer' rows are
-- left. Each step is individually satisfiable.
-- ---------------------------------------------------------------------------
ALTER TABLE views DROP CONSTRAINT IF EXISTS views_audience_check;
ALTER TABLE views
  ADD CONSTRAINT views_audience_check
  CHECK (audience IN ('internal', 'contract', 'venue', 'dj', 'partner', 'other'))
  NOT VALID;

UPDATE views SET audience = 'contract' WHERE audience = 'designer';

ALTER TABLE views VALIDATE CONSTRAINT views_audience_check;

-- ---------------------------------------------------------------------------
-- 3. RLS policies — re-point every has_role('designer') predicate at
--    has_role('contract'). DROP + CREATE (not OR REPLACE — Postgres
--    doesn't support that for policies).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "events_select_designer" ON events;
CREATE POLICY "events_select_contract" ON events FOR SELECT USING (has_role('contract'));

DROP POLICY IF EXISTS "event_dj_slots_select_designer" ON event_dj_slots;
CREATE POLICY "event_dj_slots_select_contract" ON event_dj_slots FOR SELECT USING (has_role('contract'));

DROP POLICY IF EXISTS "views_select_designer" ON views;
CREATE POLICY "views_select_contract" ON views FOR SELECT USING (
  has_role('contract') AND audience = 'contract'
);

DROP POLICY IF EXISTS "view_fields_select_designer" ON view_fields;
CREATE POLICY "view_fields_select_contract" ON view_fields FOR SELECT USING (
  has_role('contract') AND EXISTS (
    SELECT 1 FROM views v WHERE v.id = view_fields.view_id AND v.audience = 'contract'
  )
);

-- ---------------------------------------------------------------------------
-- 4. designer_dj_names() (migration 0028) — rename + repoint at
--    has_role('contract'). Keep the old name as a thin wrapper for one
--    release in case anything cached the old function name, then drop
--    it in a later migration once confirmed unused.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_dj_names(p_dj_ids uuid[])
RETURNS TABLE(id uuid, dj_name varchar)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT d.id, d.dj_name
  FROM djs d
  WHERE d.id = ANY(p_dj_ids)
    AND (has_role('contract') OR has_role('admin'))
$function$;

GRANT EXECUTE ON FUNCTION public.contract_dj_names(uuid[]) TO authenticated;

DROP FUNCTION IF EXISTS public.designer_dj_names(uuid[]);

NOTIFY pgrst, 'reload schema';
