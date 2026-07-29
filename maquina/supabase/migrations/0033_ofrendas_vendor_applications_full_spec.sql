-- Migration 0033 — rebuild ofrendas_vendor_applications to match the
-- full spec in Ofrendas_Vendor_Application_Form_Spec.md (15 questions
-- across vendor info, offerings, space needs, food/bev permitting, the
-- vendor agreement, content-use consent, and booth decor).
--
-- 0032 shipped a much smaller version before Chase provided the real
-- spec. No real submissions exist yet (table was empty), so this
-- drops and recreates rather than layering ALTERs — simpler and the
-- table is still fully isolated (see 0032's header comment: no FKs to
-- anything else in the app).
--
-- Still isolated on purpose: no foreign keys, own RLS (enabled, zero
-- policies — service-role only, same as before), own route folder.
-- To remove this feature entirely, see
-- supabase/teardown/ofrendas_vendor_applications_teardown.sql (still
-- accurate — it just drops the table, whatever its current shape).

DROP TABLE IF EXISTS ofrendas_vendor_applications;

CREATE TABLE ofrendas_vendor_applications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vendor & Business Info (Q1-6)
  business_name          text NOT NULL,
  vendor_names           text NOT NULL,
  email                  text NOT NULL,
  phone                  text NOT NULL,
  instagram_handle       text NOT NULL,
  website_url            text,

  -- What You're Bringing (Q7-9)
  offerings              text[] NOT NULL DEFAULT '{}',
  offerings_other        text,
  best_fit               text NOT NULL,
  best_fit_other         text,
  business_description   text NOT NULL,

  -- Space Needed (Q10)
  space_needed           text NOT NULL,

  -- Food & Beverage Vendors Only (Q11-12)
  food_permit_status     text NOT NULL,
  food_permit_other      text,
  menu_description       text,

  -- Agreement (Q13) — must be explicitly accepted to submit.
  agreement_accepted     boolean NOT NULL DEFAULT false,

  -- Content & extras (Q14-15)
  content_use_consent    text NOT NULL,
  booth_decor_plan       text,

  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ofrendas_vendor_applications_agreement_accepted_check
    CHECK (agreement_accepted = true)
);

ALTER TABLE ofrendas_vendor_applications ENABLE ROW LEVEL SECURITY;
-- No policies added — deliberate default-deny for anon/authenticated.
-- All access happens via the service-role key (server action insert,
-- Supabase dashboard for reads).

CREATE INDEX ofrendas_vendor_applications_created_at_idx
  ON ofrendas_vendor_applications(created_at);

NOTIFY pgrst, 'reload schema';
