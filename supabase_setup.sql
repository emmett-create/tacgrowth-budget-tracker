-- Run this in Supabase → SQL Editor (in the SAME shared project as
-- madegood-budget-tracker / moonjuice-budget-tracker — Emmett's out of
-- projects on the free tier, 2026-09-24)
--
-- This is a consolidated version of everything madegood-budget-tracker's own
-- supabase_setup.sql built up incrementally over time (DocuSign inbox, Lumanu
-- integration, retroactive invoice attach, contract link) — TAC Growth
-- starts with Lumanu already built in from day one, so there's no migration
-- history to replay, just the final schema.
--
-- Only real difference from MadeGood/Moon Juice's schema: the category CHECK
-- constraint. Emmett's call (2026-09-24) — this tracker has no a8_paid /
-- {client}_paid / shipping split at all, just the two campaigns themselves
-- as categories, each with its own budget cap (Hair $50k, Berberine/WLP-1
-- $100k — enforced in the tracker's own app.js, not the database).

CREATE TABLE tacgrowth_budget_entries (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date            date NOT NULL,
  category        text CHECK (category IN ('hair', 'berberine_wlp1')),
  entry_type      text NOT NULL DEFAULT 'actual' CHECK (entry_type IN ('actual', 'planned')),
  creator_handle  text,
  description     text,
  amount          numeric(12, 2) NOT NULL,
  notes           text,
  status          text NOT NULL DEFAULT 'confirmed',        -- 'pending' = sitting in the Needs Review inbox
  source          text NOT NULL DEFAULT 'manual',            -- 'invoice_email' | 'manual' | (docusign zap, if added later)
  ready_to_invoice boolean NOT NULL DEFAULT false,
  billing_id      text,                                      -- Lumanu ID or billing email
  due_date        date,
  po_number       text,
  lumanu_status   text NOT NULL DEFAULT 'not_sent'
    CHECK (lumanu_status IN ('not_sent','needs_approval','approved','pending','issued','canceled')),
  lumanu_payable_id text,                                     -- set once actually sent to Lumanu; prevents double-sends
  invoice_path    text,                                       -- path in the private "invoices" Storage bucket
  contract_link   text,                                       -- plain link to the signed contract (DocuSign or any URL)
  planned_amount  numeric(12, 2),                              -- unused going forward (Planned was retired 2026-09-22), kept for schema parity
  created_at      timestamptz DEFAULT now()
);

-- Allow public read/write (no login required — internal tool, same as every other tracker)
ALTER TABLE tacgrowth_budget_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON tacgrowth_budget_entries FOR SELECT USING (true);
CREATE POLICY "Public insert" ON tacgrowth_budget_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON tacgrowth_budget_entries FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON tacgrowth_budget_entries FOR DELETE USING (true);

-- Reuses the existing "invoices" Storage bucket already created for
-- MadeGood/Moon Juice — paths are namespaced by client, so no collision.
-- Nothing to create here.
