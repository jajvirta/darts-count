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

  // --- inline-SVG sparklines (no deps; full-width, crisp stroke) ----------
  const SPARK_W = 240, SPARK_H = 36;
  function barSpark(values) {
    const n = values.length; if (!n) return '';
    const gap = n > 60 ? 0.5 : 1;
    const max = Math.max(1, ...values);
    const bw = (SPARK_W - (n - 1) * gap) / n;
    const bars = values.map((val, i) => {
      const bh = val > 0 ? Math.max(1.5, (val / max) * (SPARK_H - 2)) : 0;
      const x = i * (bw + gap);
      const fill = i === n - 1 ? 'var(--accent)' : 'var(--line)';
      return `<rect x="${x.toFixed(1)}" y="${(SPARK_H - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${fill}"/>`;
    }).join('');
    return `<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
  }
  function lineSpark(values) {
    const n = values.length; if (n < 2) return '';
    const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1, pad = 4;
    const x = i => (i / (n - 1)) * SPARK_W;
    const y = val => pad + (1 - (val - min) / span) * (SPARK_H - 2 * pad);
    const pts = values.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${pts}"/>` +
      `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(values[n - 1]).toFixed(1)}" r="3" fill="var(--accent)" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderSummary() {
    const r = ScoringStats.analyze(sessions, { roll: 5, weeklyAim: 2000, weeklyFloor: 1200, days: 30 });
    const v = r.volume, p = r.progress;
    const vol = v.onAim ? 'on aim ✓' : v.aboveFloor ? 'above floor' : 'below floor';

    // Volume card: last-7d darts (big) + 30-day daily-darts bars.
    let html =
      '<div class="lp-card">' +
        `<div class="lp-row"><span class="lp-big">${r0(v.last7)}</span><span class="lp-unit">darts · 7d</span></div>` +
        `<div class="lp-sub">${vol} · ${v.sessions} sessions · ${r0(v.totalDarts)} all-time</div>` +
        barSpark(v.daily.map(d => d.darts)) +
        '<div class="lp-cap">daily darts · last 30d</div>' +
      '</div>';

    // Level card: rolling TEST average (big) + rolling-average line.
    html += '<div class="lp-card">';
    if (p.tests >= 2) {
      const trend = p.trendKnown
        ? `${p.trendPerMonth >= 0 ? '+' : ''}${r1(p.trendPerMonth)}/mo${p.plateau ? ' · plateau' : ''}`
        : `${p.needForTrend} more test(s) for a trend`;
      html +=
        `<div class="lp-row"><span class="lp-big">${r1(p.rollAvg)}</span><span class="lp-unit">avg /3 darts</span></div>` +
        `<div class="lp-sub">latest ${r1(p.latest)} · ±${r1(p.luckBand)} is luck · ${trend}</div>` +
        lineSpark(p.series.map(s => s.roll)) +
        '<div class="lp-cap">rolling TEST average</div>';
    } else {
      html +=
        `<div class="lp-row"><span class="lp-big">${p.tests}</span><span class="lp-unit">TEST done</span></div>` +
        '<div class="lp-sub">log a few TEST sessions to see your level</div>';
    }
    html += '</div>';
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
      const startBtn = $('btnStartTestlog');
      if (startBtn) startBtn.addEventListener('click', () => global.TestLog && TestLog.start());
      // Defaults for fast entry.
      els.date.value = todayISO();
      if (!els.target.value) els.target.value = 'T20';
      if (!els.darts.value) els.darts.value = '300';
    },
    onActivate() {
      if (global.TestLog && TestLog.isActive()) { TestLog.reattach(); return; }
      showConfig();
      els.date.value = todayISO();
      refresh();
    },
    onDeactivate() {},
    onKey(e) {
      if (global.TestLog && TestLog.isActive()) { TestLog.onKey(e); }
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
