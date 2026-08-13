-- Migration 0040 — waitlist email tracking on
-- ofrendas_vendor_applications.
--
-- Adds the field needed for a third bulk "send a form email" button
-- ("Email waitlisted vendors") that emails everyone NOT marked
-- approved, same dedup pattern as approved_email_sent_at /
-- paid_email_sent_at from migration 0035:
--
--   waitlist_email_sent_at  timestamptz, set once the waitlist email
--                            actually sends (stays null if
--                            RESEND_API_KEY isn't configured yet, same
--                            dormant-safe philosophy as lib/email.ts)
--
-- Unlike approved/paid, there's no boolean flag to toggle here — the
-- "waitlist" state is just approved = false, so there's no matching
-- reset-on-uncheck action; if a vendor is later approved after having
-- gotten the waitlist email, that's fine as-is.

ALTER TABLE ofrendas_vendor_applications
  ADD COLUMN IF NOT EXISTS waitlist_email_sent_at timestamptz;

NOTIFY pgrst, 'reload schema';
