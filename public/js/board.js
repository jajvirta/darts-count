/* ============================================================
 * board.js — dartboard rendering, hit detection & throw simulation
 * The board is drawn in a fixed 500x500 logical space; the canvas
 * is sized to its CSS box and the context scaled (incl. devicePixelRatio)
 * so it stays crisp and responsive on any screen.
 * Exposes window.Board.
 * ============================================================ */
(function (global) {
  'use strict';

  const LOGICAL = 500;
  const CX = LOGICAL / 2;
  const CY = LOGICAL / 2;
  // Smaller than the canvas so there's an outer ring for Mawari Tau pins +
  // room to push the numbers out. Double/triple rings are deliberately WIDER
  // than a real board (easier tap targets, clearer).
  const BOARD_RADIUS = 200;

  const SECTOR_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const SECTOR_ANGLE = (2 * Math.PI) / 20;

  const R_BULL = BOARD_RADIUS * 0.045;
  const R_OUTER_BULL = BOARD_RADIUS * 0.10;
  const R_INNER_TRIPLE = BOARD_RADIUS * 0.50;
  const R_OUTER_TRIPLE = BOARD_RADIUS * 0.64;   // triple width ~0.14 (was ~0.047)
  const R_INNER_DOUBLE = BOARD_RADIUS * 0.85;
  const R_OUTER_DOUBLE = BOARD_RADIUS * 1.0;    // double width ~0.15

  const COLOR_BLACK = '#1c1c1c';
  const COLOR_WHITE = '#f1dbb5';
  const COLOR_RED = '#d62828';
  const COLOR_GREEN = '#2d6a4f';
  const COLOR_BOARD_BG = '#2b2b2b';

  let canvas = null;
  let ctx = null;

  function sectorColor(index, isWire) {
    if (isWire) return index % 2 === 0 ? COLOR_RED : COLOR_GREEN;
    return index % 2 === 0 ? COLOR_BLACK : COLOR_WHITE;
  }

  // --- Responsive sizing ------------------------------------------------
  function setupCanvas() {
    if (!canvas) return;
    const cssSize = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
    const dpr = global.devicePixelRatio || 1;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    const scale = (cssSize / LOGICAL) * dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // --- Board drawing ----------------------------------------------------
  function drawBoard() {
    ctx.clearRect(0, 0, LOGICAL, LOGICAL);

    ctx.beginPath();
    ctx.arc(CX, CY, BOARD_RADIUS + 10, 0, 2 * Math.PI);
    ctx.fillStyle = COLOR_BOARD_BG;
    ctx.fill();

    for (let i = 0; i < 20; i++) {
      const startAngle = -Math.PI / 2 - SECTOR_ANGLE / 2 + i * SECTOR_ANGLE;
      const endAngle = startAngle + SECTOR_ANGLE;
      drawRingSegment(startAngle, endAngle, R_INNER_DOUBLE, R_OUTER_DOUBLE, sectorColor(i, true));
      drawRingSegment(startAngle, endAngle, R_OUTER_TRIPLE, R_INNER_DOUBLE, sectorColor(i, false));
      drawRingSegment(startAngle, endAngle, R_INNER_TRIPLE, R_OUTER_TRIPLE, sectorColor(i, true));
      drawRingSegment(startAngle, endAngle, R_OUTER_BULL, R_INNER_TRIPLE, sectorColor(i, false));
    }

    ctx.beginPath();
    ctx.arc(CX, CY, R_OUTER_BULL, 0, 2 * Math.PI);
    ctx.fillStyle = COLOR_GREEN;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(CX, CY, R_BULL, 0, 2 * Math.PI);
    ctx.fillStyle = COLOR_RED;
    ctx.fill();

    drawNumbers();
    drawWires();
  }

  function drawRingSegment(startAngle, endAngle, innerR, outerR, color) {
    ctx.beginPath();
    ctx.arc(CX, CY, outerR, startAngle, endAngle);
    ctx.arc(CX, CY, innerR, endAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawWires() {
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 20; i++) {
      const angle = -Math.PI / 2 - SECTOR_ANGLE / 2 + i * SECTOR_ANGLE;
      ctx.beginPath();
      ctx.moveTo(CX + R_OUTER_BULL * Math.cos(angle), CY + R_OUTER_BULL * Math.sin(angle));
      ctx.lineTo(CX + R_OUTER_DOUBLE * Math.cos(angle), CY + R_OUTER_DOUBLE * Math.sin(angle));
      ctx.stroke();
    }
    [R_OUTER_BULL, R_INNER_TRIPLE, R_OUTER_TRIPLE, R_INNER_DOUBLE, R_OUTER_DOUBLE].forEach(r => {
      ctx.beginPath();
      ctx.arc(CX, CY, r, 0, 2 * Math.PI);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(CX, CY, R_BULL, 0, 2 * Math.PI);
    ctx.stroke();
  }

  function drawNumbers() {
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = '#e0e0e0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 20; i++) {
      const angle = -Math.PI / 2 + i * SECTOR_ANGLE;
      const x = CX + (R_OUTER_DOUBLE + 34) * Math.cos(angle);
      const y = CY + (R_OUTER_DOUBLE + 34) * Math.sin(angle);
      ctx.fillText(SECTOR_ORDER[i].toString(), x, y);
    }
  }

  // --- Hit highlight & markers -----------------------------------------
  function drawHitHighlights(darts) {
    if (!darts || darts.length === 0) return;
    const hitCounts = {};
    darts.forEach(d => {
      const key = d.ring === 'bull' ? 'bull'
        : d.ring === 'outerBull' ? 'outerBull'
          : `${d.sectorIndex}:${d.ring}`;
      hitCounts[key] = (hitCounts[key] || 0) + 1;
    });
    const highlightAlpha = { 1: 0.20, 2: 0.38, 3: 0.55 };
    const highlightColor = { 1: '255, 215, 0', 2: '255, 140, 0', 3: '255, 60, 60' };

    for (const [key, count] of Object.entries(hitCounts)) {
      const alpha = highlightAlpha[Math.min(count, 3)];
      const color = highlightColor[Math.min(count, 3)];
      if (key === 'bull') {
        ctx.beginPath();
        ctx.arc(CX, CY, R_BULL, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.fill();
      } else if (key === 'outerBull') {
        ctx.beginPath();
        ctx.arc(CX, CY, R_OUTER_BULL, 0, 2 * Math.PI);
        ctx.arc(CX, CY, R_BULL, 0, 2 * Math.PI, true);
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.fill();
      } else {
        const [sectorStr, ring] = key.split(':');
        const sectorIndex = parseInt(sectorStr);
        const startAngle = -Math.PI / 2 - SECTOR_ANGLE / 2 + sectorIndex * SECTOR_ANGLE;
        const endAngle = startAngle + SECTOR_ANGLE;
        let innerR, outerR;
        switch (ring) {
          case 'double': innerR = R_INNER_DOUBLE; outerR = R_OUTER_DOUBLE; break;
          case 'outerSingle': innerR = R_OUTER_TRIPLE; outerR = R_INNER_DOUBLE; break;
          case 'triple': innerR = R_INNER_TRIPLE; outerR = R_OUTER_TRIPLE; break;
          case 'innerSingle': innerR = R_OUTER_BULL; outerR = R_INNER_TRIPLE; break;
          default: continue;
        }
        ctx.beginPath();
        ctx.arc(CX, CY, outerR, startAngle, endAngle);
        ctx.arc(CX, CY, innerR, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.fill();
      }
    }
  }

  function drawDartMarkers(markers) {
    markers.forEach((d, idx) => {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 9, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255,255,0,0.25)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(d.x, d.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 8px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((idx + 1).toString(), d.x, d.y);
    });
  }

  // Mawari Tau overlay: colored discs sitting on the rim of each sector.
  // taus: [{ sector: 1..20, player: 1|2 }]. Uses the same angle math as the
  // numbers so markers land on the right sector; multiple on one sector stack
  // inward. Purely additive — callers that pass no taus are unaffected.
  const TAU_COLORS = { 1: '#00b4d8', 2: '#ff70a6' };
  // Taus as physical-style pins sitting just OUTSIDE the double ring (a stem
  // from the rim to a colored head). Color = player; multiple on one sector
  // spread angularly so they all stay outside the board.
  function drawTaus(taus) {
    const bySector = {};
    taus.forEach(t => { (bySector[t.sector] = bySector[t.sector] || []).push(t); });
    Object.keys(bySector).forEach(sec => {
      const i = SECTOR_ORDER.indexOf(Number(sec));
      if (i < 0) return;
      const base = -Math.PI / 2 + i * SECTOR_ANGLE;
      const group = bySector[sec];
      group.forEach((t, k) => {
        const spread = group.length > 1 ? (k - (group.length - 1) / 2) * 0.12 : 0;
        const angle = base + spread;
        const headR = R_OUTER_DOUBLE + 16;
        const x = CX + headR * Math.cos(angle);
        const y = CY + headR * Math.sin(angle);
        const sx = CX + (R_OUTER_DOUBLE + 2) * Math.cos(angle);
        const sy = CY + (R_OUTER_DOUBLE + 2) * Math.sin(angle);
        const color = TAU_COLORS[t.player] || '#ffd166';
        ctx.beginPath();          // stem
        ctx.moveTo(sx, sy); ctx.lineTo(x, y);
        ctx.strokeStyle = '#111'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath();          // head
        ctx.arc(x, y, 11, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#111';   // player number inside the head
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(t.player), x, y);
      });
    });
  }

  // Render the board plus the given darts (highlights + numbered markers) and
  // optional Mawari Taus.
  function render(darts, taus) {
    if (!ctx) return;
    drawBoard();
    if (darts && darts.length) {
      drawHitHighlights(darts);
      drawDartMarkers(darts.map(d => ({ x: d.x, y: d.y })));
    }
    if (taus && taus.length) drawTaus(taus);
  }

  // --- Throw simulation -------------------------------------------------
  const PROFILES = {
    pro: { targetSector: 20, targetRing: 'triple', radialStd: 13, angularStd: 0.09 },
    intermediate: { targetSector: 19, targetRing: 'triple', radialStd: 29, angularStd: 0.15, doubleRadialStd: 18, doubleAngularStd: 0.10 },
    intermediate20: { targetSector: 20, targetRing: 'triple', radialStd: 29, angularStd: 0.15, doubleRadialStd: 18, doubleAngularStd: 0.10 },
  };
  let activeProfile = 'intermediate20';
  function setProfile(name) { if (PROFILES[name]) activeProfile = name; }
  function getProfile() { return activeProfile; }

  function gaussianRandom(mean, std) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
  }

  function getInt20TargetSector(previousDarts) {
    if (activeProfile !== 'intermediate20' || previousDarts.length === 0) return 20;
    const lastDart = previousDarts[previousDarts.length - 1];
    const hitSector = SECTOR_ORDER[lastDart.sectorIndex];
    const hitTriple = lastDart.ring === 'triple' && hitSector === 20;
    if (hitTriple) return 20;
    const nearMiss = (hitSector === 20) || (hitSector === 1) || (hitSector === 5);
    if (nearMiss) {
      const roll = Math.random();
      if (roll < 0.25) return 19;
      if (roll < 0.35) return 18;
      return 20;
    }
    const roll = Math.random();
    if (roll < 0.35) return 19;
    if (roll < 0.50) return 18;
    return 20;
  }

  function throwDart(previousDarts) {
    const p = PROFILES[activeProfile];
    let targetSector = p.targetSector;
    if (activeProfile === 'intermediate20' && previousDarts && previousDarts.length > 0) {
      targetSector = getInt20TargetSector(previousDarts);
    }
    const sectorIdx = SECTOR_ORDER.indexOf(targetSector);
    const targetAngle = -Math.PI / 2 + sectorIdx * SECTOR_ANGLE;
    const targetR = (R_INNER_TRIPLE + R_OUTER_TRIPLE) / 2;
    const angle = targetAngle + gaussianRandom(0, p.angularStd);
    let r = targetR + gaussianRandom(0, p.radialStd);
    r = Math.max(0, r);
    const x = CX + r * Math.cos(angle);
    const y = CY + r * Math.sin(angle);
    const result = identifyHit(r, angle);
    result.x = x; result.y = y;
    return result;
  }

  function throwDartAtTarget(targetSector, targetRing) {
    const p = PROFILES[activeProfile];
    let targetAngle, targetR;
    if (targetRing === 'bull') {
      targetAngle = -Math.PI / 2;
      targetR = 0;
    } else {
      const sectorIdx = SECTOR_ORDER.indexOf(targetSector);
      targetAngle = -Math.PI / 2 + sectorIdx * SECTOR_ANGLE;
      switch (targetRing) {
        case 'double': targetR = (R_INNER_DOUBLE + R_OUTER_DOUBLE) / 2; break;
        case 'triple': targetR = (R_INNER_TRIPLE + R_OUTER_TRIPLE) / 2; break;
        case 'single':
        default: targetR = (R_OUTER_BULL + R_INNER_TRIPLE) / 2; break;
      }
    }
    const rStd = (targetRing === 'double' && p.doubleRadialStd) ? p.doubleRadialStd : p.radialStd;
    const aStd = (targetRing === 'double' && p.doubleAngularStd) ? p.doubleAngularStd : p.angularStd;
    const angle = targetAngle + gaussianRandom(0, aStd);
    let r = targetR + gaussianRandom(0, rStd);
    r = Math.max(0, r);
    const x = CX + r * Math.cos(angle);
    const y = CY + r * Math.sin(angle);
    const result = identifyHit(r, angle);
    result.x = x; result.y = y;
    return result;
  }

  function identifyHit(r, rawAngle) {
    let angle = rawAngle + Math.PI / 2;
    angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let adjusted = angle + SECTOR_ANGLE / 2;
    adjusted = ((adjusted % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const sectorIndex = Math.floor(adjusted / SECTOR_ANGLE) % 20;
    const sectorNumber = SECTOR_ORDER[sectorIndex];
    if (r <= R_BULL) return { sectorIndex, ring: 'bull', label: 'Bull (50)', score: 50 };
    if (r <= R_OUTER_BULL) return { sectorIndex, ring: 'outerBull', label: 'Outer Bull (25)', score: 25 };
    if (r <= R_INNER_TRIPLE) return { sectorIndex, ring: 'innerSingle', label: `Single ${sectorNumber}`, score: sectorNumber };
    if (r <= R_OUTER_TRIPLE) return { sectorIndex, ring: 'triple', label: `Triple ${sectorNumber}`, score: sectorNumber * 3 };
    if (r <= R_INNER_DOUBLE) return { sectorIndex, ring: 'outerSingle', label: `Single ${sectorNumber}`, score: sectorNumber };
    if (r <= R_OUTER_DOUBLE) return { sectorIndex, ring: 'double', label: `Double ${sectorNumber}`, score: sectorNumber * 2 };
    return { sectorIndex, ring: 'miss', label: 'Miss (0)', score: 0 };
  }

  // Map a viewport tap to a Mawari-style hit: { sector:1..20|null, ring }.
  // ring ∈ single|double|triple|bull|outerBull|miss (inner/outer single merged).
  function hitAt(clientX, clientY) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const size = rect.width || 1;
    const lx = ((clientX - rect.left) / size) * LOGICAL;
    const ly = ((clientY - rect.top) / size) * LOGICAL;
    const r = Math.hypot(lx - CX, ly - CY);
    const angle = Math.atan2(ly - CY, lx - CX);
    const hit = identifyHit(r, angle);
    let ring = hit.ring;
    if (ring === 'innerSingle' || ring === 'outerSingle') ring = 'single';
    if (ring === 'bull' || ring === 'outerBull' || ring === 'miss') return { sector: null, ring };
    return { sector: SECTOR_ORDER[hit.sectorIndex], ring };
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    setupCanvas();
    drawBoard();
  }

  function resize(darts, taus) {
    setupCanvas();
    render(darts || [], taus);
  }

  global.Board = {
    init, resize, render, hitAt,
    throwDart, throwDartAtTarget,
    setProfile, getProfile,
    SECTOR_ORDER,
  };
})(typeof window !== 'undefined' ? window : globalThis);
