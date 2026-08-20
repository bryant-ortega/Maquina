-- Migration 0041 — logo-received tracking on ofrendas_vendor_applications.
--
-- Adds a simple checkbox field for Chase to mark off which vendors have
-- sent in their logo, independent of approved/paid status:
--
--   logo_received     boolean, default false
--   logo_received_at  timestamptz, set when logo_received flips true
--
-- No "email sent" companion column and no bulk-email button — unlike
-- approved/paid this doesn't drive an automated email, it's just a
-- tracking checkbox on the admin list (see status-toggles.tsx).
--
-- Same isolated table, same RLS (service-role only). Run after 0040.

ALTER TABLE ofrendas_vendor_applications
  ADD COLUMN IF NOT EXISTS logo_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logo_received_at timestamptz;

NOTIFY pgrst, 'reload schema';
