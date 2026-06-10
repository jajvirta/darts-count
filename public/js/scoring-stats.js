/* ============================================================
 * scoring-stats.js — power-scoring analytics (pure, no DOM, no I/O)
 * Single source of truth for the progress math, used by the browser Log view
 * (window.ScoringStats). Has a Node export shim so it stays unit-testable.
 * A "session" is { date, type, target, darts, score, notes? }.
 * Only type === 'test' feeds the progress trend; all sessions count
 * toward volume.
 * ============================================================ */
(function (global) {
  'use strict';

  const DAY = 86400000;

  const sum = a => a.reduce((x, y) => x + y, 0);
  const mean = a => (a.length ? sum(a) / a.length : 0);
  function sd(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1));
  }
  // 3-dart average for a session.
  const avg3 = s => s.score / (s.darts / 3);
  // UTC day-number for an ISO yyyy-mm-dd date.
  const dayNum = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);

  function regression(pts) { // [{x,y}] -> {slope, intercept} | null
    if (pts.length < 4) return null;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const mx = mean(xs), my = mean(ys);
    let num = 0, den = 0;
    for (let i = 0; i < pts.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    if (den === 0) return null;
    const slope = num / den;
    return { slope, intercept: my - slope * mx };
  }

  // Distribution stats over an array of 3-dart visit totals (0–180). Pure.
  // Floor = wasted visits (≤26); ceiling = clean (≥60); ton+ = ≥100.
  const VISIT_EDGES = [[0, 26], [27, 39], [40, 59], [60, 79], [80, 99], [100, 139], [140, 180]];
  const VISIT_LABELS = ['0', '27', '40', '60', '80', '100', '140'];
  function visitStats(visits) {
    const n = visits.length;
    if (!n) return null;
    const cnt = pred => visits.filter(pred).length;
    return {
      n,
      mean: mean(visits),
      sd: sd(visits),
      floorPct: cnt(v => v <= 26) / n * 100,   // wasted visits
      ceilingPct: cnt(v => v >= 60) / n * 100,  // clean treble+ pace
      tonPlus: cnt(v => v >= 100),              // count of 100+
      max: Math.max(...visits),
      buckets: VISIT_EDGES.map(([lo, hi], i) =>
        ({ lo, hi, label: VISIT_LABELS[i], count: cnt(v => v >= lo && v <= hi) })),
    };
  }

  // sessions: array; opts: { roll, weeklyAim, weeklyFloor, nowDay }
  function analyze(sessions, opts) {
    opts = opts || {};
    const roll = opts.roll || 5;
    const weeklyAim = opts.weeklyAim || 2000;
    const weeklyFloor = opts.weeklyFloor || 1200;
    const list = sessions.slice().sort((a, b) => dayNum(a.date) - dayNum(b.date));
    const now = (opts.nowDay != null) ? opts.nowDay : Math.floor(Date.now() / DAY);

    const within = d => list.filter(s => now - dayNum(s.date) < d);
    const dartsIn = d => sum(within(d).map(s => s.darts));
    const volume = {
      totalDarts: sum(list.map(s => s.darts)),
      sessions: list.length,
      last7: dartsIn(7),
      last30: dartsIn(30),
      weeklyAim, weeklyFloor,
      onAim: dartsIn(7) >= weeklyAim,
      aboveFloor: dartsIn(7) >= weeklyFloor,
    };
    // Daily darts for the last `days` days (continuous, zero-filled) — for the
    // volume sparkline.
    const days = opts.days || 30;
    volume.daily = [];
    for (let d = now - days + 1; d <= now; d++) {
      const darts = sum(list.filter(s => dayNum(s.date) === d).map(s => s.darts));
      volume.daily.push({ date: new Date(d * DAY).toISOString().slice(0, 10), darts });
    }

    const tests = list.filter(s => s.type === 'test');
    const progress = { tests: tests.length };
    if (tests.length >= 2) {
      const avgs = tests.map(avg3);
      const recent = tests.slice(-roll);
      const recentAvgs = recent.map(avg3);
      const noiseSample = tests.slice(-Math.min(10, tests.length)).map(avg3);
      const noise = sd(noiseSample);
      progress.latest = avg3(tests[tests.length - 1]);
      progress.rollAvg = mean(recentAvgs);
      progress.rollN = recent.length;
      progress.noise = noise;            // ~1σ single-session
      progress.luckBand = 2 * noise;     // a single test within ±this is luck
      progress.realChange = recent.length ? noise / Math.sqrt(recent.length) : noise; // 1 SE of the mean
      progress.min = Math.min(...avgs);
      progress.max = Math.max(...avgs);
      // Per-test series with the rolling average up to each point — for the
      // progress sparkline.
      progress.series = tests.map((s, i) => {
        const w = tests.slice(Math.max(0, i - roll + 1), i + 1).map(avg3);
        return { date: s.date, avg3: avg3(s), roll: mean(w) };
      });

      const reg = regression(tests.map(s => ({ x: dayNum(s.date), y: avg3(s) })));
      if (reg) {
        progress.trendPerMonth = reg.slope * 30;
        progress.trendKnown = true;
        progress.spanDays = dayNum(tests[tests.length - 1].date) - dayNum(tests[0].date);
        progress.plateau = Math.abs(progress.trendPerMonth) < noise / 3;
      } else {
        progress.trendKnown = false;
        progress.needForTrend = 4 - tests.length;
      }
    }

    // Score distribution across recent detailed (per-visit) TEST sessions —
    // works with even one. Floor (≤26) vs ceiling (≥60) shows what to drill.
    const detailed = tests.filter(s => Array.isArray(s.visits) && s.visits.length);
    if (detailed.length) {
      const recentDetailed = detailed.slice(-10);
      progress.dist = visitStats(recentDetailed.flatMap(s => s.visits));
      progress.dist.sessions = recentDetailed.length;
    }

    return {
      volume,
      progress,
      recentTests: tests.slice(-12).map(s => ({ date: s.date, avg3: avg3(s) })),
    };
  }

  global.ScoringStats = { analyze, visitStats, avg3, dayNum, mean, sd, regression };
})(typeof window !== 'undefined' ? window : globalThis);

// Node export for offline unit-testing (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).ScoringStats;
}
