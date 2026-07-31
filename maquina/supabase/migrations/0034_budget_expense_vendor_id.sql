-- Migration 0034 — link budget expense lines to a registered vendor.
--
-- Adds a nullable vendor_id FK to event_budget_expenses so the budget's
-- existing "Vendors" expense category (category='vendors') can carry a
-- row per vendor assigned to the event via event_vendors (migration
-- 0031), auto-populated with the vendor's name, alongside a Rate
-- ($ = price) and Type (freeform = item, e.g. "Robot", "Flowers", "360
-- Video") the admin fills in. Freeform vendor-cost lines not tied to a
-- roster vendor keep working exactly as before — vendor_id just stays
-- NULL on those rows.
--
-- ON DELETE CASCADE: if a vendor is permanently deleted from the roster,
-- its linked budget rows go with it (a row with a null-forever vendor
-- reference has no name to display and isn't useful to keep). Note this
-- is deliberately NOT tied to event_vendors (the per-event assignment) —
-- unassigning a vendor from an event is handled in application code
-- (src/app/(admin)/events/[id]/edit/actions.ts), which explicitly
-- deletes any event_budget_expenses rows for that vendor scoped to the
-- event's budgets, on both Estimated and Final.
--
-- Run after 0031 (event_vendors must already exist). Then run the
-- NOTIFY at the bottom.

ALTER TABLE event_budget_expenses
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS event_budget_expenses_vendor_id_idx
  ON event_budget_expenses (vendor_id)
  WHERE vendor_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
