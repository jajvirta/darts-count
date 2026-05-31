/* ============================================================
 * checkout.js — checkout route solver + bust rules
 * Single source of truth for the suggested-finish hint, the
 * checkout trainer, and the reference chart.
 * Exposes window.Checkout = { getRoute, getCheckoutTarget, isBust,
 *                             formatRoute, hasCheckout }
 * ============================================================ */
(function (global) {
  'use strict';

  // --- Dart universe ----------------------------------------------------
  const SINGLES = [], DOUBLES = [], TRIPLES = [];
  for (let n = 1; n <= 20; n++) {
    SINGLES.push({ label: 'S' + n, ring: 'single', n, value: n });
    DOUBLES.push({ label: 'D' + n, ring: 'double', n, value: 2 * n });
    TRIPLES.push({ label: 'T' + n, ring: 'triple', n, value: 3 * n });
  }
  const BULL = { label: 'Bull', ring: 'bull', n: 25, value: 50 };       // double bull (counts as a double)
  const OUTER = { label: '25', ring: 'outerBull', n: 25, value: 25 };   // single bull

  // Setup darts (any non-finishing position). Ordered singles → triples →
  // doubles → bull so that, when two forms hit the same value (e.g. S9 vs
  // T3, both 9), find() returns the natural single. Cost still decides
  // between different values; order only breaks within-value ties.
  const SETUP = [
    ...SINGLES.slice().reverse(),
    ...TRIPLES.slice().reverse(),
    ...DOUBLES.slice().reverse(),
    BULL, OUTER,
  ];
  // Finishing darts must land on a double or the bull.
  const FINISH = [...DOUBLES.slice().reverse(), BULL];

  // --- Preference heuristics (lower cost = more "standard") -------------
  // Doubles players prefer to leave (halving-friendly first). Bull and odd
  // doubles are demoted so e.g. 158 → T20 T20 D19 (not T20 T16 Bull) and
  // 98 → T20 D19 (not T16 Bull).
  const DOUBLE_RANK = { 40: 0, 32: 1, 16: 2, 8: 3, 24: 4, 20: 5, 12: 6, 36: 7, 28: 8, 4: 9, 2: 10 };
  function finishCost(f) {
    if (f.ring === 'bull') return 16;                          // bull-out: avoid unless forced
    if (f.value in DOUBLE_RANK) return DOUBLE_RANK[f.value];   // preferred even doubles
    return 13 + (20 - f.n) * 0.01;                             // odd doubles (D1,D3,…): low but beats bull
  }
  function setupCost(d) {
    if (d.ring === 'triple') return (20 - d.n) * 0.5;          // T20 best; reward banking big triples
    if (d.ring === 'single') return 4 + (20 - d.n) * 0.05;     // natural for small leaves; high singles first
    if (d.ring === 'bull') return 14;
    if (d.ring === 'outerBull') return 15;
    return 16;                                                  // double as a setup dart: last resort
  }

  // --- Core solver ------------------------------------------------------
  // Returns the preferred route for `score` as an array of dart objects,
  // or null if there is no valid double-out within 3 darts (bogey numbers,
  // <2, >170).
  // Order a found route the way you'd throw it: scoring darts biggest-first,
  // finishing dart last.
  function orderRoute(route) {
    if (!route || route.length <= 1) return route;
    const finish = route[route.length - 1];
    const setup = route.slice(0, -1).sort((a, b) => b.value - a.value);
    return [...setup, finish];
  }

  function getRoute(score) {
    if (!Number.isInteger(score) || score < 2 || score > 170) return null;

    // 1 dart
    let best = null, bestCost = Infinity;
    for (const f of FINISH) {
      if (f.value === score) {
        const c = finishCost(f);
        if (c < bestCost) { bestCost = c; best = [f]; }
      }
    }
    if (best) return best;

    // 2 darts: setup + finish
    bestCost = Infinity;
    for (const f of FINISH) {
      const need = score - f.value;
      if (need < 1) continue;
      const s = SETUP.find(d => d.value === need);
      if (!s) continue;
      const c = setupCost(s) + finishCost(f);
      if (c < bestCost) { bestCost = c; best = [s, f]; }
    }
    if (best) return orderRoute(best);

    // 3 darts: setup + setup + finish
    bestCost = Infinity;
    for (const f of FINISH) {
      const rem = score - f.value;
      if (rem < 2) continue;
      for (const s1 of SETUP) {
        const need = rem - s1.value;
        if (need < 1) continue;
        const s2 = SETUP.find(d => d.value === need);
        if (!s2) continue;
        const c = setupCost(s1) + setupCost(s2) + finishCost(f);
        if (c < bestCost) { bestCost = c; best = [s1, s2, f]; }
      }
    }
    return orderRoute(best); // may be null for true bogey numbers (e.g. 169, 168, 166, 165, 163, 162, 159)
  }

  function hasCheckout(score) {
    return getRoute(score) !== null;
  }

  function formatRoute(route) {
    if (!route) return '—';
    return route.map(d => d.label).join('  ');
  }

  // First dart of the preferred route, in the shape the throw simulator
  // expects: { sector, ring }. Used to aim the simulated opponent.
  function getCheckoutTarget(remaining) {
    const route = getRoute(remaining);
    if (!route) return { sector: 20, ring: 'triple' };
    const d = route[0];
    if (d.ring === 'bull') return { sector: null, ring: 'bull' };
    if (d.ring === 'outerBull') return { sector: null, ring: 'bull' };
    return { sector: d.n, ring: d.ring };
  }

  // Bust rules (double-out). Identical to the original game logic.
  function isBust(dart, remaining) {
    const newScore = remaining - dart.score;
    if (newScore < 0) return true;
    if (newScore === 1) return true;
    if (newScore === 0 && dart.ring !== 'double' && dart.ring !== 'bull') return true;
    return false;
  }

  global.Checkout = { getRoute, getCheckoutTarget, isBust, formatRoute, hasCheckout };
})(typeof window !== 'undefined' ? window : globalThis);

// Node export for offline validation (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Checkout;
}
