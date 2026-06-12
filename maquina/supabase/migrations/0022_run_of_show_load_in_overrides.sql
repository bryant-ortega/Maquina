-- Migration 0022 — manual load-in time overrides for Run of Show.
--
-- src/lib/run-of-show.ts auto-computes two production rows from
-- doors_time:
--   "LosGothsCo load-in" = doors - 180 min (3h before doors)
--   "DJs load-in"        = doors -  90 min (1.5h before doors)
--
-- These two new nullable TIME columns let an admin override either
-- row's time on a per-event basis from the event edit form. NULL (the
-- default for every existing row) preserves the current computed
-- behavior — no existing run-of-show schedules change until an admin
-- explicitly sets one.
--
-- Apply via the Supabase SQL Editor, then run the NOTIFY at the bottom
-- so PostgREST picks up the new columns immediately.

ALTER TABLE events
  ADD COLUMN losgoths_load_in_time time,
  ADD COLUMN dj_load_in_time       time;

NOTIFY pgrst, 'reload schema';
