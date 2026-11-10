-- Run this in Supabase → SQL Editor (same project as the other trackers).
--
-- Adds 'November' to the allowed `month` values, same pattern as
-- ADD_MONTH_AND_SPLIT_CATEGORIES.sql did for September/October (Lauren,
-- 2026-11-10: TAC's invoices need a real November budget to land in).

ALTER TABLE tacgrowth_budget_entries DROP CONSTRAINT IF EXISTS tacgrowth_budget_entries_month_check;
ALTER TABLE tacgrowth_budget_entries ADD CONSTRAINT tacgrowth_budget_entries_month_check
  CHECK (month IN ('September', 'October', 'November'));
