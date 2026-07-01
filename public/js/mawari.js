/* ============================================================
 * mawari.js — Mawari scorekeeper (view controller).
 * Real-board scorekeeper: two humans throw; enter each dart by tapping
 * the board or via the numpad + ring buttons. All rules live in the pure
 * MawariEngine; this file is UI + turn flow only.
 * Controller interface: {init,onActivate,onDeactivate,onKey}. Exposes window.Mawari.
 * ============================================================ */
(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);
  const SH = { single: 1, double: 2, triple: 3 };
  const RING_LABEL = { single: 'S', double: 'D', triple: 'T' };

  let els = {};
  let started = false;
  let game = null;          // MawariEngine state
  let history = [];         // prior states this turn (undo stack)
  let thrown = [];          // dart descriptors this turn (display)
  let entryNum = '';        // manual sector digits
  let msg = '';

  function newMatch(fmt) {
    game = MawariEngine.newGame(fmt);
    history = []; thrown = []; entryNum = '';
    msg = 'Player 1 to throw.';
    started = true;
    document.body.classList.add('playing');   // full-screen (hides header on mobile)
    els.setup.classList.add('hidden');
    els.stage.classList.remove('hidden');
    render();
  }

  function boardTaus() {
    return game.taus.filter(t => !t.home).map(t => ({ player: t.player, sector: t.sector }));
  }

  // --- dart flow --------------------------------------------------------
  // All Taus are equal, so co-located Taus need no prompt — advance either
  // (the engine defaults to one when tauChoice is omitted).
  function tryDart(dart) {
    if (!game || game.winner || game.dartsThrown >= 3) return;
    commitDart(dart);
  }
  function commitDart(dart) {
    const before = game;
    history.push(game);
    thrown.push(dart);
    game = MawariEngine.applyDart(game, dart);
    entryNum = '';
    msg = describeDart(before, game, dart);
    render();
  }
  function undo() {
    if (!history.length) return;
    game = history.pop(); thrown.pop(); entryNum = ''; msg = '';
    render();
  }
  function resolve() {
    if (!game || game.dartsThrown === 0 || game.winner) return;
    const who = game.turn;
    game = MawariEngine.endTurn(game);
    history = []; thrown = []; entryNum = '';
    if (game.winner) msg = `🏆 Player ${game.winner} wins!`;
    else if (game.newTurnGranted) msg = `Player ${who} earned another turn!`;
    else {
      msg = `Player ${who} → Player ${game.turn}.`;
      if (!game.triedToAdvance) msg += ` (P${who} didn't try to advance — opponent may award 3 penalty throws.)`;
    }
    render();
  }

  // --- input sources ----------------------------------------------------
  function boardTap(e) {
    if (!game) return;
    const hit = Board.hitAt(e.clientX, e.clientY);
    if (hit) tryDart(hit);
  }
  function digit(d) {
    let n = entryNum + d;
    if (parseInt(n, 10) > 20) n = d;
    if (n.length > 2) n = d;
    if (parseInt(n, 10) === 0) return;
    entryNum = n; render();
  }
  function ringBtn(ring) {
    const s = parseInt(entryNum, 10);
    if (!(s >= 1 && s <= 20)) { msg = 'Enter a sector (1–20) first.'; render(); return; }
    tryDart({ sector: s, ring });
  }

  // --- render -----------------------------------------------------------
  function dartLabel(d) {
    if (d.ring === 'bull') return 'Bull';
    if (d.ring === 'outerBull') return '25';
    if (d.ring === 'miss') return 'Miss';
    return (RING_LABEL[d.ring] || '?') + d.sector;
  }
  // Human-readable outcome of a dart (so drops/advances aren't silent).
  function describeDart(before, after, dart) {
    const me = before.turn, lbl = dartLabel(dart), ev = after.lastEvent;
    const prev = {}; before.taus.forEach(t => { prev[t.id] = t.sector; });
    const movedFwd = after.taus.find(t => t.player === me && prev[t.id] != null && t.sector > prev[t.id]);
    if (ev === 'advance' && movedFwd) {
      return `${lbl}: Tau ${prev[movedFwd.id]}→${movedFwd.sector}` +
        (movedFwd.sector === 20 ? ' — on 20! throw 20/bull for Home' : '');
    }
    if (ev === 'drop') {
      const back = after.taus.find(t => t.player === me && prev[t.id] != null && t.sector !== prev[t.id]);
      return `${lbl} is opponent-only — your furthest Tau dropped ${back ? prev[back.id] : '?'}→${dart.sector}`;
    }
    if (ev === 'no-drop') {
      return `${lbl} is opponent-only, but no Tau of yours is ahead of ${dart.sector} to drop back — no effect`;
    }
    if (ev === 'no-advance') {
      const fed = after.taus.find(t => t.player === me && (after.carry[t.id] || 0) > (before.carry[t.id] || 0));
      return `${lbl}: +${SH[dart.ring]} shirushi (carry ${fed ? after.carry[fed.id] : '?'}/${after.format}) — no move yet`;
    }
    if (ev === 'home-point') {
      return `${lbl}: +${after.homePoints - before.homePoints} Home pts (${after.homePoints} this turn)`;
    }
    return `${lbl}: no effect`;
  }

  function render() {
    Board.resize([], boardTaus());
    // Compact top row: turn indicator + this-turn dart chips inline.
    if (game.winner) {
      els.banner.innerHTML = `<span class="mw-win">🏆 Player ${game.winner} wins</span>`;
    } else {
      const chips = thrown.map(d => `<span class="mw-chip">${dartLabel(d)}</span>`).join('');
      els.banner.innerHTML = `<span class="mw-turn mw-p${game.turn}">Player ${game.turn} to throw</span>` + chips;
    }
    // Home stash (top corners): 3 slots each, dashed when empty, filled disc
    // with the player number as Taus reach Home.
    [1, 2].forEach(p => {
      const homed = game.taus.filter(t => t.player === p && t.home).length;
      let slots = '';
      for (let i = 0; i < 3; i++) {
        const on = i < homed;
        slots += `<span class="mw-slot${on ? ' filled mw-p' + p : ''}">${on ? p : ''}</span>`;
      }
      (p === 1 ? els.homeP1 : els.homeP2).innerHTML = `<span class="mw-slot-home">🏠</span>${slots}`;
    });
    // per-player status
    els.status.innerHTML = [1, 2].map(p => {
      const home = game.taus.filter(t => t.player === p && t.home).length;
      const onTrack = game.taus.filter(t => t.player === p && !t.home)
        .sort((a, b) => a.sector - b.sector)
        .map(t => {
          const c = game.carry[t.id] || 0;
          return t.sector + (c > 0 ? `·${c}` : '');
        }).join('  ');
      return `<div class="mw-player mw-p${p}"><span class="mw-dot"></span>` +
        `<span class="mw-name">P${p}</span>` +
        `<span class="mw-secs">${onTrack || '—'}</span>` +
        `<span class="mw-home">${'🏠'.repeat(home)}</span></div>`;
    }).join('');
    els.msg.textContent = msg;
    els.secdisp.textContent = entryNum || '—';
    els.resolve.disabled = game.dartsThrown === 0 || !!game.winner;
    els.undo.disabled = history.length === 0;
    const locked = !!game.winner || game.dartsThrown >= 3;
    els.entry.classList.toggle('mw-locked', locked);
  }

  return globalThis.Mawari = {
    init() {
      els = {
        setup: $('mawariSetup'), stage: $('mawariStage'),
        format: $('mawariFormat'), start: $('btnMawariStart'),
        canvas: $('mawariBoard'), banner: $('mawariBanner'), status: $('mawariStatus'),
        homeP1: $('mawariHomeP1'), homeP2: $('mawariHomeP2'),
        entry: $('mawariEntry'), pad: $('mawariPad'), secdisp: $('mwSectorDisplay'),
        msg: $('mawariMsg'), undo: $('btnMawariUndo'), resolve: $('btnMawariResolve'),
        newGame: $('btnMawariNew'),
      };
      els.start.addEventListener('click', () => newMatch(parseInt(els.format.value, 10)));
      els.newGame.addEventListener('click', () => {
        // Destructive — confirm before discarding the whole match.
        if (game && !game.winner && !global.confirm('End this match? The current game will be lost.')) return;
        started = false;
        document.body.classList.remove('playing');   // restore header at setup
        els.stage.classList.add('hidden');
        els.setup.classList.remove('hidden');
      });
      els.undo.addEventListener('click', undo);
      els.resolve.addEventListener('click', resolve);
      els.canvas.addEventListener('pointerdown', e => { e.preventDefault(); boardTap(e); });
      els.entry.querySelectorAll('[data-ring]').forEach(b =>
        b.addEventListener('click', () => ringBtn(b.getAttribute('data-ring'))));
      els.entry.querySelectorAll('[data-special]').forEach(b =>
        b.addEventListener('click', () => tryDart({ sector: null, ring: b.getAttribute('data-special') })));
    },
    onActivate() {
      Board.init(els.canvas);                 // singleton Board — bind to Mawari canvas
      Numpad.init(els.pad);                    // singleton Numpad — bind to Mawari pad
      Numpad.setHandlers({ digit, backspace: () => { entryNum = entryNum.slice(0, -1); render(); },
        enter: () => { if (entryNum) ringBtn('single'); } });
      Numpad.setEnter('S', true);
      if (started) { document.body.classList.add('playing'); render(); }
    },
    onDeactivate() { document.body.classList.remove('playing'); },
    onKey(e) {
      if (!started || !game) return;
      if (e.key >= '0' && e.key <= '9') { Numpad.pressDigit(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { Numpad.pressBackspace(); e.preventDefault(); }
      else if (e.key === 'Enter') { resolve(); e.preventDefault(); }
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
