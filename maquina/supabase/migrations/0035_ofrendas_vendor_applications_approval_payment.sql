-- Migration 0035 — approval + payment tracking on
-- ofrendas_vendor_applications.
--
-- Adds the fields the admin list/detail views need to mark an
-- application approved, mark it paid, and drive the two bulk "send a
-- form email" buttons (one for newly-approved vendors, one for
-- newly-paid vendors) without re-emailing anyone twice:
--
--   approved                boolean, default false
--   approved_at             timestamptz, set when approved flips true
--   approved_email_sent_at  timestamptz, set once the approval email
--                            actually sends (stays null if
--                            RESEND_API_KEY isn't configured yet, so
--                            nothing is silently marked "sent" without
--                            really sending — same dormant-safe
--                            philosophy as lib/email.ts)
--   paid                    boolean, default false
--   paid_at                 timestamptz, set when paid flips true
--   paid_email_sent_at      timestamptz, same idea as above
--
-- Unapproving/unmarking-paid clears the matching *_email_sent_at from
-- the admin actions (see (admin)/ofrendas-vendor-applications/actions.ts)
-- so a later re-approval or re-payment is eligible for the bulk email
-- again — that reset happens in application code, not here.
--
-- Still isolated per 0032/0033's header comments: no FKs added, same
-- table, same RLS (service-role only). Run after 0034.

ALTER TABLE ofrendas_vendor_applications
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_email_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS ofrendas_vendor_applications_approved_idx
  ON ofrendas_vendor_applications(approved);

CREATE INDEX IF NOT EXISTS ofrendas_vendor_applications_paid_idx
  ON ofrendas_vendor_applications(paid);

NOTIFY pgrst, 'reload schema';
