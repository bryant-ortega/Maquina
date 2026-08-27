-- Migration 0043 — "Presented by" branding on events.
--
-- Adds presented_by, driving what renders at the top of the Run of
-- Show and Budget PDFs (src/components/pdf-templates/brand-band.tsx):
--
--   presented_by   varchar, default 'LosGothsCo.'
--
-- When it's the default, the PDFs keep showing the usual LosGothsCo
-- triangle + wordmark, unchanged from before this migration. Any other
-- value renders as plain text in that spot instead.
--
-- No CHECK constraint, deliberately: the option list
-- (PRESENTED_BY_OPTIONS in src/lib/event-defaults.ts) is meant to grow
-- by hand-editing that array as new co-presented series come up, not by
-- a migration each time — same app-level-only validation as
-- djs.region/vendors.region, which drifted from their own stale DB
-- CHECKs for the same reason (see handoff.md).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS presented_by varchar NOT NULL DEFAULT 'LosGothsCo.';

NOTIFY pgrst, 'reload schema';
