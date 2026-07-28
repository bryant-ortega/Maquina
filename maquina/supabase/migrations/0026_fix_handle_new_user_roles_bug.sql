-- Migration 0026 — fix handle_new_user() reading the wrong metadata key.
--
-- BUG: handle_new_user() (the AFTER INSERT ON auth.users trigger that
-- creates each new profiles row) still does:
--
--   ARRAY[COALESCE(NEW.raw_user_meta_data->>'role', 'dj')]
--
-- i.e. it reads a singular `role` string out of user_metadata. But
-- since commit da4ea02 ("migrate from role column to roles array"),
-- src/app/register/dj/actions.ts and src/app/register/vendor/actions.ts
-- both write:
--
--   user_metadata: { roles: ['dj'] }   /* or ['vendor'] */
--
-- — a plural `roles` array, not a `role` string. `raw_user_meta_data->>
-- 'role'` on that shape returns NULL (the key doesn't exist), so the
-- COALESCE always falls through to the 'dj' default, no matter what
-- the registrant actually signed up as.
--
-- Confirmed against production data:
--   - DJ registrations still *look* fine (roles = ['dj']), but only by
--     coincidence — the buggy fallback default happens to equal 'dj'.
--   - No vendor has registered since this shipped (June 2), so the bug
--     hasn't visibly broken anything yet. But the next vendor signup
--     would get profiles.roles = ['dj'] instead of ['vendor'], which
--     bounces them straight to /dj/profile after registration instead
--     of /vendor/upload-w9 — they'd never see their own W-9 uploader
--     through the normal UI. Same failure mode would hit any future
--     role (designer, viewer, etc.) that ever gets a self-registration
--     flow of its own.
--
-- FIX: prefer the new `roles` array key; fall back to the legacy
-- singular `role` key for any code path that still sets it; fall back
-- to 'dj' only if neither is present, matching the original default.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom.
-- This only changes trigger logic — no table/column changes, so no
-- backfill is needed for existing rows.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  new_roles text[];
BEGIN
  IF NEW.raw_user_meta_data ? 'roles' THEN
    SELECT array_agg(value)
      INTO new_roles
      FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'roles');
  ELSIF NEW.raw_user_meta_data ? 'role' THEN
    new_roles := ARRAY[NEW.raw_user_meta_data->>'role'];
  END IF;

  INSERT INTO public.profiles (user_id, roles, display_name)
  VALUES (
    NEW.id,
    COALESCE(new_roles, ARRAY['dj']),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email)
  );
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
