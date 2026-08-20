-- Migration 0042 — dedup tracking for the Ofrendas logo reminder email.
--
-- Adds logo_reminder_email_sent_at, same dedup pattern as
-- approved_email_sent_at / paid_email_sent_at: the "Email vendors
-- missing logo" bulk button only sends to rows where this is still
-- null, and sets it once the send actually goes out. Unmarking
-- logo_received clears it (see actions.ts), so a vendor whose logo
-- turns out unusable becomes eligible for a reminder again, same
-- re-arm behavior as unapproving/unmarking-paid.
--
-- Run after 0041.

ALTER TABLE ofrendas_vendor_applications
  ADD COLUMN IF NOT EXISTS logo_reminder_email_sent_at timestamptz;

NOTIFY pgrst, 'reload schema';
