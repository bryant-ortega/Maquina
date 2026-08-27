-- Migration 0044 — drop the unused logo_received_at column.
--
-- Added in 0041 alongside logo_received for symmetry with
-- approved_at/paid_at, but nothing ever reads it — no list/detail view,
-- no filter, no export. logo_received itself (the checkbox state) and
-- logo_reminder_email_sent_at (the bulk-reminder dedup, added in 0042)
-- are the only two columns this feature actually needs. Dropping the
-- dead one rather than leaving it around unused.

ALTER TABLE ofrendas_vendor_applications
  DROP COLUMN IF EXISTS logo_received_at;

NOTIFY pgrst, 'reload schema';
