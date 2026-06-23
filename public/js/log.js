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
  const expanded = new Set();   // history rows showing their per-visit histogram

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
  function lineSpark(values, color) {
    color = color || 'var(--accent)';
    const n = values.length; if (n < 2) return '';
    const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1, pad = 4;
    const x = i => (i / (n - 1)) * SPARK_W;
    const y = val => pad + (1 - (val - min) / span) * (SPARK_H - 2 * pad);
    const pts = values.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${pts}"/>` +
      `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(values[n - 1]).toFixed(1)}" r="3" fill="${color}" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // Visit-score histogram (labelled bars), floor bucket tinted, ceiling bright.
  function histChart(buckets) {
    const max = Math.max(1, ...buckets.map(b => b.count));
    return '<div class="dist-hist">' + buckets.map(b => {
      const h = b.count ? Math.max(8, Math.round(b.count / max * 100)) : 0;
      const cls = b.hi <= 26 ? ' dh-floor' : (b.lo >= 60 ? ' dh-ceil' : '');
      return `<div class="dh-col"><div class="dh-n">${b.count}</div>` +
        `<div class="dh-track"><div class="dh-bar${cls}" style="height:${h}%"></div></div>` +
        `<div class="dh-lbl">${b.label}</div></div>`;
    }).join('') + '</div>';
  }
  function drillText(d) {
    if (d.floorPct >= 12) return `Drill the floor: ${r1(d.floorPct)}% of visits are ≤26 — cutting those gains the most. Groove the T20 bed (consistency) over chasing max.`;
    if (d.ceilingPct < 45) return `Drill the ceiling: only ${r1(d.ceilingPct)}% are 60+. Floor's solid — go for more trebles per visit.`;
    return 'Balanced shape — low floor, healthy ceiling. Keep grooving.';
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

    // Distribution card (full width) — only with per-visit TEST data.
    if (p.dist) {
      const d = p.dist;
      html += '<div class="lp-card lp-wide">' +
        `<div class="lp-row"><span class="lp-big">${r1(d.floorPct)}%</span>` +
        `<span class="lp-unit">≤26 floor · ${r1(d.ceilingPct)}% are 60+ (ceiling)</span></div>` +
        `<div class="lp-sub">${d.tonPlus} ton+ · max ${d.max} · mean ${r1(d.mean)} · SD ${r1(d.sd)} · ${d.sessions} session${d.sessions > 1 ? 's' : ''}</div>` +
        histChart(d.buckets) +
        '<div class="lp-cap">visit-score distribution</div>';
      // Floor-rate trend (≤26 % per session) — the metric to drive down.
      if (d.floorSeries && d.floorSeries.length >= 2) {
        const fs = d.floorSeries.map(p => p.floorPct);
        const delta = fs[fs.length - 1] - fs[0];
        const dir = delta < -1 ? '↓ improving' : delta > 1 ? '↑ rising' : '→ flat';
        html += lineSpark(fs, '#c2683f') +
          `<div class="lp-cap">floor rate ≤26 · ${d.floorSeries.length} sessions · ${dir} · lower is better</div>`;
      }
      html += `<div class="log-note dist-drill">${drillText(d)}</div></div>`;
    }
    els.summary.innerHTML = html;
  }

  function renderHistory() {
    if (!sessions.length) { els.history.innerHTML = '<p class="log-note">No sessions yet.</p>'; return; }
    const rows = sessions.slice().reverse().map(s => {
      const a = ScoringStats.avg3(s);
      const isTest = s.type === 'test';
      const hasDist = isTest && Array.isArray(s.visits) && s.visits.length;
      let row = `<li class="log-row${isTest ? ' is-test' : ''}${hasDist ? ' has-dist' : ''}" data-id="${s.id}">` +
        `<span class="lr-date">${s.date}${hasDist ? ' ▾' : ''}</span>` +
        `<span class="lr-type">${s.type}</span>` +
        `<span class="lr-target">${s.target}</span>` +
        `<span class="lr-darts">${s.darts}d</span>` +
        `<span class="lr-score">${r0(s.score)}</span>` +
        `<span class="lr-avg">${r1(a)}</span>` +
        `<button class="lr-del" data-id="${s.id}" title="Delete">✕</button>` +
        '</li>';
      if (hasDist && expanded.has(s.id)) {
        const d = ScoringStats.visitStats(s.visits);
        row += `<li class="lr-detail"><div class="lp-sub">${d.tonPlus} ton+ · max ${d.max} · ${r1(d.floorPct)}% ≤26 · ${r1(d.ceilingPct)}% 60+</div>${histChart(d.buckets)}</li>`;
      }
      return row;
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
        if (b) { del(b.getAttribute('data-id')); return; }
        const row = e.target.closest('.log-row.has-dist');
        if (row) {
          const id = row.getAttribute('data-id');
          expanded.has(id) ? expanded.delete(id) : expanded.add(id);
          renderHistory();
        }
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
