/* ============================================================
 * mawari-engine.js — pure Mawari rules (no DOM, no I/O).
 * Single source of truth for the game logic; the view controller
 * (mawari.js) drives it. Has a Node module.exports shim so it's
 * CLI unit-testable, like checkout.js / scoring-stats.js.
 *
 * Full rule spec: docs/mawari-plan.md. 2-player focus.
 *
 * State shape:
 *   { format:1|2|3, turn:1|2, winner:null|1|2,
 *     taus:[{id, player, sector:1..20, home:bool}],
 *     carry:{tauId:number},     // per-Tau shirushi carry, reset each turn
 *     dartsThrown, stepsThisTurn, inSectorDarts, homePoints,  // this turn
 *     lastEvent, newTurnGranted, triedToAdvance }
 * ============================================================ */
(function (global) {
  'use strict';

  const START = { 1: [5, 6, 16], 2: [1, 11, 15] };
  const SHIRUSHI = { single: 1, double: 2, triple: 3 };
  const HOME_THRESHOLD = { 1: 50, 2: 70, 3: 90 };
  const NEW_TURN_MIN_STEPS = { 1: 3, 2: 3, 3: 4 };
  const TRY_MIN_DARTS = { 1: 1, 2: 2, 3: 3 };

  // --- pure core: shirushi carry → advance steps ------------------------
  // Costs N to get moving, then every extra shirushi in the same dart is +1
  // sector; counter resets after each advancing dart. Returns {steps, carry}.
  function advanceSteps(carry, m, N) {
    const c = carry + m;
    if (c >= N) return { steps: c - (N - 1), carry: 0 };
    return { steps: 0, carry: c };
  }

  // Home points a dart contributes (sector 20 by ring, or bull/outer-bull).
  function homePointsOf(dart) {
    if (dart.ring === 'bull') return 50;
    if (dart.ring === 'outerBull') return 25;
    if (dart.sector === 20) return 20 * (SHIRUSHI[dart.ring] || 0);
    return 0;
  }

  function clone(s) {
    return {
      ...s,
      taus: s.taus.map(t => ({ ...t })),
      carry: { ...s.carry },
    };
  }

  // Build a state with arbitrary Tau positions (for resume/tests). spec is
  // [[player, sector], ...]; omit for the standard 2-player triangle start.
  function makeState(format, spec) {
    let id = 0;
    const taus = [];
    if (spec) {
      spec.forEach(([player, sector]) => taus.push({ id: id++, player, sector, home: false }));
    } else {
      [1, 2].forEach(p => START[p].forEach(sector => taus.push({ id: id++, player: p, sector, home: false })));
    }
    return {
      format, turn: 1, winner: null, taus,
      carry: {}, dartsThrown: 0, stepsThisTurn: 0, inSectorDarts: 0, homePoints: 0,
      lastEvent: null, newTurnGranted: false, triedToAdvance: false,
    };
  }
  function newGame(format) { return makeState(format); }

  // --- apply one dart ---------------------------------------------------
  // dart: { sector:1..20|null, ring:'single'|'double'|'triple'|'bull'|'outerBull'|'miss',
  //         tauChoice?:id }  (tauChoice disambiguates when 2 of your Taus share the hit sector)
  function applyDart(state, dart) {
    const s = clone(state);
    if (s.winner || s.dartsThrown >= 3) return s;
    const N = s.format, me = s.turn, opp = me === 1 ? 2 : 1;
    const sec = (dart.sector == null) ? null : dart.sector;
    const m = SHIRUSHI[dart.ring];
    let event = 'miss';

    s.dartsThrown++;
    s.homePoints += homePointsOf(dart);

    if (sec != null) {
      const mineHere = s.taus.filter(t => t.player === me && !t.home && t.sector === sec);
      const oppHere = s.taus.some(t => t.player === opp && !t.home && t.sector === sec);
      if (mineHere.length) {
        if (sec === 20) {
          // Terminal sector: 20-hits feed Home points (added above); in-sector.
          s.inSectorDarts++;
          event = 'home-point';
        } else if (m) {
          // Advance mechanic (sectors 1–19). Pick which co-located Tau to feed.
          let tau = mineHere[0];
          if (mineHere.length > 1 && dart.tauChoice != null) {
            tau = mineHere.find(t => t.id === dart.tauChoice) || mineHere[0];
          }
          const r = advanceSteps(s.carry[tau.id] || 0, m, N);
          s.carry[tau.id] = r.carry;
          if (r.steps > 0) {
            const real = s.taus.find(t => t.id === tau.id);
            const from = real.sector;
            real.sector = Math.min(20, from + r.steps); // cap at 20
            s.stepsThisTurn += real.sector - from;
            event = 'advance';
          } else {
            event = 'no-advance';
          }
          s.inSectorDarts++;
        }
      } else if (oppHere) {
        // Drop: hit an opponent-only sector (protection already fails here, since
        // none of my Taus is on it). A drop only pulls a Tau BACKWARD, so it
        // applies only if my furthest-advanced Tau is ahead of the hit sector;
        // it then drops to the hit sector. Otherwise nothing happens.
        const mine = s.taus.filter(t => t.player === me && !t.home);
        let furthest = mine[0];
        for (const t of mine) if (t && t.sector > furthest.sector) furthest = t;
        if (furthest && furthest.sector > sec) {
          furthest.sector = sec;
          s.carry[furthest.id] = 0;
          event = 'drop';
        } else {
          event = 'no-drop';
        }
      } else {
        event = 'empty';
      }
    } else if (dart.ring === 'bull' || dart.ring === 'outerBull') {
      event = 'home-point';
    }

    s.lastEvent = event;
    return s;
  }

  // --- resolve end of a 3-dart turn -------------------------------------
  function endTurn(state) {
    const s = clone(state);
    const N = s.format, me = s.turn, thresh = HOME_THRESHOLD[N];

    s.triedToAdvance = s.inSectorDarts >= TRY_MIN_DARTS[N];

    // Cash one Tau Home if it's on 20 and enough Home points were scored.
    let homed = false;
    const on20 = s.taus.find(t => t.player === me && !t.home && t.sector === 20);
    if (on20 && s.homePoints >= thresh) { on20.home = true; homed = true; }

    // Win: all 3 of my Taus Home.
    if (s.taus.filter(t => t.player === me && t.home).length === 3) {
      s.winner = me;
      return s;
    }

    // New turn: advancing path (all 3 in-sector + step minimum) OR home path
    // (≥ 2× the Home threshold, having actually homed a Tau).
    const advPath = s.dartsThrown >= 3 && s.inSectorDarts === 3 && s.stepsThisTurn >= NEW_TURN_MIN_STEPS[N];
    const homePath = homed && s.homePoints >= 2 * thresh;
    const newTurn = advPath || homePath;

    // Reset per-turn counters; hand over unless a new turn was earned.
    s.carry = {};
    s.dartsThrown = 0;
    s.stepsThisTurn = 0;
    s.inSectorDarts = 0;
    s.homePoints = 0;
    s.newTurnGranted = newTurn;
    if (!newTurn) s.turn = me === 1 ? 2 : 1;
    return s;
  }

  // Convenience: apply up to 3 darts then resolve. darts:[{sector,ring,tauChoice?}]
  function playTurn(state, darts) {
    let s = state;
    for (const d of darts.slice(0, 3)) s = applyDart(s, d);
    return endTurn(s);
  }

  global.MawariEngine = {
    START, SHIRUSHI, HOME_THRESHOLD, NEW_TURN_MIN_STEPS, TRY_MIN_DARTS,
    advanceSteps, homePointsOf, makeState, newGame, applyDart, endTurn, playTurn,
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).MawariEngine;
}
