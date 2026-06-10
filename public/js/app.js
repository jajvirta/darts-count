/* ============================================================
 * app.js — settings, view routing, reference chart, keyboard bus
 * Loaded last; wires the modules together on DOMContentLoaded.
 * ============================================================ */
(function (global) {
  'use strict';

  // --- Settings (localStorage-backed) ----------------------------------
  const DEFAULTS = {
    startScore: 301,
    profile: 'intermediate20',
    sequentialReveal: true,
    showHint: false,
    lastView: 'practice',
    trainerRange: 'favourites',
  };
  const KEY = 'dcp.settings';
  let store = {};
  try { store = JSON.parse(global.localStorage.getItem(KEY)) || {}; } catch (e) { store = {}; }

  const Settings = {
    get(k) { return k in store ? store[k] : DEFAULTS[k]; },
    set(k, v) {
      store[k] = v;
      try { global.localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
    },
  };
  global.Settings = Settings;

  // --- Reference chart --------------------------------------------------
  const FAVOURITES = new Set([170, 167, 164, 161, 160, 158, 141, 136, 132, 130, 121, 120,
    110, 100, 98, 96, 90, 84, 81, 80, 76, 70, 68, 60, 57, 50, 40, 36, 32, 24, 20, 16]);

  function renderChart() {
    const grid = document.getElementById('chartGrid');
    if (!grid || grid.childElementCount) return;
    for (let n = 170; n >= 2; n--) {
      const route = Checkout.getRoute(n);
      const cell = document.createElement('div');
      cell.className = 'chart-cell' + (route ? '' : ' bogey') + (FAVOURITES.has(n) ? ' fav' : '');
      cell.innerHTML = `<span class="chart-n">${n}</span>` +
        `<span class="chart-route">${route ? Checkout.formatRoute(route) : 'no checkout'}</span>`;
      grid.appendChild(cell);
    }
  }

  // --- View routing -----------------------------------------------------
  const VIEWS = {
    practice: { el: null, tab: null, ctrl: () => global.Practice },
    trainer: { el: null, tab: null, ctrl: () => global.Trainer },
    chart: { el: null, tab: null, ctrl: () => null },
    log: { el: null, tab: null, ctrl: () => global.Log },
  };
  let activeView = null;

  function switchView(name) {
    if (!VIEWS[name]) name = 'practice';
    if (activeView === name) return;
    Object.keys(VIEWS).forEach(key => {
      const v = VIEWS[key];
      const on = key === name;
      v.el.classList.toggle('hidden', !on);
      v.tab.classList.toggle('active', on);
      v.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      const c = v.ctrl();
      if (on && c && c.onActivate) c.onActivate();
      if (!on && c && c.onDeactivate) c.onDeactivate();
    });
    if (name === 'chart') renderChart();
    activeView = name;
    Settings.set('lastView', name);
  }

  // --- Boot -------------------------------------------------------------
  function boot() {
    Object.keys(VIEWS).forEach(key => {
      VIEWS[key].el = document.getElementById('view-' + key);
      VIEWS[key].tab = document.querySelector('.tab[data-view="' + key + '"]');
      VIEWS[key].tab.addEventListener('click', () => switchView(key));
    });

    Numpad.init(document.getElementById('numpad'));
    Practice.init();
    Trainer.init();
    TestLog.init();
    Log.init();

    // One keyboard bus → active controller. Ignore when typing in form fields.
    global.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const c = VIEWS[activeView] && VIEWS[activeView].ctrl();
      if (c && c.onKey) c.onKey(e);
    });

    switchView(Settings.get('lastView'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
