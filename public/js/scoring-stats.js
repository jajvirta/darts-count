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

    return {
      volume,
      progress,
      recentTests: tests.slice(-12).map(s => ({ date: s.date, avg3: avg3(s) })),
    };
  }

  global.ScoringStats = { analyze, avg3, dayNum, mean, sd, regression };
})(typeof window !== 'undefined' ? window : globalThis);

// Node export for offline unit-testing (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).ScoringStats;
}
