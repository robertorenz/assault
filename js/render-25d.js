/* Assault Revamped — 2.5D renderer.
 * The arcade world seen from a chase camera that sits behind the tank and
 * turns with it. The island's floor texture is drawn mode-7 style (one
 * perspective-scaled strip per scanline) floating in open space; rock
 * boulders, structures, the fortress pyramids and every unit are raised 3D
 * geometry, depth-sorted and lit from the north-west, with shadows, floor
 * lighting and particles. */
(function (global) {
  'use strict';

  const { TS, T, TALL } = global.Assault;

  const CAM_H = 150, CAM_BACK = 160, MAX_Z = 1500, OBJ_Z = 900, TAU = Math.PI * 2;
  const LIGHT = [-0.6, -0.8];
  const PINK = '#f6a8d8';

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
      this.parts = []; this.smoke = []; this.lights = []; this.rings = []; this.popups = [];
      this.shake = 0; this.flash = 0; this.flashRgb = '255,255,255';
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
        this.theme = global.MAP_THEME[g.stage.theme.key];
        this.rockCols = global.ROCK_COLORS[this.theme.rock];
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
          const alt = ev.flying ? 70 : ev.enemy === 'fortgun' ? 14 : 10;
          this.explosion(ev.x, ev.y, alt, sz, ['#ffe060', '#ff8a20', '#ffffff', '#e8201c']);
          if (!ev.flying) this.mapTex.crater(ev.x, ev.y, 9 + sz * 4, (ev.x * 13 + ev.y) | 0);
          if (ev.points) this.popups.push({ x: ev.x, y: ev.y, alt: alt + 26, text: '+' + ev.points, life: 1.1, max: 1.1 });
          break;
        }
        case 'blast':
          this.explosion(ev.x, ev.y, 4, ev.r / 34, ev.owner === 'enemy' ? ['#ff9ad8', '#ffc4ea', '#ffffff'] : ['#ffe060', '#ff8a20', '#ffffff']);
          this.mapTex.crater(ev.x, ev.y, ev.r * 0.35, (ev.x * 7 + ev.y) | 0);
          this.rings.push({ x: ev.x, y: ev.y, r: 4, max: ev.r * 1.4, life: 0.5, maxLife: 0.5, rgb: '255,210,120' });
          break;
        case 'hit': this.sparks(ev.x, ev.y, 14, ['#ffffff', '#ffe060'], 10, 140); break;
        case 'spark': this.sparks(ev.x, ev.y, 12, ev.enemy ? ['#ff9ad8', '#ffffff'] : ['#e0f2fe', '#7ad0ff', '#ffffff'], 6, 110); break;
        case 'intercept':
          this.sparks(ev.x, ev.y, 12, ['#ffe060', '#ff9ad8', '#ffffff'], 12, 150);
          this.lights.push({ x: ev.x, y: ev.y, r: 40, rgb: '255,154,216', life: 0.2, max: 0.2 });
          break;
        case 'shoot':
          this.lights.push({ x: ev.x, y: ev.y, r: 50, rgb: '122,208,255', life: 0.1, max: 0.1 });
          this.sparks(ev.x, ev.y, 16, ['#e8f8ff', '#7ad0ff'], 4, 80);
          break;
        case 'enemyShoot':
          this.lights.push({ x: ev.x, y: ev.y, r: 36, rgb: '255,154,216', life: 0.1, max: 0.1 });
          break;
        case 'land':
          this.rings.push({ x: ev.x, y: ev.y, r: 6, max: 90, life: 0.55, maxLife: 0.55, rgb: '200,200,210' });
          for (let i = 0; i < 12; i++) this.smoke.push(this.puff(ev.x + rnd(-18, 18), ev.y + rnd(-18, 18), 2, 1, '120,110,100'));
          this.shake = Math.max(this.shake, 10);
          break;
        case 'playerDie':
          this.explosion(ev.x, ev.y, 10, 2.2, ['#ffffff', '#dfe3ea', '#f0d27a', '#ff8a20', '#5a7aff']);
          this.flash = 0.4; this.flashRgb = '255,255,255'; this.shake = 18;
          break;
        case 'coreOpen': this.flash = 0.3; this.flashRgb = '255,90,58'; break;
        case 'stageClear': this.flash = 0.5; this.flashRgb = '255,255,255'; this.shake = 20; break;
        case 'extraLife': this.popups.push({ x: ev.x, y: ev.y, alt: 50, text: '1UP', life: 1.8, max: 1.8, color: PINK }); break;
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
        this.parts.push({ x, y, alt, vx: Math.cos(a) * s, vy: Math.sin(a) * s, va: rnd(60, 220), life: rnd(0.8, 1.5), max: 1.5, color: pick(['#2a2a2a', '#4a4a4a', '#6a6a6a', '#8a2a1a']), size: rnd(2, 4), glow: false, rot: Math.random() * 6, vr: rnd(-12, 12) });
      }
      for (let i = 0; i < 5 * power; i++) this.smoke.push(this.puff(x + rnd(-8, 8), y + rnd(-8, 8), alt, rnd(0.9, 1.7), '36,32,32'));
      this.lights.push({ x, y, r: 100 * power, rgb: '255,170,60', life: 0.45, max: 0.45, alt: alt + 4 });
      if (alt < 30) this.rings.push({ x, y, r: 4, max: 60 * power, life: 0.5, maxLife: 0.5, rgb: '232,32,28' });
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
      this.shake = Math.max(0, this.shake - dt * 30);
      if (this.flash > 0) this.flash -= dt;
    }

    /* ---------------- space & ground ---------------- */

    buildPano() {
      const w = this.w, h = this.h;
      const fov = 2 * Math.atan((w / 2) / this.f);
      const pw = Math.round(w * TAU / fov);
      const c = document.createElement('canvas');
      c.width = pw; c.height = h;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#01030a'); g.addColorStop(0.5, '#040a18'); g.addColorStop(1, '#01030a');
      x.fillStyle = g;
      x.fillRect(0, 0, pw, h);
      let seed = 7;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      // soft nebulae (teal / blue), seamless across the wrap
      for (let i = 0; i < 7; i++) {
        const nx = r() * pw, ny = r() * h, nr = h * (0.25 + r() * 0.35);
        const col = r() < 0.5 ? '20,120,140' : '30,70,160';
        for (const ox of [0, -pw, pw]) {
          const ng = x.createRadialGradient(nx + ox, ny, 0, nx + ox, ny, nr);
          ng.addColorStop(0, 'rgba(' + col + ',0.16)');
          ng.addColorStop(1, 'rgba(' + col + ',0)');
          x.fillStyle = ng;
          x.fillRect(nx + ox - nr, ny - nr, nr * 2, nr * 2);
        }
      }
      for (let i = 0; i < pw * h / 2200; i++) {
        x.fillStyle = 'rgba(' + pick(['255,255,255', '200,216,255', '255,232,200']) + ',' + (0.25 + r() * 0.75).toFixed(2) + ')';
        const s = r() < 0.08 ? 2 : 1;
        x.fillRect(r() * pw, r() * h, s, s);
      }
      // a distant ringed planet
      const pr = h * 0.07, px = pw * 0.3, py = h * 0.14;
      const pg = x.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#e0f2fe'); pg.addColorStop(0.5, '#38a8d8'); pg.addColorStop(1, '#0c3a5e');
      x.fillStyle = pg;
      x.beginPath(); x.arc(px, py, pr, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(186,230,253,0.45)'; x.lineWidth = pr * 0.08;
      x.beginPath(); x.ellipse(px, py, pr * 1.8, pr * 0.38, -0.3, 0, TAU); x.stroke();
      this.pano = c;
    }

    drawSpace() {
      if (!this.pano || this.pano.height !== this.h) this.buildPano();
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
      const k = Math.min(1, 3072 / (halfW * 2), 1536 / (maxZ - zNear + 8));
      const GW = Math.ceil(halfW * 2 * k), GH = Math.ceil((maxZ - zNear + 8) * k);
      if (this.gcan.width !== GW || this.gcan.height !== GH) { this.gcan.width = GW; this.gcan.height = GH; }
      const gx = this.gctx, gw = GW, gh = GH;
      const rowTank = gh - (CAM_BACK - zNear) * k - 4;
      gx.setTransform(1, 0, 0, 1, 0, 0);
      gx.clearRect(0, 0, gw, gh);
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
      if (this.stageRef.cleared) {
        const fo = this.stageRef.fort, hx = fo.cx * TS, hy = fo.cy * TS;
        gx.fillStyle = '#9a9aaa'; gx.beginPath(); gx.arc(hx, hy, 26, 0, TAU); gx.fill();
        gx.fillStyle = '#000'; gx.beginPath(); gx.arc(hx + 1, hy + 1, 22, 0, TAU); gx.fill();
      }

      const step = Math.max(1, Math.round(this.dpr));
      const y0 = Math.floor(hz + camH * f / maxZ);
      c.imageSmoothingEnabled = true;
      for (let y = y0; y < h; y += step) {
        const z = camH * f / (y + step * 0.5 - hz);
        const row = rowTank - (z - CAM_BACK) * k;
        if (row < 0 || row >= gh) continue;
        const half = (w / 2) * z / f * k;
        c.globalAlpha = clamp((maxZ - z) / 500, 0, 1);
        c.drawImage(this.gcan, gw / 2 - half, row, half * 2, 1, 0, y, w, step);
      }
      c.globalAlpha = 1;
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

    obox(x, y, a, hw, hd, a0, a1, col, opt) {
      opt = opt || {};
      const ca = Math.cos(a), sa = Math.sin(a), pitch = opt.pitch || 0, topCol = opt.top || col;
      const P = (u, v, alt) => this.proj(x + u * ca + v * sa, y + u * sa - v * ca, alt + (v + hd) * pitch);
      const b = [P(-hw, hd, a0), P(hw, hd, a0), P(hw, -hd, a0), P(-hw, -hd, a0)];
      const t = [P(-hw, hd, a1), P(hw, hd, a1), P(hw, -hd, a1), P(-hw, -hd, a1)];
      const cwx = this.camWX - x, cwy = this.camWY - y;
      const faces = [
        { n: [sa, -ca], d: hd, i: [0, 1] },
        { n: [ca, sa], d: hw, i: [1, 2] },
        { n: [-sa, ca], d: hd, i: [2, 3] },
        { n: [-ca, -sa], d: hw, i: [3, 0] }
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

    sphere(x, y, alt, r, cols) {
      const P = this.proj(x, y, alt), c = this.ctx, rr = r * P.s;
      if (rr < 0.5) return;
      const g = c.createRadialGradient(P.x - rr * 0.35, P.y - rr * 0.45, rr * 0.1, P.x, P.y, rr * 1.05);
      g.addColorStop(0, cols[3]); g.addColorStop(0.38, cols[2]); g.addColorStop(0.78, cols[1]); g.addColorStop(1, cols[0]);
      c.fillStyle = g;
      c.beginPath(); c.arc(P.x, P.y, rr, 0, TAU); c.fill();
    }

    /* A squat, lumpy rock: a flattened shaded dome with a couple of knobs. */
    boulder(x, y, r) {
      const P = this.proj(x, y, r * 0.35), c = this.ctx, rr = r * P.s, cols = this.rockCols;
      if (rr < 0.5) return;
      const sq = 0.78;
      const g = c.createRadialGradient(P.x - rr * 0.35, P.y - rr * 0.5, rr * 0.1, P.x, P.y, rr * 1.05);
      g.addColorStop(0, cols[3]); g.addColorStop(0.4, cols[2]); g.addColorStop(0.8, cols[1]); g.addColorStop(1, cols[0]);
      c.fillStyle = g;
      c.beginPath(); c.ellipse(P.x, P.y, rr, rr * sq, 0, 0, TAU); c.fill();
      c.fillStyle = cols[3];
      c.globalAlpha = 0.4;
      c.beginPath(); c.ellipse(P.x - rr * 0.3, P.y - rr * 0.35, rr * 0.3, rr * 0.22, 0, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(P.x + rr * 0.25, P.y - rr * 0.15, rr * 0.2, rr * 0.15, 0, 0, TAU); c.fill();
      c.globalAlpha = 1;
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

    /* ---------------- scenery ---------------- */

    collectTiles(list) {
      const s = this.stageRef;
      const R = this.objZ;
      const tx0 = Math.max(0, Math.floor((this.px - R) / TS)), tx1 = Math.min(s.MW - 1, Math.floor((this.px + R) / TS));
      const ty0 = Math.max(0, Math.floor((this.py - R) / TS)), ty1 = Math.min(s.MH - 1, Math.floor((this.py + R) / TS));
      const halfFov = (this.w / 2) / this.f;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const v = s.map[ty * s.MW + tx];
          if (!TALL[v]) continue;
          const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS;
          const z = this.depth(cx, cy);
          if (z < 40 || z > this.objZ) continue;
          const X = (cx - this.px) * this.ca + (cy - this.py) * this.sa;
          if (Math.abs(X) - 30 > halfFov * z) continue;
          if (v === T.ROCK) {
            for (const b of global.rockBlobs(tx, ty)) {
              const bz = this.depth(b.x, b.y);
              if (bz > 30) list.push({ z: bz, fn: () => this.boulder(b.x, b.y, b.r * 0.8) });
            }
          } else {
            list.push({ z, fn: () => this.drawBlock(tx, ty) });
          }
        }
      }
    }

    drawBlock(tx, ty) {
      const x = (tx + 0.5) * TS, y = (ty + 0.5) * TS, key = this.stageRef.theme.key, c = this.ctx;
      if (key === 'city') {
        this.obox(x, y, 0, 16, 16, 0, 8, '#3c6a28', { top: '#2a6ad8' });
        const P = this.proj(x, y, 12), rr = 13 * P.s;
        const g = c.createRadialGradient(P.x - rr * 0.3, P.y - rr * 0.4, rr * 0.1, P.x, P.y, rr);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#c4c4cc'); g.addColorStop(1, '#6a6a74');
        c.fillStyle = g;
        c.beginPath(); c.ellipse(P.x, P.y, rr, rr * Math.max(0.35, this.camH / P.z), 0, 0, TAU); c.fill();
        return;
      }
      if (key === 'base') {
        this.obox(x, y, 0, 15, 15, 0, 14, '#6a4430', { top: '#7a5038' });
        this.sphere(x, y, 16, 9, ['#14286a', '#3a6ae0', '#7aa0ff', '#d4e4ff']);
        return;
      }
      this.obox(x, y, 0, 14, 14, 0, 12, '#6a6e78', { top: '#9a9ea8' });
      const P = this.proj(x, y + 6, 12.5);
      c.fillStyle = Math.floor(this.t * 3 + tx) % 2 ? '#ff3a2a' : '#6a1010';
      c.fillRect(P.x - 1.5 * P.s * 1.5, P.y - P.s * 1.5, 3 * P.s * 1.5, 2 * P.s * 1.5);
    }

    /* ---------------- units ---------------- */

    drawPlayer(g) {
      const p = g.player, c = this.ctx;
      c.save();
      if (p.invuln > 0 && p.invuln < 50 && Math.floor(this.t * 14) % 2) c.globalAlpha = 0.4;
      const base = p.lift * 80 + (p.jump ? p.alt * 60 : 0);
      const pitch = p.wheelie * 0.75;
      const ph = p.tread % 6;
      const fx = Math.sin(p.a), fy = -Math.cos(p.a), rx = Math.cos(p.a), ry = Math.sin(p.a);
      for (const side of [-1, 1]) {
        const ox = p.x + rx * side * 13, oy = p.y + ry * side * 13;
        this.obox(ox, oy, p.a, 4.5, 15, base, base + 9, '#8a6a2a', { pitch, top: '#d8b25a' });
        for (let k = -15 + ph * 0.5; k < 15; k += 3) {
          const lx = ox + fx * k, ly = oy + fy * k;
          const a0 = this.proj(lx - rx * 4.5, ly - ry * 4.5, base + 9 + (k + 15) * pitch);
          const a1 = this.proj(lx + rx * 4.5, ly + ry * 4.5, base + 9 + (k + 15) * pitch);
          c.strokeStyle = '#4a3410'; c.lineWidth = Math.max(1, a0.s);
          c.beginPath(); c.moveTo(a0.x, a0.y); c.lineTo(a1.x, a1.y); c.stroke();
        }
      }
      this.obox(p.x, p.y, p.a, 8.5, 13, base + 4, base + 12, '#c8ced8', { pitch, top: '#eef1f5' });
      for (const side of [-1, 1]) this.obox(p.x + rx * side * 7, p.y + ry * side * 7, p.a, 1.6, 7, base + 9, base + 13.5, '#2a50d0', { pitch, top: '#5a80ff' });
      const tAlt = base + 13 + 12 * pitch;
      const len = 24 - p.recoil * 5;
      const front = this.depth(p.x + fx * 20, p.y + fy * 20) < this.depth(p.x, p.y);
      const drawBarrel = () => {
        this.beam(p.x, p.y, tAlt + 3, p.x + fx * len, p.y + fy * len, tAlt + 3 + len * pitch, 4.5, '#5a606a');
        this.beam(p.x, p.y, tAlt + 3.5, p.x + fx * len, p.y + fy * len, tAlt + 3.5 + len * pitch, 2.4, '#d8dde4');
      };
      if (!front) drawBarrel();
      this.obox(p.x - fx, p.y - fy, p.a, 5.5, 6.5, tAlt, tAlt + 5, '#dfe3ea', { pitch: pitch * 0.4, top: '#ffffff' });
      const lp = this.proj(p.x, p.y, tAlt + 5.3);
      c.fillStyle = '#ff3a2a';
      c.beginPath(); c.arc(lp.x, lp.y, Math.max(1, 1.6 * lp.s), 0, TAU); c.fill();
      if (front) drawBarrel();
      if (p.invuln > 0 && p.invuln < 50) {
        const P = this.proj(p.x, p.y, base + 12);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'lighter';
        const rr = 30 * P.s;
        const sg = c.createRadialGradient(P.x, P.y, rr * 0.55, P.x, P.y, rr);
        sg.addColorStop(0, 'rgba(122,208,255,0)');
        sg.addColorStop(1, 'rgba(122,208,255,' + (0.3 + 0.15 * Math.sin(this.t * 12)).toFixed(2) + ')');
        c.fillStyle = sg;
        c.beginPath(); c.ellipse(P.x, P.y, rr, rr * 0.75, 0, 0, TAU); c.fill();
      }
      c.restore();
    }

    drawPyramid(e) {
      // triangular footprint pointing away from the fortress centre, apex raised
      const a = e.a, ox = Math.cos(a), oy = Math.sin(a), px = -oy, py = ox;
      const tip = [e.x + ox * 13, e.y + oy * 13], l = [e.x - ox * 9 + px * 12, e.y - oy * 9 + py * 12], r = [e.x - ox * 9 - px * 12, e.y - oy * 9 - py * 12];
      const apexAlt = 18, fl = e.hitFlash > 0;
      const A = this.proj(e.x, e.y, apexAlt);
      const faces = [[tip, l], [l, r], [r, tip]].map(([p0, p1]) => {
        const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
        let nx = mx - e.x, ny = my - e.y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        return { p0, p1, nx, ny, z: this.depth(mx, my) };
      }).sort((f1, f2) => f2.z - f1.z);
      for (const fc of faces) {
        const k = faceLight(fc.nx, fc.ny) * 1.05;
        this.poly([this.proj(fc.p0[0], fc.p0[1], 0), this.proj(fc.p1[0], fc.p1[1], 0), A], fl ? '#ffffff' : shade('#d4302a', k));
      }
    }

    drawCore(g, e) {
      const c = this.ctx;
      const pent = (r, alt) => {
        const pts = [];
        for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * TAU / 5; pts.push(this.proj(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, alt)); }
        return pts;
      };
      // low red pentagon block
      const r0 = 17, h0 = 6;
      for (let k = 0; k < 5; k++) {
        const a0 = -Math.PI / 2 + k * TAU / 5, a1 = a0 + TAU / 5;
        const x0 = e.x + Math.cos(a0) * r0, y0 = e.y + Math.sin(a0) * r0, x1 = e.x + Math.cos(a1) * r0, y1 = e.y + Math.sin(a1) * r0;
        const nx = Math.cos(a0 + TAU / 10), ny = Math.sin(a0 + TAU / 10);
        if (nx * (this.camWX - e.x) + ny * (this.camWY - e.y) <= r0 * 0.8) continue;
        this.poly([this.proj(x0, y0, 0), this.proj(x1, y1, 0), this.proj(x1, y1, h0), this.proj(x0, y0, h0)], shade('#a8201c', faceLight(nx, ny)));
      }
      this.poly(pent(r0, h0), e.hitFlash > 0 ? '#ffffff' : '#d4302a');
      this.poly(pent(10, h0 + 0.2), '#5a0c0c');
      if (!g.coreOpen) {
        this.sphere(e.x, e.y, h0 + 2, 5, ['#3a0606', '#7a1410', '#a82a20', '#d8584a']);
        return;
      }
      const P = this.proj(e.x, e.y, h0 + 10), pulse = 0.5 + 0.5 * Math.sin(this.t * 8);
      const rr = (9 + pulse * 2) * P.s;
      c.save();
      c.globalCompositeOperation = 'lighter';
      const gl = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr * 2.6);
      gl.addColorStop(0, 'rgba(255,237,213,0.9)');
      gl.addColorStop(0.35, 'rgba(255,90,58,0.7)');
      gl.addColorStop(1, 'rgba(232,32,28,0)');
      c.fillStyle = gl;
      c.beginPath(); c.arc(P.x, P.y, rr * 2.6, 0, TAU); c.fill();
      c.restore();
      this.sphere(e.x, e.y, h0 + 10, 9 + pulse * 2, ['#7a1410', '#ff4a2a', '#ffc890', '#ffffff']);
    }

    drawEnemy(g, e) {
      const c = this.ctx, fl = e.hitFlash > 0;
      switch (e.type) {
        case 'tank': {
          for (const side of [-1, 1]) this.obox(e.x + Math.cos(e.a) * side * 11, e.y + Math.sin(e.a) * side * 11, e.a, 3.5, 13, 0, 8, '#4a2a3c', { top: '#6a3a56' });
          this.obox(e.x, e.y, e.a, 7.5, 11, 3, 11, fl ? '#ffffff' : '#c46a9a', { top: fl ? '#ffffff' : '#f0b0d2' });
          const fx = Math.sin(e.ta), fy = -Math.cos(e.ta);
          const back = this.depth(e.x + fx * 10, e.y + fy * 10) > this.depth(e.x, e.y);
          const barrel = () => this.beam(e.x, e.y, 15, e.x + fx * 21, e.y + fy * 21, 15, 3.2, '#3a3440');
          if (back) barrel();
          this.obox(e.x, e.y, e.ta, 5, 5.5, 11, 17, fl ? '#ffffff' : '#d888b4', { top: fl ? '#ffffff' : '#ffd2e8' });
          if (!back) barrel();
          break;
        }
        case 'turret': {
          this.obox(e.x, e.y, 0, 14, 14, 0, 6, '#4a4a54', { top: '#7a7a84' });
          const fx = Math.sin(e.ta), fy = -Math.cos(e.ta);
          const back = this.depth(e.x + fx * 10, e.y + fy * 10) > this.depth(e.x, e.y);
          const barrel = () => this.beam(e.x, e.y, 15, e.x + fx * 22, e.y + fy * 22, 15, 3, '#2a2a32');
          if (back) barrel();
          this.sphere(e.x, e.y, 15, 9.5, fl ? ['#ffffff', '#ffffff', '#ffffff', '#ffffff'] : ['#3a3a46', '#8a8a96', '#c8c8d2', '#ffffff']);
          if (!back) barrel();
          break;
        }
        case 'mortar': {
          const fx = Math.sin(e.ta), fy = -Math.cos(e.ta);
          this.sphere(e.x, e.y, 6, 13, fl ? ['#ffffff', '#ffffff', '#ffffff', '#ffffff'] : ['#5a4620', '#c4a45a', '#e8d090', '#fff4d0']);
          this.beam(e.x, e.y, 12, e.x + fx * 8, e.y + fy * 8, 26, 6, '#24221e');
          this.beam(e.x, e.y, 12, e.x + fx * 8, e.y + fy * 8, 26, 3.5, '#6a6656');
          break;
        }
        case 'chopper': {
          const alt = 68 + Math.sin(e.t * 2 + e.id) * 4;
          const fx = Math.sin(e.a), fy = -Math.cos(e.a);
          this.beam(e.x, e.y, alt + 4, e.x - fx * 26, e.y - fy * 26, alt + 6, 3, '#6a6e78');
          this.obox(e.x, e.y, e.a, 6, 11, alt, alt + 9, fl ? '#ffffff' : '#9aa0aa', { top: fl ? '#ffffff' : '#d8dce4' });
          this.beam(e.x - Math.cos(e.a) * 6, e.y - Math.sin(e.a) * 6, alt + 9.2, e.x + Math.cos(e.a) * 6, e.y + Math.sin(e.a) * 6, alt + 9.2, 2.5, '#e46aa8');
          const cp = this.proj(e.x + fx * 7, e.y + fy * 7, alt + 8);
          c.fillStyle = '#5ad0f0';
          c.beginPath(); c.ellipse(cp.x, cp.y, 4 * cp.s, 3 * cp.s, 0, 0, TAU); c.fill();
          const rp = this.proj(e.x, e.y, alt + 12), rr = 20 * rp.s;
          c.fillStyle = 'rgba(220,224,232,0.16)';
          c.beginPath(); c.ellipse(rp.x, rp.y, rr, rr * 0.35, 0, 0, TAU); c.fill();
          c.strokeStyle = 'rgba(230,234,240,0.6)';
          c.lineWidth = Math.max(1, 1.5 * rp.s);
          const ra = this.t * 24;
          for (let k = 0; k < 2; k++) {
            const a = ra + k * Math.PI / 2;
            const r0 = this.proj(e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, alt + 12), r1 = this.proj(e.x - Math.cos(a) * 20, e.y - Math.sin(a) * 20, alt + 12);
            c.beginPath(); c.moveTo(r0.x, r0.y); c.lineTo(r1.x, r1.y); c.stroke();
          }
          break;
        }
        case 'fortgun': this.drawPyramid(e); break;
        case 'core': this.drawCore(g, e); break;
      }
    }

    drawShot(s) {
      const c = this.ctx;
      const head = this.proj(s.x, s.y, 16), tail = this.proj(s.x - s.vx * 0.05, s.y - s.vy * 0.05, 16);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      const gr = c.createLinearGradient(tail.x, tail.y, head.x, head.y);
      gr.addColorStop(0, 'rgba(74,176,240,0)');
      gr.addColorStop(1, 'rgba(150,220,255,0.95)');
      c.strokeStyle = gr;
      c.lineWidth = Math.max(2, 6 * head.s);
      c.shadowColor = '#4ab0f0';
      c.shadowBlur = 12 * this.ui;
      c.beginPath(); c.moveTo(tail.x, tail.y); c.lineTo(head.x, head.y); c.stroke();
      c.shadowBlur = 0;
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(1, 2 * head.s);
      c.beginPath(); c.moveTo(lerp(tail.x, head.x, 0.6), lerp(tail.y, head.y, 0.6)); c.lineTo(head.x, head.y); c.stroke();
      c.restore();
    }

    drawEShot(b) {
      const c = this.ctx, alt = b.flying ? 40 : 14;
      const P = this.proj(b.x, b.y, alt);
      const r = Math.max(2, (b.kind === 'plasma' ? 4 : 3.4) * P.s);
      c.save();
      c.globalCompositeOperation = 'lighter';
      const gg = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, r * 2.2);
      gg.addColorStop(0, 'rgba(255,255,255,1)');
      gg.addColorStop(0.4, 'rgba(255,154,216,0.95)');
      gg.addColorStop(1, 'rgba(255,106,192,0)');
      c.fillStyle = gg;
      c.beginPath(); c.arc(P.x, P.y, r * 2.2, 0, TAU); c.fill();
      c.restore();
    }

    drawGrenade(gr) {
      const c = this.ctx;
      const alt = gr.alt * 70 + 6;
      const P = this.proj(gr.x, gr.y, alt), r = Math.max(1.5, 4 * P.s);
      const g = c.createRadialGradient(P.x - r * 0.3, P.y - r * 0.3, r * 0.1, P.x, P.y, r);
      g.addColorStop(0, gr.owner === 'enemy' ? '#ffc4ea' : '#e0f8a0');
      g.addColorStop(1, gr.owner === 'enemy' ? '#5a1a40' : '#2a3a0a');
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
        g.addColorStop(0, 'rgba(' + s.rgb + ',' + (0.5 * k).toFixed(3) + ')');
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
      if (!p.alive || g.state !== 'play' || Math.floor(this.t * 3) % 3 === 2) return;
      const ga = g.guideAngle(p.x, p.y), fx = Math.sin(ga), fy = -Math.cos(ga), rx = Math.cos(ga), ry = Math.sin(ga);
      const cx = p.x + fx * 52, cy = p.y + fy * 52;
      const pt = (u, v, alt) => this.proj(cx + rx * u + fx * v, cy + ry * u + fy * v, alt);
      const disc = [];
      for (let k = 0; k < 20; k++) { const a = k / 20 * TAU; disc.push(this.proj(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, 1)); }
      this.poly(disc, '#f8d020');
      this.poly([pt(0, 8, 1.2), pt(7, 0, 1.2), pt(2.5, 0, 1.2), pt(2.5, -7, 1.2), pt(-2.5, -7, 1.2), pt(-2.5, 0, 1.2), pt(-7, 0, 1.2)], '#1a1a1a');
    }

    /* ---------------- HUD ---------------- */

    panel(x, y, w, h) {
      const c = this.ctx;
      global.roundRectPath(c, x, y, w, h, 10 * this.ui);
      c.fillStyle = 'rgba(6,10,24,0.6)';
      c.fill();
      c.strokeStyle = 'rgba(246,168,216,0.18)';
      c.lineWidth = Math.max(1, this.ui);
      c.stroke();
    }

    label(text, x, y, align, color) {
      const c = this.ctx;
      c.textAlign = align;
      c.font = '700 ' + Math.round(13 * this.ui) + 'px Rajdhani, "Segoe UI", sans-serif';
      c.fillStyle = color || PINK;
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
      this.value(String(g.score), pad + 16 * u, pad + 48 * u, 'left', '#ffffff');

      const tw = 120 * u;
      this.panel(w / 2 - tw / 2, pad, tw, ph);
      this.label('TIME', w / 2, pad + 20 * u, 'center');
      const tl = Math.max(0, Math.ceil(g.timeLeft));
      this.value(String(tl).padStart(2, '0'), w / 2, pad + 50 * u, 'center', tl <= 20 && Math.floor(t * 4) % 2 ? '#ffffff' : PINK, 30);

      this.panel(w - pad - pw, pad, pw, ph);
      this.label('TOPSCORE', w - pad - 16 * u, pad + 20 * u, 'right');
      this.value(String(Math.max(g.hiScore, g.score)), w - pad - 16 * u, pad + 48 * u, 'right', '#ffffff');

      const bh = 58 * u, by = h - pad - bh;
      this.panel(pad, by, 210 * u, bh);
      this.label('TANKS', pad + 16 * u, by + 20 * u, 'left');
      for (let i = 0; i < Math.min(Math.max(g.lives - (g.player.alive ? 1 : 0), 0), 6); i++) {
        const ix = pad + 26 * u + i * 28 * u, iy = by + 34 * u;
        c.fillStyle = '#b8903c'; c.fillRect(ix - 10 * u, iy, 5 * u, 16 * u); c.fillRect(ix + 5 * u, iy, 5 * u, 16 * u);
        c.fillStyle = '#dfe3ea'; c.fillRect(ix - 5 * u, iy + 2 * u, 10 * u, 12 * u);
        c.fillStyle = '#2a50d0'; c.fillRect(ix - 3 * u, iy + 6 * u, 6 * u, 3 * u);
        c.fillStyle = '#c8ced8'; c.fillRect(ix - 1 * u, iy - 5 * u, 2 * u, 8 * u);
      }
      const aw = 210 * u;
      this.panel(w - pad - aw, by, aw, bh);
      this.label(g.stage.theme.name, w - pad - 16 * u, by + 20 * u, 'right', '#c8ccd8');
      this.value('STAGE ' + String(g.stageNum).padStart(2, '0'), w - pad - 16 * u, by + 46 * u, 'right', '#ffffff', 22);

      const p = g.player;
      let status = null;
      if (p.lift > 0.9) status = 'LIFT ZONE';
      else if (g.coreOpen && g.state === 'play') status = 'CORE EXPOSED';
      if (status && Math.floor(t * 3) % 2 === 0) {
        c.textAlign = 'center';
        c.font = '700 ' + Math.round(18 * u) + 'px Rajdhani, "Segoe UI", sans-serif';
        c.fillStyle = PINK;
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
      c.translate(this.w / 2, this.h * 0.38);
      const sc = 0.85 + 0.15 * (1 - Math.pow(1 - kin, 3));
      c.scale(sc, sc);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const size = Math.round(Math.min(54 * u, this.w / (m.text.length * 0.9)));
      c.font = '800 ' + size + 'px Orbitron, "Segoe UI", sans-serif';
      c.lineWidth = Math.max(2, 5 * u);
      c.strokeStyle = '#4a1438';
      c.strokeText(m.text, 0, 0);
      c.fillStyle = m.text === 'GAME OVER' ? '#ffffff' : PINK;
      c.fillText(m.text, 0, 0);
      if (m.sub) {
        c.font = '700 ' + Math.round(22 * u) + 'px Rajdhani, "Segoe UI", sans-serif';
        let y = size * 0.95;
        for (const line of m.sub.split('\n')) {
          c.lineWidth = Math.max(2, 4 * u);
          c.strokeText(line.split('').join(' '), 0, y);
          c.fillStyle = '#ffffff';
          c.fillText(line.split('').join(' '), 0, y);
          y += 28 * u;
        }
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
      c.fillStyle = '#01030a';
      c.fillRect(0, 0, w, h);

      c.save();
      if (this.shake > 0) c.translate((Math.random() - 0.5) * this.shake * this.ui, (Math.random() - 0.5) * this.shake * this.ui);
      this.drawSpace();
      this.drawGround();

      // Floor lighting and markers
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const l of this.lights) this.floorLight(l.x, l.y, l.r, l.rgb, 0.5 * (l.life / l.max));
      for (const s of g.shots) this.floorLight(s.x, s.y, 34, '122,208,255', 0.22);
      for (const b of g.eshots) this.floorLight(b.x, b.y, 28, '255,154,216', 0.22);
      if (g.coreOpen) {
        const core = g.enemies.find(e => e.type === 'core');
        if (core) this.floorLight(core.x, core.y, 120, '255,90,58', 0.3 + 0.1 * Math.sin(this.t * 8));
      }
      for (const r of this.rings) {
        const P = this.proj(r.x, r.y, 0);
        if (P.z < 20 || P.z > this.objZ) continue;
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
        this.groundEllipse(gr.x1, gr.y1, gr.r, 'rgba(255,106,192,0.18)', 'rgba(255,154,216,0.95)');
      }
      this.drawGuide(g);

      // Shadows
      const p = g.player;
      for (const e of g.enemies) if (e.type !== 'core') this.shadow(e.x + (e.flying ? 14 : 2), e.y + (e.flying ? 18 : 3), e.flying ? 16 : e.r * 1.1, e.flying ? 0.35 : 0.3);
      if (p.alive) this.shadow(p.x + 3 + p.alt * 20, p.y + 4 + p.alt * 24, 20 + p.alt * 4, 0.4 - p.alt * 0.1);
      for (const gr of g.grenades) this.shadow(gr.x, gr.y, 4, 0.35);

      // Depth-sorted scenery and actors
      const list = [];
      this.collectTiles(list);
      for (const e of g.enemies) {
        const z = this.depth(e.x, e.y) - (e.flying ? 60 : 0) + (e.type === 'core' ? 6 : 0);
        if (z > 20 && z < this.objZ) list.push({ z, fn: () => this.drawEnemy(g, e) });
      }
      if (p.alive) list.push({ z: this.depth(p.x, p.y) - (p.alt > 0 ? 80 : 0), fn: () => this.drawPlayer(g) });
      for (const s of g.shots) list.push({ z: this.depth(s.x, s.y) - 2, fn: () => this.drawShot(s) });
      for (const b of g.eshots) list.push({ z: this.depth(b.x, b.y) - (b.flying ? 30 : 2), fn: () => this.drawEShot(b) });
      for (const gr of g.grenades) list.push({ z: this.depth(gr.x, gr.y) - 40, fn: () => this.drawGrenade(gr) });
      list.sort((a, b) => b.z - a.z);
      for (const d of list) d.fn();

      this.drawParticles();

      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const pp of this.popups) {
        const P = this.proj(pp.x, pp.y, pp.alt);
        if (P.z < 20) continue;
        c.globalAlpha = clamp(pp.life / pp.max * 2, 0, 1);
        c.font = '700 ' + Math.round(16 * this.ui) + 'px Rajdhani, "Segoe UI", sans-serif';
        c.fillStyle = pp.color || '#ffffff';
        c.shadowColor = 'rgba(74,20,56,0.95)';
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
