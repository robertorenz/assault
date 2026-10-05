/* Assault Revamped — core simulation, modelled on Namco's 1988 arcade Assault.
 * Top-down tank warfare: the map rotates around the player's tank, which
 * drives with tank controls, rolls sideways, rears up into a Power Wheelie to
 * lob grenades, rides lift zones and jump pads, and must destroy the enemy
 * fortress at the far end of each area before time runs out.
 * Renderer-agnostic: both views read this state and consume its events. */
(function (global) {
  'use strict';

  const TS = 32;                          // world units per map tile
  const T = { VOID: 0, GROUND: 1, ROCK: 2, WATER: 3, BUSH: 4, ROAD: 5, BLOCK: 6, LIFT: 7, JUMP: 8, FORT: 9, RUBBLE: 10, BRIDGE: 11, PAD_USED: 12, HOLE: 13 };
  //                   Vo    G      Ro    Wa    Bu     Rd     Bl    Li     Ju     Fo     Ru     Br     PU     Ho
  const MOVE_BLOCK = [true, false, true, true, false, false, true, false, false, false, false, false, false, false];
  const SHOT_BLOCK = [false, false, true, false, false, false, true, false, false, false, false, false, false, false];
  const TALL = [0, 0, 24, 0, 0, 0, 22, 0, 0, 0, 0, 0, 0, 0];   // extrusion heights for the 2.5D view

  const THEMES = [
    { key: 'grass', name: 'HIGHLANDS' },
    { key: 'forest', name: 'JUNGLE RIVER' },
    { key: 'sand', name: 'SAND LAKES' },
    { key: 'city', name: 'CITY BLOCK' },
    { key: 'base', name: 'ENEMY BASE' }
  ];

  const STAGE_TIME = 99;
  const SHOT_SPEED = 440;
  const TURN_RATE = 2.7;
  const FWD_SPEED = 118, REV_SPEED = 74;
  const LIFT_TIME = 5.5;
  const WHEELIE_TIME = 0.75;

  const ENEMY = {
    tank:    { r: 13, hp: 2,  score: 300 },
    turret:  { r: 14, hp: 3,  score: 400 },
    mortar:  { r: 13, hp: 3,  score: 500 },
    chopper: { r: 14, hp: 2,  score: 600, flying: true },
    fortgun: { r: 13, hp: 6,  score: 1500 },
    core:    { r: 15, hp: 30, score: 5000 }
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  function angDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  const turnToward = (a, target, step) => a + clamp(angDiff(a, target), -step, step);
  // Heading convention: 0 faces "north" (-y); forward vector is (sin a, -cos a).
  const angleTo = (dx, dy) => Math.atan2(dx, -dy);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ */
  /* Stage generation — each stage is a floating landmass in space,      */
  /* fringed by rock cliffs, with a pentagon fortress at the far end.    */
  /* ------------------------------------------------------------------ */

  function buildStage(n) {
    const theme = THEMES[(n - 1) % THEMES.length];
    const MW = 24, MH = 96 + Math.min(n, 8) * 4;
    for (let attempt = 0; attempt < 80; attempt++) {
      const s = tryBuild(n, theme, MW, MH, mulberry32(n * 7919 + attempt * 104729 + 17));
      if (s) return s;
    }
    throw new Error('stage generation failed');
  }

  function tryBuild(n, theme, MW, MH, rng) {
    const R = (a, b) => a + rng() * (b - a);
    const RI = (a, b) => Math.floor(R(a, b + 1));
    const key = theme.key;
    const map = new Uint8Array(MW * MH);          // all VOID
    const hp = new Uint8Array(MW * MH);
    const reserved = new Uint8Array(MW * MH);
    const inside = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
    const at = (x, y) => (inside(x, y) ? map[y * MW + x] : T.VOID);
    const set = (x, y, v) => {
      if (!inside(x, y)) return;
      map[y * MW + x] = v;
      hp[y * MW + x] = v === T.BLOCK ? 3 : 0;
    };
    const reserve = (x0, y0, w, h) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) reserved[y * MW + x] = 1;
    };

    // 1. Carve the island: a meandering band of ground with rocky rims, space beyond
    const arenaY = 17;
    const phase = R(0, TAU), amp = R(1.8, 3.2), freq = R(0.05, 0.08);
    const cxAt = y => {
      const c = MW / 2 + amp * Math.sin(y * freq + phase) + 1.1 * Math.sin(y * freq * 2.3 + phase * 1.7);
      return lerp(MW / 2, c, clamp((y - arenaY) / 8, 0, 1));
    };
    const hwAt = y => {
      let h = 6.4 + 1.3 * Math.sin(y * 0.13 + phase * 2.1) + 0.7 * Math.sin(y * 0.37 + phase);
      h = lerp(MW / 2 - 1.4, h, clamp((y - (arenaY - 3)) / 6, 0, 1));
      if (y > MH - 9) h = Math.max(h, 6);
      return h;
    };
    for (let y = 1; y < MH - 1; y++) {
      const cx = cxAt(y), hw = hwAt(y);
      for (let x = 0; x < MW; x++) {
        const d = Math.abs(x + 0.5 - cx), edge = hw + (rng() - 0.5) * 1.1;
        if (d < edge - 1.1) set(x, y, T.GROUND);
        else if (d < edge + 0.6) set(x, y, T.ROCK);
      }
    }
    for (let x = 0; x < MW; x++) {
      if (at(x, 1) === T.GROUND) set(x, 1, T.ROCK);
      if (at(x, MH - 2) === T.GROUND) set(x, MH - 2, T.ROCK);
    }
    reserve(0, 0, MW, arenaY + 1);
    reserve(0, MH - 8, MW, 8);

    // 2. Choke points — rock ridges or rivers across the island with a gap or bridge
    const bands = [];
    let y = MH - 14;
    while (y > arenaY + 7) {
      const water = (key === 'forest' && rng() < 0.55) || (key === 'sand' && rng() < 0.5);
      const thick = water ? 2 : RI(1, 2);
      let x0 = MW, x1 = -1;
      for (let x = 0; x < MW; x++) if (at(x, y) === T.GROUND) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      if (x1 - x0 < 6) { y -= 3; continue; }
      const gw = water ? 3 : 3 + (rng() < 0.5 ? 1 : 0);
      const ng = x1 - x0 > 11 && rng() < 0.6 ? 2 : 1;
      const gaps = [];
      for (let g = 0; g < ng; g++) {
        let gx, tries = 0;
        do { gx = RI(x0 + 1, x1 - gw); } while (gaps.some(o => Math.abs(o.x0 - gx) < gw + 3) && ++tries < 30);
        gaps.push({ x0: gx, x1: gx + gw - 1 });
      }
      for (let yy = y; yy < y + thick; yy++) {
        for (let x = 0; x < MW; x++) {
          if (at(x, yy) !== T.GROUND) continue;
          const inGap = gaps.some(g => x >= g.x0 && x <= g.x1);
          set(x, yy, inGap ? (water ? T.BRIDGE : T.GROUND) : (water ? T.WATER : T.ROCK));
        }
      }
      reserve(0, y - 1, MW, thick + 2);
      bands.push({ y, thick, gaps, river: water, passed: false });
      y -= RI(12, 16);
    }

    // 3. Theme dressing between the choke points
    const open = (x0, y0, w, h) => {
      for (let yy = y0; yy < y0 + h; yy++) for (let x = x0; x < x0 + w; x++) {
        if (!inside(x, yy) || at(x, yy) !== T.GROUND || reserved[yy * MW + x]) return false;
      }
      return true;
    };
    const place = (w, h, tile, sparse, pad) => {
      const p = pad === undefined ? 1 : pad;
      for (let tries = 0; tries < 12; tries++) {
        const x = RI(1, MW - 1 - w), yy = RI(arenaY + 3, MH - 10);
        if (!open(x - p, yy - p, w + p * 2, h + p * 2)) continue;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (!sparse || rng() < 0.7) set(x + dx, yy + dy, tile);
        return true;
      }
      return false;
    };
    const nFeat = Math.floor(MH / 3) + n * 2;
    for (let i = 0; i < nFeat; i++) {
      const r = rng();
      switch (key) {
        case 'grass':
          if (r < 0.4) place(RI(1, 2), RI(1, 2), T.ROCK);
          else if (r < 0.75) place(RI(2, 3), RI(1, 2), T.BUSH, true, 0);
          else place(1, 1, T.BLOCK);
          break;
        case 'forest':
          if (r < 0.6) place(RI(2, 4), RI(2, 3), T.BUSH, true, 0);
          else if (r < 0.8) place(RI(1, 2), RI(1, 2), T.ROCK);
          else place(1, 1, T.BLOCK);
          break;
        case 'sand':
          if (r < 0.35) place(RI(2, 3), 2, T.WATER);
          else if (r < 0.65) place(RI(1, 2), RI(1, 2), T.ROCK);
          else if (r < 0.8) place(2, 1, T.BUSH, true, 0);
          else place(1, 1, T.BLOCK);
          break;
        case 'city':
          if (r < 0.5) place(2, 2, T.BLOCK);
          else if (r < 0.75) place(1, 2, T.BUSH, false, 1);
          else place(1, 1, T.BLOCK);
          break;
        default:
          if (r < 0.5) place(rng() < 0.5 ? 2 : 1, rng() < 0.5 ? 1 : 2, T.BLOCK);
          else if (r < 0.8) place(3, 3, T.ROAD, false, 0);
          else place(1, 1, T.ROCK);
      }
    }
    for (let i = 0; i < MH / 7; i++) place(1, 1, T.RUBBLE, false, 0);

    // 4. Lift zones (2x2) and jump pads (just south of a choke point)
    const lifts = [];
    for (let i = 0; i < 1 + (n >= 3 ? 1 : 0); i++) {
      for (let tries = 0; tries < 300; tries++) {
        const x = RI(2, MW - 4), yy = RI(arenaY + 6, MH - 14);
        if (!open(x - 1, yy - 1, 4, 4)) continue;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) set(x + dx, yy + dy, T.LIFT);
        reserve(x - 1, yy - 1, 4, 4);
        lifts.push({ x, y: yy, used: false });
        break;
      }
    }
    let nJump = 0;
    for (const b of bands) {
      if (nJump >= 2 || rng() < 0.35) continue;
      for (let tries = 0; tries < 20; tries++) {
        const x = RI(2, MW - 3), jy = b.y + b.thick + 1;
        if (b.gaps.some(g => x >= g.x0 - 2 && x <= g.x1 + 2)) continue;
        if (at(x, jy) !== T.GROUND || at(x, jy + 1) !== T.GROUND || at(x, b.y - 2) !== T.GROUND || at(x, b.y - 3) !== T.GROUND) continue;
        set(x, jy, T.JUMP);
        nJump++;
        break;
      }
    }

    // 5. The fortress: a pentagonal stone platform with gun pyramids and a core
    const fort = { cx: MW / 2, cy: 7.5, r: 2.1, verts: [] };
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + k * TAU / 5;
      fort.verts.push([fort.cx + Math.cos(a) * fort.r, fort.cy + Math.sin(a) * fort.r]);
    }
    const inPent = (px, py) => {
      let c = false;
      for (let i = 0, j = 4; i < 5; j = i++) {
        const [xi, yi] = fort.verts[i], [xj, yj] = fort.verts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (let yy = 2; yy < 14; yy++) for (let x = 0; x < MW; x++) {
      if (inPent(x + 0.5, yy + 0.5)) set(x, yy, T.FORT);
    }

    // 6. Connectivity + flow field from the fortress (destructibles count as passable)
    const pass = v => v !== T.VOID && v !== T.ROCK && v !== T.WATER;
    const dist = new Int16Array(MW * MH).fill(-1);
    const q = [];
    for (let i = 0; i < MW * MH; i++) if (map[i] === T.FORT) { dist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % MW, yy = (i / MW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = yy + dy;
        if (!inside(nx, ny)) continue;
        const ni = ny * MW + nx;
        if (dist[ni] >= 0 || !pass(map[ni])) continue;
        dist[ni] = dist[i] + 1;
        q.push(ni);
      }
    }
    const sy = MH - 5, sx = Math.round(cxAt(sy) - 0.5);
    if (at(sx, sy) !== T.GROUND || dist[sy * MW + sx] < 0) return null;

    // 7. Enemies
    const spawns = [];
    const diffN = Math.min(n, 10);
    for (let ry = arenaY + 3; ry < MH - 15; ry += 6) {
      const count = 1 + (rng() < 0.45 + diffN * 0.06 ? 1 : 0) + (diffN > 3 && rng() < 0.35 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        for (let tries = 0; tries < 30; tries++) {
          const x = RI(1, MW - 2), yy = RI(ry, ry + 5);
          const i = yy * MW + x;
          if (at(x, yy) !== T.GROUND || reserved[i] || dist[i] < 0) continue;
          if (spawns.some(s => Math.abs(s.x - x) + Math.abs(s.y - yy) < 4)) continue;
          const r = rng();
          const type = r < 0.45 ? 'tank' : r < 0.78 ? 'turret' : n >= 2 ? 'mortar' : 'tank';
          spawns.push({ type, x, y: yy });
          break;
        }
      }
    }
    for (const gx of [Math.floor(fort.cx) - 7, Math.floor(fort.cx) + 6]) if (at(gx, 13) === T.GROUND) spawns.push({ type: 'turret', x: gx, y: 13 });
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + k * TAU / 5;
      spawns.push({ type: 'fortgun', wx: (fort.cx + Math.cos(a) * fort.r * 0.7) * TS, wy: (fort.cy + Math.sin(a) * fort.r * 0.7) * TS, a });
    }
    spawns.push({ type: 'core', wx: fort.cx * TS, wy: fort.cy * TS });

    return {
      n, theme, MW, MH, map, hp, fort, arenaY, bands, lifts, dist, spawns, cleared: false,
      start: { x: (sx + 0.5) * TS, y: (sy + 0.5) * TS }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Game                                                                */
  /* ------------------------------------------------------------------ */

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.hiScore = opts.hiScore || 0;
      this.nextId = 1;
      this.score = 0;
      this.lives = 3;
      this.nextLife = 20000;
      this.events = [];
      this.over = false;
      this.time = 0;
      this.message = null;
      this.ai = { lx: 0, ly: 0, stuck: 0, unstick: 0, dir: 1 };
      this.loadStage(opts.stage || 1);
    }

    get difficulty() { return 1 + (this.stageNum - 1) * 0.1; }

    emit(type, data) { this.events.push(Object.assign({}, data, { type })); }
    drainEvents() { const e = this.events; this.events = []; return e; }
    setState(s, t) { this.state = s; this.stateTimer = t || 0; }
    say(text, sub, dur) { this.message = { text, sub: sub || '', t: 0, dur: dur || 2 }; }

    loadStage(n) {
      this.stageNum = n;
      this.stage = buildStage(n);
      const s = this.stage;
      this.player = this.makePlayer(s.start.x, s.start.y);
      this.checkpoint = { x: s.start.x, y: s.start.y };
      this.enemies = s.spawns.map(sp => {
        const e = this.makeEnemy(sp.type, sp.wx !== undefined ? sp.wx : (sp.x + 0.5) * TS, sp.wy !== undefined ? sp.wy : (sp.y + 0.5) * TS);
        if (sp.a !== undefined) { e.a = sp.a; e.ta = sp.a + Math.PI / 2; }
        return e;
      });
      this.shots = [];
      this.eshots = [];
      this.grenades = [];
      this.timeLeft = STAGE_TIME;
      this.timeWarned = false;
      this.chopperCd = 24;
      this.camA = 0;
      this.coreOpen = false;
      this.clearFx = 0;
      this.setState('intro', 2.6);
      this.say('STAGE ' + String(n).padStart(2, '0'), s.theme.name, 2.6);
      this.emit('stageStart', { stage: n });
    }

    makePlayer(x, y) {
      return {
        x, y, a: 0, r: 11, alive: true, invuln: 2.5, fireCd: 0, speed: 0, turn: 0, tread: 0, recoil: 0,
        wheelie: 0, wheelieT: 0, wheelieCd: 0, wheelieFired: false,
        rollT: 0, rollDir: 0, rollCd: 0,
        lift: 0, liftT: 0, liftPad: null, jump: null, alt: 0, padLock: false
      };
    }

    makeEnemy(type, x, y) {
      const spec = ENEMY[type];
      return {
        id: this.nextId++, type, x, y, r: spec.r, hp: spec.hp, a: Math.random() * TAU, ta: Math.PI,
        fireCd: rand(1, 3), t: Math.random() * 10, hitFlash: 0, dead: false,
        flying: !!spec.flying, wanderT: 0, wanderA: 0, burst: 0, orbit: Math.random() * TAU, speed: 0, tread: 0
      };
    }

    /* ---------------- map helpers ---------------- */

    tileAt(tx, ty) {
      const s = this.stage;
      if (tx < 0 || ty < 0 || tx >= s.MW || ty >= s.MH) return T.VOID;
      return s.map[ty * s.MW + tx];
    }

    setTile(tx, ty, v) {
      const s = this.stage;
      s.map[ty * s.MW + tx] = v;
      s.hp[ty * s.MW + tx] = 0;
      this.emit('tile', { tx, ty });
    }

    collides(x, y, r) {
      const x0 = Math.floor((x - r) / TS), x1 = Math.floor((x + r) / TS);
      const y0 = Math.floor((y - r) / TS), y1 = Math.floor((y + r) / TS);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!MOVE_BLOCK[this.tileAt(tx, ty)]) continue;
          const nx = clamp(x, tx * TS, tx * TS + TS), ny = clamp(y, ty * TS, ty * TS + TS);
          if ((nx - x) * (nx - x) + (ny - y) * (ny - y) < r * r) return true;
        }
      }
      return false;
    }

    moveCircle(o, dx, dy) {
      let free = true;
      o.x += dx;
      if (this.collides(o.x, o.y, o.r)) { o.x -= dx; free = false; }
      o.y += dy;
      if (this.collides(o.x, o.y, o.r)) { o.y -= dy; free = false; }
      return free;
    }

    los(x0, y0, x1, y1) {
      const d = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(d / 10);
      for (let i = 1; i < steps; i++) {
        const k = i / steps;
        const tile = this.tileAt(Math.floor(lerp(x0, x1, k) / TS), Math.floor(lerp(y0, y1, k) / TS));
        if (SHOT_BLOCK[tile]) return false;
      }
      return true;
    }

    /* Direction along the flow field toward the fortress (used by the exit arrow and the autopilot). */
    guideAngle(x, y) {
      const s = this.stage;
      if (y < s.arenaY * TS) {
        let best = null, bd = 1e9;
        for (const e of this.enemies) {
          if (e.dead || (e.type !== 'fortgun' && e.type !== 'core')) continue;
          if (e.type === 'core' && !this.coreOpen) continue;
          const d = Math.hypot(e.x - x, e.y - y);
          if (d < bd) { bd = d; best = e; }
        }
        const tx = best ? best.x : s.fort.cx * TS, ty = best ? best.y : s.fort.cy * TS;
        return angleTo(tx - x, ty - y);
      }
      let tx = Math.floor(x / TS), ty = Math.floor(y / TS);
      for (let step = 0; step < 3; step++) {
        const here = s.dist[ty * s.MW + tx];
        let bx = tx, by = ty, bd = here < 0 ? 1e9 : here;
        for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= s.MW || ny >= s.MH) continue;
          const d = s.dist[ny * s.MW + nx];
          if (d >= 0 && d < bd) { bd = d; bx = nx; by = ny; }
        }
        if (bx === tx && by === ty) break;
        tx = bx; ty = by;
      }
      return angleTo((tx + 0.5) * TS - x, (ty + 0.5) * TS - y);
    }

    /* ---------------- update ---------------- */

    update(dt, inp) {
      inp = inp || {};
      this.time += dt;
      if (this.message) {
        this.message.t += dt;
        if (this.message.t >= this.message.dur) this.message = null;
      }
      const p = this.player;
      const active = this.state === 'play';
      if (p.alive) this.updatePlayer(dt, inp, active);
      this.camA += angDiff(this.camA, p.a) * Math.min(1, dt * 7);

      if (active) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 20 && !this.timeWarned) { this.timeWarned = true; this.emit('timeWarn', {}); }
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.killPlayer('time'); }
        this.spawnChoppers(dt);
      }
      this.updateEnemies(dt);
      this.updateShots(dt);
      this.updateEShots(dt);
      this.updateGrenades(dt);
      this.enemies = this.enemies.filter(e => !e.dead);
      this.shots = this.shots.filter(s => !s.dead);
      this.eshots = this.eshots.filter(s => !s.dead);
      this.grenades = this.grenades.filter(g => !g.dead);

      if (this.stateTimer > 0) this.stateTimer -= dt;
      switch (this.state) {
        case 'intro':
        case 'ready':
          if (this.stateTimer <= 0) this.setState('play');
          break;
        case 'dying':
          if (this.stateTimer <= 0) this.afterDeath();
          break;
        case 'clear':
          this.clearFx -= dt;
          if (this.clearFx <= 0 && this.stateTimer > 2.2) {
            this.clearFx = 0.12;
            const f = this.stage.fort, a = Math.random() * TAU, r = Math.random() * f.r * TS;
            this.emit('explode', { x: f.cx * TS + Math.cos(a) * r, y: f.cy * TS + Math.sin(a) * r, size: 2, enemy: 'fortgun' });
          }
          if (this.stateTimer <= 0) this.loadStage(this.stageNum + 1);
          break;
      }
    }

    updatePlayer(dt, inp, active) {
      const p = this.player;
      if (p.invuln > 0) p.invuln -= dt;
      p.fireCd -= dt;
      p.wheelieCd -= dt;
      p.rollCd -= dt;
      if (p.recoil > 0) p.recoil = Math.max(0, p.recoil - dt * 6);
      p.speed = 0;
      p.turn = 0;
      if (!active) return;
      const fx = Math.sin(p.a), fy = -Math.cos(p.a);

      // Jump pad flight
      if (p.jump) {
        const j = p.jump;
        j.t += dt;
        const k = Math.min(1, j.t / j.dur);
        p.x = lerp(j.x0, j.x1, k);
        p.y = lerp(j.y0, j.y1, k);
        p.alt = Math.sin(k * Math.PI);
        if (k >= 1) {
          p.jump = null;
          p.alt = 0;
          p.padLock = true;
          this.emit('land', { x: p.x, y: p.y });
          this.blast(p.x, p.y, 74, 3, 'player');
        }
        return;
      }

      // Lift zone: rise, hover and bomb, then come back down
      if (p.liftT > 0) {
        p.liftT -= dt;
        const el = LIFT_TIME - p.liftT;
        p.lift = el < 0.9 ? el / 0.9 : p.liftT < 0.9 ? Math.max(0, p.liftT / 0.9) : 1;
        p.alt = p.lift * 1.6;
        const turn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        p.a += turn * TURN_RATE * 0.8 * dt;
        p.turn = turn;
        if ((inp.fire || inp.wheelie) && p.fireCd <= 0 && p.lift > 0.9) {
          p.fireCd = 0.4;
          this.launchGrenade(p.x, p.y, p.a, 170, 0.7, 'bomb');
        }
        if (p.liftT <= 0) {
          p.lift = 0;
          p.alt = 0;
          p.liftT = 0;
          const pad = p.liftPad;
          if (pad) {
            pad.used = true;
            for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.setTile(pad.x + dx, pad.y + dy, T.PAD_USED);
          }
          p.liftPad = null;
          this.emit('liftEnd', {});
        }
        return;
      }

      // Power Wheelie: rear up and lob a grenade
      if (p.wheelieT > 0) {
        p.wheelieT -= dt;
        const el = WHEELIE_TIME - p.wheelieT;
        p.wheelie = el < 0.18 ? el / 0.18 : p.wheelieT < 0.2 ? Math.max(0, p.wheelieT / 0.2) : 1;
        if (!p.wheelieFired && el >= 0.18) {
          p.wheelieFired = true;
          this.launchGrenade(p.x + fx * 14, p.y + fy * 14, p.a, 200, 0.85, 'grenade');
        }
        if (p.wheelieT <= 0) { p.wheelie = 0; p.wheelieT = 0; }
        return;
      }

      const turn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      p.a += turn * TURN_RATE * dt;
      p.turn = turn;
      const mv = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
      const sp = mv > 0 ? FWD_SPEED : mv < 0 ? -REV_SPEED : 0;
      p.speed = sp;
      let dx = Math.sin(p.a) * sp * dt, dy = -Math.cos(p.a) * sp * dt;

      if (p.rollT > 0) {
        p.rollT -= dt;
        const rs = 250 * p.rollDir;
        dx += Math.cos(p.a) * rs * dt;
        dy += Math.sin(p.a) * rs * dt;
      } else if ((inp.rollL || inp.rollR) && p.rollCd <= 0) {
        p.rollT = 0.28;
        p.rollDir = inp.rollL ? -1 : 1;
        p.rollCd = 0.7;
        this.emit('roll', {});
      }
      if (dx || dy) this.moveCircle(p, dx, dy);
      p.tread += (Math.abs(sp) + Math.abs(turn) * 45 + (p.rollT > 0 ? 220 : 0)) * dt;

      // Floor triggers
      const tx = Math.floor(p.x / TS), ty = Math.floor(p.y / TS);
      const tile = this.tileAt(tx, ty);
      if (tile === T.LIFT) {
        const pad = this.stage.lifts.find(l => !l.used && tx >= l.x && tx <= l.x + 1 && ty >= l.y && ty <= l.y + 1);
        if (pad) {
          p.liftPad = pad;
          p.liftT = LIFT_TIME;
          p.x = (pad.x + 1) * TS;
          p.y = (pad.y + 1) * TS;
          this.emit('lift', {});
          return;
        }
      }
      if (tile === T.JUMP && !p.padLock) this.startJump(p);
      if (tile !== T.JUMP) p.padLock = false;

      if (inp.fire && p.fireCd <= 0 && this.shots.length < 4) {
        p.fireCd = 0.17;
        p.recoil = 1;
        const x = p.x + fx * 18, y = p.y + fy * 18;
        this.shots.push({ x, y, vx: fx * SHOT_SPEED, vy: fy * SHOT_SPEED, life: 0.8 });
        this.emit('shoot', { x, y, a: p.a });
      }
      if (inp.wheelie && p.wheelieCd <= 0) {
        p.wheelieT = WHEELIE_TIME;
        p.wheelieFired = false;
        p.wheelieCd = 1.1;
        this.emit('wheelie', {});
      }

      // Checkpoints: each barrier crossed becomes the respawn point
      for (const b of this.stage.bands) {
        if (b.passed || p.y > b.y * TS - 6) continue;
        b.passed = true;
        let g = b.gaps[0];
        for (const gg of b.gaps) if (Math.abs((gg.x0 + gg.x1 + 1) / 2 * TS - p.x) < Math.abs((g.x0 + g.x1 + 1) / 2 * TS - p.x)) g = gg;
        this.checkpoint = { x: (g.x0 + g.x1 + 1) / 2 * TS, y: (b.y - 0.5) * TS };
        this.timeLeft = STAGE_TIME;
        this.timeWarned = false;
      }
    }

    startJump(p) {
      const fx = Math.sin(p.a), fy = -Math.cos(p.a);
      for (let d = 200; d <= 360; d += 16) {
        const x1 = p.x + fx * d, y1 = p.y + fy * d;
        if (!this.collides(x1, y1, p.r + 2)) {
          p.jump = { t: 0, dur: 0.85 + d / 700, x0: p.x, y0: p.y, x1, y1 };
          this.emit('jump', {});
          return;
        }
      }
      p.padLock = true;
    }

    launchGrenade(x, y, a, dist, dur, kind) {
      const s = this.stage;
      const x1 = clamp(x + Math.sin(a) * dist, TS, (s.MW - 1) * TS);
      const y1 = clamp(y - Math.cos(a) * dist, TS, (s.MH - 1) * TS);
      this.grenades.push({ x0: x, y0: y, x1, y1, x, y, alt: 0, t: 0, dur, owner: 'player', r: kind === 'bomb' ? 44 : 52, dmg: 4, kind });
      this.emit('grenade', { kind });
    }

    spawnChoppers(dt) {
      this.chopperCd -= dt;
      if (this.chopperCd > 0) return;
      this.chopperCd = rand(14, 22) / this.difficulty;
      const max = 1 + Math.floor(this.stageNum / 3);
      if (this.enemies.filter(e => e.type === 'chopper').length >= max) return;
      const p = this.player, s = this.stage;
      const a = p.a + rand(-0.6, 0.6);
      const e = this.makeEnemy('chopper', clamp(p.x + Math.sin(a) * 430, TS * 2, (s.MW - 2) * TS), clamp(p.y - Math.cos(a) * 430, TS * 2, (s.MH - 2) * TS));
      e.a = a + Math.PI;
      this.enemies.push(e);
      this.emit('chopperIn', {});
    }

    updateEnemies(dt) {
      const p = this.player, s = this.stage;
      const target = p.alive && this.state === 'play';
      const diff = this.difficulty;
      for (const e of this.enemies) {
        if (e.dead) continue;
        e.t += dt;
        if (e.hitFlash > 0) e.hitFlash -= dt;
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
        if (d > 600 && e.type !== 'chopper') continue;
        const aim = angleTo(dx, dy);
        e.fireCd -= dt;
        e.speed = 0;

        switch (e.type) {
          case 'tank': {
            const see = target && d < 400 && this.los(e.x, e.y, p.x, p.y);
            if (see) {
              e.a = turnToward(e.a, aim, 1.5 * dt);
              if (d > 150) this.enemyMove(e, 40 + this.stageNum * 3, dt);
            } else {
              e.wanderT -= dt;
              if (e.wanderT <= 0) { e.wanderT = rand(1.5, 3.5); e.wanderA = e.a + rand(-1.7, 1.7); }
              e.a = turnToward(e.a, e.wanderA, 1.2 * dt);
              if (!this.enemyMove(e, 30, dt)) e.wanderT = 0;
            }
            e.ta = turnToward(e.ta, see ? aim : e.a, 2.4 * dt);
            if (see && e.fireCd <= 0 && Math.abs(angDiff(e.ta, aim)) < 0.15) {
              this.enemyFire(e, e.ta, 175, 'shell', 18);
              e.fireCd = rand(1.6, 2.8) / diff;
            }
            break;
          }
          case 'turret': {
            const see = target && d < 380 && this.los(e.x, e.y, p.x, p.y);
            if (see) e.ta = turnToward(e.ta, aim, 1.6 * dt);
            if (see && e.fireCd <= 0 && Math.abs(angDiff(e.ta, aim)) < 0.2) {
              this.enemyFire(e, e.ta, 185, 'shell', 20);
              e.burst++;
              e.fireCd = e.burst % 2 ? 0.28 : rand(1.8, 2.6) / diff;
            }
            break;
          }
          case 'mortar':
            e.ta = turnToward(e.ta, aim, 1.2 * dt);
            if (target && d < 420 && d > 70 && e.fireCd <= 0 && p.alt === 0) {
              const lead = 0.9;
              const tx = p.x + Math.sin(p.a) * p.speed * lead, ty = p.y - Math.cos(p.a) * p.speed * lead;
              this.grenades.push({ x0: e.x, y0: e.y, x1: tx, y1: ty, x: e.x, y: e.y, alt: 0, t: 0, dur: 1.6, owner: 'enemy', r: 30, kind: 'mortar' });
              this.emit('mortarFire', { x: e.x, y: e.y });
              e.fireCd = rand(3, 4.2) / diff;
            }
            break;
          case 'chopper': {
            e.orbit += dt * 0.8;
            const ox = p.x + Math.cos(e.orbit) * 140, oy = p.y + Math.sin(e.orbit) * 140;
            e.a = turnToward(e.a, angleTo(ox - e.x, oy - e.y), 2.4 * dt);
            e.x = clamp(e.x + Math.sin(e.a) * 120 * dt, TS, (s.MW - 1) * TS);
            e.y = clamp(e.y - Math.cos(e.a) * 120 * dt, TS, (s.MH - 1) * TS);
            e.ta = aim;
            if (target && d < 360 && e.fireCd <= 0) {
              this.enemyFire(e, aim, 210, 'plasma', 12);
              e.fireCd = rand(1.4, 2.2) / diff;
            }
            break;
          }
          case 'fortgun': {
            const see = target && d < 460 && p.y < s.arenaY * TS;
            if (see) e.ta = turnToward(e.ta, aim, 1.4 * dt);
            if (see && e.fireCd <= 0 && Math.abs(angDiff(e.ta, aim)) < 0.3) {
              for (const k of [-0.24, 0, 0.24]) this.enemyFire(e, e.ta + k, 165, 'shell', 22);
              e.fireCd = rand(1.6, 2.4) / diff;
            }
            break;
          }
          case 'core':
            e.ta += dt * 0.8;
            if (this.coreOpen && target && d < 520 && e.fireCd <= 0) {
              for (let k = 0; k < 10; k++) this.enemyFire(e, e.ta + k / 10 * TAU, 150, 'plasma', 30);
              e.fireCd = 2.1 / diff;
            }
            break;
        }
        if (e.speed) e.tread += Math.abs(e.speed) * dt;
      }
    }

    enemyMove(e, speed, dt) {
      e.speed = speed;
      return this.moveCircle(e, Math.sin(e.a) * speed * dt, -Math.cos(e.a) * speed * dt);
    }

    enemyFire(e, a, speed, kind, muzzle) {
      if (this.eshots.length > 48) return;
      const fx = Math.sin(a), fy = -Math.cos(a);
      const x = e.x + fx * muzzle, y = e.y + fy * muzzle;
      this.eshots.push({ x, y, vx: fx * speed, vy: fy * speed, kind, life: 3.2, fromFort: e.type === 'fortgun' || e.type === 'core', flying: e.flying });
      this.emit('enemyShoot', { x, y, kind });
    }

    updateShots(dt) {
      for (const s of this.shots) {
        if (s.dead) continue;
        s.life -= dt;
        if (s.life <= 0) { s.dead = true; continue; }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        for (const e of this.enemies) {
          if (e.dead) continue;
          if ((e.x - s.x) ** 2 + (e.y - s.y) ** 2 < (e.r + 3) ** 2) {
            s.dead = true;
            this.damageEnemy(e, 1);
            break;
          }
        }
        if (s.dead) continue;
        for (const b of this.eshots) {
          if (!b.dead && b.kind === 'shell' && (b.x - s.x) ** 2 + (b.y - s.y) ** 2 < 100) {
            b.dead = s.dead = true;
            this.addScore(20);
            this.emit('intercept', { x: b.x, y: b.y });
            break;
          }
        }
        if (s.dead) continue;
        const tx = Math.floor(s.x / TS), ty = Math.floor(s.y / TS), tile = this.tileAt(tx, ty);
        if (SHOT_BLOCK[tile]) {
          s.dead = true;
          if (tile === T.BLOCK) this.damageTile(tx, ty, 1);
          else this.emit('spark', { x: s.x - s.vx * dt, y: s.y - s.vy * dt });
        }
      }
    }

    damageTile(tx, ty, dmg) {
      const s = this.stage, i = ty * s.MW + tx;
      const tile = s.map[i];
      if (tile !== T.BLOCK) return;
      s.hp[i] = Math.max(0, s.hp[i] - dmg);
      const x = (tx + 0.5) * TS, y = (ty + 0.5) * TS;
      if (s.hp[i] > 0) { this.emit('hit', { x, y }); return; }
      this.setTile(tx, ty, T.RUBBLE);
      this.addScore(50);
      this.emit('explode', { x, y, size: 1, enemy: 'block' });
    }

    damageEnemy(e, dmg) {
      if (e.type === 'core' && !this.coreOpen) { this.emit('spark', { x: e.x, y: e.y }); return; }
      e.hp -= dmg;
      e.hitFlash = 0.12;
      if (e.hp > 0) { this.emit('hit', { x: e.x, y: e.y }); return; }
      e.dead = true;
      const pts = ENEMY[e.type].score;
      this.addScore(pts);
      this.emit('explode', { x: e.x, y: e.y, size: e.type === 'core' ? 3 : e.type === 'fortgun' ? 1.6 : 1.2, enemy: e.type, points: pts, flying: e.flying });
      if (e.type === 'fortgun' && !this.enemies.some(o => !o.dead && o.type === 'fortgun')) {
        this.coreOpen = true;
        this.say('CORE EXPOSED', 'DESTROY THE FORTRESS', 2.2);
        this.emit('coreOpen', {});
      }
      if (e.type === 'core') this.stageClear();
    }

    updateEShots(dt) {
      const p = this.player;
      for (const b of this.eshots) {
        if (b.dead) continue;
        b.life -= dt;
        if (b.life <= 0) { b.dead = true; continue; }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const tile = this.tileAt(Math.floor(b.x / TS), Math.floor(b.y / TS));
        if (SHOT_BLOCK[tile] && !b.flying) {
          b.dead = true;
          this.emit('spark', { x: b.x, y: b.y, enemy: true });
          continue;
        }
        if (p.alive && p.invuln <= 0 && p.alt < 0.25 && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < (p.r + 3) ** 2) {
          b.dead = true;
          this.killPlayer('shot');
        }
      }
    }

    updateGrenades(dt) {
      for (const g of this.grenades) {
        g.t += dt;
        const k = Math.min(1, g.t / g.dur);
        g.x = lerp(g.x0, g.x1, k);
        g.y = lerp(g.y0, g.y1, k);
        g.alt = Math.sin(k * Math.PI) * (g.kind === 'bomb' ? 0.4 : 1) + (g.kind === 'bomb' ? (1 - k) * 1.2 : 0);
        if (k >= 1) {
          g.dead = true;
          this.blast(g.x1, g.y1, g.r, g.dmg || 0, g.owner);
        }
      }
    }

    blast(x, y, r, dmg, owner) {
      this.emit('blast', { x, y, r, owner });
      const p = this.player;
      if (owner === 'player') {
        for (const e of this.enemies) {
          if (!e.dead && Math.hypot(e.x - x, e.y - y) < r + e.r) this.damageEnemy(e, dmg);
        }
        for (const b of this.eshots) if (!b.dead && Math.hypot(b.x - x, b.y - y) < r) b.dead = true;
        const t0x = Math.floor((x - r) / TS), t1x = Math.floor((x + r) / TS);
        const t0y = Math.floor((y - r) / TS), t1y = Math.floor((y + r) / TS);
        for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
          if (Math.hypot((tx + 0.5) * TS - x, (ty + 0.5) * TS - y) < r + 8) this.damageTile(tx, ty, 9);
        }
      } else if (p.alive && p.invuln <= 0 && p.alt < 0.25 && Math.hypot(p.x - x, p.y - y) < r + p.r * 0.5) {
        this.killPlayer('blast');
      }
    }

    killPlayer(reason) {
      const p = this.player;
      if (!p.alive || this.state !== 'play') return;
      p.alive = false;
      p.liftT = 0; p.lift = 0; p.jump = null; p.alt = 0; p.wheelie = 0; p.wheelieT = 0;
      this.lives--;
      this.emit('playerDie', { x: p.x, y: p.y, reason });
      for (const b of this.eshots) b.dead = true;
      for (const g of this.grenades) if (g.owner === 'enemy') g.dead = true;
      this.setState('dying', 2.4);
      if (reason === 'time') this.say('TIME UP', '', 2.2);
    }

    afterDeath() {
      if (this.lives > 0) {
        const cp = this.checkpoint;
        this.player = this.makePlayer(cp.x, cp.y);
        this.camA = 0;
        this.timeLeft = STAGE_TIME; this.timeWarned = false;
        for (const e of this.enemies) {
          if (e.type !== 'fortgun' && e.type !== 'core' && Math.hypot(e.x - cp.x, e.y - cp.y) < 150) e.dead = true;
        }
        this.setState('ready', 1.4);
        this.say('READY', '', 1.4);
      } else {
        this.setState('gameover');
        this.over = true;
        if (this.score > this.hiScore) this.hiScore = this.score;
        this.say('GAME OVER', '', 1e9);
        this.emit('gameOver', { score: this.score, stage: this.stageNum });
      }
    }

    stageClear() {
      const bonus = Math.ceil(this.timeLeft) * 50 + this.stageNum * 1000;
      for (const e of this.enemies) {
        if (!e.dead) { e.dead = true; this.emit('explode', { x: e.x, y: e.y, size: 1, enemy: e.type, flying: e.flying }); }
      }
      for (const b of this.eshots) b.dead = true;
      for (const g of this.grenades) if (g.owner === 'enemy') g.dead = true;
      this.stage.cleared = true;
      this.addScore(bonus);
      this.player.invuln = 99;
      this.setState('clear', 5);
      this.say('STAGE ' + String(this.stageNum).padStart(2, '0') + ' CLEAR', 'NOW\nYOU ASSAULT ON\nNEXT STAGE!!', 5);
      this.emit('stageClear', { bonus });
    }

    addScore(n) {
      this.score += n;
      while (this.score >= this.nextLife) {
        this.nextLife += 30000;
        if (this.lives < 6) { this.lives++; this.emit('extraLife', { x: this.player.x, y: this.player.y }); }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Attract-mode autopilot                                              */
  /* ------------------------------------------------------------------ */

  function aiInput(g) {
    const p = g.player, inp = {}, ai = g.ai;
    if (!p.alive || g.state !== 'play') return inp;
    if (p.liftT > 0) { inp.fire = true; return inp; }

    let tgt = null, best = 1e9;
    for (const e of g.enemies) {
      if (e.dead || (e.type === 'core' && !g.coreOpen)) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 300 && d < best && (e.flying || g.los(p.x, p.y, e.x, e.y))) { best = d; tgt = e; }
    }

    let goal;
    if (tgt) {
      goal = angleTo(tgt.x - p.x, tgt.y - p.y);
      const off = Math.abs(angDiff(p.a, goal));
      if (off < 0.12) inp.fire = true;
      if (best > 170 && off < 0.5) inp.fwd = true;
      else if (best < 90) inp.back = true;
      if ((tgt.type === 'fortgun' || tgt.type === 'core') && off < 0.2 && Math.random() < 0.02) inp.wheelie = true;
    } else {
      goal = g.guideAngle(p.x, p.y);
      inp.fwd = Math.abs(angDiff(p.a, goal)) < 0.7;
      const ax = Math.floor((p.x + Math.sin(p.a) * 30) / TS), ay = Math.floor((p.y - Math.cos(p.a) * 30) / TS);
      const ahead = g.tileAt(ax, ay);
      if (ahead === T.BLOCK) inp.fire = true;
    }

    // Unstick when wedged against scenery
    if (ai.unstick > 0) {
      ai.unstick -= 1 / 120;
      inp.fwd = false;
      inp.back = true;
      inp[ai.dir > 0 ? 'right' : 'left'] = true;
      return inp;
    }
    if (inp.fwd) {
      const moved = Math.hypot(p.x - ai.lx, p.y - ai.ly);
      ai.stuck = moved < 0.4 ? ai.stuck + 1 / 120 : 0;
      if (ai.stuck > 0.5) { ai.unstick = 0.5; ai.stuck = 0; ai.dir = Math.random() < 0.5 ? -1 : 1; }
    }
    ai.lx = p.x; ai.ly = p.y;

    const diff = angDiff(p.a, goal);
    if (diff > 0.05) inp.right = true;
    else if (diff < -0.05) inp.left = true;
    return inp;
  }

  global.Assault = { Game, aiInput, buildStage, TS, T, TALL, MOVE_BLOCK, SHOT_BLOCK, ENEMY, angDiff, angleTo };
})(window);
