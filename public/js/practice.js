/* ============================================================
 * practice.js — the counting game
 * Normal play (>170): darts revealed one at a time so you sum the
 * 3-dart total in your head, then enter total + new remaining.
 * Finishing (<=170): one dart at a time, enter what's left after each
 * (just like a marker answering "what's left?").
 * Exposes window.Practice with the view-controller interface
 * { init, onActivate, onDeactivate, onKey }.
 * ============================================================ */
(function (global) {
  'use strict';

  // --- State ------------------------------------------------------------
  let gameMode = 301;
  let scoreRemaining = 301;
  let roundNumber = 0;
  let correctCount = 0;
  let totalQuestions = 0;
  let roundStartScore = 0;

  let mode = 'normal';        // 'normal' | 'finishing'
  let phase = 'idle';         // 'reveal' | 'round' | 'remaining' | 'answered' | 'idle'
  let autoAdvancing = false;  // true while a correct answer is auto-advancing
  let value = '';             // current numeric entry
  let answers = {};           // { round, remaining }

  // Normal-mode darts
  let currentDarts = [];
  let revealed = 0;

  // Finishing-mode darts
  let dartIndex = 0;
  let roundDarts = [];
  let finishingBusted = false;
  let finishingBustIndex = -1;
  let finishingUserAnswers = [];
  let finishingActualRemainings = [];

  let started = false;

  // --- DOM --------------------------------------------------------------
  let el = {};
  function cache() {
    el = {
      score: document.getElementById('scoreRemaining'),
      hint: document.getElementById('finishHint'),
      hintRoute: document.getElementById('finishHintRoute'),
      btnHint: document.getElementById('btnToggleHint'),
      slots: document.getElementById('dartSlots'),
      prompt: document.getElementById('inputPrompt'),
      display: document.getElementById('inputDisplay'),
      feedback: document.getElementById('feedback'),
      canvas: document.getElementById('dartboard'),
      statRounds: document.getElementById('statRounds'),
      statCorrect: document.getElementById('statCorrect'),
      statAccuracy: document.getElementById('statAccuracy'),
      history: document.getElementById('historyList'),
      gameOver: document.getElementById('gameOver'),
      gameOverMsg: document.getElementById('gameOverMsg'),
      stage: document.getElementById('practiceStage'),
      setup: document.getElementById('practiceSetup'),
      startScore: document.getElementById('startScore'),
      profile: document.getElementById('playerProfile'),
      seqToggle: document.getElementById('seqToggle'),
    };
  }

  // --- Helpers ----------------------------------------------------------
  function settings() { return global.Settings; }

  function setSlot(i, html) {
    const items = el.slots.querySelectorAll('li');
    if (items[i]) items[i].innerHTML = html;
  }
  function slotHtml(label, scoreHtml, scoreColor) {
    const style = scoreColor ? ` style="color:${scoreColor}"` : '';
    return `<span class="ds-label">${label}</span><span class="ds-score"${style}>${scoreHtml}</span>`;
  }
  function resetSlots() {
    for (let i = 0; i < 3; i++) setSlot(i, slotHtml('Dart ' + (i + 1) + ': —', '—'));
  }

  function updateDisplay() {
    el.display.textContent = value || '';
  }
  function setPrompt(text) { el.prompt.textContent = text; }

  function updateEnter() {
    if (phase === 'reveal') {
      Numpad.setEnter(revealed < 2 ? 'Reveal ▸' : 'Count ▸', true);
    } else if (phase === 'round' || phase === 'remaining') {
      Numpad.setEnter('OK', value !== '');
    } else if (phase === 'answered') {
      Numpad.setEnter('Next ▸', scoreRemaining > 0 && !autoAdvancing);
    } else {
      Numpad.setEnter('OK', false);
    }
  }

  function setFeedback(kind, text) {
    el.feedback.className = 'feedback' + (kind ? ' show ' + kind : '');
    el.feedback.textContent = text || '';
  }

  function updateStats() {
    el.statRounds.textContent = roundNumber;
    el.statCorrect.textContent = correctCount;
    el.statAccuracy.textContent = totalQuestions > 0
      ? Math.round(correctCount / totalQuestions * 100) + '%' : '—';
  }

  function updateHint() {
    const route = Checkout.getRoute(scoreRemaining);
    const finishable = scoreRemaining >= 2 && scoreRemaining <= 170;
    if (!finishable) { el.hint.classList.add('hidden'); return; }
    el.hint.classList.remove('hidden');
    const show = settings().get('showHint');
    el.btnHint.textContent = show ? '🙈 Hide finish' : '💡 Show finish';
    el.btnHint.setAttribute('aria-pressed', show ? 'true' : 'false');
    if (show) {
      el.hintRoute.classList.remove('hidden');
      el.hintRoute.textContent = route ? Checkout.formatRoute(route) : 'no checkout';
    } else {
      el.hintRoute.classList.add('hidden');
    }
  }

  function renderBoard(darts) {
    Board.render(darts || []);
  }

  // --- Game flow --------------------------------------------------------
  function startGame() {
    gameMode = parseInt(el.startScore.value) || 301;
    scoreRemaining = gameMode;
    Board.setProfile(el.profile.value);
    settings().set('startScore', gameMode);
    settings().set('profile', el.profile.value);
    settings().set('sequentialReveal', el.seqToggle.checked);

    roundNumber = 0;
    correctCount = 0;
    totalQuestions = 0;
    el.history.innerHTML = '';
    el.gameOver.classList.add('hidden');
    el.stage.classList.remove('hidden');
    el.setup.classList.add('hidden');
    started = true;

    el.score.textContent = scoreRemaining;
    updateStats();
    Board.resize([]); // stage is now visible — size the canvas to its real box
    nextTurn();
  }

  function nextTurn() {
    autoAdvancing = false;
    roundStartScore = scoreRemaining;
    setFeedback('', '');
    updateHint();
    if (scoreRemaining <= 170) {
      mode = 'finishing';
      throwRoundFinishing();
    } else {
      mode = 'normal';
      throwRound();
    }
  }

  // --- Normal mode: sequential reveal ----------------------------------
  function throwRound() {
    const d1 = Board.throwDart([]);
    const d2 = Board.throwDart([d1]);
    const d3 = Board.throwDart([d1, d2]);
    currentDarts = [d1, d2, d3];
    revealed = 0;
    answers = {};
    value = '';
    resetSlots();
    renderBoard([]);
    updateDisplay();

    if (settings().get('sequentialReveal')) {
      phase = 'reveal';
      setPrompt('Tap board or “Reveal” to see each dart — sum as you go.');
    } else {
      revealed = 3;
      revealMarkers();
      beginRoundInput();
      return;
    }
    updateEnter();
  }

  function revealMarkers() {
    const shown = currentDarts.slice(0, revealed);
    renderBoard(shown);
    shown.forEach((d, i) => setSlot(i, slotHtml('Dart ' + (i + 1) + ': ' + d.label, '?')));
  }

  function revealNext() {
    if (revealed >= 3) return;
    revealed++;
    revealMarkers();
    if (revealed === 3) {
      beginRoundInput();
    } else {
      updateEnter();
    }
  }

  function beginRoundInput() {
    phase = 'round';
    value = '';
    setPrompt('3-dart total (what they scored this turn):');
    updateDisplay();
    el.display.classList.add('active');
    updateEnter();
    pulseDisplay();
  }

  function evaluateNormal() {
    phase = 'answered';
    roundNumber++;
    totalQuestions++;

    const roundScoreActual = currentDarts.reduce((s, d) => s + d.score, 0);
    const rawRemaining = scoreRemaining - roundScoreActual;
    const regularBust = rawRemaining < 2;            // can't leave 1 or go negative
    const newRemainingActual = regularBust ? scoreRemaining : rawRemaining;

    const roundCorrect = answers.round === roundScoreActual;
    const remainingCorrect = answers.remaining === newRemainingActual;
    const allCorrect = roundCorrect && remainingCorrect;
    if (allCorrect) correctCount++;

    // Reveal actual dart scores
    currentDarts.forEach((d, i) =>
      setSlot(i, slotHtml('Dart ' + (i + 1) + ': ' + d.label, d.score)));

    if (allCorrect) {
      setFeedback('correct', regularBust ? '✓ Correct! BUST — no score this turn.' : '✓ Correct!');
    } else {
      let msg = '✗ ';
      if (!roundCorrect) msg += `Total ${roundScoreActual} (you said ${answers.round}). `;
      if (!remainingCorrect) msg += `Remaining ${newRemainingActual} (you said ${answers.remaining}).`;
      if (regularBust) msg += ' BUST.';
      setFeedback('incorrect', msg);
    }

    scoreRemaining = newRemainingActual;
    el.score.textContent = scoreRemaining;
    addHistory(roundScoreActual, allCorrect);
    updateStats();
    updateHint();
    el.display.classList.remove('active');

    finishOrAdvance(allCorrect, roundScoreActual);
  }

  // --- Finishing mode: one dart at a time ------------------------------
  function throwRoundFinishing() {
    dartIndex = 0;
    roundDarts = [];
    currentDarts = [];
    finishingBusted = false;
    finishingBustIndex = -1;
    finishingUserAnswers = [];
    finishingActualRemainings = [];
    resetSlots();
    renderBoard([]);
    showNextFinishingDart();
  }

  function showNextFinishingDart() {
    const target = Checkout.getCheckoutTarget(scoreRemaining);
    const dart = (target.ring === 'bull')
      ? Board.throwDartAtTarget(null, 'bull')
      : Board.throwDartAtTarget(target.sector, target.ring);
    roundDarts.push(dart);
    currentDarts.push(dart);
    renderBoard(currentDarts);
    setSlot(dartIndex, slotHtml('Dart ' + (dartIndex + 1) + ': ' + dart.label, '?'));

    phase = 'remaining';
    value = '';
    setPrompt('Remaining after dart ' + (dartIndex + 1) + ':');
    updateDisplay();
    el.display.classList.add('active');
    updateEnter();
    pulseDisplay();
  }

  function submitFinishingDart() {
    const dart = roundDarts[dartIndex];
    const busted = Checkout.isBust(dart, scoreRemaining);
    const newRemainingActual = busted ? roundStartScore : scoreRemaining - dart.score;
    const userNewRemaining = answers.remaining;

    finishingUserAnswers.push(userNewRemaining);
    finishingActualRemainings.push(newRemainingActual);

    setSlot(dartIndex, slotHtml('Dart ' + (dartIndex + 1) + ': ' + dart.label,
      '→ ' + userNewRemaining, '#888'));

    scoreRemaining = newRemainingActual; // internal only; not shown until reveal

    if (busted) {
      finishingBusted = true;
      finishingBustIndex = dartIndex;
      for (let i = dartIndex + 1; i < 3; i++) setSlot(i, slotHtml('Dart ' + (i + 1) + ': —', '—'));
      revealFinishingResults();
      return;
    }
    if (scoreRemaining === 0) {
      for (let i = dartIndex + 1; i < 3; i++) setSlot(i, slotHtml('Dart ' + (i + 1) + ': —', '—'));
      revealFinishingResults();
      return;
    }
    dartIndex++;
    if (dartIndex < 3) showNextFinishingDart();
    else revealFinishingResults();
  }

  function revealFinishingResults() {
    phase = 'answered';
    roundNumber++;
    el.display.classList.remove('active');

    let allCorrect = true;
    const feedbackParts = [];
    for (let i = 0; i < finishingUserAnswers.length; i++) {
      const dart = roundDarts[i];
      const actual = finishingActualRemainings[i];
      const user = finishingUserAnswers[i];
      const isCorrect = user === actual;
      const isBustDart = (finishingBustIndex === i);
      totalQuestions++;
      if (isCorrect) correctCount++; else allCorrect = false;
      const bustLabel = isBustDart ? ' — BUST' : '';
      const color = isCorrect ? '#2ecc71' : '#e74c3c';
      const icon = isCorrect ? '✓' : '✗';
      const detail = isCorrect ? '' : ` (should be ${actual})`;
      setSlot(i, slotHtml('Dart ' + (i + 1) + ': ' + dart.label + ' (' + dart.score + ')' + bustLabel,
        icon + ' ' + user + detail, color));
      if (!isCorrect) feedbackParts.push(`Dart ${i + 1}: ${actual} (you said ${user})`);
    }

    el.score.textContent = scoreRemaining;
    updateHint();

    if (allCorrect) {
      if (finishingBusted) setFeedback('correct', `✓ All correct! BUST — reverts to ${roundStartScore}.`);
      else if (scoreRemaining === 0) setFeedback('correct', '✓ All correct! Checkout! 🎯');
      else setFeedback('correct', '✓ All correct!');
    } else {
      let msg = '✗ ' + feedbackParts.join('. ') + '.';
      if (finishingBusted) msg += ` BUST — reverts to ${roundStartScore}.`;
      setFeedback('incorrect', msg);
    }

    const roundScore = currentDarts.reduce((s, d) => s + d.score, 0);
    addHistory(roundScore, allCorrect, true);
    updateStats();
    finishOrAdvance(allCorrect, roundScore);
  }

  // --- Shared end-of-turn handling -------------------------------------
  function finishOrAdvance(allCorrect, roundScore) {
    if (scoreRemaining === 0) {
      updateEnter();
      setTimeout(() => {
        el.gameOver.classList.remove('hidden');
        const acc = totalQuestions > 0 ? Math.round(correctCount / totalQuestions * 100) : 0;
        el.gameOverMsg.textContent = `Checked out in ${roundNumber} rounds. Accuracy: ${acc}%`;
      }, 500);
      return;
    }
    if (allCorrect) {
      autoAdvancing = true;
      updateEnter();
      setTimeout(() => { if (started && autoAdvancing) nextTurn(); }, 800);
    } else {
      autoAdvancing = false;
      updateEnter(); // OK becomes "Next ▸"
    }
  }

  function addHistory(roundScore, correct, finishing) {
    const item = document.createElement('div');
    item.className = 'history-item ' + (correct ? 'ok' : 'fail');
    const scores = currentDarts.map(d => d.score).join(' + ');
    item.innerHTML = `<span>R${roundNumber}: ${scores} = ${roundScore}${finishing ? ' 🎯' : ''}</span>` +
      `<span>${correct ? '✓' : '✗'}</span>`;
    el.history.prepend(item);
  }

  function pulseDisplay() {
    el.display.classList.remove('pulse');
    void el.display.offsetWidth;
    el.display.classList.add('pulse');
  }

  // --- Input handlers (numpad + keyboard share these) ------------------
  function onDigit(d) {
    if (phase !== 'round' && phase !== 'remaining') return;
    if (value.length >= 4) return;
    value += d;
    updateDisplay();
    updateEnter();
  }
  function onBackspace() {
    if (phase !== 'round' && phase !== 'remaining') return;
    value = value.slice(0, -1);
    updateDisplay();
    updateEnter();
  }
  function onEnter() {
    if (phase === 'reveal') { revealNext(); return; }
    if (phase === 'round') {
      if (value === '') return;
      answers.round = parseInt(value);
      phase = 'remaining';
      value = '';
      setPrompt('New remaining score:');
      updateDisplay();
      updateEnter();
      pulseDisplay();
      return;
    }
    if (phase === 'remaining') {
      if (value === '') return;
      answers.remaining = parseInt(value);
      if (mode === 'finishing') submitFinishingDart();
      else evaluateNormal();
      return;
    }
    if (phase === 'answered') {
      if (autoAdvancing) return; // auto-advance already scheduled
      if (scoreRemaining > 0) nextTurn();
    }
  }

  // --- View controller interface ---------------------------------------
  function init() {
    cache();
    Board.init(el.canvas);

    // Restore settings into setup controls
    const s = settings();
    el.startScore.value = s.get('startScore') || 301;
    el.profile.value = s.get('profile') || 'intermediate20';
    el.seqToggle.checked = s.get('sequentialReveal') !== false;

    document.getElementById('btnStart').addEventListener('click', startGame);
    document.getElementById('btnRestart').addEventListener('click', () => {
      el.gameOver.classList.add('hidden');
      startGame();
    });
    document.getElementById('btnNewGame').addEventListener('click', () => {
      started = false;
      el.stage.classList.add('hidden');
      el.setup.classList.remove('hidden');
      el.gameOver.classList.add('hidden');
    });

    el.btnHint.addEventListener('click', () => {
      s.set('showHint', !s.get('showHint'));
      updateHint();
    });

    // Tap the board to reveal the next dart during the reveal phase.
    el.canvas.addEventListener('pointerdown', (e) => {
      if (phase === 'reveal') { e.preventDefault(); revealNext(); }
    });

    // Redraw on resize so the board stays crisp/responsive.
    let rt;
    global.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const shown = mode === 'finishing' ? currentDarts : currentDarts.slice(0, revealed);
        Board.resize(phase === 'answered' ? currentDarts : shown);
      }, 120);
    });
  }

  function onActivate() {
    Numpad.setHandlers({ digit: onDigit, backspace: onBackspace, enter: onEnter });
    Board.resize(started ? (phase === 'answered' ? currentDarts
      : (mode === 'finishing' ? currentDarts : currentDarts.slice(0, revealed))) : []);
    updateEnter();
  }

  function onDeactivate() { /* nothing to tear down */ }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEnter(); }
    else if (e.key === 'Backspace') { e.preventDefault(); onBackspace(); }
    else if (e.key >= '0' && e.key <= '9') { onDigit(e.key); }
  }

  global.Practice = { init, onActivate, onDeactivate, onKey };
})(typeof window !== 'undefined' ? window : globalThis);
