/* ============================================================
 * testlog.js — guided per-visit TEST session entry.
 * Enter each 3-dart total (0–180); live total / 3-dart average /
 * visits-left; editable list; autosave to localStorage; Confirm
 * writes the full visits[] to the backend (type:test).
 * Lives inside the Log tab (not a routed view); log.js delegates
 * key events + activation to it. Exposes window.TestLog.
 * ============================================================ */
(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);
  const r1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const SAVE_KEY = 'dcp.testlog';
  // Most common 3-dart totals at T20 (data-driven + milestones). Tapping one
  // commits that visit instantly; the numpad stays for any other value.
  const QUICK_SCORES = [25, 26, 30, 40, 41, 45, 60, 80, 85, 100, 140, 180];

  let els = {};
  let active = false;     // entry panel showing
  let started = false;    // past the start screen
  let target = 100;
  let visits = [];
  let entry = '';         // current digits being typed
  let editing = null;     // index being edited, or null

  // ---- persistence -----------------------------------------------------
  function save() {
    try { global.localStorage.setItem(SAVE_KEY, JSON.stringify({ target, visits })); } catch (e) { /* ignore */ }
  }
  function clearSave() { try { global.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
  function loadSaved() {
    try {
      const s = JSON.parse(global.localStorage.getItem(SAVE_KEY));
      if (s && Array.isArray(s.visits) && s.visits.length) return s;
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---- start screen ----------------------------------------------------
  function start() {
    active = true; started = false;
    document.body.classList.add('playing');
    if (els.logBody) els.logBody.classList.add('hidden');
    if (els.tokenSetup) els.tokenSetup.classList.add('hidden');
    els.panel.classList.remove('hidden');
    els.startScreen.classList.remove('hidden');
    els.entryScreen.classList.add('hidden');
    const saved = loadSaved();
    els.resume.classList.toggle('hidden', !saved);
    if (saved) els.resume.querySelector('#tlResumeInfo').textContent =
      `${saved.visits.length}/${saved.target} visits`;
    els.lenInput.value = '';
  }

  function begin(t, restore) {
    target = t;
    if (restore) { const s = loadSaved(); visits = s ? s.visits.slice() : []; target = s ? s.target : t; }
    else { visits = []; }
    entry = ''; editing = null; started = true;
    els.startScreen.classList.add('hidden');
    els.entryScreen.classList.remove('hidden');
    Numpad.init(els.pad);
    Numpad.setHandlers({ digit: onDigit, backspace: onBackspace, enter: onEnter });
    render();
  }

  // Re-point the (singleton) Numpad back to this pad — e.g. after a tab switch
  // to Practice and back.
  function reattach() {
    if (!started) { start(); return; }
    Numpad.init(els.pad);
    Numpad.setHandlers({ digit: onDigit, backspace: onBackspace, enter: onEnter });
    render();
  }

  // ---- input -----------------------------------------------------------
  function onDigit(d) {
    let next = (entry === '0') ? d : entry + d;
    if (next.length > 3) return;
    if (Number(next) > 180) return;
    entry = next;
    render();
  }
  function onBackspace() {
    if (entry) { entry = entry.slice(0, -1); render(); }
    else if (editing !== null) { editing = null; render(); }
  }
  function onEnter() {
    if (entry === '') return;
    const v = Number(entry);
    if (!Number.isInteger(v) || v < 0 || v > 180) { setStatus('0–180 only', 'err'); return; }
    if (editing !== null) { visits[editing] = v; editing = null; }
    else { visits.push(v); }
    entry = '';
    save();
    render(true);
  }

  // Begin editing slot i: start from an empty entry (the old value shows
  // highlighted in the list) so typing replaces rather than appends.
  // Shortcut: commit a common score in one tap (goes through onEnter, so it
  // respects edit-in-place too).
  function quickScore(v) { entry = String(v); onEnter(); }

  function startEdit(i) { editing = i; entry = ''; render(); }
  function deleteVisit(i) { visits.splice(i, 1); if (editing === i) editing = null; entry = ''; save(); render(); }
  function undoLast() { if (visits.length) { visits.pop(); editing = null; entry = ''; save(); render(); } }

  // ---- confirm / exit --------------------------------------------------
  async function confirm() {
    if (!visits.length) return;
    els.confirm.disabled = true;
    setStatus('Saving…');
    try {
      await Store.create({
        date: todayISO(), type: 'test', target: 'T20',
        visits: visits.slice(), notes: (els.notes.value || '').trim(),
      });
      clearSave();
      exit();
    } catch (e) {
      setStatus(e.message, 'err');
      els.confirm.disabled = false;
    }
  }

  function exit() {
    active = false; started = false;
    document.body.classList.remove('playing');
    els.panel.classList.add('hidden');
    if (els.notes) els.notes.value = '';
    setStatus('');
    if (global.Log && Log.onActivate) Log.onActivate(); // restore the Log view
  }

  function cancel() {
    if (visits.length && !global.confirm('Discard this in-progress session?')) return;
    clearSave();
    exit();
  }

  // ---- render ----------------------------------------------------------
  function setStatus(msg, kind) {
    els.status.textContent = msg || '';
    els.status.className = 'log-status' + (kind ? ' ' + kind : '');
  }
  function render(scroll) {
    const total = visits.reduce((a, b) => a + b, 0);
    const avg = visits.length ? total / visits.length : 0;
    const left = Math.max(0, target - visits.length);
    els.total.textContent = total;
    els.avg.textContent = visits.length ? r1(avg) : '—';
    els.left.textContent = left;
    els.count.textContent = `${visits.length}/${target}`;
    els.input.textContent = entry === '' ? (editing !== null ? '(editing #' + (editing + 1) + ')' : '—') : entry;
    els.input.classList.toggle('editing', editing !== null);

    els.list.innerHTML = visits.map((v, i) =>
      `<li class="tl-row${editing === i ? ' editing' : ''}">` +
      `<span class="tl-i">${i + 1}</span>` +
      `<button class="tl-v" data-i="${i}">${v}</button>` +
      `<button class="tl-x" data-i="${i}" aria-label="delete">✕</button></li>`
    ).join('');
    if (scroll) els.list.scrollTop = els.list.scrollHeight;

    els.undo.disabled = !visits.length;
    els.confirm.disabled = !visits.length;
    els.confirm.textContent = visits.length >= target
      ? `Confirm & save (${visits.length})` : `Save now (${visits.length})`;
    els.confirm.classList.toggle('ready', visits.length >= target);
    if (typeof Numpad !== 'undefined' && Numpad.setEnter) Numpad.setEnter('OK', entry !== '');
  }

  // ---- key bus (forwarded by log.js when active) -----------------------
  function onKey(e) {
    if (!started) return;
    if (e.key >= '0' && e.key <= '9') { Numpad.pressDigit(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { Numpad.pressBackspace(); e.preventDefault(); }
    else if (e.key === 'Enter') { Numpad.pressEnter(); e.preventDefault(); }
  }

  return globalThis.TestLog = {
    init() {
      els = {
        panel: $('testlogPanel'), startScreen: $('testlogStart'), entryScreen: $('testlogEntry'),
        resume: $('tlResume'), lenInput: $('tlLenInput'),
        total: $('tlTotal'), avg: $('tlAvg'), left: $('tlLeft'), count: $('tlCount'),
        input: $('tlInput'), pad: $('testlogPad'), list: $('tlList'), notes: $('tlNotes'),
        quick: $('testlogQuick'),
        undo: $('btnTlUndo'), confirm: $('btnTlConfirm'), cancel: $('btnTlCancel'), status: $('tlStatus'),
        logBody: $('logBody'), tokenSetup: $('logTokenSetup'),
      };
      // quick-score buttons (static; one tap commits that visit)
      els.quick.innerHTML = QUICK_SCORES.map(v => `<button type="button" class="tl-q" data-v="${v}">${v}</button>`).join('');
      els.quick.addEventListener('click', e => {
        const b = e.target.closest('.tl-q');
        if (b) quickScore(parseInt(b.getAttribute('data-v'), 10));
      });
      // start-screen length picker
      els.startScreen.addEventListener('click', e => {
        const b = e.target.closest('[data-len]');
        if (b) begin(parseInt(b.getAttribute('data-len'), 10), false);
      });
      $('btnTlCustom').addEventListener('click', () => {
        const n = parseInt(els.lenInput.value, 10);
        if (n >= 1 && n <= 100) begin(n, false); else setStatus('1–100', 'err');
      });
      $('btnTlResume').addEventListener('click', () => begin(0, true));
      $('btnTlDiscard').addEventListener('click', () => { clearSave(); els.resume.classList.add('hidden'); });
      // entry-screen controls
      els.undo.addEventListener('click', undoLast);
      els.confirm.addEventListener('click', confirm);
      els.cancel.addEventListener('click', cancel);
      els.list.addEventListener('click', e => {
        const v = e.target.closest('.tl-v'); const x = e.target.closest('.tl-x');
        if (v) startEdit(parseInt(v.getAttribute('data-i'), 10));
        else if (x) deleteVisit(parseInt(x.getAttribute('data-i'), 10));
      });
    },
    start, reattach, onKey,
    isActive() { return active; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
