/* ============================================================
 * log.js — the Log view: enter / list / delete power-scoring
 * sessions against the backend, and show the noise-aware trend.
 * Controller interface: { init, onActivate, onDeactivate, onKey }.
 * All progress math comes from ScoringStats (shared with the CLI).
 * ============================================================ */
(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);
  const r1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const r0 = n => Math.round(n).toLocaleString('en-US');
  const todayISO = () => new Date().toISOString().slice(0, 10);

  let els = {};
  let sessions = [];

  function setStatus(msg, kind) {
    els.status.textContent = msg || '';
    els.status.className = 'log-status' + (kind ? ' ' + kind : '');
  }

  function showConfig() {
    const ok = Store.configured();
    els.tokenSetup.classList.toggle('hidden', ok);
    els.body.classList.toggle('hidden', !ok);
  }

  async function refresh() {
    if (!Store.configured()) return;
    setStatus('Loading…');
    try {
      sessions = await Store.list();
      setStatus('');
      renderSummary();
      renderHistory();
    } catch (e) {
      setStatus(e.message, 'err');
    }
  }

  function renderSummary() {
    const r = ScoringStats.analyze(sessions, { roll: 5, weeklyAim: 2000, weeklyFloor: 1200 });
    const v = r.volume, p = r.progress;
    const vol = v.onAim ? 'on aim ✓' : v.aboveFloor ? 'above floor' : 'below floor';
    let html =
      `<div class="log-metric"><span class="lm-big">${r0(v.last7)}</span>` +
      `<span class="lm-label">darts · last 7d (${vol})</span></div>`;
    if (p.tests >= 2) {
      html +=
        `<div class="log-metric"><span class="lm-big">${r1(p.rollAvg)}</span>` +
        `<span class="lm-label">rolling avg · per 3 darts (your level)</span></div>`;
      let trend = p.trendKnown
        ? `${p.trendPerMonth >= 0 ? '+' : ''}${r1(p.trendPerMonth)}/mo${p.plateau ? ' · plateau, keep throwing' : ''}`
        : `need ${p.needForTrend} more test(s)`;
      html += `<div class="log-note">latest ${r1(p.latest)} (one noisy dot · ±${r1(p.luckBand)} is luck) · trend ${trend}</div>`;
    } else {
      html += `<div class="log-note">${p.tests} test session(s) — a few more before any trend means anything.</div>`;
    }
    els.summary.innerHTML = html;
  }

  function renderHistory() {
    if (!sessions.length) { els.history.innerHTML = '<p class="log-note">No sessions yet.</p>'; return; }
    const rows = sessions.slice().reverse().map(s => {
      const a = ScoringStats.avg3(s);
      const isTest = s.type === 'test';
      return `<li class="log-row${isTest ? ' is-test' : ''}">` +
        `<span class="lr-date">${s.date}</span>` +
        `<span class="lr-type">${s.type}</span>` +
        `<span class="lr-target">${s.target}</span>` +
        `<span class="lr-darts">${s.darts}d</span>` +
        `<span class="lr-score">${r0(s.score)}</span>` +
        `<span class="lr-avg">${r1(a)}</span>` +
        `<button class="lr-del" data-id="${s.id}" title="Delete">✕</button>` +
        `</li>`;
    }).join('');
    els.history.innerHTML = `<ul class="log-list">${rows}</ul>`;
  }

  async function save() {
    const body = {
      date: els.date.value || todayISO(),
      type: els.type.value,
      target: (els.target.value || '').trim(),
      darts: parseInt(els.darts.value, 10),
      score: parseInt(els.score.value, 10),
      notes: (els.notes.value || '').trim(),
    };
    if (!body.target) { setStatus('Target is required (e.g. T20).', 'err'); return; }
    if (!(body.darts > 0)) { setStatus('Darts must be a positive number.', 'err'); return; }
    if (!(body.score >= 0)) { setStatus('Enter a score.', 'err'); return; }
    els.save.disabled = true;
    setStatus('Saving…');
    try {
      await Store.create(body);
      els.score.value = '';
      els.notes.value = '';
      setStatus('Saved ✓', 'ok');
      await refresh();
    } catch (e) {
      setStatus(e.message, 'err');
    } finally {
      els.save.disabled = false;
    }
  }

  async function del(id) {
    if (!global.confirm('Delete this session?')) return;
    try { await Store.remove(id); await refresh(); }
    catch (e) { setStatus(e.message, 'err'); }
  }

  function saveToken() {
    const t = els.tokenInput.value.trim();
    if (!t) return;
    Store.setToken(t);
    els.tokenInput.value = '';
    showConfig();
    refresh();
  }

  return globalThis.Log = {
    init() {
      els = {
        tokenSetup: $('logTokenSetup'), tokenInput: $('logTokenInput'), tokenSave: $('btnLogToken'),
        body: $('logBody'), status: $('logStatus'), summary: $('logSummary'), history: $('logHistory'),
        date: $('logDate'), type: $('logType'), target: $('logTarget'),
        darts: $('logDarts'), score: $('logScore'), notes: $('logNotes'), save: $('btnLogSave'),
      };
      els.tokenSave.addEventListener('click', saveToken);
      els.save.addEventListener('click', save);
      els.history.addEventListener('click', e => {
        const b = e.target.closest('.lr-del');
        if (b) del(b.getAttribute('data-id'));
      });
      // Defaults for fast entry.
      els.date.value = todayISO();
      if (!els.target.value) els.target.value = 'T20';
      if (!els.darts.value) els.darts.value = '300';
    },
    onActivate() {
      showConfig();
      els.date.value = todayISO();
      refresh();
    },
    onDeactivate() {},
    onKey() {},
  };
})(typeof window !== 'undefined' ? window : globalThis);
