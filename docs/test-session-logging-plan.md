# Plan: per-visit TEST session logging

Status: **DONE** (shipped). Per-visit entry, the prominent sparkline progress
cards, and the floor/ceiling distribution analysis are all built and verified.
Kept for reference.

## Goal
A guided "log a TEST session" mode in the app: enter 100 three-dart visit
totals (0–180) one at a time, with live total / 3-dart average / visits-left,
and a Confirm that writes the full **per-visit** detail to DynamoDB. This is
**capture only** — the distribution *analysis* is a deliberate follow-up.

Why: per-visit data lets us see the *shape* of scoring, not just the mean —
e.g. `% visits ≤26` (wasted visits = the floor) vs `% ≥60` (the ceiling). For an
~49 average, raising the floor (26s → 60s) usually beats raising the ceiling, so
this is what tells us *how* to train most efficiently.

## Decisions (locked)
- **Corrections:** an **editable list** of committed visits — tap any to
  re-enter/delete, plus an Undo for the last. Edits recompute total/avg/left.
- **Session length:** **configurable, default 100.** Start screen offers
  100 / 50 / custom. Length drives "visits left"; a finish-early path exists.
  `darts = visits.length * 3`, so shorter blocks still give a comparable (just
  noisier) 3-dart average.

## Data model
Add `visits: number[]` to a session (the 3-dart totals). Make `darts` and
`score` **derived** (`darts = visits.length*3`, `score = sum(visits)`) so the
existing analytics (`scoring-stats.js`, Log summary/history) keep working.
`visits` is **optional** — manual/old sessions without it stay valid.

DynamoDB item just gains a `visits` list (tiny; well within limits).

## Backend — `infra/lambda/index.mjs`
- `validateSession`: accept optional `visits` — array, length 1–100, each an
  integer 0–180; when present, compute/override `darts` and `score` from it.
- **Switch writes to a JSON body.** The query-string approach was an OAC-era
  workaround; on API Gateway a JSON body cleanly carries the 100-element array.
  `parseInput` already falls back to the body; CloudFront forwards POST bodies
  to the origin automatically → no infra/distribution change. (Query-string
  create can stay supported for the simple manual form.)
- Ships on the next `infra/backend.sh` run (updates the Lambda code). No
  CloudFront change.

## Frontend
New controller `public/js/testlog.js` (IIFE attaching `window.TestLog`, same
`{init,onActivate,onDeactivate,onKey}` shape as the other views; load before
`app.js` in `index.html`). Markup in the Log view (`index.html`), styles in
`public/css/styles.css`.

- **Start screen:** "▶ Start TEST session" button in the Log tab → pick length
  (default 100) → begin. Switch the Log view into a compact full-height entry
  panel (reuse the `body.playing` full-screen pattern).
- **Entry panel:**
  - Live header: big **total**, **3-dart avg** (total ÷ visits-so-far),
    **visits left** (target − count).
  - **Reuse the `Numpad`** component (numpad.js — same keys/feel as Practice):
    digits build a 0–180 value, **Enter** commits a visit, **Backspace** edits
    the current entry. Hardware keyboard via the global keydown bus too.
    Reject/clamp >180.
  - **Editable list** of committed visits (scrollable): tap to re-enter/delete,
    plus **Undo last**.
  - **Confirm & save** enabled at the target (and a finish-early path). On
    confirm → POST full session (`type:test`, `target:T20`, `visits[]`, optional
    note) as a JSON body via `store.create` → return to Log summary/history.
- **Crash safety:** autosave the in-progress `visits` (+ target) to
  `localStorage` after every change; restore/offer-resume on load so a refresh
  doesn't lose 90 entries.
- `store.js`: `create`/`update` send a **JSON body** (carry `visits`); keep the
  `X-Api-Key` header. (Reverts the query-string-only writes.)

## Build order
1. Lambda: `visits` validation + derived darts/score (+ pure unit tests).
2. `store.js`: create/update via JSON body.
3. `testlog.js` + entry-panel markup + CSS; wire the "Start TEST session" button
   and view routing.
4. Reuse `Numpad`; editable list; localStorage autosave/restore.
5. Verify: Lambda unit tests; headless-Chrome (CDP) drive of enter → edit →
   confirm, asserting the POST body shape (visits[], derived fields) + zero
   console errors. Then `./deploy.sh` (frontend). Lambda change rides the next
   `infra/backend.sh`.

## Out of scope (next step, after data exists)
Distribution **analysis** — add to `scoring-stats.js`: `%≤26`, `%≥60`, ton+
count, max visit, per-visit SD, and a "what to drill" hint; plus a small view.
Do this once a few detailed sessions are logged.

## Notes / open implementation details
- Confirm exact `Numpad` reuse approach when building (it currently inits once
  for Practice; the entry panel needs its own keypad container + handlers).
- `scoring-stats.analyze` is length-agnostic (uses score/darts), so configurable
  length needs no change there.
- Backward compat: Log history/summary already derive from score/darts; nothing
  there changes.
