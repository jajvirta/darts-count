# Plan: weekly tournament tracking

Status: **planned, not started.** Resume point.

## Goal
Track weekly tournaments via their **first-9 average** (standard 3-dart-equivalent
scoring proxy). Tournament darts **count toward weekly volume** and tournaments
are a fixed element of the weekly menu — but they're **excluded from the TEST
(power-scoring) trend** and get their own separate first-9 progress line.

## Decisions (locked)
- **Volume capture:** enter **legs played**; darts are **estimated** as
  `round(legs * 1503 / first9)` (≈ 501 points/leg ÷ scoring pace). Approximate
  by design.
- **Captured fields:** first-9 average + legs only. No win/loss.

## Data model
Add a 5th session type **`tournament`**. Fields:
- `first9` — first-9 three-dart average (number, decimals allowed, ~1–180).
- `legs` — legs played (positive int).
- `darts` — **derived** server-side from legs + first9 (volume).
- `notes`. (`target`/`score`/`visits` unused for this type.)

Flows through the same store/history as other sessions.

## Backend — `validateSession`
Branch on type. For `tournament`: require `first9` (number 1–180) and `legs`
(positive int); derive `darts = round(legs * 1503 / first9)`; `score` not
required (omit or 0). Other types unchanged. Ships on next `backend.sh`.

## Analytics — `scoring-stats.js`
Three independent things:
- **TEST trend stays pure** — already filters `type === 'test'`; tournaments
  never touch it. No change.
- **Volume includes tournaments**, and shows a **breakdown** (e.g. "1,800 last
  7d = 1,200 practice + 600 tournament") so match play counting toward the floor
  is transparent.
- **New tournament first-9 line** — separate rolling average + trend over
  `type === 'tournament'`, in its own block. Same noise-aware treatment; never
  compared 1:1 with the T20 ruler (match first-9 typically reads lower).

## Log UI
- Type dropdown gains `tournament`. The manual form shows the relevant fields
  per type: tournament → **First-9 avg** + **Legs** (hide target/darts/score);
  others → current fields. (Per-visit TEST flow unchanged.)
- History rows for tournaments show **first-9** (tagged), not the T20 3-dart avg.
- A small **"Tournaments"** summary card (rolling first-9 + trend), separate
  from the practice summary.

## Methodology — `practice/README.md`
Add the weekly tournament to the microcycle as the **competition / transfer
element** (the "play real legs under pressure" desirable difficulty). It counts
toward weekly volume, is tracked by first-9, and is **not** part of the TEST
ruler. Note explicitly: tournament first-9 usually sits below the T20
power-scoring number — that gap is normal, not a regression.

## Build order
1. Lambda: `tournament` branch in `validateSession` (require first9 + legs;
   derive darts) + unit tests.
2. `scoring-stats.js`: tournament first-9 rolling avg + trend; volume
   practice/tournament breakdown.
3. Log UI: type-conditional form fields; tournament history rows; Tournaments
   summary card.
4. `practice/README.md` methodology update.
5. Verify: Lambda unit tests; headless drive of tournament entry + display;
   `./deploy.sh` (+ `backend.sh` for the Lambda change).

## Notes
- darts estimate is intentionally rough; guard `first9 > 0` to avoid div-by-zero.
- `scoring-stats.analyze` is otherwise length-agnostic; the tournament line is a
  parallel computation, not a change to the TEST path.
