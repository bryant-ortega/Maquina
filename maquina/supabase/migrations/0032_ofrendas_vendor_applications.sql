-- Migration 0032 — ofrendas_vendor_applications.
--
-- Standalone lead-capture table for the "Ofrendas" market event vendor
-- call (see LosGothsCo_Vendor_Call.md). Deliberately NOT wired into the
-- existing vendors / event_vendors / profiles system — this backs a
-- one-off public form at /ofrendas-vendors that Chase shares as a
-- direct link. No nav entry, no auth, no relation to the real vendor
-- roster. Submissions are read straight from the Supabase dashboard /
-- table editor for now.
--
-- Isolated on purpose: no foreign keys to any other table, own RLS,
-- own route folder. If Ofrendas doesn't become a recurring thing, the
-- whole feature can be removed cleanly — see
-- supabase/teardown/ofrendas_vendor_applications_teardown.sql.
--
-- RLS is enabled with NO policies for anon/authenticated, so only the
-- service-role key (used server-side in the form's server action) can
-- insert, and only service-role access (e.g. the Supabase dashboard)
-- can read. Run after 0031.

CREATE TABLE IF NOT EXISTS ofrendas_vendor_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name         text NOT NULL,
  contact_name          text NOT NULL,
  email                 text NOT NULL,
  phone                 text NOT NULL,
  instagram_or_website  text,
  categories            text[] NOT NULL DEFAULT '{}',
  plant_based_options   boolean NOT NULL DEFAULT false,
  description           text NOT NULL,
  additional_notes      text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ofrendas_vendor_applications ENABLE ROW LEVEL SECURITY;
-- No policies added — deliberate default-deny for anon/authenticated.
-- All access happens via the service-role key.

CREATE INDEX IF NOT EXISTS ofrendas_vendor_applications_created_at_idx
  ON ofrendas_vendor_applications(created_at);

NOTIFY pgrst, 'reload schema';
