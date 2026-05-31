/* ============================================================
 * trainer.js — checkout flashcard trainer
 * Shows a score; you recall the finish, reveal it, then self-grade
 * (Anki-style). Tracks streak and accuracy. Routes come from
 * Checkout.getRoute so the trainer, hint and chart never disagree.
 * Exposes window.Trainer { init, onActivate, onDeactivate, onKey }.
 * ============================================================ */
(function (global) {
  'use strict';

  // Iconic finishes worth drilling.
  const FAVOURITES = [170, 167, 164, 161, 160, 158, 141, 136, 132, 130, 121, 120,
    110, 100, 98, 96, 90, 84, 81, 80, 76, 70, 68, 60, 57, 50, 40, 36, 32, 24, 20, 16];

  const RANGES = {
    all: { label: 'All finishes (2–170)', test: n => true },
    big: { label: 'Big finishes (61–170)', test: n => n >= 61 },
    small: { label: 'Doubles & combos (2–60)', test: n => n <= 60 },
    favourites: { label: 'Favourites', test: n => FAVOURITES.indexOf(n) !== -1 },
  };

  let pools = {};
  function buildPools() {
    Object.keys(RANGES).forEach(key => {
      const pool = [];
      for (let n = 2; n <= 170; n++) {
        if (Checkout.hasCheckout(n) && RANGES[key].test(n)) pool.push(n);
      }
      pools[key] = pool;
    });
  }

  let el = {};
  let current = null;
  let revealed = false;
  let streak = 0, seen = 0, correct = 0;

  function rangeKey() { return el.range.value || 'favourites'; }

  function pick() {
    const pool = pools[rangeKey()];
    if (!pool || pool.length === 0) return;
    let n;
    do { n = pool[Math.floor(Math.random() * pool.length)]; }
    while (pool.length > 1 && n === current);
    current = n;
    revealed = false;
    el.number.textContent = n;
    el.route.textContent = '';
    el.route.classList.add('hidden');
    el.grade.classList.add('hidden');
    el.reveal.classList.remove('hidden');
    el.reveal.focus();
  }

  function reveal() {
    if (revealed || current == null) return;
    revealed = true;
    el.route.textContent = Checkout.formatRoute(Checkout.getRoute(current));
    el.route.classList.remove('hidden');
    el.reveal.classList.add('hidden');
    el.grade.classList.remove('hidden');
  }

  function grade(knew) {
    if (!revealed) return;
    seen++;
    if (knew) { correct++; streak++; } else { streak = 0; }
    updateStats();
    pick();
  }

  function updateStats() {
    el.streak.textContent = streak;
    el.seen.textContent = seen;
    el.acc.textContent = seen > 0 ? Math.round(correct / seen * 100) + '%' : '—';
  }

  function init() {
    el = {
      range: document.getElementById('trainerRange'),
      number: document.getElementById('trainerNumber'),
      route: document.getElementById('trainerRoute'),
      reveal: document.getElementById('btnTrainerReveal'),
      grade: document.getElementById('trainerGrade'),
      knew: document.getElementById('btnTrainerKnew'),
      missed: document.getElementById('btnTrainerMissed'),
      streak: document.getElementById('trainerStreak'),
      seen: document.getElementById('trainerSeen'),
      acc: document.getElementById('trainerAcc'),
    };
    buildPools();

    // Populate range options
    el.range.innerHTML = '';
    Object.keys(RANGES).forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = RANGES[key].label;
      el.range.appendChild(opt);
    });
    el.range.value = global.Settings.get('trainerRange') || 'favourites';

    el.range.addEventListener('change', () => {
      global.Settings.set('trainerRange', el.range.value);
      streak = 0; seen = 0; correct = 0; current = null;
      updateStats();
      pick();
    });
    el.reveal.addEventListener('click', reveal);
    el.knew.addEventListener('click', () => grade(true));
    el.missed.addEventListener('click', () => grade(false));
  }

  function onActivate() {
    if (current == null) { updateStats(); pick(); }
  }
  function onDeactivate() { }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!revealed) reveal(); else pick();
    } else if (revealed && (e.key === 'y' || e.key === 'Y' || e.key === 'ArrowRight')) {
      grade(true);
    } else if (revealed && (e.key === 'n' || e.key === 'N' || e.key === 'ArrowLeft')) {
      grade(false);
    }
  }

  global.Trainer = { init, onActivate, onDeactivate, onKey };
})(typeof window !== 'undefined' ? window : globalThis);
