-- Run this in Supabase → SQL Editor (same project as the other trackers).
--
-- Two separate changes, both needed for September/October budget separation
-- (Emmett, 2026-10-08):
--
-- 1. A `month` column — nothing distinguished September entries from October
--    entries before today, since this tracker never needed to separate them.
--    All EXISTING rows predate this split, so they all get backfilled as
--    'September' below (nothing has ever been tagged October before now).
--
-- 2. Berberine and WLP-1 need their OWN separate budget caps for October
--    ($52,854 / $88,090), not one combined 'berberine_wlp1' bucket like
--    September uses ($100,000 combined). The old combined value is kept
--    valid (not removed) so existing September rows don't need to be
--    individually reclassified into one or the other — the tracker's own
--    app.js treats 'berberine_wlp1' as part of the combined September
--    bucket going forward, and 'berberine' / 'wlp1' as the separate October
--    ones.

ALTER TABLE tacgrowth_budget_entries ADD COLUMN IF NOT EXISTS month text CHECK (month IN ('September', 'October'));
UPDATE tacgrowth_budget_entries SET month = 'September' WHERE month IS NULL;

ALTER TABLE tacgrowth_budget_entries DROP CONSTRAINT IF EXISTS tacgrowth_budget_entries_category_check;
ALTER TABLE tacgrowth_budget_entries ADD CONSTRAINT tacgrowth_budget_entries_category_check
  CHECK (category IN ('hair', 'berberine_wlp1', 'berberine', 'wlp1'));
