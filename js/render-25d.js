/* Assault Revamped — 2.5D renderer.
 * Lays the 2D simulation onto a perspective ground plane viewed by a pitched
 * camera that sways with the player. Everything is canvas 2D: projected boxes
 * and wedges, shaded saucers, cast shadows, floor lighting and particles. */
(function (global) {
  'use strict';

  const { W, GROUND_Y, MOTHER_Y, ROWS, HEAT_WARN } = global.Assault;

  const CAM_H = 330, CAM_BACK = 330, PITCH = 0.36, DEPTH = 1.6;
  const NEAR_Y = GROUND_Y + 30;
  const MOTHER_ALT = 190;
  const COS = Math.cos(PITCH), SIN = Math.sin(PITCH);

  // [body, highlight, shade] per enemy type — no purples.
  const PAL = {
    saucer:   ['#f59e0b', '#fde68a', '#78350f'],
    splitter: ['#14b8a6', '#99f6e4', '#134e4a'],
    mini:     ['#2dd4bf', '#ccfbf1', '#115e59'],
    gunner:   ['#ef4444', '#fecaca', '#7f1d1d'],
    diver:    ['#22c55e', '#bbf7d0', '#14532d']
  };
  const SPARK = {
    saucer: ['#fde68a', '#fbbf24', '#ffffff'], splitter: ['#99f6e4', '#5eead4', '#ffffff'],
    mini: ['#ccfbf1', '#5eead4'], gunner: ['#fecaca', '#f87171', '#fbbf24'], diver: ['#bbf7d0', '#4ade80', '#ffffff']
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    const A = hexRgb(a), B = hexRgb(b);
    return 'rgb(' + Math.round(lerp(A[0], B[0], t)) + ',' + Math.round(lerp(A[1], B[1], t)) + ',' + Math.round(lerp(A[2], B[2], t)) + ')';
  }

  function altFly(y) {
    if (y <= 430) return 60;
    return 60 - clamp((y - 430) / (GROUND_Y - 430), 0, 1) * 44;
  }

  function enemyAlt(e) {
    if (e.state === 'crawl') return 0;
    if (e.state === 'drop') {
      const k = clamp((e.y - MOTHER_Y) / (ROWS[0] - MOTHER_Y), 0, 1);
      return lerp(MOTHER_ALT - 24, altFly(e.y), k);
    }
    let a = altFly(e.y);
    if (e.state === 'descend' && e.targetY >= GROUND_Y) {
      const k = clamp((e.y - ROWS[4]) / (GROUND_Y - ROWS[4]), 0, 1);
      a = lerp(altFly(ROWS[4]), 6, k);
    }
    return a + Math.sin(e.t * 3 + e.id) * 3;
  }

  class ModernRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 1; this.h = 1; this.f = 1; this.cx = 0; this.cy = 0; this.camX = 0; this.ui = 1;
      this.t = 0;
      this.hideHud = false;
      this.reset();
    }

    reset() {
      this.parts = []; this.smoke = []; this.rings = []; this.lights = []; this.popups = []; this.decals = [];
      this.shake = 0; this.flash = 0; this.flashRgb = '239,68,68';
    }

    resize(w, h) {
      this.w = w; this.h = h;
      this.ui = clamp(Math.min(w / 1400, h / 860), 0.5, 3);
      this.fit();
      this.buildBackdrop();
    }

    /* ---------------- camera ---------------- */

    proj(x, y, alt) {
      const dx = x - W / 2 - this.camX, dy = alt - CAM_H, dz = (NEAR_Y - y) * DEPTH + CAM_BACK;
      let zc = dz * COS - dy * SIN;
      const yc = dy * COS + dz * SIN;
      if (zc < 5) zc = 5;
      const s = this.f / zc;
      return { x: this.cx + dx * s, y: this.cy - yc * s, s, z: zc };
    }

    fit() {
      const cam = this.camX;
      this.camX = 0; this.f = 1; this.cx = 0; this.cy = 0;
      // Keep a band of sky above the horizon in frame
      const top = Math.min(this.proj(W / 2, MOTHER_Y, MOTHER_ALT + 50).y, -SIN / COS - 0.07);
      const bot = this.proj(W / 2, GROUND_Y + 26, 0).y;
      const l = this.proj(-10, GROUND_Y + 26, 0).x, r = this.proj(W + 10, GROUND_Y + 26, 0).x;
      this.f = Math.min(this.w * 0.96 / (r - l), this.h * 0.84 / (bot - top));
      this.cx = this.w / 2;
      this.cy = this.h * 0.46 - this.f * (top + bot) / 2;
      this.horizon = this.cy - this.f * SIN / COS;
      this.camX = cam;
    }

    floorSquash(x, y) {
      const a = this.proj(x, y - 10, 0), b = this.proj(x, y + 10, 0), c = this.proj(x, y, 0);
      return Math.abs(b.y - a.y) / (20 * c.s);
    }

    /* ---------------- backdrop ---------------- */

    buildBackdrop() {
      const w = this.w, pad = Math.round(w * 0.12);
      const hz = Math.max(4, Math.round(this.horizon) + 2);
      const c = document.createElement('canvas');
      c.width = w + pad * 2;
      c.height = hz;
      const x = c.getContext('2d');

      const sky = x.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, '#02060f');
      sky.addColorStop(0.55, '#071426');
      sky.addColorStop(1, '#0f2a40');
      x.fillStyle = sky;
      x.fillRect(0, 0, c.width, hz);

      const n = Math.round(c.width * hz / 3500);
      for (let i = 0; i < n; i++) {
        const sx = Math.random() * c.width, sy = Math.random() * hz * 0.92;
        const r = Math.random() < 0.08 ? rnd(1.2, 1.9) : rnd(0.4, 1.1);
        x.fillStyle = 'rgba(' + pick(['226,232,240', '186,230,253', '254,243,199']) + ',' + rnd(0.25, 0.9).toFixed(2) + ')';
        x.beginPath(); x.arc(sx, sy, r * this.ui * 1.4, 0, Math.PI * 2); x.fill();
      }

      // Ringed gas giant
      const pr = Math.min(w, this.h) * 0.07, px = pad + w * 0.27, py = hz * 0.5;
      const glow = x.createRadialGradient(px, py, pr, px, py, pr * 2.4);
      glow.addColorStop(0, 'rgba(56,189,248,0.18)');
      glow.addColorStop(1, 'rgba(56,189,248,0)');
      x.fillStyle = glow;
      x.fillRect(px - pr * 3, py - pr * 3, pr * 6, pr * 6);
      x.save();
      x.translate(px, py); x.rotate(-0.35);
      x.strokeStyle = 'rgba(186,230,253,0.18)'; x.lineWidth = pr * 0.12;
      x.beginPath(); x.ellipse(0, 0, pr * 1.9, pr * 0.42, 0, Math.PI, Math.PI * 2); x.stroke();
      x.restore();
      const pg = x.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#bae6fd'); pg.addColorStop(0.45, '#0e7490'); pg.addColorStop(1, '#082f49');
      x.fillStyle = pg;
      x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.fill();
      x.save();
      x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.clip();
      x.strokeStyle = 'rgba(8,47,73,0.35)'; x.lineWidth = pr * 0.08;
      for (let k = -2; k <= 2; k++) { x.beginPath(); x.ellipse(px, py + k * pr * 0.3, pr * 1.1, pr * 0.08, -0.35, 0, Math.PI * 2); x.stroke(); }
      x.restore();
      x.save();
      x.translate(px, py); x.rotate(-0.35);
      x.strokeStyle = 'rgba(186,230,253,0.4)'; x.lineWidth = pr * 0.1;
      x.beginPath(); x.ellipse(0, 0, pr * 1.9, pr * 0.42, 0, 0, Math.PI); x.stroke();
      x.restore();

      // Horizon glow
      const hg = x.createLinearGradient(0, hz * 0.6, 0, hz);
      hg.addColorStop(0, 'rgba(20,184,166,0)');
      hg.addColorStop(1, 'rgba(20,184,166,0.28)');
      x.fillStyle = hg;
      x.fillRect(0, hz * 0.6, c.width, hz * 0.4);

      // Two mountain ridges
      const ridge = (amp, seed, fill, edge) => {
        x.beginPath();
        x.moveTo(0, hz);
        for (let i = 0; i <= c.width; i += 6) {
          const u = i / c.width;
          const hgt = amp * (0.55 + 0.25 * Math.sin(u * 13 + seed) + 0.15 * Math.sin(u * 37 + seed * 2) + 0.08 * Math.sin(u * 91 + seed * 3));
          x.lineTo(i, hz - hgt);
        }
        x.lineTo(c.width, hz);
        x.closePath();
        x.fillStyle = fill;
        x.fill();
        x.strokeStyle = edge;
        x.lineWidth = Math.max(1, this.ui);
        x.stroke();
      };
      ridge(this.h * 0.07, 1.3, '#0a1a2b', 'rgba(45,212,191,0.12)');
      ridge(this.h * 0.04, 4.1, '#081422', 'rgba(45,212,191,0.22)');

      this.backdrop = c;
      this.backPad = pad;
    }

    /* ---------------- events ---------------- */

    onEvent(ev, g) {
      switch (ev.type) {
        case 'explode': {
          const alt = ev.crawl ? 6 : ev.state === 'drop' ? MOTHER_ALT - 40 : altFly(ev.y);
          this.explosion(ev.x, ev.y, alt, ev.enemy, ev.crawl ? 1.2 : 1);
          if (ev.points) this.popups.push({ x: ev.x, y: ev.y, alt: alt + 20, text: '+' + ev.points, life: 1.1, max: 1.1 });
          break;
        }
        case 'split':
          this.sparks(ev.x, ev.y, altFly(ev.y), SPARK.splitter, 26, 180);
          this.lights.push({ x: ev.x, y: ev.y, r: 70, rgb: '45,212,191', life: 0.35, max: 0.35 });
          this.popups.push({ x: ev.x, y: ev.y, alt: altFly(ev.y) + 20, text: 'SPLIT +' + ev.points, life: 1, max: 1 });
          this.shake = Math.max(this.shake, 4);
          break;
        case 'hit':
          this.sparks(ev.x, ev.y, altFly(ev.y), ['#ffffff', '#fecaca'], 12, 140);
          break;
        case 'spark':
          this.sparks(ev.x, ev.y, MOTHER_ALT - 12, ['#e0f2fe', '#67e8f9', '#ffffff'], 10, 120);
          break;
        case 'intercept':
          this.sparks(ev.x, ev.y, altFly(ev.y), ['#fde68a', '#fb923c', '#ffffff'], 14, 150);
          this.lights.push({ x: ev.x, y: ev.y, r: 40, rgb: '251,146,60', life: 0.25, max: 0.25 });
          break;
        case 'bulletGround':
          this.sparks(ev.x, ev.y, 2, ['#fca5a5', '#fb923c'], 8, 90);
          this.rings.push({ x: ev.x, y: ev.y, r: 2, max: 22, life: 0.35, maxLife: 0.35, rgb: '248,113,113' });
          this.decals.push({ x: ev.x, y: ev.y, r: rnd(7, 11), life: 5, max: 5 });
          break;
        case 'land':
          this.rings.push({ x: ev.x, y: ev.y, r: 4, max: 46, life: 0.5, maxLife: 0.5, rgb: '148,163,184' });
          for (let i = 0; i < 8; i++) this.smoke.push(this.puff(ev.x + rnd(-14, 14), ev.y + rnd(-8, 8), 2, 0.9, '100,116,139'));
          this.shake = Math.max(this.shake, 3);
          break;
        case 'shoot': {
          const p = g.player;
          const mx = ev.dir === 'up' ? p.x : p.x + (ev.dir === 'left' ? -24 : 24);
          const my = ev.dir === 'up' ? p.y - 24 : p.y;
          this.lights.push({ x: mx, y: my, r: 46, rgb: '103,232,249', life: 0.12, max: 0.12 });
          this.sparks(mx, my, 20, ['#cffafe', '#67e8f9'], 4, 70);
          break;
        }
        case 'playerDie':
          this.explosion(ev.x, ev.y, 12, 'player', 2.2);
          this.flash = 0.55;
          this.flashRgb = ev.reason === 'overheat' ? '249,115,22' : '239,68,68';
          this.shake = 16;
          break;
        case 'waveClear':
          this.flash = 0.35;
          this.flashRgb = '45,212,191';
          break;
        case 'extraLife':
          this.popups.push({ x: ev.x, y: ev.y, alt: 50, text: 'EXTRA LIFE', life: 1.8, max: 1.8, color: '#5eead4' });
          break;
      }
    }

    puff(x, y, alt, life, rgb) {
      return { x, y, alt, r: rnd(5, 9), grow: rnd(14, 26), va: rnd(10, 30), vx: rnd(-12, 12), life, max: life, rgb };
    }

    sparks(x, y, alt, colors, n, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = rnd(0.3, 1) * speed;
        this.parts.push({
          x, y, alt, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, va: rnd(-0.3, 1) * speed,
          life: rnd(0.25, 0.7), max: 0.7, color: pick(colors), size: rnd(1, 2.2), glow: true
        });
      }
    }

    explosion(x, y, alt, type, power) {
      const pal = PAL[type] || ['#94a3b8', '#e2e8f0', '#334155'];
      const sp = SPARK[type] || ['#fde68a', '#fb923c', '#ffffff', '#67e8f9'];
      this.sparks(x, y, alt, sp, Math.round(34 * power), 200 * Math.sqrt(power));
      for (let i = 0; i < 12 * power; i++) {
        const a = Math.random() * Math.PI * 2, s = rnd(40, 150) * Math.sqrt(power);
        this.parts.push({
          x, y, alt, vx: Math.cos(a) * s, vy: Math.sin(a) * s, va: rnd(60, 220),
          life: rnd(0.8, 1.6), max: 1.6, color: pick([pal[0], pal[2], '#475569']), size: rnd(2, 4.5),
          glow: false, rot: Math.random() * 6, vr: rnd(-12, 12)
        });
      }
      for (let i = 0; i < 6 * power; i++) this.smoke.push(this.puff(x + rnd(-8, 8), y + rnd(-6, 6), alt, rnd(0.9, 1.6), '51,65,85'));
      this.lights.push({ x, y, r: 110 * power, rgb: '251,191,36', life: 0.45, max: 0.45, alt });
      if (alt < 40) {
        this.rings.push({ x, y, r: 4, max: 70 * power, life: 0.55, maxLife: 0.55, rgb: '251,191,36' });
        this.decals.push({ x, y, r: 16 * power, life: 7, max: 7 });
      }
      this.shake = Math.max(this.shake, 6 * power);
    }

    update(dt, g) {
      this.t += dt;
      const target = g.player.alive ? (g.player.x - W / 2) * 0.22 : this.camX;
      this.camX += (target - this.camX) * Math.min(1, dt * 3);

      for (const p of this.parts) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.alt += p.va * dt;
        p.va -= 420 * dt;
        if (p.alt < 0) { p.alt = 0; p.va *= -0.35; p.vx *= 0.6; p.vy *= 0.6; }
        if (p.rot !== undefined) p.rot += p.vr * dt;
        p.life -= dt;
      }
      this.parts = this.parts.filter(p => p.life > 0);
      for (const s of this.smoke) { s.alt += s.va * dt; s.x += s.vx * dt; s.r += s.grow * dt; s.life -= dt; }
      this.smoke = this.smoke.filter(s => s.life > 0);
      for (const r of this.rings) { r.life -= dt; r.r = lerp(r.max, 4, r.life / r.maxLife); }
      this.rings = this.rings.filter(r => r.life > 0);
      for (const l of this.lights) l.life -= dt;
      this.lights = this.lights.filter(l => l.life > 0);
      for (const p of this.popups) { p.life -= dt; p.alt += 30 * dt; }
      this.popups = this.popups.filter(p => p.life > 0);
      for (const d of this.decals) d.life -= dt;
      this.decals = this.decals.filter(d => d.life > 0);
      if (this.decals.length > 40) this.decals.splice(0, this.decals.length - 40);
      this.shake = Math.max(0, this.shake - dt * 30);
      if (this.flash > 0) this.flash -= dt;
    }

    /* ---------------- primitives ---------------- */

    poly(pts, fill) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    }

    ellipse(x, y, rx, ry, fill) {
      const c = this.ctx;
      c.beginPath();
      c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
      c.fillStyle = fill;
      c.fill();
    }

    box(x, y, hw, hd, a0, a1, top, front, side) {
      const P = (xx, yy, aa) => this.proj(xx, yy, aa);
      const x0 = x - hw, x1 = x + hw, yF = y - hd, yN = y + hd;
      const tFL = P(x0, yN, a1), tFR = P(x1, yN, a1), tBL = P(x0, yF, a1), tBR = P(x1, yF, a1);
      const bFL = P(x0, yN, a0), bFR = P(x1, yN, a0), bBL = P(x0, yF, a0), bBR = P(x1, yF, a0);
      const camWX = W / 2 + this.camX;
      if (x0 > camWX) this.poly([tFL, tBL, bBL, bFL], side);
      if (x1 < camWX) this.poly([tFR, tBR, bBR, bFR], side);
      this.poly([tFL, tFR, bFR, bFL], front);
      this.poly([tFL, tFR, tBR, tBL], top);
    }

    floorLight(x, y, r, rgb, alpha) {
      const c = this.ctx, P = this.proj(x, y, 0), sq = this.floorSquash(x, y), rad = r * P.s;
      if (rad < 0.5) return;
      c.save();
      c.translate(P.x, P.y);
      c.scale(1, sq);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, rad, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    shadow(x, y, r, alt) {
      const P = this.proj(x, y, 0), sq = this.floorSquash(x, y);
      const a = 0.5 * clamp(1 - alt / 220, 0.15, 1);
      const rx = r * P.s * (1 + alt / 260);
      const c = this.ctx;
      c.save();
      c.translate(P.x, P.y);
      c.scale(1, sq);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(0,0,0,' + a + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    /* ---------------- scene: floor ---------------- */

    drawFloor(g) {
      const c = this.ctx, u = this.ui, hz = this.horizon;
      const fg = c.createLinearGradient(0, hz, 0, this.h);
      fg.addColorStop(0, '#0b1d2c');
      fg.addColorStop(0.25, '#08141f');
      fg.addColorStop(1, '#0b1824');
      c.fillStyle = fg;
      c.fillRect(0, hz, this.w, this.h - hz);

      c.lineWidth = Math.max(1, u * 1.1);
      const yFar = -1100, yNear = GROUND_Y + 170;
      for (let x = -880; x <= W + 880; x += 40) {
        const a = this.proj(x, yFar, 0), b = this.proj(x, yNear, 0);
        const inField = x >= 0 && x <= W;
        const gr = c.createLinearGradient(a.x, a.y, b.x, b.y);
        gr.addColorStop(0, 'rgba(45,212,191,0)');
        gr.addColorStop(1, inField ? 'rgba(45,212,191,0.22)' : 'rgba(45,212,191,0.08)');
        c.strokeStyle = gr;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
      for (let y = yNear; y >= yFar; y -= 40) {
        const a = this.proj(-880, y, 0), b = this.proj(W + 880, y, 0);
        const fade = clamp((y - yFar) / (yNear - yFar), 0, 1);
        c.strokeStyle = 'rgba(45,212,191,' + (0.03 + fade * fade * 0.14).toFixed(3) + ')';
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }

      // Patrol lanes
      c.setLineDash([8 * u, 10 * u]);
      for (const ry of ROWS) {
        const a = this.proj(6, ry, 0), b = this.proj(W - 6, ry, 0);
        c.strokeStyle = 'rgba(148,163,184,0.10)';
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
      c.setLineDash([]);

      // Player track
      const t0 = GROUND_Y - 18, t1 = GROUND_Y + 18;
      const q = [this.proj(0, t0, 0), this.proj(W, t0, 0), this.proj(W, t1, 0), this.proj(0, t1, 0)];
      const tg = c.createLinearGradient(0, q[0].y, 0, q[2].y);
      tg.addColorStop(0, 'rgba(20,184,166,0.05)');
      tg.addColorStop(1, 'rgba(20,184,166,0.16)');
      this.poly(q, tg);
      c.strokeStyle = 'rgba(94,234,212,0.45)';
      c.lineWidth = Math.max(1, u * 1.5);
      c.beginPath(); c.moveTo(q[0].x, q[0].y); c.lineTo(q[1].x, q[1].y); c.stroke();
      c.beginPath(); c.moveTo(q[3].x, q[3].y); c.lineTo(q[2].x, q[2].y); c.stroke();

      // Field rails with travelling pulses
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const rx of [0, W]) {
        const a = this.proj(rx, MOTHER_Y - 60, 0), b = this.proj(rx, GROUND_Y + 40, 0);
        c.strokeStyle = 'rgba(45,212,191,0.55)';
        c.lineWidth = Math.max(1.5, u * 2.2);
        c.shadowColor = 'rgba(45,212,191,0.9)';
        c.shadowBlur = 10 * u;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        c.shadowBlur = 0;
        for (let k = 0; k < 3; k++) {
          const ph = ((this.t * 0.35 + k / 3) % 1);
          const py = lerp(MOTHER_Y - 60, GROUND_Y + 40, ph);
          const P = this.proj(rx, py, 0);
          const rr = Math.max(1.5, 5 * P.s);
          const gg = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr * 3);
          gg.addColorStop(0, 'rgba(204,251,241,0.9)');
          gg.addColorStop(1, 'rgba(45,212,191,0)');
          c.fillStyle = gg;
          c.beginPath(); c.arc(P.x, P.y, rr * 3, 0, Math.PI * 2); c.fill();
        }
      }
      c.restore();

      // Scorch decals
      for (const d of this.decals) {
        const P = this.proj(d.x, d.y, 0), sq = this.floorSquash(d.x, d.y);
        c.save();
        c.translate(P.x, P.y); c.scale(1, sq);
        const a = 0.45 * clamp(d.life / d.max * 2, 0, 1);
        const gd = c.createRadialGradient(0, 0, 0, 0, 0, d.r * P.s);
        gd.addColorStop(0, 'rgba(2,6,12,' + a + ')');
        gd.addColorStop(1, 'rgba(2,6,12,0)');
        c.fillStyle = gd;
        c.beginPath(); c.arc(0, 0, d.r * P.s, 0, Math.PI * 2); c.fill();
        c.restore();
      }

      // Horizon haze
      const fog = c.createLinearGradient(0, hz, 0, hz + this.h * 0.14);
      fog.addColorStop(0, 'rgba(15,42,64,0.95)');
      fog.addColorStop(1, 'rgba(15,42,64,0)');
      c.fillStyle = fog;
      c.fillRect(0, hz - 1, this.w, this.h * 0.14 + 1);
    }

    drawFloorLights(g) {
      const c = this.ctx;
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const l of this.lights) this.floorLight(l.x, l.y, l.r, l.rgb, 0.55 * (l.life / l.max));
      for (const s of g.shots) this.floorLight(s.x, s.y, 34, '103,232,249', 0.22);
      for (const b of g.bullets) this.floorLight(b.x, b.y, 30, b.kind === 'missile' ? '251,146,60' : '248,113,113', 0.2);
      if (g.mother.bay > 0) this.floorLight(g.mother.x, ROWS[0] - 30, 90, '45,212,191', 0.3 * g.mother.bay);
      if (g.player.alive) this.floorLight(g.player.x, g.player.y, 60, '45,212,191', 0.12 + g.heat / 100 * 0.1);
      for (const r of this.rings) {
        const P = this.proj(r.x, r.y, 0), sq = this.floorSquash(r.x, r.y);
        c.save();
        c.translate(P.x, P.y); c.scale(1, sq);
        c.strokeStyle = 'rgba(' + r.rgb + ',' + (0.8 * r.life / r.maxLife).toFixed(3) + ')';
        c.lineWidth = Math.max(1, 3 * P.s * 3);
        c.beginPath(); c.arc(0, 0, r.r * P.s, 0, Math.PI * 2); c.stroke();
        c.restore();
      }
      c.restore();
    }

    /* ---------------- scene: actors ---------------- */

    drawMother(g) {
      const c = this.ctx, m = g.mother, t = this.t;
      const P = this.proj(m.x, m.y, MOTHER_ALT), s = P.s;
      const r = 82 * s, ry = r * 0.3;

      if (m.bay > 0) {
        const B = this.proj(m.x, ROWS[0], altFly(ROWS[0]));
        c.save();
        c.globalCompositeOperation = 'lighter';
        const bg = c.createLinearGradient(0, P.y, 0, B.y);
        bg.addColorStop(0, 'rgba(94,234,212,' + (0.45 * m.bay).toFixed(3) + ')');
        bg.addColorStop(1, 'rgba(94,234,212,0)');
        c.fillStyle = bg;
        c.beginPath();
        c.moveTo(P.x - r * 0.16, P.y + ry * 0.6);
        c.lineTo(P.x + r * 0.16, P.y + ry * 0.6);
        c.lineTo(B.x + 26 * B.s, B.y);
        c.lineTo(B.x - 26 * B.s, B.y);
        c.closePath();
        c.fill();
        c.restore();
      }

      // Engine glow beneath the hull
      c.save();
      c.globalCompositeOperation = 'lighter';
      const eg = c.createRadialGradient(P.x, P.y + ry * 0.8, 0, P.x, P.y + ry * 0.8, r * 0.9);
      eg.addColorStop(0, 'rgba(45,212,191,0.35)');
      eg.addColorStop(1, 'rgba(45,212,191,0)');
      c.fillStyle = eg;
      c.beginPath(); c.ellipse(P.x, P.y + ry * 0.8, r * 0.9, ry * 1.2, 0, 0, Math.PI * 2); c.fill();
      c.restore();

      // Lower hull
      const lg = c.createLinearGradient(0, P.y, 0, P.y + ry * 1.4);
      lg.addColorStop(0, '#334155'); lg.addColorStop(1, '#0f172a');
      this.ellipse(P.x, P.y + ry * 0.45, r * 0.9, ry * 0.95, lg);

      // Main disc
      const dg = c.createLinearGradient(0, P.y - ry, 0, P.y + ry);
      dg.addColorStop(0, '#cbd5e1'); dg.addColorStop(0.45, '#64748b'); dg.addColorStop(1, '#1e293b');
      this.ellipse(P.x, P.y, r, ry, dg);
      c.strokeStyle = 'rgba(15,23,42,0.55)';
      c.lineWidth = Math.max(1, s * 1.5);
      for (const k of [0.82, 0.64]) { c.beginPath(); c.ellipse(P.x, P.y - ry * 0.05, r * k, ry * k, 0, 0, Math.PI * 2); c.stroke(); }
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        c.beginPath();
        c.moveTo(P.x + Math.cos(a) * r * 0.64, P.y - ry * 0.05 + Math.sin(a) * ry * 0.64);
        c.lineTo(P.x + Math.cos(a) * r * 0.98, P.y + Math.sin(a) * ry * 0.98);
        c.stroke();
      }

      // Rim lights
      const N = 20;
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2 + t * 0.7;
        const sn = Math.sin(a);
        const lx = P.x + Math.cos(a) * r * 0.97, ly = P.y + sn * ry * 0.97;
        const on = (i + Math.floor(t * 6)) % 4 === 0;
        const col = i % 2 ? '251,191,36' : '94,234,212';
        const alpha = (sn > 0 ? 1 : 0.35) * (on ? 1 : 0.45);
        const lr = Math.max(1, s * (on ? 5 : 3));
        const gl = c.createRadialGradient(lx, ly, 0, lx, ly, lr * 2.5);
        gl.addColorStop(0, 'rgba(' + col + ',' + alpha + ')');
        gl.addColorStop(1, 'rgba(' + col + ',0)');
        c.fillStyle = gl;
        c.beginPath(); c.arc(lx, ly, lr * 2.5, 0, Math.PI * 2); c.fill();
      }
      c.restore();

      // Upper deck
      const ug = c.createLinearGradient(0, P.y - ry * 1.2, 0, P.y);
      ug.addColorStop(0, '#e2e8f0'); ug.addColorStop(1, '#475569');
      this.ellipse(P.x, P.y - ry * 0.5, r * 0.52, ry * 0.55, ug);
      // Command dome
      const dr = r * 0.22;
      const cg = c.createRadialGradient(P.x - dr * 0.35, P.y - ry * 0.9 - dr * 0.4, dr * 0.05, P.x, P.y - ry * 0.75, dr);
      cg.addColorStop(0, '#f0fdfa'); cg.addColorStop(0.4, 'rgba(45,212,191,0.85)'); cg.addColorStop(1, 'rgba(15,23,42,0.95)');
      c.fillStyle = cg;
      c.beginPath(); c.ellipse(P.x, P.y - ry * 0.65, dr, dr * 0.7, 0, Math.PI, Math.PI * 2); c.fill();
      // Beacon
      if (Math.floor(t * 2) % 2 === 0) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        const by = P.y - ry * 0.65 - dr * 0.75;
        const bgr = c.createRadialGradient(P.x, by, 0, P.x, by, s * 14);
        bgr.addColorStop(0, 'rgba(248,113,113,1)'); bgr.addColorStop(1, 'rgba(248,113,113,0)');
        c.fillStyle = bgr;
        c.beginPath(); c.arc(P.x, by, s * 14, 0, Math.PI * 2); c.fill();
        c.restore();
      }
      // Launch bay
      c.save();
      c.globalCompositeOperation = 'lighter';
      const bay = 0.25 + m.bay * 0.75;
      const lb = c.createRadialGradient(P.x, P.y + ry * 0.85, 0, P.x, P.y + ry * 0.85, r * 0.2);
      lb.addColorStop(0, 'rgba(204,251,241,' + bay + ')'); lb.addColorStop(1, 'rgba(45,212,191,0)');
      c.fillStyle = lb;
      c.beginPath(); c.ellipse(P.x, P.y + ry * 0.85, r * 0.2, ry * 0.4, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    drawSaucer(P, r, pal, seed, opts) {
      const c = this.ctx, t = this.t, x = P.x, y = P.y;
      const ry = r * 0.36;
      opts = opts || {};

      if (opts.gun) {
        c.strokeStyle = '#1f2937';
        c.lineWidth = Math.max(1.5, r * 0.18);
        c.beginPath(); c.moveTo(x, y + ry * 0.5); c.lineTo(x, y + ry * 1.8); c.stroke();
        c.strokeStyle = pal[0];
        c.lineWidth = Math.max(1, r * 0.08);
        c.beginPath(); c.moveTo(x, y + ry * 1.4); c.lineTo(x, y + ry * 1.8); c.stroke();
      }
      // Underside
      const lg = c.createLinearGradient(0, y, 0, y + ry * 1.3);
      lg.addColorStop(0, pal[2]); lg.addColorStop(1, '#0b1220');
      this.ellipse(x, y + ry * 0.4, r * 0.82, ry * 0.9, lg);
      // Glow ring underneath
      c.save();
      c.globalCompositeOperation = 'lighter';
      const ug = c.createRadialGradient(x, y + ry * 0.7, 0, x, y + ry * 0.7, r * 0.7);
      ug.addColorStop(0, 'rgba(255,255,255,0.25)'); ug.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = ug;
      c.beginPath(); c.ellipse(x, y + ry * 0.7, r * 0.7, ry * 0.8, 0, 0, Math.PI * 2); c.fill();
      c.restore();
      // Disc
      const dg = c.createLinearGradient(0, y - ry, 0, y + ry);
      dg.addColorStop(0, opts.flash ? '#ffffff' : pal[1]);
      dg.addColorStop(0.5, opts.flash ? '#ffffff' : pal[0]);
      dg.addColorStop(1, pal[2]);
      this.ellipse(x, y, r, ry, dg);
      // Dome
      const dr = r * 0.46;
      const gg = c.createRadialGradient(x - dr * 0.3, y - ry * 0.3 - dr * 0.55, dr * 0.05, x, y - ry * 0.2, dr);
      gg.addColorStop(0, '#f0f9ff'); gg.addColorStop(0.45, 'rgba(56,189,248,0.75)'); gg.addColorStop(1, 'rgba(8,20,36,0.95)');
      c.fillStyle = gg;
      c.beginPath(); c.ellipse(x, y - ry * 0.15, dr, dr * 0.78, 0, Math.PI, Math.PI * 2); c.closePath(); c.fill();
      // Rim lights
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        const a = t * 2.4 + seed + i / 8 * Math.PI * 2, sn = Math.sin(a);
        if (sn < -0.2) continue;
        const lx = x + Math.cos(a) * r * 0.8, ly = y + sn * ry * 0.65;
        c.fillStyle = i % 2 ? 'rgba(255,255,255,0.95)' : 'rgba(253,230,138,0.95)';
        c.beginPath(); c.arc(lx, ly, Math.max(0.8, r * 0.07), 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }

    drawDiver(e, alt) {
      const P = (xx, yy, aa) => this.proj(xx, yy, aa);
      const pal = PAL.diver, x = e.x, y = e.y, fl = e.hitFlash > 0;
      const bank = clamp(e.vx / 200, -0.6, 0.6) * 6;
      const nose = P(x, y + 19, alt - 2), lw = P(x - 18, y - 12, alt + 1 - bank), rw = P(x + 18, y - 12, alt + 1 + bank);
      const top = P(x, y - 6, alt + 10), tail = P(x, y - 14, alt + 4);
      this.poly([lw, tail, rw, top], pal[2]);
      this.poly([nose, lw, top], fl ? '#ffffff' : pal[1]);
      this.poly([nose, top, rw], fl ? '#ffffff' : pal[0]);
      const c = this.ctx;
      c.save();
      c.globalCompositeOperation = 'lighter';
      const rr = Math.max(2, 7 * tail.s);
      const eg = c.createRadialGradient(tail.x, tail.y, 0, tail.x, tail.y, rr * 2);
      eg.addColorStop(0, 'rgba(187,247,208,0.95)'); eg.addColorStop(1, 'rgba(34,197,94,0)');
      c.fillStyle = eg;
      c.beginPath(); c.arc(tail.x, tail.y, rr * 2, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    drawCrawler(e) {
      const c = this.ctx, pal = PAL[e.type], t = e.t;
      const body = this.proj(e.x, e.y, 9), s = body.s;
      c.strokeStyle = '#0f172a';
      c.lineWidth = Math.max(1, 2.4 * s);
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const ph = Math.sin(t * 14 + k * 2.1 + (side > 0 ? 1.5 : 0));
          const knee = this.proj(e.x + side * (9 + k * 2), e.y + (k - 1) * 7, 13 + ph * 2);
          const foot = this.proj(e.x + side * (15 + k * 2), e.y + (k - 1) * 9 + ph * 3, 0);
          c.beginPath(); c.moveTo(body.x, body.y); c.lineTo(knee.x, knee.y); c.lineTo(foot.x, foot.y); c.stroke();
        }
      }
      const r = (e.w / 2 + 3) * s;
      const bg = c.createRadialGradient(body.x - r * 0.3, body.y - r * 0.5, r * 0.1, body.x, body.y, r);
      bg.addColorStop(0, e.hitFlash > 0 ? '#ffffff' : pal[1]); bg.addColorStop(0.5, pal[0]); bg.addColorStop(1, pal[2]);
      c.fillStyle = bg;
      c.beginPath(); c.ellipse(body.x, body.y, r, r * 0.7, 0, Math.PI, Math.PI * 2); c.closePath(); c.fill();
      this.ellipse(body.x, body.y, r, r * 0.22, pal[2]);
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const dx of [-0.35, 0.35]) {
        const ex = body.x + dx * r, ey = body.y - r * 0.18;
        const eg = c.createRadialGradient(ex, ey, 0, ex, ey, r * 0.3);
        eg.addColorStop(0, 'rgba(254,202,202,1)'); eg.addColorStop(1, 'rgba(239,68,68,0)');
        c.fillStyle = eg;
        c.beginPath(); c.arc(ex, ey, r * 0.3, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }

    drawEnemy(e) {
      const alt = enemyAlt(e);
      if (e.state === 'crawl') { this.drawCrawler(e); return; }
      if (e.type === 'diver') { this.drawDiver(e, alt); return; }
      const P = this.proj(e.x, e.y, alt);
      const pal = PAL[e.type], fl = e.hitFlash > 0;
      if (e.type === 'splitter') {
        const off = 12;
        const L = this.proj(e.x - off, e.y, alt), R = this.proj(e.x + off, e.y, alt);
        const c = this.ctx;
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(94,234,212,' + (0.5 + 0.3 * Math.sin(this.t * 10)).toFixed(2) + ')';
        c.lineWidth = Math.max(1.5, 3 * P.s);
        c.beginPath(); c.moveTo(L.x, L.y); c.lineTo(R.x, R.y); c.stroke();
        c.restore();
        this.drawSaucer(L, 13 * L.s, pal, e.id, { flash: fl });
        this.drawSaucer(R, 13 * R.s, pal, e.id + 2, { flash: fl });
        return;
      }
      const r = (e.w / 2 + 2) * P.s * 1.3;
      this.drawSaucer(P, r, pal, e.id, { flash: fl, gun: e.type === 'gunner' });
      if (e.type === 'gunner' && e.hp < 2 && Math.random() < 0.3) {
        this.smoke.push(this.puff(e.x + rnd(-6, 6), e.y, alt + 4, 0.6, '71,85,105'));
      }
    }

    drawPlayer(g) {
      const p = g.player, c = this.ctx;
      if (!p.alive) return;
      c.save();
      if (p.invuln > 0 && Math.floor(this.t * 12) % 2) c.globalAlpha = 0.45;
      const x = p.x, y = p.y;
      const heat = g.heat / 100;

      this.box(x - 15, y, 6, 14, 0, 7, '#334155', '#1e293b', '#111827');
      this.box(x + 15, y, 6, 14, 0, 7, '#334155', '#1e293b', '#111827');
      // Tread ribs
      c.strokeStyle = 'rgba(15,23,42,0.85)';
      c.lineWidth = Math.max(1, this.proj(x, y, 7).s * 1.2);
      const roll = (this.t * (p.vx / 30)) % 1;
      for (const tx of [x - 15, x + 15]) {
        for (let k = 0; k < 5; k++) {
          const yy = y - 14 + ((k + roll + 5) % 5) / 5 * 28;
          const a = this.proj(tx - 6, yy, 7), b = this.proj(tx + 6, yy, 7);
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        }
      }
      this.box(x, y, 13, 11, 4, 12, '#64748b', '#475569', '#334155');

      // Accent strip
      const a1 = this.proj(x - 11, y + 11, 8.5), a2 = this.proj(x + 11, y + 11, 8.5);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = 'rgba(94,234,212,0.95)';
      c.lineWidth = Math.max(1.2, 2 * a1.s * 1.5);
      c.shadowColor = '#2dd4bf';
      c.shadowBlur = 8 * this.ui;
      c.beginPath(); c.moveTo(a1.x, a1.y); c.lineTo(a2.x, a2.y); c.stroke();
      c.restore();

      const recoil = p.recoil * 5;
      const base = this.proj(x, y, 17);
      let end;
      if (p.aim === 'up') end = this.proj(x, y - 26 + recoil, 21);
      else if (p.aim === 'left') end = this.proj(x - 28 + recoil, y, 18);
      else end = this.proj(x + 28 - recoil, y, 18);

      const drawBarrel = () => {
        c.save();
        c.lineCap = 'round';
        c.strokeStyle = '#1e293b';
        c.lineWidth = Math.max(2, 6 * base.s);
        c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(end.x, end.y); c.stroke();
        c.strokeStyle = mix('#94a3b8', '#fb923c', heat);
        c.lineWidth = Math.max(1, 3.4 * base.s);
        if (heat > 0.5) { c.shadowColor = 'rgba(249,115,22,' + (heat - 0.5) * 2 + ')'; c.shadowBlur = 14 * this.ui * heat; }
        c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(end.x, end.y); c.stroke();
        c.restore();
      };

      if (p.aim === 'up') drawBarrel();
      this.box(x, y + 1, 8, 7, 12, 17, '#94a3b8', '#64748b', '#475569');
      const dome = this.proj(x, y + 1, 17);
      const dr = 6 * dome.s;
      const dg = c.createRadialGradient(dome.x - dr * 0.3, dome.y - dr * 0.6, dr * 0.1, dome.x, dome.y, dr);
      dg.addColorStop(0, '#f0fdfa'); dg.addColorStop(0.5, '#2dd4bf'); dg.addColorStop(1, '#134e4a');
      c.fillStyle = dg;
      c.beginPath(); c.ellipse(dome.x, dome.y, dr, dr * 0.75, 0, Math.PI, Math.PI * 2); c.closePath(); c.fill();
      if (p.aim !== 'up') drawBarrel();

      if (heat > 0.6 && Math.random() < heat * 0.25) {
        this.smoke.push(this.puff(x + rnd(-3, 3), y, 24, 0.8, '100,116,139'));
      }

      if (p.invuln > 0) {
        const P = this.proj(x, y, 12);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'lighter';
        const rr = 30 * P.s;
        const sg = c.createRadialGradient(P.x, P.y, rr * 0.6, P.x, P.y, rr);
        sg.addColorStop(0, 'rgba(45,212,191,0)');
        sg.addColorStop(1, 'rgba(45,212,191,' + (0.35 + 0.15 * Math.sin(this.t * 12)).toFixed(2) + ')');
        c.fillStyle = sg;
        c.beginPath(); c.ellipse(P.x, P.y, rr, rr * 0.8, 0, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }

    drawShot(s) {
      const c = this.ctx;
      let head, tail;
      if (s.dir === 'up') {
        head = this.proj(s.x, s.y, altFly(s.y) * 0.5 + 12);
        tail = this.proj(s.x, s.y + 34, altFly(s.y + 34) * 0.5 + 12);
      } else {
        head = this.proj(s.x, s.y, 16);
        tail = this.proj(s.x - Math.sign(s.vx) * 34, s.y, 16);
      }
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      const gr = c.createLinearGradient(tail.x, tail.y, head.x, head.y);
      gr.addColorStop(0, 'rgba(34,211,238,0)');
      gr.addColorStop(1, 'rgba(103,232,249,0.95)');
      c.strokeStyle = gr;
      c.lineWidth = Math.max(2.5, 7 * head.s);
      c.shadowColor = '#22d3ee';
      c.shadowBlur = 16 * this.ui;
      c.beginPath(); c.moveTo(tail.x, tail.y); c.lineTo(head.x, head.y); c.stroke();
      c.shadowBlur = 0;
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = Math.max(1, 2.5 * head.s);
      c.beginPath(); c.moveTo(lerp(tail.x, head.x, 0.5), lerp(tail.y, head.y, 0.5)); c.lineTo(head.x, head.y); c.stroke();
      c.restore();
    }

    drawBullet(b) {
      const c = this.ctx;
      const P = this.proj(b.x, b.y, altFly(b.y));
      const back = 0.07;
      const T = this.proj(b.x - b.vx * back, b.y - b.vy * back, altFly(b.y - b.vy * back));
      const missile = b.kind === 'missile';
      const rgb = missile ? '251,146,60' : '248,113,113';
      const r = Math.max(2, (missile ? 6 : 5.5) * P.s);
      c.save();
      c.globalCompositeOperation = 'lighter';
      const tg = c.createLinearGradient(T.x, T.y, P.x, P.y);
      tg.addColorStop(0, 'rgba(' + rgb + ',0)');
      tg.addColorStop(1, 'rgba(' + rgb + ',0.7)');
      c.strokeStyle = tg;
      c.lineWidth = r * 1.2;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(T.x, T.y); c.lineTo(P.x, P.y); c.stroke();
      const gg = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, r * 2.6);
      gg.addColorStop(0, 'rgba(255,255,255,1)');
      gg.addColorStop(0.3, 'rgba(' + rgb + ',0.95)');
      gg.addColorStop(1, 'rgba(' + rgb + ',0)');
      c.fillStyle = gg;
      c.beginPath(); c.arc(P.x, P.y, r * 2.6, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    drawParticles() {
      const c = this.ctx;
      // Smoke (normal blend)
      for (const s of this.smoke) {
        const P = this.proj(s.x, s.y, s.alt), k = s.life / s.max;
        const rr = s.r * P.s;
        const g = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr);
        g.addColorStop(0, 'rgba(' + s.rgb + ',' + (0.4 * k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + s.rgb + ',0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(P.x, P.y, rr, 0, Math.PI * 2); c.fill();
      }
      // Debris
      for (const p of this.parts) {
        if (p.glow) continue;
        const P = this.proj(p.x, p.y, p.alt), sz = p.size * P.s;
        c.save();
        c.globalAlpha = clamp(p.life / 0.4, 0, 1);
        c.translate(P.x, P.y); c.rotate(p.rot);
        c.fillStyle = p.color;
        c.fillRect(-sz, -sz * 0.6, sz * 2, sz * 1.2);
        c.restore();
      }
      // Sparks (additive streaks)
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      for (const p of this.parts) {
        if (!p.glow) continue;
        const P = this.proj(p.x, p.y, p.alt);
        const Q = this.proj(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.alt - p.va * 0.03);
        c.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
        c.strokeStyle = p.color;
        c.lineWidth = Math.max(1, p.size * P.s * 2.2);
        c.beginPath(); c.moveTo(Q.x, Q.y); c.lineTo(P.x, P.y); c.stroke();
      }
      // Air-burst flashes
      for (const l of this.lights) {
        if (!l.alt) continue;
        const P = this.proj(l.x, l.y, l.alt), k = l.life / l.max;
        const rr = l.r * 0.5 * P.s * (1.4 - k * 0.4);
        const g = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr);
        g.addColorStop(0, 'rgba(255,255,255,' + (0.9 * k).toFixed(3) + ')');
        g.addColorStop(0.35, 'rgba(' + l.rgb + ',' + (0.6 * k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + l.rgb + ',0)');
        c.globalAlpha = 1;
        c.fillStyle = g;
        c.beginPath(); c.arc(P.x, P.y, rr, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }

    drawPopups() {
      const c = this.ctx, u = this.ui;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const p of this.popups) {
        const P = this.proj(p.x, p.y, p.alt);
        c.globalAlpha = clamp(p.life / p.max * 2, 0, 1);
        c.font = '700 ' + Math.round(15 * u) + 'px Rajdhani, "Segoe UI", sans-serif';
        c.fillStyle = p.color || '#fde68a';
        c.shadowColor = 'rgba(0,0,0,0.8)';
        c.shadowBlur = 6 * u;
        c.fillText(p.text, P.x, P.y);
      }
      c.restore();
    }

    /* ---------------- HUD ---------------- */

    panel(x, y, w, h) {
      const c = this.ctx;
      global.roundRectPath(c, x, y, w, h, 10 * this.ui);
      c.fillStyle = 'rgba(15,23,42,0.62)';
      c.fill();
      c.strokeStyle = 'rgba(148,163,184,0.16)';
      c.lineWidth = Math.max(1, this.ui);
      c.stroke();
    }

    label(text, x, y, align, color) {
      const c = this.ctx, u = this.ui;
      c.textAlign = align;
      c.font = '600 ' + Math.round(12 * u) + 'px Rajdhani, "Segoe UI", sans-serif';
      c.fillStyle = color || '#94a3b8';
      c.fillText(text.split('').join(String.fromCharCode(8202)), x, y);
    }

    drawHUD(g) {
      const c = this.ctx, u = this.ui, w = this.w, h = this.h, pad = 18 * u, t = this.t;
      c.save();
      c.textBaseline = 'alphabetic';

      // Top: score / hi / wave
      const pw = 200 * u, ph = 58 * u;
      this.panel(pad, pad, pw, ph);
      this.label('SCORE', pad + 16 * u, pad + 20 * u, 'left');
      c.font = '700 ' + Math.round(26 * u) + 'px Orbitron, "Segoe UI", sans-serif';
      c.fillStyle = '#f8fafc';
      c.textAlign = 'left';
      c.fillText(String(g.score).padStart(7, '0'), pad + 16 * u, pad + 48 * u);

      this.panel(w / 2 - pw / 2, pad, pw, ph);
      this.label('HIGH SCORE', w / 2, pad + 20 * u, 'center');
      c.font = '700 ' + Math.round(26 * u) + 'px Orbitron, "Segoe UI", sans-serif';
      c.fillStyle = '#fbbf24';
      c.textAlign = 'center';
      c.fillText(String(Math.max(g.hiScore, g.score)).padStart(7, '0'), w / 2, pad + 48 * u);

      const ww = 130 * u;
      this.panel(w - pad - ww, pad, ww, ph);
      this.label('WAVE', w - pad - 16 * u, pad + 20 * u, 'right');
      c.font = '700 ' + Math.round(26 * u) + 'px Orbitron, "Segoe UI", sans-serif';
      c.fillStyle = '#5eead4';
      c.textAlign = 'right';
      c.fillText(String(g.wave).padStart(2, '0'), w - pad - 16 * u, pad + 48 * u);

      // Bottom-left: lives
      const bh = 62 * u, by = h - pad - bh;
      this.panel(pad, by, 200 * u, bh);
      this.label('RESERVE CANNONS', pad + 16 * u, by + 20 * u, 'left');
      for (let i = 0; i < Math.min(g.lives, 6); i++) {
        const ix = pad + 26 * u + i * 28 * u, iy = by + 42 * u;
        c.fillStyle = '#64748b';
        c.fillRect(ix - 10 * u, iy, 20 * u, 7 * u);
        c.fillStyle = '#2dd4bf';
        c.beginPath(); c.ellipse(ix, iy, 6 * u, 5 * u, 0, Math.PI, Math.PI * 2); c.fill();
        c.fillStyle = '#94a3b8';
        c.fillRect(ix - 1.2 * u, iy - 11 * u, 2.4 * u, 7 * u);
      }

      // Bottom-right: hostiles remaining
      const left = Math.max(0, g.quota - g.kills);
      this.panel(w - pad - 200 * u, by, 200 * u, bh);
      this.label('HOSTILES', w - pad - 16 * u, by + 20 * u, 'right');
      c.font = '700 ' + Math.round(22 * u) + 'px Orbitron, "Segoe UI", sans-serif';
      c.fillStyle = '#f8fafc';
      c.textAlign = 'right';
      c.fillText(String(left).padStart(2, '0'), w - pad - 16 * u, by + 48 * u);
      const pipW = 4 * u, pipGap = 2.5 * u;
      for (let i = 0; i < g.quota; i++) {
        const row = i < 12 ? 0 : 1, col = i % 12;
        c.fillStyle = i < g.kills ? 'rgba(148,163,184,0.18)' : '#f59e0b';
        c.fillRect(w - pad - 184 * u + col * (pipW + pipGap), by + 32 * u + row * 10 * u, pipW, 7 * u);
      }

      // Bottom-centre: cannon heat
      const hw = Math.min(420 * u, w - 2 * (pad + 220 * u)), hx = (w - hw) / 2;
      if (hw > 120 * u) {
        this.panel(hx - 16 * u, by, hw + 32 * u, bh);
        const hot = g.heat >= HEAT_WARN;
        this.label('CANNON HEAT', hx, by + 20 * u, 'left', hot && Math.floor(t * 6) % 2 ? '#f87171' : '#94a3b8');
        this.label(Math.round(g.heat) + '%', hx + hw, by + 20 * u, 'right', hot ? '#f87171' : '#cbd5e1');
        const segs = 25, gap = 3 * u, sw = (hw - gap * (segs - 1)) / segs, sy = by + 32 * u, sh = 16 * u;
        for (let i = 0; i < segs; i++) {
          const k = i / (segs - 1);
          const on = (i + 1) / segs * 100 <= g.heat + 2;
          const col = k < 0.55 ? '#2dd4bf' : k < 0.78 ? '#f59e0b' : '#ef4444';
          c.fillStyle = on ? col : 'rgba(148,163,184,0.12)';
          if (on) { c.shadowColor = col; c.shadowBlur = 8 * u; } else c.shadowBlur = 0;
          c.fillRect(hx + i * (sw + gap), sy, sw, sh);
        }
        c.shadowBlur = 0;
        if (hot) {
          c.strokeStyle = 'rgba(239,68,68,' + (0.5 + 0.5 * Math.sin(t * 14)).toFixed(2) + ')';
          c.lineWidth = 2 * u;
          global.roundRectPath(c, hx - 16 * u, by, hw + 32 * u, bh, 10 * u);
          c.stroke();
        }
      }
      c.restore();
    }

    drawMessage(g) {
      const m = g.message;
      if (!m) return;
      const c = this.ctx, u = this.ui;
      const kin = clamp(m.t / 0.3, 0, 1), kout = m.dur > 100 ? 1 : clamp((m.dur - m.t) / 0.4, 0, 1);
      const a = Math.min(kin, kout);
      const sc = 0.85 + 0.15 * (1 - Math.pow(1 - kin, 3));
      c.save();
      c.globalAlpha = a;
      c.translate(this.w / 2, this.h * 0.42);
      c.scale(sc, sc);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const size = Math.round(Math.min(58 * u, this.w / (m.text.length * 0.9)));
      c.font = '800 ' + size + 'px Orbitron, "Segoe UI", sans-serif';
      c.shadowColor = m.text.indexOf('OVERHEAT') === 0 || m.text === 'GAME OVER' ? 'rgba(239,68,68,0.9)' : 'rgba(45,212,191,0.9)';
      c.shadowBlur = 28 * u;
      c.fillStyle = '#f8fafc';
      c.fillText(m.text, 0, 0);
      if (m.sub) {
        c.shadowBlur = 10 * u;
        c.shadowColor = 'rgba(0,0,0,0.8)';
        c.font = '700 ' + Math.round(20 * u) + 'px Rajdhani, "Segoe UI", sans-serif';
        c.fillStyle = '#fbbf24';
        c.fillText(m.sub.split('').join(' '), 0, size * 0.85);
      }
      c.restore();
    }

    /* ---------------- frame ---------------- */

    render(g) {
      const c = this.ctx, w = this.w, h = this.h;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.imageSmoothingEnabled = true;
      c.fillStyle = '#02060f';
      c.fillRect(0, 0, w, h);

      c.save();
      if (this.shake > 0) c.translate((Math.random() - 0.5) * this.shake * this.ui, (Math.random() - 0.5) * this.shake * this.ui);

      if (this.backdrop) c.drawImage(this.backdrop, -this.backPad - clamp(this.camX * 2 * this.ui, -this.backPad, this.backPad), 0);
      this.drawFloor(g);
      this.drawFloorLights(g);

      // Cast shadows
      const m = g.mother;
      this.shadow(m.x, m.y, 90, MOTHER_ALT);
      for (const e of g.enemies) this.shadow(e.x, e.y, e.w * 0.7, enemyAlt(e));
      if (g.player.alive) this.shadow(g.player.x, g.player.y, 26, 0);

      // Depth-sorted actors, far to near
      const list = [];
      list.push({ z: this.proj(m.x, m.y, MOTHER_ALT).z, fn: () => this.drawMother(g) });
      for (const e of g.enemies) list.push({ z: this.proj(e.x, e.y, 0).z, fn: () => this.drawEnemy(e) });
      if (g.player.alive) list.push({ z: this.proj(g.player.x, g.player.y, 0).z, fn: () => this.drawPlayer(g) });
      for (const s of g.shots) list.push({ z: this.proj(s.x, s.y, 0).z - 1, fn: () => this.drawShot(s) });
      for (const b of g.bullets) list.push({ z: this.proj(b.x, b.y, 0).z - 1, fn: () => this.drawBullet(b) });
      list.sort((a, b) => b.z - a.z);
      for (const d of list) d.fn();

      this.drawParticles();
      this.drawPopups();
      c.restore();

      // Vignette
      const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.5)');
      c.fillStyle = vg;
      c.fillRect(0, 0, w, h);

      if (this.flash > 0) {
        c.fillStyle = 'rgba(' + this.flashRgb + ',' + (this.flash * 0.45).toFixed(3) + ')';
        c.fillRect(0, 0, w, h);
      }

      if (!this.hideHud) {
        this.drawHUD(g);
        this.drawMessage(g);
      }
    }
  }

  global.ModernRenderer = ModernRenderer;
})(window);
