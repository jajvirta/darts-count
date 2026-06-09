# Power-scoring practice plan

A training system for raising your 3-dart scoring average, built around what you
can actually control (darts thrown) and honest about what you can't (day-to-day
variance). Doubles / checkouts / singles are deliberately **out of scope** here —
this is the scoring block.

Log every session in the app's **Log** tab; it stores them in the backend
(DynamoDB) and shows the trend. Setup: [`../infra/BACKEND.md`](../infra/BACKEND.md).

---

## 1. The two metrics, and why they're different

**Darts thrown = the commitment metric.** You control it completely. It's the
leading indicator: volume now → average later. Judge whether you're "on plan"
*only* by this. Hitting your weekly darts is a win regardless of the scores.

**3-dart average = the outcome metric.** You do *not* control it on any given
day — feel, fatigue, light, mood all move it. It's a lagging, noisy signal.
Judge improvement by this, but only as a **rolling average over several TEST
sessions**, never a single one.

This split is the whole philosophy: **chase volume, let the average follow.**

## 2. Why a single session lies to you (the noise math)

Your three baseline sessions: **50.5, 47.6, 46.8** (avg ≈ 48.3). The spread
isn't a 4-point collapse in form over three days — it's noise.

A 300-dart session is the sum of 100 three-dart sets. Set-to-set scatter (a
60, then a 41, then a 100, then a 26…) has a standard deviation of roughly
25–30 points. Summed over 100 sets and divided back to a per-3-dart figure, the
**session average has a standard deviation of about ±2–3 points.** So:

- A single test landing **±2σ (~±5 points)** from your true level is *pure luck*,
  both directions. A "great" 53 and a "terrible" 44 can be the exact same you.
- To see your real level, average **5+ tests**. The mean of 5 sessions cuts the
  noise by √5 ≈ 2.2×, down to **~±1 point**. *That* number is trustworthy.
- A real improvement only counts once the **rolling average** moves by more than
  the noise band — the Log view prints that threshold for you.

Practical rule: **never react to one session.** Don't change anything, don't
celebrate, don't despair. React to the rolling line.

## 3. Two session classes — keep the ruler separate from the gym

To measure cleanly *and* train well, split your sessions:

- **TEST** — the ruler. Always identical conditions: **T20, 300 darts, full
  effort, same warm-up.** Constant conditions are what make the trend
  comparable across months. Run ~2 per week. These are the only sessions that
  feed the progress line.
- **TRAIN** — the gym. Here you deliberately make practice *harder and more
  varied* (section 5). Scores here aren't directly comparable to tests; they
  build the engine that the tests measure.

Don't pollute the ruler: a test is always a test, no experiments mid-session.

## 4. Periodization — vary length and intensity on purpose

Grinding the same 300 darts at the same intensity every day plateaus fast and
burns out. Cycle it.

### Session menu

| Type         | Darts   | Intensity | Purpose                              |
|--------------|---------|-----------|--------------------------------------|
| `test`       | 300     | max       | the ruler (T20, fixed conditions)    |
| `interleave` | 300–450 | high      | bed rotation / random target (§5)    |
| `volume`     | 600–900 | moderate  | endurance, groove under mild fatigue |
| `technique`  | 150–300 | low       | rhythm, stance, release — no scoreboard |

### Weekly microcycle (4–5 throwing days, ~2,000–2,300 darts)

```
Mon  test        300   fresh ruler reading
Tue  interleave  450   bed rotation, random order
Wed  volume      600   endurance, moderate effort
Thu  off / technique 300   recovery or rhythm work
Fri  test        300   second ruler reading
Sat  flex / volume   (optional)
Sun  off
```

Two tests per week = ~8/month = enough to keep the rolling average honest.

### Monthly mesocycle — 3 weeks build, 1 week deload (3:1)

- **Weeks 1–3:** nudge weekly volume up (e.g. 1,800 → 2,000 → 2,300).
- **Week 4 (deload):** cut to ~60% volume, keep both tests. Lower fatigue lets
  adaptations consolidate — and the spacing itself is a learning tool (§5).

Deload weeks are not slacking; they're when the gains "set." Expect some of your
best tests right after a deload.

## 5. Desirable difficulties (Bjork) — make training harder than the test

Counterintuitively, practice that feels worse in the moment produces better
*retention and transfer*. Two we use:

**Interleaving / variable practice.** Instead of 100 sets all at T20, **rotate
the target every set or every few sets** — T20 → T19 → T18 → T17 → repeat, or
truly random (roll a die / use a target list). Each switch forces your motor
system to *re-retrieve* the aiming pattern instead of running on autopilot.
Blocked practice looks better today; interleaved practice scores better next
month and transfers to a real match where no two visits are alike. Keep this in
the `interleave` and `volume` sessions — the `test` stays pure T20.

**Spacing.** Distribute reps instead of massing them. You already get this from
the weekly layout and the deload week. Add a light **weak-bed diagnostic** on a
spaced schedule (e.g. once a week, 30 darts at your worst treble) rather than
grinding it to death in one session — revisiting a skill after partial
forgetting strengthens it more than repeating it while it's still fresh.

Other useful "difficulties" when you want them: randomize warm-up order,
practice in poorer light occasionally, throw the first test of the week *cold*
(minimal warm-up) to train scoring-from-nothing like a match.

## 6. Volume goals (your committed level: 4–5 days, mixed)

| Window  | Floor (still on-plan) | Aim     |
|---------|-----------------------|---------|
| Weekly  | 1,200 darts           | 2,000   |
| Monthly | ~5,000                | ~8,000  |

The floor is the number that protects you on a bad week — hit it and you have
*not* fallen off the plan. The aim is a good week. The Log view flags both.
(Adjust the floor/aim constants in `public/js/log.js` if your availability changes.)

## 7. Realistic timeline — read these as rolling averages, with caveats

Improvement is fast at first, then slows, and is **never linear**. These are
rolling-average milestones, not single-session targets, and they're a *range*:

| When        | Rolling-avg target (per 3 darts) |
|-------------|----------------------------------|
| Now         | ~48                              |
| Month 3     | 51–54                            |
| Month 6     | 55–60                            |
| Month 12    | 62–68                            |

**Expect plateaus of 3–6 weeks.** A flat (or even dipping) rolling line while
your volume is on-plan is *normal consolidation*, not failure — the body banks
volume and then steps up. The Log view tells you when a trend is "flatter than the
noise"; that's your cue to **keep doing exactly what you're doing**, not to
overhaul the plan. Only investigate if the rolling line falls *and* volume
adherence dropped.

## 8. How to log and read

In the app's **Log** tab, after each session fill in date / type / target /
darts / score (+ optional note) and save. `type` is `test` (the ruler) or
`interleave` / `volume` / `technique`. The 3-dart average is derived — you don't
enter it. The same view shows:

- **VOLUME** — darts in the last 7 days vs your floor / aim. All session types
  count here.
- **PROGRESS** — rolling average (your true level), the noise band (how big a
  swing is meaningless), and the per-month trend once there's enough data. Only
  `test` sessions feed this; the others are volume-only.

The progress math (`public/js/scoring-stats.js`) is shared, so the numbers are
identical to what you'd compute by hand.

## 9. The anti-discouragement rules

1. A win is a logged session that hit your volume floor. Scores are weather.
2. Never judge form from one test. Look at the rolling average.
3. A swing inside the noise band (~±5 on a single test) means *nothing*.
4. A 3–6 week plateau with good volume is the plan working, not failing.
5. When in doubt, throw more darts and check the trend next month — not today.
