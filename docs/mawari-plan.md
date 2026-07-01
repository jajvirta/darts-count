# Mawari — scorekeeper plan & rules spec

A real-board **scorekeeper** for Mawari (Kari Kaitanen, *The Darts Book*). Two
humans throw at a physical board; the app tracks Tau positions and enforces the
rules. Its own section now (`Mawari` tab); may split to its own path later.

Status: **Phase 1 done** (visual). Phases 2–4 pending.

## The game (2-player focus; 2–8 supported later)
- Each player has **3 Taus** (markers). Race them up the **numeric track**
  `1 → 2 → … → 20 → Home`. First to get all 3 Taus **Home** wins. **No
  equalizing turn.**
- **Start (2-player triangle):** P1 = **5, 6, 16** · P2 = **1, 11, 15**.
  (Sectors can hold Taus of both players.)
- **Shirushi:** hitting a sector = single 1 / double 2 / triple 3 shirushi.
- **Format:** one / two / three-shirushi mawari (the number N below).

## Advance rule (CONFIRMED — verified against all examples)
Per Tau, keep a **carry `C`**, starting 0 at the start of the player's turn,
**persisting across that turn's 3 darts**. Each dart is evaluated against the
Tau sitting on the hit sector **at the instant it is thrown**. For a dart with
`m` shirushi on a Tau's current sector:
- `C += m`
- if `C ≥ N`: advance the Tau **`C − (N − 1)`** sectors, then **`C = 0`**
- else: no move; `C` carries to the next dart

I.e. it costs `N` shirushi to get the Tau moving, then **every extra shirushi in
that same dart is +1 sector**, and the counter resets after each advancing dart
(re-pay `N` next dart). You **chase your own Tau**: after it advances, later
darts must hit its **new** sector.

Verified cases:
| N | darts (sector) | result |
|---|---|---|
| 1 | S1, D2, T4 | 1→2→4→7 |
| 2 | S1, S1, D2 | 1→2→3 (advance 2) |
| 2 | S1, T1, T4 | 1→4→6 (advance 3 then 2) |
| 3 | S1×3 | 1→2 |
| 3 | S1, D1, T2 | 1→2→3 |

**Overshoot past 20 (CONFIRMED):** an advance that would pass 20 **caps at 20**;
extra steps are wasted. From 20 you exit only via the Home points mechanic.

**Own-Tau stacking (CONFIRMED):** two+ of your own Taus **may share a sector**
(happens immediately — P1 starts on 5 & 6). Each is tracked separately. When a
dart lands on a sector holding two of your Taus, the player chooses which
co-located Tau the shirushi feeds (engine needs a selection prompt there).

**No banking (two rules, confirmed):**
1. A leftover partial carry is **lost at end of turn** (the Tau shows only
   position, not partial shirushi).
2. **No banking within a turn either:** a dart only feeds the Tau on that sector
   at the moment it's thrown; hitting a sector the Tau only *later* arrives on
   does **not** retroactively count.

## New turn (throw again before opponent)
Requires **all 3 darts in your sectors** AND a per-format minimum total advance:
- one-shirushi: (all 3 in-sector ⇒ ≥3 steps inherently)
- two-shirushi: **≥3 steps** total this turn
- three-shirushi: **≥4 steps** total this turn

## Must "try to advance"
Each turn you must attempt: hit your sector with ≥1 dart (one-shirushi), ≥2
(two), ≥3 (three). If you fail, the opponent **may** (voluntary) force **3
penalty throws**; if none of those advance any of your Taus, the opponent moves
one of your Taus to any sector. (Voluntary because it gives you 3 more darts.)

## Drop rule  (CONFIRMED)
Two-step check, **in order**:
1. **Trigger:** the hit sector must hold **≥1 opponent Tau AND 0 of your (non-
   Home) Taus.** If any of your own Taus is on that sector, it is **protected** —
   **no drop**, full stop (the furthest-advanced selection never runs).
2. **Target:** if triggered, your **furthest-advanced** (non-Home) Tau relocates
   to the hit sector — **but only if that Tau is ahead of the hit sector** (a
   drop moves a Tau BACKWARD only, never to a higher number). If your furthest
   Tau is already at/behind the hit sector, nothing happens (`no-drop`).

Examples:
- Your Tau on 20, opp on 5, you hit 5 → your 20-Tau drops to 5. (triggers)
- Your Taus on 20 **and 5**, opp on 5, you hit 5 → **no drop** (5 is protected by
  your own Tau); the 20-Tau stays. (step 1 fails)
- Your furthest Tau on 6, opp on 15, you hit 15 → **no drop** (6 is behind 15; a
  Tau can't drop to a higher number). (step 2 fails)

**Home Taus are off the track (CONFIRMED):** a Home Tau is safe (can't be
dropped) and provides **no protection** to a sector. It's out of all track
interactions. Visually it moves to a **side tray** (not on the board).

## Home  (accounting CONFIRMED)
A Tau on **sector 20** goes Home by scoring **≥ threshold** points, **summed
across the turn's darts that land on S/D/T-20 or bull/outer-bull only**:
one-shirushi **50**, two **70**, three **90**. Reaching **≥ 2× threshold**
(100 / 140 / 180) also grants a **new turn**. Points **reset each turn** (no
banking). Home Taus can't move again. A Tau must be **on 20** to cash out.

## Architecture
- **`mawari.js`** — view controller (`{init,onActivate,onDeactivate,onKey}`),
  registered in `app.js` routing; `Mawari` tab.
- **`board.js`** — extended additively: `render(darts, taus)` / `resize(darts,
  taus)` paint Tau discs (P1 cyan #00b4d8, P2 pink #ff70a6) on each sector's rim
  via the existing angle math. Board + Numpad are singletons — Practice and
  Mawari each re-`init` them onto their own elements in `onActivate`.
- **`mawari-engine.js`** (Phase 2, not yet built) — PURE rules module with a
  Node `module.exports` shim (like `checkout.js`/`scoring-stats.js`), CLI
  unit-testable. Holds advance/turn/drop/home/penalty/win logic.

## Phases
1. **DONE** — Mawari tab, setup (format picker), start-position board render with
   Taus. Verified headless.
2. **Engine** — pure `mawari-engine.js` + CLI unit tests of the advance rule and
   state machine (turn/new-turn/drop/home/penalty/win).
3. **DONE** — controller wired to the engine. Dart entry via **board tap**
   (`Board.hitAt`) AND **numpad + ring/bull/miss buttons**; per-dart feedback
   line (advance/drop/no-drop/home/etc.), per-player status, Undo dart, End
   game (with confirm), win banner. Verified headless.
3.5 **DONE — UI polish (this session):**
   - Co-located Taus **auto-advance** (no picker — all Taus equal).
   - Taus rendered as **pins outside the double ring** with the player number
     inside; **double/triple rings widened** and the board shrunk to make room
     (shared `board.js` — Practice reflects this too).
   - **Full-screen** during a match (`body.playing` hides the header on mobile,
     like TestLog); **two-column** layout at ≥768px (iPad + web), single column
     on phones; **compact controls** so everything fits a phone screen.
   - Compact top row (turn + this-turn chips merged; format/dart subline + tap
     hint removed — a Tutorial mode will cover explanation later).
   - **Home stash** in the board's top corners (🏠 + 3 slots per player, dashed
     when empty, fill as Taus reach Home).
   - **"End game"** button with a confirm dialog (was "New").
   - Bug fix: a **drop only moves a Tau backward** (never to a higher number).
   - Header safe-area bug fixed (inset was on the bottom).
4. **Match flow (pending)** — penalty UI (voluntary 3 throws → opponent
   relocates a Tau), **Tau move animations**, then N>2 players and own
   route/path.

## Resolved (2-player)
- Home accounting, drop target, overshoot-at-20, and own-Tau stacking — all
  confirmed above.

## Still open (resume here)
- **Penalty flow (Phase 4, next):** UI for the voluntary 3 throws + the opponent
  then moving one of your Taus "to whichever sector they want" (any sector 1–20?
  presumably not Home). The engine exposes `triedToAdvance` per turn already.
- **Tau move animations** (Phase 4).
- **N > 2 players** and the **own route/path** split (later).
- (Resolved: co-located Taus auto-advance — no picker needed.)
