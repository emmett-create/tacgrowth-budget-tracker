# TAC Growth Budget Tracker

Cloned from `madegood-budget-tracker`/`moonjuice-budget-tracker` 2026-09-24,
per Emmett's ask for The Absorption Company (Growth) — $150,000 total budget.

Deliberately different from every other tracker here: instead of the usual
A8 Paid Influencers / {Client} Paid Influencers / Shipping & Mailers split,
this one has exactly two categories — **Hair** ($50,000) and **Berberine /
WLP-1** ($100,000) — the two campaigns themselves. Each has its own budget
cap and progress bar on the dashboard, which no other tracker does (they
only track one combined total).

Everything else MadeGood's/Moon Juice's trackers have is here too: the
Needs Review inbox (DocuSign contracts and invoice-sourced entries), Send to
Lumanu, retroactive invoice attach, contract link, calendar/invoice/sent
views.

## Invoice categorization

Invoice emails to `invoicing@agency-eight.com` follow the usual subject
format — `TAC Growth @handle CAMPAIGN MONTH/YEAR BILLING_EMAIL` — and the
bridge now extracts CAMPAIGN as its own field (not just embedded in the
description text, like other clients). It matches that against
`campaign_category_map` in the bridge's `config.py` (keywords: "hair" →
`hair`, "berberine"/"wlp" → `berberine_wlp1`) to set the category
automatically. If the campaign text doesn't match either keyword, category
is left blank — same as any other field the extraction couldn't confidently
fill in, so the AM just picks it manually at the normal "Assign + add"
review step. Nothing about this skips human review; it only saves a click
when the match is obvious.

## Setup status

Decided 2026-09-24: shares MadeGood's existing Supabase project (Emmett's
out of projects on the free tier) — `tacgrowth_budget_entries` lives
alongside `madegood_budget_entries` and `moonjuice_budget_entries` there.
Done as of this decision:

- [x] Table created (`supabase_setup.sql`, run in the shared project's SQL Editor)
- [x] `docs/config.js` pointed at the shared project
- [x] `"tacgrowth"` added to `budget-tracker-lumanu-bridge/config.py`'s
      `CLIENTS` dict — reuses MadeGood's `invoices` Storage bucket (paths
      are namespaced by client, so no collision) and its existing
      `MADEGOOD_SUPABASE_SERVICE_KEY` Render secret (project-wide, not
      per-table, so no new secret was needed)
- [x] Bridge's invoice-extraction schema + `receive_invoice` updated to
      support campaign-based category mapping (see above)

## Still needed

1. **GL Account** — starts unset (`None`), same situation every other
   tracker is in. `/api/lumanu/send` will refuse to send until it's filled in.
2. **Push this repo to GitHub**, enable GitHub Pages serving from `/docs`,
   matching every other tracker
   (`emmett-create.github.io/tacgrowth-budget-tracker/`).
3. **Set up the invoicing Zap** for TAC Growth — duplicate an existing
   client's zap, change the Subject filter to `TAC Growth`, same as any
   other new client onboarding onto this pipeline.

None of these block basic manual use (adding entries by hand, tracking
either campaign's budget) — only the Lumanu-integrated parts need them.
