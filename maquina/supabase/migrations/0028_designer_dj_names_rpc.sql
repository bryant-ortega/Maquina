-- Migration 0028 — tighten designer RLS on `djs`.
--
-- Flagged in migration 0020's own comment: `djs_select_designer` is a
-- row-level policy, not column-level, so it grants a designer's JWT
-- SELECT on every column of `djs` — pay_method, pay_handle, phone,
-- email, w9_status, government_name, rank, region, user_id — even
-- though the UI only ever renders `dj_name` (for the lineup on their
-- one view, /designer/view). A designer's session token could in
-- theory be used to query the REST API directly and pull that data,
-- bypassing the UI entirely.
--
-- Fix: drop the row-level policy and replace it with a SECURITY
-- DEFINER RPC that returns only (id, dj_name) for a given set of DJ
-- ids, gated to designer/admin callers. Same pattern already used for
-- has_role() itself — narrow the surface to exactly what's needed
-- instead of a blanket SELECT grant.
--
-- App-side: src/app/designer/view/page.tsx's lineup loader is updated
-- in the same commit to stop embedding `djs(dj_name)` on
-- event_dj_slots (which relied on the now-removed policy) and instead
-- call this RPC with the distinct dj_ids from the slots it already
-- fetched.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom.
-- Run after 0026 and 0027.

DROP POLICY IF EXISTS "djs_select_designer" ON djs;

CREATE OR REPLACE FUNCTION public.designer_dj_names(p_dj_ids uuid[])
RETURNS TABLE(id uuid, dj_name varchar)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT d.id, d.dj_name
  FROM djs d
  WHERE d.id = ANY(p_dj_ids)
    AND (has_role('designer') OR has_role('admin'))
$function$;

-- Explicit grant — belt and suspenders in case this project's default
-- privileges don't already expose new public-schema functions to
-- PostgREST's `authenticated` role.
GRANT EXECUTE ON FUNCTION public.designer_dj_names(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
