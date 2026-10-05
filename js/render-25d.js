/* Assault Revamped — 2.5D renderer.
 * A chase camera sits behind the tank and turns with it. The ground is the
 * stage's floor texture drawn mode-7 style (one perspective-scaled strip per
 * scanline); walls, blocks, the fortress and every unit are extruded 3D
 * geometry, depth-sorted and lit from the north-west, with cast shadows,
 * floor lighting and particle effects on top. */
(function (global) {
  'use strict';

  const { TS, T, TALL } = global.Assault;

  const CAM_H = 150, CAM_BACK = 160, MAX_Z = 1500, OBJ_Z = 900, TAU = Math.PI * 2;
  const LIGHT = [-0.6, -0.8];

  const SKY = {
    desert: { top: '#06101e', mid: '#1c2a3e', hz: '#c98a52', fog: [201, 138, 82] },
    base:   { top: '#030712', mid: '#0c1a2c', hz: '#2a6a74', fog: [42, 106, 116] },
    forest: { top: '#04101a', mid: '#123040', hz: '#5a8a74', fog: [90, 138, 116] },
    river:  { top: '#061428', mid: '#1a3a5a', hz: '#7aa8c0', fog: [122, 168, 192] }
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  const rgbCache = {};
  function rgb(hex) {
    let v = rgbCache[hex];
    if (!v) { const n = parseInt(hex.slice(1), 16); v = rgbCache[hex] = [n >> 16, (n >> 8) & 255, n & 255]; }
    return v;
  }
  function shade(hex, k) {
    const c = rgb(hex);
    if (k <= 1) return 'rgb(' + (c[0] * k | 0) + ',' + (c[1] * k | 0) + ',' + (c[2] * k | 0) + ')';
    const w = k - 1;
    return 'rgb(' + (c[0] + (255 - c[0]) * w | 0) + ',' + (c[1] + (255 - c[1]) * w | 0) + ',' + (c[2] + (255 - c[2]) * w | 0) + ')';
  }
  const faceLight = (nx, ny) => 0.62 + 0.38 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1]);

  class ModernRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 1; this.h = 1; this.ui = 1; this.dpr = 1;
      this.t = 0;
      this.hideHud = false;
      this.gcan = document.createElement('canvas');
      this.gctx = this.gcan.getContext('2d');
      this.mapTex = null;
      this.stageRef = null;
      this.pano = null;
      this.reset();
    }

    reset() {
      this.parts = []; this.smoke = []; this.lights = []; this.rings = []; this.popups = []; this.decals = [];
      this.shake = 0; this.flash = 0; this.flashRgb = '239,68,68';
    }

    resize(w, h) {
      this.w = w; this.h = h;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.ui = clamp(Math.min(w / 1400, h / 860), 0.5, 3);
      this.pano = null;
    }

    ensureMap(g) {
      if (this.stageRef !== g.stage) {
        this.stageRef = g.stage;
        this.mapTex = new global.MapTexture(g.stage, 'floor');
        this.pal = global.MAP_PALETTES[g.stage.theme.key];
        this.sky = SKY[g.stage.theme.key];
        this.pano = null;
        this.decals = [];
      }
    }

    /* ---------------- camera ---------------- */

    setupCamera(g) {
      const p = g.player;
      this.px = p.x; this.py = p.y;
      const a = g.camA;
      this.ca = Math.cos(a); this.sa = Math.sin(a);
      this.camA = a;
      this.hz = this.h * 0.3;
      this.camH = CAM_H + (p.lift || 0) * 300 + (p.jump ? p.alt * 70 : 0);
      this.f = (this.h * 0.8 - this.hz) * CAM_BACK / this.camH;
      this.cx = this.w / 2;
      this.maxZ = MAX_Z;
      this.objZ = OBJ_Z;
      this.camWX = this.px - this.sa * CAM_BACK;
      this.camWY = this.py + this.ca * CAM_BACK;
    }

    proj(wx, wy, alt) {
      const dx = wx - this.px, dy = wy - this.py;
      const X = dx * this.ca + dy * this.sa;
      const z = dx * this.sa - dy * this.ca + CAM_BACK;
      const s = this.f / (z < 8 ? 8 : z);
      return { x: this.cx + X * s, y: this.hz + (this.camH - alt) * s, s, z };
    }

    depth(wx, wy) { return (wx - this.px) * this.sa - (wy - this.py) * this.ca + CAM_BACK; }

    /* ---------------- events ---------------- */

    onEvent(ev, g) {
      this.ensureMap(g);
      switch (ev.type) {
        case 'tile': this.mapTex.redraw(ev.tx, ev.ty); break;
        case 'explode': {
          const sz = ev.size || 1;
          const alt = ev.flying ? 70 : ev.enemy === 'fortgun' || ev.enemy === 'core' ? 46 : 10;
          const cols = ev.enemy === 'tree' ? ['#4a8a3a', '#86c06a', '#6a4a2a'] : ev.enemy === 'block' ? ['#d8b07a', '#8a6a4a', '#fde68a'] : ['#fde68a', '#fb923c', '#ffffff', '#f87171'];
          this.explosion(ev.x, ev.y, alt, sz, cols);
          if (ev.points) this.popups.push({ x: ev.x, y: ev.y, alt: alt + 26, text: '+' + ev.points, life: 1.1, max: 1.1 });
          break;
        }
        case 'blast':
          this.explosion(ev.x, ev.y, 4, ev.r / 34, ev.owner === 'enemy' ? ['#fca5a5', '#fb923c', '#ffffff'] : ['#d9f99d', '#fde68a', '#fb923c', '#ffffff']);
          this.rings.push({ x: ev.x, y: ev.y, r: 4, max: ev.r * 1.4, life: 0.5, maxLife: 0.5, rgb: '253,230,138' });
          break;
        case 'hit': this.sparks(ev.x, ev.y, 14, ['#ffffff', '#fde68a'], 10, 140); break;
        case 'spark': this.sparks(ev.x, ev.y, ev.enemy ? 12 : 14, ev.enemy ? ['#fb923c', '#fde68a'] : ['#e0f2fe', '#67e8f9', '#ffffff'], 6, 110); break;
        case 'intercept':
          this.sparks(ev.x, ev.y, 12, ['#fde68a', '#fb923c', '#ffffff'], 12, 150);
          this.lights.push({ x: ev.x, y: ev.y, r: 40, rgb: '251,146,60', life: 0.2, max: 0.2 });
          break;
        case 'shoot':
          this.lights.push({ x: ev.x, y: ev.y, r: 50, rgb: '253,230,138', life: 0.1, max: 0.1 });
          this.sparks(ev.x, ev.y, 16, ['#fffbeb', '#fde68a'], 4, 80);
          break;
        case 'enemyShoot':
          this.lights.push({ x: ev.x, y: ev.y, r: 36, rgb: ev.kind === 'plasma' ? '244,63,94' : '251,146,60', life: 0.1, max: 0.1 });
          break;
        case 'land':
          this.rings.push({ x: ev.x, y: ev.y, r: 6, max: 90, life: 0.55, maxLife: 0.55, rgb: '148,163,184' });
          for (let i = 0; i < 12; i++) this.smoke.push(this.puff(ev.x + rnd(-18, 18), ev.y + rnd(-18, 18), 2, 1, '120,110,100'));
          this.shake = Math.max(this.shake, 10);
          break;
        case 'playerDie':
          this.explosion(ev.x, ev.y, 10, 2.4, ['#ffffff', '#e2e8f0', '#fde68a', '#fb923c', '#60a5fa']);
          this.flash = 0.5;
          this.flashRgb = '239,68,68';
          this.shake = 18;
          break;
        case 'coreOpen': this.flash = 0.35; this.flashRgb = '251,191,36'; break;
        case 'stageClear': this.flash = 0.5; this.flashRgb = '255,255,255'; this.shake = 20; break;
        case 'extraLife': this.popups.push({ x: ev.x, y: ev.y, alt: 50, text: '1UP', life: 1.8, max: 1.8, color: '#5eead4' }); break;
      }
    }

    puff(x, y, alt, life, rgbs) {
      return { x, y, alt, r: rnd(6, 10), grow: rnd(14, 26), va: rnd(10, 30), vx: rnd(-10, 10), life, max: life, rgb: rgbs };
    }

    sparks(x, y, alt, colors, n, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = rnd(0.3, 1) * speed;
        this.parts.push({ x, y, alt, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, va: rnd(-0.2, 1) * speed, life: rnd(0.25, 0.7), max: 0.7, color: pick(colors), size: rnd(1, 2), glow: true });
      }
    }

    explosion(x, y, alt, power, colors) {
      this.sparks(x, y, alt, colors, Math.round(26 * power), 190 * Math.sqrt(power));
      for (let i = 0; i < 9 * power; i++) {
        const a = Math.random() * TAU, s = rnd(40, 140) * Math.sqrt(power);
        this.parts.push({ x, y, alt, vx: Math.cos(a) * s, vy: Math.sin(a) * s, va: rnd(60, 220), life: rnd(0.8, 1.5), max: 1.5, color: pick(['#334155', '#475569', '#57534e', '#78350f']), size: rnd(2, 4), glow: false, rot: Math.random() * 6, vr: rnd(-12, 12) });
      }
      for (let i = 0; i < 5 * power; i++) this.smoke.push(this.puff(x + rnd(-8, 8), y + rnd(-8, 8), alt, rnd(0.9, 1.7), '40,44,52'));
      this.lights.push({ x, y, r: 100 * power, rgb: '251,191,36', life: 0.45, max: 0.45, alt: alt + 4 });
      if (alt < 30) {
        this.rings.push({ x, y, r: 4, max: 60 * power, life: 0.5, maxLife: 0.5, rgb: '251,191,36' });
        this.decals.push({ x, y, r: 14 * power, life: 8, max: 8 });
        if (this.decals.length > 50) this.decals.shift();
      }
      this.shake = Math.max(this.shake, 5 * power);
    }

    update(dt) {
      this.t += dt;
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
      this.shake = Math.max(0, this.shake - dt * 30);
      if (this.flash > 0) this.flash -= dt;
    }

    /* ---------------- sky & ground ---------------- */

    buildPano() {
      const w = this.w, hz = Math.round(this.hz) + 2, sk = this.sky;
      const fov = 2 * Math.atan((w / 2) / this.f);
      const pw = Math.round(w * TAU / fov);
      const c = document.createElement('canvas');
      c.width = pw; c.height = hz;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, hz);
      g.addColorStop(0, sk.top); g.addColorStop(0.55, sk.mid); g.addColorStop(1, sk.hz);
      x.fillStyle = g;
      x.fillRect(0, 0, pw, hz);
      let seed = 7;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < pw * hz / 4000; i++) {
        x.fillStyle = 'rgba(226,232,240,' + (0.2 + r() * 0.7).toFixed(2) + ')';
        const sy = r() * hz * 0.6;
        x.fillRect(r() * pw, sy, 1 + (r() < 0.1 ? 1 : 0), 1 + (r() < 0.1 ? 1 : 0));
      }
      // distant planet
      const pr = hz * 0.16, px = pw * 0.2, py = hz * 0.32;
      const pg = x.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#e0f2fe'); pg.addColorStop(0.5, '#38bdf8'); pg.addColorStop(1, '#0c4a6e');
      x.fillStyle = pg;
      x.beginPath(); x.arc(px, py, pr, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(186,230,253,0.45)'; x.lineWidth = pr * 0.08;
      x.beginPath(); x.ellipse(px, py, pr * 1.8, pr * 0.38, -0.3, 0, TAU); x.stroke();
      // mountain ridges, seamless around the panorama
      const ridge = (amp, k, fill) => {
        x.beginPath(); x.moveTo(0, hz);
        for (let i = 0; i <= pw; i += 4) {
          const u = i / pw * TAU;
          const hgt = amp * (0.55 + 0.25 * Math.sin(u * 3 + k) + 0.15 * Math.sin(u * 11 + k * 2) + 0.07 * Math.sin(u * 29 + k * 3));
          x.lineTo(i, hz - hgt);
        }
        x.lineTo(pw, hz); x.closePath();
        x.fillStyle = fill; x.fill();
      };
      const f = sk.fog;
      ridge(hz * 0.32, 1.1, 'rgba(' + (f[0] * 0.35 | 0) + ',' + (f[1] * 0.35 | 0) + ',' + (f[2] * 0.4 | 0) + ',1)');
      ridge(hz * 0.18, 4.2, 'rgba(' + (f[0] * 0.55 | 0) + ',' + (f[1] * 0.55 | 0) + ',' + (f[2] * 0.6 | 0) + ',1)');
      const hg = x.createLinearGradient(0, hz * 0.75, 0, hz);
      hg.addColorStop(0, 'rgba(' + f.join(',') + ',0)');
      hg.addColorStop(1, 'rgba(' + f.join(',') + ',0.85)');
      x.fillStyle = hg;
      x.fillRect(0, hz * 0.75, pw, hz * 0.25);
      this.pano = c;
    }

    drawSky() {
      if (!this.pano || this.pano.height !== Math.round(this.hz) + 2) this.buildPano();
      const c = this.ctx, pw = this.pano.width;
      let off = -((this.camA / TAU) * pw) % pw;
      if (off > 0) off -= pw;
      for (let x = Math.floor(off); x < this.w; x += pw - 1) c.drawImage(this.pano, x, 0);
    }

    drawGround() {
      const c = this.ctx, w = this.w, h = this.h, hz = this.hz, f = this.f, camH = this.camH;
      const maxZ = this.maxZ;
      const zNear = camH * f / (h - hz);
      const halfW = Math.ceil((w / 2) * maxZ / f) + 4;
      // The ground buffer is world-aligned to the camera; scale it down when the view is wide or high
      const k = Math.min(1, 3072 / (halfW * 2), 1536 / (maxZ - zNear + 8));
      const GW = Math.ceil(halfW * 2 * k), GH = Math.ceil((maxZ - zNear + 8) * k);
      if (this.gcan.width !== GW || this.gcan.height !== GH) {
        this.gcan.width = GW;
        this.gcan.height = GH;
      }
      const gx = this.gctx, gw = GW, gh = GH;
      const rowTank = gh - (CAM_BACK - zNear) * k - 4;
      const fog = this.sky.fog;
      gx.setTransform(1, 0, 0, 1, 0, 0);
      gx.fillStyle = this.pal.g[3];
      gx.fillRect(0, 0, gw, gh);
      gx.imageSmoothingEnabled = true;
      gx.translate(gw / 2, rowTank);
      gx.scale(k, k);
      gx.rotate(-this.camA);
      gx.translate(-this.px, -this.py);
      const R = Math.hypot(halfW, gh / k) + 40;
      const mc = this.mapTex.canvas;
      const sx = clamp(Math.floor(this.px - R), 0, mc.width), sy = clamp(Math.floor(this.py - R), 0, mc.height);
      const ex = clamp(Math.ceil(this.px + R), 0, mc.width), ey = clamp(Math.ceil(this.py + R), 0, mc.height);
      if (ex > sx && ey > sy) gx.drawImage(mc, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
      // Scorch decals baked into the per-frame ground buffer
      for (const d of this.decals) {
        const a = 0.5 * clamp(d.life / d.max * 2, 0, 1);
        const gr = gx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        gr.addColorStop(0, 'rgba(10,8,6,' + a + ')');
        gr.addColorStop(1, 'rgba(10,8,6,0)');
        gx.fillStyle = gr;
        gx.beginPath(); gx.arc(d.x, d.y, d.r, 0, TAU); gx.fill();
      }

      const step = Math.max(1, Math.round(this.dpr));
      const y0 = Math.floor(hz + camH * f / maxZ);
      c.imageSmoothingEnabled = true;
      for (let y = y0; y < h; y += step) {
        const z = camH * f / (y + step * 0.5 - hz);
        const row = rowTank - (z - CAM_BACK) * k;
        if (row < 0 || row >= gh) continue;
        const half = (w / 2) * z / f * k;
        c.drawImage(this.gcan, gw / 2 - half, row, half * 2, 1, 0, y, w, step);
      }
      // Distance fog: opaque at the horizon, clear by ~550 units out
      const yClear = hz + camH * f / 550;
      const fg = c.createLinearGradient(0, hz, 0, yClear);
      const kf = clamp((y0 - hz) / (yClear - hz), 0, 0.95);
      fg.addColorStop(0, 'rgba(' + fog.join(',') + ',1)');
      fg.addColorStop(kf, 'rgba(' + fog.join(',') + ',1)');
      fg.addColorStop(1, 'rgba(' + fog.join(',') + ',0)');
      c.fillStyle = fg;
      c.fillRect(0, hz - 1, w, yClear - hz + 1);
    }

    /* ---------------- 3D primitives ---------------- */

    poly(pts, fill) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    }

    /* Oriented box: centre (x,y), heading a, half extents hw (right) / hd (forward),
     * from alt a0 to a1. pitch lifts the front (rotating about the rear edge). */
    obox(x, y, a, hw, hd, a0, a1, col, opt) {
      opt = opt || {};
      const ca = Math.cos(a), sa = Math.sin(a), pitch = opt.pitch || 0, topCol = opt.top || col;
      const P = (u, v, alt) => this.proj(x + u * ca + v * sa, y + u * sa - v * ca, alt + (v + hd) * pitch);
      const b = [P(-hw, hd, a0), P(hw, hd, a0), P(hw, -hd, a0), P(-hw, -hd, a0)];
      const t = [P(-hw, hd, a1), P(hw, hd, a1), P(hw, -hd, a1), P(-hw, -hd, a1)];
      const cwx = this.camWX - x, cwy = this.camWY - y;
      const faces = [
        { n: [sa, -ca], d: hd, i: [0, 1] },     // front
        { n: [ca, sa], d: hw, i: [1, 2] },      // right
        { n: [-sa, ca], d: hd, i: [2, 3] },     // back
        { n: [-ca, -sa], d: hw, i: [3, 0] }     // left
      ];
      for (const fc of faces) {
        if (fc.n[0] * cwx + fc.n[1] * cwy <= fc.d) continue;
        const [i, j] = fc.i;
        this.poly([b[i], b[j], t[j], t[i]], shade(col, faceLight(fc.n[0], fc.n[1]) * (opt.side || 0.82)));
      }
      this.poly(t, shade(topCol, opt.topK || 1.05));
      return t;
    }

    beam(x0, y0, a0, x1, y1, a1, width, col) {
      const p0 = this.proj(x0, y0, a0), p1 = this.proj(x1, y1, a1), c = this.ctx;
      c.strokeStyle = col;
      c.lineWidth = Math.max(1, width * (p0.s + p1.s) / 2);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    }

    groundEllipse(x, y, r, fill, stroke) {
      const P = this.proj(x, y, 0), c = this.ctx;
      if (P.z < 20 || P.z > this.objZ) return;
      const sq = this.camH / P.z;
      c.beginPath();
      c.ellipse(P.x, P.y, Math.max(0.5, r * P.s), Math.max(0.5, r * P.s * sq), 0, 0, TAU);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.stroke(); }
    }

    shadow(x, y, r, alpha) { this.groundEllipse(x, y, r, 'rgba(0,0,0,' + alpha + ')'); }

    floorLight(x, y, r, rgbs, alpha) {
      const P = this.proj(x, y, 0);
      if (P.z < 20 || P.z > this.objZ) return;
      const c = this.ctx, rad = r * P.s, sq = this.camH / P.z;
      if (rad < 1) return;
      c.save();
      c.translate(P.x, P.y);
      c.scale(1, sq);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0, 'rgba(' + rgbs + ',' + alpha + ')');
      g.addColorStop(1, 'rgba(' + rgbs + ',0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, rad, 0, TAU); c.fill();
      c.restore();
    }

    /* ---------------- scene ---------------- */

    collectTiles(list) {
      const s = this.stageRef, P = this.pal, key = s.theme.key;
      const R = this.objZ;
      const tx0 = Math.max(0, Math.floor((this.px - R) / TS)), tx1 = Math.min(s.MW - 1, Math.floor((this.px + R) / TS));
      const ty0 = Math.max(0, Math.floor((this.py - R) / TS)), ty1 = Math.min(s.MH - 1, Math.floor((this.py + R) / TS));
      const halfFov = (this.w / 2) / this.f;
      const tall = (x, y) => (x < 0 || y < 0 || x >= s.MW || y >= s.MH) ? 99 : TALL[s.map[y * s.MW + x]];
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const v = s.map[ty * s.MW + tx];
          const h = TALL[v];
          if (!h) continue;
          const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS;
          const z = this.depth(cx, cy);
          if (z < 40 || z > this.objZ) continue;
          const X = (cx - this.px) * this.ca + (cy - this.py) * this.sa;
          if (Math.abs(X) - 24 > halfFov * z) continue;
          if (v === T.TREE) {
            list.push({ z, fn: () => this.drawTree(cx, cy, tx, ty) });
            continue;
          }
          const col = v === T.WALL ? P.wall : v === T.BLOCK ? P.block : P.fort;
          const top = v === T.WALL ? P.wallTop : v === T.BLOCK ? P.blockHi : P.fortHi;
          list.push({ z, fn: () => this.drawTileBox(tx, ty, h, col, top, v, key, tall) });
        }
      }
    }

    drawTileBox(tx, ty, h, col, top, v, key, tall) {
      const x0 = tx * TS, y0 = ty * TS, x1 = x0 + TS, y1 = y0 + TS;
      const P = (x, y, a) => this.proj(x, y, a);
      const c = this.ctx;
      const faces = [];
      if (this.camWY > y1 && tall(tx, ty + 1) < h) faces.push([[x0, y1], [x1, y1], 0, 1]);   // south
      if (this.camWY < y0 && tall(tx, ty - 1) < h) faces.push([[x1, y0], [x0, y0], 0, -1]);  // north
      if (this.camWX > x1 && tall(tx + 1, ty) < h) faces.push([[x1, y1], [x1, y0], 1, 0]);   // east
      if (this.camWX < x0 && tall(tx - 1, ty) < h) faces.push([[x0, y0], [x0, y1], -1, 0]);  // west
      for (const [a, b, nx, ny] of faces) {
        const pa0 = P(a[0], a[1], 0), pb0 = P(b[0], b[1], 0), pa1 = P(a[0], a[1], h), pb1 = P(b[0], b[1], h);
        this.poly([pa0, pb0, pb1, pa1], shade(col, faceLight(nx, ny) * 0.85));
        if (key === 'base' && v === T.WALL && (tx + ty) % 3 === 0) {
          const m0 = P(lerp(a[0], b[0], 0.3), lerp(a[1], b[1], 0.3), h * 0.55), m1 = P(lerp(a[0], b[0], 0.7), lerp(a[1], b[1], 0.7), h * 0.55);
          c.strokeStyle = 'rgba(94,234,212,0.9)';
          c.lineWidth = Math.max(1, 2.5 * m0.s);
          c.beginPath(); c.moveTo(m0.x, m0.y); c.lineTo(m1.x, m1.y); c.stroke();
        } else if (v === T.BLOCK) {
          const m0 = P(a[0], a[1], h * 0.5), m1 = P(b[0], b[1], h * 0.5);
          c.strokeStyle = 'rgba(0,0,0,0.25)';
          c.lineWidth = Math.max(1, 2 * m0.s);
          c.beginPath(); c.moveTo(m0.x, m0.y); c.lineTo(m1.x, m1.y); c.stroke();
        } else if (v === T.FORT && (tx + ty) % 2 === 0) {
          const m = P(lerp(a[0], b[0], 0.5), lerp(a[1], b[1], 0.5), h * 0.6);
          c.fillStyle = Math.floor(this.t * 3 + tx) % 2 ? '#ef4444' : '#7f1d1d';
          c.fillRect(m.x - 2 * m.s * 2, m.y - m.s * 2, 4 * m.s * 2, 2 * m.s * 2);
        }
      }
      const t = [P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)];
      this.poly(t, shade(top, 1));
      // edge highlight on exposed top edges
      c.strokeStyle = 'rgba(255,255,255,0.14)';
      c.lineWidth = Math.max(1, t[0].s * 1.2);
      c.beginPath();
      if (tall(tx, ty - 1) < h) { c.moveTo(t[0].x, t[0].y); c.lineTo(t[1].x, t[1].y); }
      if (tall(tx - 1, ty) < h) { c.moveTo(t[0].x, t[0].y); c.lineTo(t[3].x, t[3].y); }
      c.stroke();
      if (v === T.BLOCK) {
        c.strokeStyle = 'rgba(0,0,0,0.3)';
        c.beginPath(); c.moveTo(t[0].x, t[0].y); c.lineTo(t[2].x, t[2].y); c.stroke();
      }
    }

    drawTree(cx, cy, tx, ty) {
      const P = this.pal.tree, c = this.ctx;
      const jx = ((tx * 7 + ty * 13) % 7) - 3, jy = ((tx * 11 + ty * 5) % 7) - 3;
      const x = cx + jx, y = cy + jy;
      this.beam(x, y, 0, x, y, 14, 4, '#4a3020');
      const layers = [[16, 12, P[2]], [13, 22, P[0]], [9, 30, P[1]]];
      for (const [r, alt, col] of layers) {
        const p = this.proj(x, y, alt);
        const rr = r * p.s;
        const g = c.createRadialGradient(p.x - rr * 0.35, p.y - rr * 0.4, rr * 0.1, p.x, p.y, rr);
        g.addColorStop(0, shade(col, 1.25));
        g.addColorStop(1, shade(col, 0.7));
        c.fillStyle = g;
        c.beginPath(); c.ellipse(p.x, p.y, rr, rr * 0.8, 0, 0, TAU); c.fill();
      }
    }

    drawPlayer(g) {
      const p = g.player, c = this.ctx;
      c.save();
      if (p.invuln > 0 && p.invuln < 50 && Math.floor(this.t * 14) % 2) c.globalAlpha = 0.4;
      const base = p.lift * 80 + (p.jump ? p.alt * 60 : 0);
      const pitch = p.wheelie * 0.75;
      const ph = p.tread % 8;
      for (const side of [-1, 1]) {
        const ox = p.x + Math.cos(p.a) * side * 13, oy = p.y + Math.sin(p.a) * side * 13;
        this.obox(ox, oy, p.a, 5, 15, base, base + 9, '#2a2e36', { pitch, top: '#3a3f48' });
        // tread lugs
        for (let k = -15 + ph * 0.5; k < 15; k += 4) {
          const lx = ox + Math.sin(p.a) * k, ly = oy - Math.cos(p.a) * k;
          const a0 = this.proj(lx - Math.cos(p.a) * 5, ly - Math.sin(p.a) * 5, base + 9 + (k + 15) * pitch);
          const a1 = this.proj(lx + Math.cos(p.a) * 5, ly + Math.sin(p.a) * 5, base + 9 + (k + 15) * pitch);
          c.strokeStyle = '#15171c'; c.lineWidth = Math.max(1, a0.s);
          c.beginPath(); c.moveTo(a0.x, a0.y); c.lineTo(a1.x, a1.y); c.stroke();
        }
      }
      this.obox(p.x, p.y, p.a, 9, 13, base + 4, base + 13, '#b8c0cc', { pitch, top: '#dfe4ea' });
      const fx = Math.sin(p.a), fy = -Math.cos(p.a);
      const tAlt = base + 13 + 12 * pitch;
      // blue stripe on the hull deck
      const s0 = this.proj(p.x - Math.cos(p.a) * 8 - fx * 8, p.y - Math.sin(p.a) * 8 - fy * 8, base + 13.2 + 5 * pitch);
      const s1 = this.proj(p.x + Math.cos(p.a) * 8 - fx * 8, p.y + Math.sin(p.a) * 8 - fy * 8, base + 13.2 + 5 * pitch);
      c.strokeStyle = '#2f6fd8'; c.lineWidth = Math.max(1, 3 * s0.s);
      c.beginPath(); c.moveTo(s0.x, s0.y); c.lineTo(s1.x, s1.y); c.stroke();
      const len = 24 - p.recoil * 5;
      const front = this.depth(p.x + fx * 20, p.y + fy * 20) < this.depth(p.x, p.y);
      const drawBarrel = () => {
        this.beam(p.x, p.y, tAlt + 3, p.x + fx * len, p.y + fy * len, tAlt + 3 + len * pitch, 4.5, '#2a2e36');
        this.beam(p.x, p.y, tAlt + 3.5, p.x + fx * len, p.y + fy * len, tAlt + 3.5 + len * pitch, 2.5, '#c8ced8');
      };
      if (!front) drawBarrel();
      this.obox(p.x - fx * 1, p.y - fy * 1, p.a, 6, 7, tAlt, tAlt + 6, '#d6dbe3', { pitch: pitch * 0.4, top: '#f4f6f8' });
      if (front) drawBarrel();
      if (p.invuln > 0 && p.invuln < 50) {
        const P = this.proj(p.x, p.y, base + 12);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'lighter';
        const rr = 30 * P.s;
        const sg = c.createRadialGradient(P.x, P.y, rr * 0.55, P.x, P.y, rr);
        sg.addColorStop(0, 'rgba(45,212,191,0)');
        sg.addColorStop(1, 'rgba(45,212,191,' + (0.3 + 0.15 * Math.sin(this.t * 12)).toFixed(2) + ')');
        c.fillStyle = sg;
        c.beginPath(); c.ellipse(P.x, P.y, rr, rr * 0.75, 0, 0, TAU); c.fill();
      }
      c.restore();
    }

    drawEnemy(g, e) {
      const c = this.ctx, fl = e.hitFlash > 0;
      switch (e.type) {
        case 'tank': {
          for (const side of [-1, 1]) {
            this.obox(e.x + Math.cos(e.a) * side * 11, e.y + Math.sin(e.a) * side * 11, e.a, 4, 13, 0, 8, '#2a1e1a', { top: '#3a2a24' });
          }
          this.obox(e.x, e.y, e.a, 8, 11, 3, 11, fl ? '#ffffff' : '#9a3a24', { top: fl ? '#ffffff' : '#c8502e' });
          const fx = Math.sin(e.ta), fy = -Math.cos(e.ta);
          const back = this.depth(e.x + fx * 10, e.y + fy * 10) > this.depth(e.x, e.y);
          const barrel = () => this.beam(e.x, e.y, 15, e.x + fx * 22, e.y + fy * 22, 15, 3.5, '#241a16');
          if (back) barrel();
          this.obox(e.x, e.y, e.ta, 5.5, 6, 11, 17, fl ? '#ffffff' : '#b8482a', { top: fl ? '#ffffff' : '#e06a40' });
          if (!back) barrel();
          break;
        }
        case 'turret': {
          this.obox(e.x, e.y, 0, 13, 13, 0, 9, '#6e737c', { top: '#8a9099' });
          const fx = Math.sin(e.ta), fy = -Math.cos(e.ta), rx = Math.cos(e.ta), ry = Math.sin(e.ta);
          const back = this.depth(e.x + fx * 10, e.y + fy * 10) > this.depth(e.x, e.y);
          const barrels = () => {
            for (const s of [-3.5, 3.5]) this.beam(e.x + rx * s, e.y + ry * s, 15, e.x + rx * s + fx * 22, e.y + ry * s + fy * 22, 15, 3, '#1f1f24');
          };
          if (back) barrels();
          this.obox(e.x, e.y, e.ta, 8, 8, 9, 18, fl ? '#ffffff' : '#a8321f', { top: fl ? '#ffffff' : '#d8503a' });
          if (!back) barrels();
          const P = this.proj(e.x, e.y, 18.5);
          c.fillStyle = Math.floor(this.t * 4 + e.id) % 2 ? '#fde047' : '#713f12';
          c.beginPath(); c.arc(P.x, P.y, Math.max(1, 2.2 * P.s), 0, TAU); c.fill();
          break;
        }
        case 'mortar': {
          this.obox(e.x, e.y, 0, 13, 13, 0, 6, '#8a7650', { top: '#b8a070' });
          this.obox(e.x, e.y, 0, 8, 8, 0, 6.5, '#3a3428', { top: '#2a261e' });
          const fx = Math.sin(e.ta), fy = -Math.cos(e.ta);
          this.beam(e.x, e.y, 6, e.x + fx * 8, e.y + fy * 8, 24, 7, '#1f1f1c');
          this.beam(e.x, e.y, 6, e.x + fx * 8, e.y + fy * 8, 24, 4.5, fl ? '#ffffff' : '#6a6a5a');
          break;
        }
        case 'chopper': {
          const alt = 68 + Math.sin(e.t * 2 + e.id) * 4;
          const fx = Math.sin(e.a), fy = -Math.cos(e.a);
          this.beam(e.x, e.y, alt + 4, e.x - fx * 26, e.y - fy * 26, alt + 6, 3, '#2a3440');
          this.obox(e.x, e.y, e.a, 6, 11, alt, alt + 9, fl ? '#ffffff' : '#3e5468', { top: fl ? '#ffffff' : '#56718a' });
          const cp = this.proj(e.x + fx * 7, e.y + fy * 7, alt + 8);
          c.fillStyle = '#7ad8f0';
          c.beginPath(); c.ellipse(cp.x, cp.y, 4 * cp.s, 3 * cp.s, 0, 0, TAU); c.fill();
          // rotor disc
          const rp = this.proj(e.x, e.y, alt + 12), rr = 20 * rp.s;
          c.fillStyle = 'rgba(203,213,225,0.16)';
          c.beginPath(); c.ellipse(rp.x, rp.y, rr, rr * (this.camH - alt) / Math.max(40, rp.z) + rr * 0.15, 0, 0, TAU); c.fill();
          c.strokeStyle = 'rgba(226,232,240,0.6)';
          c.lineWidth = Math.max(1, 1.5 * rp.s);
          const ra = this.t * 24;
          for (let k = 0; k < 2; k++) {
            const a = ra + k * Math.PI / 2;
            const r0 = this.proj(e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, alt + 12), r1 = this.proj(e.x - Math.cos(a) * 20, e.y - Math.sin(a) * 20, alt + 12);
            c.beginPath(); c.moveTo(r0.x, r0.y); c.lineTo(r1.x, r1.y); c.stroke();
          }
          break;
        }
        case 'fortgun': {
          const fx = Math.sin(e.ta), fy = -Math.cos(e.ta);
          const back = this.depth(e.x + fx * 10, e.y + fy * 10) > this.depth(e.x, e.y);
          const barrel = () => this.beam(e.x, e.y, 54, e.x + fx * 26, e.y + fy * 26, 54, 5, '#141416');
          if (back) barrel();
          this.obox(e.x, e.y, 0, 13, 13, 40, 46, '#3a3434', { top: '#4a4040' });
          this.obox(e.x, e.y, e.ta, 9, 10, 46, 58, fl ? '#ffffff' : '#7a2a24', { top: fl ? '#ffffff' : '#a8443a' });
          if (!back) barrel();
          const P = this.proj(e.x, e.y, 58.5);
          c.fillStyle = Math.floor(this.t * 5 + e.id) % 2 ? '#f87171' : '#7f1d1d';
          c.beginPath(); c.arc(P.x, P.y, Math.max(1, 2.5 * P.s), 0, TAU); c.fill();
          break;
        }
        case 'core': {
          if (!g.coreOpen) {
            this.obox(e.x, e.y, 0, 34, 20, 40, 50, '#3a3a44', { top: '#5a5a66' });
            for (let i = -2; i <= 2; i++) this.obox(e.x + i * 12, e.y, 0, 4, 18, 50, 54, '#6a6a76', { top: '#8a8a96' });
            break;
          }
          this.obox(e.x, e.y, 0, 30, 18, 40, 46, '#2a1a18', { top: '#3a2420' });
          const P = this.proj(e.x, e.y, 62), pulse = 0.5 + 0.5 * Math.sin(this.t * 8);
          const rr = (20 + pulse * 3) * P.s;
          c.save();
          c.globalCompositeOperation = 'lighter';
          const gl = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr * 2.4);
          gl.addColorStop(0, 'rgba(255,237,213,0.9)');
          gl.addColorStop(0.35, 'rgba(249,115,22,0.7)');
          gl.addColorStop(1, 'rgba(239,68,68,0)');
          c.fillStyle = gl;
          c.beginPath(); c.arc(P.x, P.y, rr * 2.4, 0, TAU); c.fill();
          c.restore();
          const sg = c.createRadialGradient(P.x - rr * 0.3, P.y - rr * 0.35, rr * 0.1, P.x, P.y, rr);
          sg.addColorStop(0, fl ? '#ffffff' : '#fff7ed');
          sg.addColorStop(0.4, '#fb923c');
          sg.addColorStop(1, '#7f1d1d');
          c.fillStyle = sg;
          c.beginPath(); c.arc(P.x, P.y, rr, 0, TAU); c.fill();
          break;
        }
      }
    }

    drawShot(s) {
      const c = this.ctx;
      const head = this.proj(s.x, s.y, 16), tail = this.proj(s.x - s.vx * 0.05, s.y - s.vy * 0.05, 16);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      const gr = c.createLinearGradient(tail.x, tail.y, head.x, head.y);
      gr.addColorStop(0, 'rgba(253,224,71,0)');
      gr.addColorStop(1, 'rgba(254,240,138,0.95)');
      c.strokeStyle = gr;
      c.lineWidth = Math.max(2, 6 * head.s);
      c.shadowColor = '#fde047';
      c.shadowBlur = 12 * this.ui;
      c.beginPath(); c.moveTo(tail.x, tail.y); c.lineTo(head.x, head.y); c.stroke();
      c.shadowBlur = 0;
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(1, 2 * head.s);
      c.beginPath(); c.moveTo(lerp(tail.x, head.x, 0.6), lerp(tail.y, head.y, 0.6)); c.lineTo(head.x, head.y); c.stroke();
      c.restore();
    }

    drawEShot(b) {
      const c = this.ctx, alt = b.flying ? 40 : b.fromFort ? 40 : 14;
      const P = this.proj(b.x, b.y, alt);
      const plasma = b.kind === 'plasma';
      const rgbs = plasma ? '244,63,94' : '251,146,60';
      const r = Math.max(2, (plasma ? 4 : 3.4) * P.s);
      c.save();
      c.globalCompositeOperation = 'lighter';
      const gg = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, r * 2.2);
      gg.addColorStop(0, 'rgba(255,255,255,1)');
      gg.addColorStop(0.4, 'rgba(' + rgbs + ',0.95)');
      gg.addColorStop(1, 'rgba(' + rgbs + ',0)');
      c.fillStyle = gg;
      c.beginPath(); c.arc(P.x, P.y, r * 2.2, 0, TAU); c.fill();
      c.restore();
    }

    drawGrenade(gr) {
      const c = this.ctx;
      const alt = gr.alt * 70 + 6;
      const P = this.proj(gr.x, gr.y, alt), r = Math.max(1.5, 4 * P.s);
      const g = c.createRadialGradient(P.x - r * 0.3, P.y - r * 0.3, r * 0.1, P.x, P.y, r);
      g.addColorStop(0, gr.owner === 'enemy' ? '#fdba74' : '#d9f99d');
      g.addColorStop(1, gr.owner === 'enemy' ? '#431407' : '#1a2e05');
      c.fillStyle = g;
      c.beginPath(); c.arc(P.x, P.y, r, 0, TAU); c.fill();
    }

    drawParticles() {
      const c = this.ctx;
      for (const s of this.smoke) {
        const P = this.proj(s.x, s.y, s.alt);
        if (P.z < 20) continue;
        const k = s.life / s.max, rr = s.r * P.s;
        const g = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr);
        g.addColorStop(0, 'rgba(' + s.rgb + ',' + (0.45 * k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + s.rgb + ',0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(P.x, P.y, rr, 0, TAU); c.fill();
      }
      for (const p of this.parts) {
        if (p.glow) continue;
        const P = this.proj(p.x, p.y, p.alt), sz = p.size * P.s;
        if (P.z < 20) continue;
        c.save();
        c.globalAlpha = clamp(p.life / 0.4, 0, 1);
        c.translate(P.x, P.y); c.rotate(p.rot);
        c.fillStyle = p.color;
        c.fillRect(-sz, -sz * 0.6, sz * 2, sz * 1.2);
        c.restore();
      }
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      for (const p of this.parts) {
        if (!p.glow) continue;
        const P = this.proj(p.x, p.y, p.alt);
        if (P.z < 20) continue;
        const Q = this.proj(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.alt - p.va * 0.03);
        c.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
        c.strokeStyle = p.color;
        c.lineWidth = Math.max(1, p.size * P.s * 2.2);
        c.beginPath(); c.moveTo(Q.x, Q.y); c.lineTo(P.x, P.y); c.stroke();
      }
      c.globalAlpha = 1;
      for (const l of this.lights) {
        if (l.alt === undefined) continue;
        const P = this.proj(l.x, l.y, l.alt), k = l.life / l.max;
        if (P.z < 20) continue;
        const rr = l.r * 0.5 * P.s * (1.4 - k * 0.4);
        const g = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr);
        g.addColorStop(0, 'rgba(255,255,255,' + (0.9 * k).toFixed(3) + ')');
        g.addColorStop(0.35, 'rgba(' + l.rgb + ',' + (0.6 * k).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + l.rgb + ',0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(P.x, P.y, rr, 0, TAU); c.fill();
      }
      c.restore();
    }

    drawGuide(g) {
      const p = g.player;
      if (!p.alive || g.state !== 'play' || Math.floor(this.t * 3) % 2) return;
      const ga = g.guideAngle(p.x, p.y), fx = Math.sin(ga), fy = -Math.cos(ga), rx = Math.cos(ga), ry = Math.sin(ga);
      const cx = p.x + fx * 52, cy = p.y + fy * 52;
      const pt = (u, v) => this.proj(cx + rx * u + fx * v, cy + ry * u + fy * v, 1);
      const shape = [pt(0, 14), pt(11, 0), pt(4, 0), pt(4, -12), pt(-4, -12), pt(-4, 0), pt(-11, 0)];
      const c = this.ctx;
      c.save();
      c.globalCompositeOperation = 'lighter';
      this.poly(shape, 'rgba(253,224,71,0.75)');
      c.restore();
    }

    /* ---------------- HUD ---------------- */

    panel(x, y, w, h) {
      const c = this.ctx;
      global.roundRectPath(c, x, y, w, h, 10 * this.ui);
      c.fillStyle = 'rgba(15,23,42,0.66)';
      c.fill();
      c.strokeStyle = 'rgba(148,163,184,0.16)';
      c.lineWidth = Math.max(1, this.ui);
      c.stroke();
    }

    label(text, x, y, align, color) {
      const c = this.ctx;
      c.textAlign = align;
      c.font = '600 ' + Math.round(12 * this.ui) + 'px Rajdhani, "Segoe UI", sans-serif';
      c.fillStyle = color || '#94a3b8';
      c.fillText(text.split('').join(String.fromCharCode(8202)), x, y);
    }

    value(text, x, y, align, color, size) {
      const c = this.ctx;
      c.textAlign = align;
      c.font = '700 ' + Math.round((size || 26) * this.ui) + 'px Orbitron, "Segoe UI", sans-serif';
      c.fillStyle = color;
      c.fillText(text, x, y);
    }

    drawHUD(g) {
      const c = this.ctx, u = this.ui, w = this.w, h = this.h, pad = 18 * u, t = this.t;
      c.save();
      c.textBaseline = 'alphabetic';
      const pw = 200 * u, ph = 58 * u;
      this.panel(pad, pad, pw, ph);
      this.label('SCORE', pad + 16 * u, pad + 20 * u, 'left');
      this.value(String(g.score).padStart(7, '0'), pad + 16 * u, pad + 48 * u, 'left', '#f8fafc');

      this.panel(w / 2 - pw / 2, pad, pw, ph);
      this.label('HIGH SCORE', w / 2, pad + 20 * u, 'center');
      this.value(String(Math.max(g.hiScore, g.score)).padStart(7, '0'), w / 2, pad + 48 * u, 'center', '#fbbf24');

      const tw = 150 * u;
      this.panel(w - pad - tw, pad, tw, ph);
      this.label('TIME', w - pad - 16 * u, pad + 20 * u, 'right');
      const tl = Math.ceil(g.timeLeft);
      this.value(String(tl).padStart(3, '0'), w - pad - 16 * u, pad + 48 * u, 'right', tl <= 30 ? (Math.floor(t * 4) % 2 ? '#f87171' : '#fbbf24') : '#5eead4');

      const bh = 58 * u, by = h - pad - bh;
      this.panel(pad, by, 210 * u, bh);
      this.label('RESERVE TANKS', pad + 16 * u, by + 20 * u, 'left');
      for (let i = 0; i < Math.min(Math.max(g.lives - (g.player.alive ? 1 : 0), 0), 6); i++) {
        const ix = pad + 26 * u + i * 28 * u, iy = by + 34 * u;
        c.fillStyle = '#3a3f48'; c.fillRect(ix - 10 * u, iy, 5 * u, 16 * u); c.fillRect(ix + 5 * u, iy, 5 * u, 16 * u);
        c.fillStyle = '#d6dbe3'; c.fillRect(ix - 5 * u, iy + 2 * u, 10 * u, 12 * u);
        c.fillStyle = '#2f6fd8'; c.fillRect(ix - 3 * u, iy + 6 * u, 6 * u, 3 * u);
        c.fillStyle = '#d6dbe3'; c.fillRect(ix - 1 * u, iy - 5 * u, 2 * u, 8 * u);
      }

      const aw = 210 * u;
      this.panel(w - pad - aw, by, aw, bh);
      this.label(g.stage.theme.name, w - pad - 16 * u, by + 20 * u, 'right');
      this.value('AREA ' + String(g.stageNum).padStart(2, '0'), w - pad - 16 * u, by + 46 * u, 'right', '#f8fafc', 22);

      const p = g.player;
      let status = null, sc = '#5eead4';
      if (p.lift > 0.9) status = 'LIFT ZONE  ·  BOMBS AWAY';
      else if (g.coreOpen && g.state === 'play') { status = 'CORE EXPOSED'; sc = '#f87171'; }
      if (status && Math.floor(t * 3) % 2 === 0) {
        c.textAlign = 'center';
        c.font = '700 ' + Math.round(18 * u) + 'px Rajdhani, "Segoe UI", sans-serif';
        c.fillStyle = sc;
        c.fillText(status.split('').join(' '), w / 2, by + 36 * u);
      }
      c.restore();
    }

    drawMessage(g) {
      const m = g.message;
      if (!m) return;
      const c = this.ctx, u = this.ui;
      const kin = clamp(m.t / 0.3, 0, 1), kout = m.dur > 100 ? 1 : clamp((m.dur - m.t) / 0.4, 0, 1);
      c.save();
      c.globalAlpha = Math.min(kin, kout);
      c.translate(this.w / 2, this.h * 0.4);
      const sc = 0.85 + 0.15 * (1 - Math.pow(1 - kin, 3));
      c.scale(sc, sc);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const size = Math.round(Math.min(58 * u, this.w / (m.text.length * 0.9)));
      c.font = '800 ' + size + 'px Orbitron, "Segoe UI", sans-serif';
      c.shadowColor = m.text === 'GAME OVER' || m.text === 'TIME UP' ? 'rgba(239,68,68,0.9)' : 'rgba(45,212,191,0.9)';
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
      this.ensureMap(g);
      this.setupCamera(g);
      const c = this.ctx, w = this.w, h = this.h;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#02060f';
      c.fillRect(0, 0, w, h);

      c.save();
      if (this.shake > 0) c.translate((Math.random() - 0.5) * this.shake * this.ui, (Math.random() - 0.5) * this.shake * this.ui);
      this.drawSky();
      this.drawGround();

      // Floor lighting and markers
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const l of this.lights) this.floorLight(l.x, l.y, l.r, l.rgb, 0.5 * (l.life / l.max));
      for (const s of g.shots) this.floorLight(s.x, s.y, 34, '253,224,71', 0.2);
      for (const b of g.eshots) this.floorLight(b.x, b.y, 28, b.kind === 'plasma' ? '244,63,94' : '251,146,60', 0.22);
      if (g.coreOpen) {
        const core = g.enemies.find(e => e.type === 'core');
        if (core) this.floorLight(core.x, core.y, 160, '249,115,22', 0.25 + 0.1 * Math.sin(this.t * 8));
      }
      for (const r of this.rings) {
        const P = this.proj(r.x, r.y, 0);
        if (P.z < 20) continue;
        c.save();
        c.translate(P.x, P.y);
        c.scale(1, this.camH / P.z);
        c.strokeStyle = 'rgba(' + r.rgb + ',' + (0.8 * r.life / r.maxLife).toFixed(3) + ')';
        c.lineWidth = Math.max(1, 6 * P.s);
        c.beginPath(); c.arc(0, 0, r.r * P.s, 0, TAU); c.stroke();
        c.restore();
      }
      c.restore();
      for (const gr of g.grenades) {
        if (gr.owner !== 'enemy' || Math.floor(this.t * 10) % 2) continue;
        c.lineWidth = Math.max(1.5, 2 * this.ui);
        this.groundEllipse(gr.x1, gr.y1, gr.r, 'rgba(239,68,68,0.18)', 'rgba(248,113,113,0.95)');
      }
      this.drawGuide(g);

      // Shadows
      const p = g.player;
      for (const e of g.enemies) this.shadow(e.x + (e.flying ? 14 : 2), e.y + (e.flying ? 18 : 3), e.flying ? 16 : e.r * 1.2, e.flying ? 0.35 : 0.3);
      if (p.alive) this.shadow(p.x + 3 + p.alt * 20, p.y + 4 + p.alt * 24, 20 + p.alt * 4, 0.4 - p.alt * 0.1);
      for (const gr of g.grenades) this.shadow(gr.x, gr.y, 4, 0.35);

      // Depth-sorted scenery and actors
      const list = [];
      this.collectTiles(list);
      for (const e of g.enemies) {
        const z = this.depth(e.x, e.y) - (e.type === 'fortgun' || e.type === 'core' ? 0.5 : 0) - (e.flying ? 60 : 0);
        if (z > 20 && z < this.objZ) list.push({ z, fn: () => this.drawEnemy(g, e) });
      }
      if (p.alive) list.push({ z: this.depth(p.x, p.y) - (p.alt > 0 ? 80 : 0), fn: () => this.drawPlayer(g) });
      for (const s of g.shots) list.push({ z: this.depth(s.x, s.y) - 2, fn: () => this.drawShot(s) });
      for (const b of g.eshots) list.push({ z: this.depth(b.x, b.y) - (b.fromFort || b.flying ? 30 : 2), fn: () => this.drawEShot(b) });
      for (const gr of g.grenades) list.push({ z: this.depth(gr.x, gr.y) - 40, fn: () => this.drawGrenade(gr) });
      list.sort((a, b) => b.z - a.z);
      for (const d of list) d.fn();

      this.drawParticles();

      // Score popups
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const pp of this.popups) {
        const P = this.proj(pp.x, pp.y, pp.alt);
        if (P.z < 20) continue;
        c.globalAlpha = clamp(pp.life / pp.max * 2, 0, 1);
        c.font = '700 ' + Math.round(16 * this.ui) + 'px Rajdhani, "Segoe UI", sans-serif';
        c.fillStyle = pp.color || '#fde68a';
        c.shadowColor = 'rgba(0,0,0,0.85)';
        c.shadowBlur = 6 * this.ui;
        c.fillText(pp.text, P.x, P.y);
      }
      c.restore();
      c.restore();

      const vg = c.createRadialGradient(w / 2, h * 0.6, Math.min(w, h) * 0.4, w / 2, h * 0.6, Math.max(w, h) * 0.8);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      c.fillStyle = vg;
      c.fillRect(0, 0, w, h);

      if (this.flash > 0) {
        c.fillStyle = 'rgba(' + this.flashRgb + ',' + (this.flash * 0.5).toFixed(3) + ')';
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
