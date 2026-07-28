-- Migration 0031 — event_vendors junction table.
--
-- Lets an admin attach specific vendors to an event, mirroring how
-- event_dj_slots links DJs to events — except vendors don't get rate/
-- time/slot fields (per Chase: "i just need to add vendor names from
-- dropdown so that maquina knows who to send ROS to"). Just a plain
-- many-to-many join.
--
-- Two things read this table:
--   1. New/Edit Event forms — a vendor multi-select, replacing the
--      event's vendor list wholesale on save (same pattern as DJ slots).
--   2. Send Run of Show — adds every assigned vendor's email to the
--      recipient list.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom.
-- Run after 0030.

CREATE TABLE IF NOT EXISTS event_vendors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vendor_id  uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, vendor_id)
);

ALTER TABLE event_vendors ENABLE ROW LEVEL SECURITY;

-- Admin: full CRUD, same shape as event_dj_slots_all_admin.
DROP POLICY IF EXISTS "event_vendors_all_admin" ON event_vendors;
CREATE POLICY "event_vendors_all_admin" ON event_vendors FOR ALL USING (has_role('admin'));

-- Finance: read-only, consistent with its budgets/DJ/vendor roster scope.
DROP POLICY IF EXISTS "event_vendors_select_finance" ON event_vendors;
CREATE POLICY "event_vendors_select_finance" ON event_vendors FOR SELECT USING (has_role('finance'));

-- Contract: read-only — a contracted vendor's whole point is seeing
-- upcoming events, and knowing which vendors (including themselves)
-- are on a given event is part of that view.
DROP POLICY IF EXISTS "event_vendors_select_contract" ON event_vendors;
CREATE POLICY "event_vendors_select_contract" ON event_vendors FOR SELECT USING (has_role('contract'));

CREATE INDEX IF NOT EXISTS event_vendors_event_id_idx ON event_vendors(event_id);
CREATE INDEX IF NOT EXISTS event_vendors_vendor_id_idx ON event_vendors(vendor_id);

NOTIFY pgrst, 'reload schema';
