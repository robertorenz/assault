/* Assault Revamped — app shell: loop, input, view switching and modals. */
(function () {
  'use strict';

  const { Game, aiInput } = window.Assault;
  const $ = id => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('assault.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('assault.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  const canvas = $('screen');
  const sound = new window.AssaultAudio();
  const renderers = { classic: new window.ClassicRenderer(canvas), modern: new window.ModernRenderer(canvas) };

  let mode = store.get('mode', 'modern');
  if (!renderers[mode]) mode = 'modern';
  let hiScore = store.get('hi', 0) | 0;
  sound.setMuted(!!store.get('muted', false));

  let app = 'menu';               // menu | play | paused | over
  let game = new Game({ hiScore });
  let demoRestart = 0;

  const renderer = () => renderers[mode];
  window.assaultGame = () => game;   // console hook for debugging

  /* ---------------- sizing ---------------- */

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    for (const k in renderers) renderers[k].resize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------------- input ---------------- */

  const KEYMAP = {
    ArrowUp: 'fwd', KeyW: 'fwd', ArrowDown: 'back', KeyS: 'back',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    KeyQ: 'rollL', KeyE: 'rollR',
    Space: 'fire', KeyJ: 'fire', ShiftLeft: 'wheelie', ShiftRight: 'wheelie', KeyK: 'wheelie'
  };
  const keys = {}, touch = {}, pad = {};

  window.addEventListener('keydown', e => {
    const act = KEYMAP[e.code];
    if (app === 'play' && act) { keys[act] = true; e.preventDefault(); }
    if (e.repeat) return;

    if (app === 'menu') {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { setMode(mode === 'classic' ? 'modern' : 'classic'); e.preventDefault(); }
      else if (e.code === 'Digit1') setMode('classic');
      else if (e.code === 'Digit2') setMode('modern');
      else if (e.code === 'Enter') { startGame(); e.preventDefault(); }
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (app === 'play') pause(); else if (app === 'paused') resume();
      e.preventDefault();
    } else if (e.code === 'KeyV' && (app === 'play' || app === 'paused')) {
      setMode(mode === 'classic' ? 'modern' : 'classic');
    } else if (e.code === 'KeyM') {
      toggleMute();
    } else if (e.code === 'Enter' && app === 'over') {
      startGame();
    }
  });
  window.addEventListener('keyup', e => { const act = KEYMAP[e.code]; if (act) keys[act] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (app === 'play') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && app === 'play') pause(); });

  document.querySelectorAll('[data-act]').forEach(btn => {
    const act = btn.dataset.act;
    const on = e => { touch[act] = true; btn.classList.add('down'); e.preventDefault(); sound.unlock(); };
    const off = () => { touch[act] = false; btn.classList.remove('down'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });

  let padStartWas = false;
  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find(p => p && p.connected);
    for (const k in pad) pad[k] = false;
    if (!gp) return;
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    pad.left = ax < -0.4 || b(14);
    pad.right = ax > 0.4 || b(15);
    pad.fwd = ay < -0.4 || b(12);
    pad.back = ay > 0.4 || b(13);
    pad.fire = b(0) || b(7);
    pad.wheelie = b(1) || b(3) || b(6);
    pad.rollL = b(4);
    pad.rollR = b(5);
    const start = b(9);
    if (start && !padStartWas) {
      if (app === 'play') pause(); else if (app === 'paused') resume(); else startGame();
    }
    padStartWas = start;
  }

  function playerInput() {
    const r = {};
    for (const k of ['fwd', 'back', 'left', 'right', 'rollL', 'rollR', 'fire', 'wheelie']) r[k] = !!(keys[k] || touch[k] || pad[k]);
    return r;
  }

  /* ---------------- modes & state ---------------- */

  function setMode(m) {
    if (!renderers[m] || m === mode) { syncModeUI(); return; }
    mode = m;
    store.set('mode', m);
    sound.style = m;
    renderers[m].reset();
    renderers[m].hideHud = app === 'menu';
    syncModeUI();
  }

  function syncModeUI() {
    document.querySelectorAll('.mode-card').forEach(c => {
      const on = c.dataset.mode === mode;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    document.body.dataset.mode = mode;
    const vb = $('viewBtn');
    if (vb) vb.textContent = mode === 'classic' ? '2.5D' : 'Classic';
    $('pauseView').textContent = 'Switch to ' + (mode === 'classic' ? '2.5D' : 'Classic') + ' view';
  }

  function showModal(id) {
    document.querySelectorAll('.overlay').forEach(o => o.classList.toggle('show', o.id === id));
    const focus = id && $(id).querySelector('[data-autofocus]');
    if (focus) setTimeout(() => focus.focus(), 30);
  }

  function startGame() {
    sound.unlock();
    sound.style = mode;
    sound.click();
    game = new Game({ hiScore });
    for (const k in renderers) { renderers[k].reset(); renderers[k].hideHud = false; }
    app = 'play';
    document.body.classList.add('playing');
    showModal(null);
    for (const ev of game.drainEvents()) handleEvent(ev);
  }

  function pause() {
    app = 'paused';
    for (const k in keys) keys[k] = false;
    $('pauseScore').textContent = game.score.toLocaleString();
    $('pauseWave').textContent = game.stageNum;
    showModal('pauseModal');
  }

  function resume() {
    sound.unlock();
    app = 'play';
    showModal(null);
  }

  function toMenu() {
    app = 'menu';
    document.body.classList.remove('playing');
    game = new Game({ hiScore });
    for (const k in renderers) { renderers[k].reset(); renderers[k].hideHud = true; }
    $('menuHi').textContent = hiScore.toLocaleString();
    showModal('menuModal');
  }

  function gameOver(ev) {
    const isHi = ev.score > hiScore && ev.score > 0;
    if (isHi) { hiScore = ev.score; store.set('hi', hiScore); }
    $('overScore').textContent = ev.score.toLocaleString();
    $('overWave').textContent = ev.stage;
    $('overHi').textContent = hiScore.toLocaleString();
    $('overBadge').hidden = !isHi;
    setTimeout(() => {
      if (app !== 'play') return;
      app = 'over';
      showModal('overModal');
    }, 1800);
  }

  function toggleMute() {
    sound.unlock();
    sound.setMuted(!sound.muted);
    store.set('muted', sound.muted);
    syncMuteUI();
  }

  function syncMuteUI() {
    const b = $('muteBtn');
    b.classList.toggle('off', sound.muted);
    b.setAttribute('aria-pressed', sound.muted ? 'true' : 'false');
    b.title = sound.muted ? 'Unmute (M)' : 'Mute (M)';
  }

  function handleEvent(ev) {
    renderer().onEvent(ev, game);
    if (app === 'play') sound.play(ev);
    if (ev.type === 'gameOver') {
      if (app === 'play') gameOver(ev);
      else demoRestart = 3.5;
    }
  }

  /* ---------------- UI wiring ---------------- */

  document.querySelectorAll('.mode-card').forEach(c => {
    c.addEventListener('click', () => { sound.unlock(); setMode(c.dataset.mode); sound.click(); });
    c.addEventListener('dblclick', () => startGame());
  });
  $('startBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', resume);
  $('pauseView').addEventListener('click', () => setMode(mode === 'classic' ? 'modern' : 'classic'));
  $('quitBtn').addEventListener('click', toMenu);
  $('againBtn').addEventListener('click', startGame);
  $('overMenuBtn').addEventListener('click', toMenu);
  $('pauseBtn').addEventListener('click', () => { if (app === 'play') pause(); else if (app === 'paused') resume(); });
  $('viewBtn').addEventListener('click', e => { setMode(mode === 'classic' ? 'modern' : 'classic'); e.currentTarget.blur(); });
  $('muteBtn').addEventListener('click', e => { toggleMute(); e.currentTarget.blur(); });

  /* ---------------- main loop ---------------- */

  const STEP = 1 / 120;
  let acc = 0, last = performance.now();

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    pollGamepad();

    if (app !== 'paused') {
      if (app === 'menu' && demoRestart > 0) {
        demoRestart -= dt;
        if (demoRestart <= 0) { game = new Game({ hiScore }); renderer().reset(); }
      }
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        game.update(STEP, app === 'menu' ? aiInput(game) : playerInput());
        for (const ev of game.drainEvents()) handleEvent(ev);
      }
      renderer().update(dt, game);
    }
    renderer().render(game);
    requestAnimationFrame(frame);
  }

  sound.style = mode;
  for (const k in renderers) renderers[k].hideHud = true;
  $('menuHi').textContent = hiScore.toLocaleString();
  syncModeUI();
  syncMuteUI();
  showModal('menuModal');
  requestAnimationFrame(frame);
})();
