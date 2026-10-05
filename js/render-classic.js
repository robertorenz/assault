/* Assault Revamped — Classic renderer.
 * Recreates the arcade presentation: a vertical 224x288 screen whose
 * playfield (a floating landmass over a starfield) rotates around the player's
 * tank with nearest-neighbour sampling, arcade-style sprites, the pink
 * SCORE / TIME / TOPSCORE HUD, then a CRT pass. */
(function (global) {
  'use strict';

  const { T, TS } = global.Assault;
  const BW = 224, BH = 288;
  const FONT = '"Press Start 2P", "Courier New", monospace';
  const PINK = '#f6a8d8', PINK_DARK = '#4a1438', NUM = '#ffffff', NUM_SHADOW = '#2840d8';

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;

  function makeSprite(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    draw((px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); }, x);
    return c;
  }

  function ball(x, cx, cy, r, cols) {
    const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, cols[0]); g.addColorStop(0.45, cols[1]); g.addColorStop(1, cols[2]);
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
  }

  function treads(R, x0, y0, len, w, phase, base, lug, hi) {
    R(x0, y0, w, len, lug);
    R(x0 + 1, y0, w - 2, len, base);
    for (let y = y0 + (phase % 3); y < y0 + len; y += 3) R(x0, y, w, 1, lug);
    R(x0 + 1, y0, 1, len, hi);
  }

  /* ---------------- sprites (all face "up") ---------------- */

  const playerFrames = [0, 1, 2].map(ph => makeSprite(26, 32, R => {
    treads(R, 0, 8, 23, 6, ph, '#b8903c', '#4a3410', '#f0d27a');
    treads(R, 20, 8, 23, 6, ph, '#b8903c', '#4a3410', '#f0d27a');
    R(6, 10, 14, 21, '#8a92a0');
    R(6, 10, 13, 20, '#dfe3ea');
    R(6, 10, 1, 20, '#ffffff');
    R(6, 13, 3, 13, '#2a50d0'); R(17, 13, 3, 13, '#2a50d0');
    R(6, 13, 3, 2, '#7aa0ff'); R(17, 13, 3, 2, '#7aa0ff');
    R(9, 26, 8, 4, '#a8b0bc');
    R(10, 27, 2, 2, '#30343c'); R(14, 27, 2, 2, '#30343c');
    R(9, 12, 8, 10, '#7a828e');
    R(10, 12, 6, 9, '#f2f4f8');
    R(10, 17, 6, 2, '#3a5ae0');
    R(12, 14, 2, 2, '#ff3a2a');
    R(12, 0, 2, 15, '#c8ced8');
    R(13, 0, 1, 15, '#7a828e');
    R(11, 0, 4, 2, '#5a606a');
    R(6, 8, 3, 3, '#f0d27a'); R(17, 8, 3, 3, '#f0d27a');
  }));

  const enemyTankFrames = [0, 1, 2].map(ph => makeSprite(24, 28, R => {
    treads(R, 0, 3, 24, 6, ph, '#5a3048', '#2a1222', '#8a5a74');
    treads(R, 18, 3, 24, 6, ph, '#5a3048', '#2a1222', '#8a5a74');
    R(6, 4, 12, 22, '#7a3a62');
    R(6, 4, 11, 21, '#e4a2c6');
    R(6, 4, 11, 2, '#ffd2e8');
    R(6, 18, 11, 6, '#bc6c98');
    R(8, 20, 3, 2, '#5a2446'); R(13, 20, 3, 2, '#5a2446');
  }));
  const enemyTurretTop = makeSprite(14, 26, R => {
    R(6, 0, 2, 14, '#3a3440');
    R(6, 0, 1, 14, '#7a7084');
    R(2, 10, 10, 10, '#7a3a62');
    R(3, 10, 8, 9, '#f0b4d4');
    R(3, 10, 8, 2, '#ffe0f0');
    R(5, 14, 4, 3, '#9a4a7a');
  });

  const turretBase = makeSprite(30, 30, (R, x) => {
    x.fillStyle = '#3e3e46';
    x.beginPath();
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + Math.PI / 8; x.lineTo(15 + Math.cos(a) * 15, 15 + Math.sin(a) * 15); }
    x.fill();
    x.fillStyle = '#787882';
    x.beginPath();
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + Math.PI / 8; x.lineTo(15 + Math.cos(a) * 13, 15 + Math.sin(a) * 13); }
    x.fill();
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + Math.PI / 4; R(Math.round(15 + Math.cos(a) * 10) - 1, Math.round(15 + Math.sin(a) * 10) - 1, 2, 2, '#c8c8d0'); }
  });
  const turretTop = makeSprite(22, 32, (R, x) => {
    R(10, 0, 2, 16, '#2a2a32');
    R(10, 0, 1, 16, '#6a6a74');
    ball(x, 11, 18, 9, ['#ffffff', '#b8b8c2', '#4a4a56']);
    R(9, 21, 4, 2, '#3a3a44');
  });

  const mortarBase = makeSprite(28, 28, (R, x) => {
    ball(x, 14, 14, 13, ['#f0dca0', '#c4a45a', '#5a4620']);
    R(9, 9, 10, 10, '#4a3a1a');
  });
  const mortarTube = makeSprite(10, 20, R => {
    R(2, 0, 6, 12, '#24221e');
    R(3, 0, 3, 12, '#6a6656');
    R(2, 0, 6, 2, '#101010');
    R(1, 11, 8, 7, '#8a6a30');
    R(2, 12, 5, 5, '#c8a050');
  });

  const chopperBody = makeSprite(22, 36, (R, x) => {
    R(10, 20, 2, 14, '#6a6e78'); R(6, 32, 10, 2, '#6a6e78');
    x.fillStyle = '#3a3e48';
    x.beginPath(); x.ellipse(11, 13, 7, 11, 0, 0, TAU); x.fill();
    x.fillStyle = '#c8ccd6';
    x.beginPath(); x.ellipse(11, 13, 6, 10, 0, 0, TAU); x.fill();
    R(6, 15, 10, 2, '#e46aa8');
    x.fillStyle = '#5ad0f0';
    x.beginPath(); x.ellipse(11, 7, 4, 4, 0, 0, TAU); x.fill();
    R(10, 5, 2, 1, '#e6fbff');
    R(2, 12, 4, 6, '#4a4e58'); R(16, 12, 4, 6, '#4a4e58');
  });

  const pyramid = makeSprite(26, 24, (R, x) => {
    x.fillStyle = '#5a0c0c';
    x.beginPath(); x.moveTo(13, 0); x.lineTo(26, 24); x.lineTo(0, 24); x.closePath(); x.fill();
    x.fillStyle = '#ff6a58';
    x.beginPath(); x.moveTo(13, 2); x.lineTo(13, 18); x.lineTo(2, 22); x.closePath(); x.fill();
    x.fillStyle = '#c42a22';
    x.beginPath(); x.moveTo(13, 2); x.lineTo(24, 22); x.lineTo(13, 18); x.closePath(); x.fill();
    x.fillStyle = '#8a1414';
    x.beginPath(); x.moveTo(2, 22); x.lineTo(13, 18); x.lineTo(24, 22); x.closePath(); x.fill();
    R(12, 3, 2, 8, '#ffd0c8');
  });

  const lifeIcon = makeSprite(11, 10, R => {
    R(0, 2, 3, 8, '#b8903c'); R(8, 2, 3, 8, '#b8903c');
    R(3, 3, 5, 7, '#dfe3ea'); R(4, 6, 3, 2, '#3a5ae0');
    R(5, 0, 1, 4, '#c8ced8');
  });

  // Starfield tile — part of the map plane, so it turns with the playfield
  const starTile = makeSprite(128, 128, R => {
    R(0, 0, 128, 128, '#000000');
    let s = 99;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 46; i++) {
      const c = ['#ffffff', '#c8d8ff', '#ffe8c8', '#8890a8', '#5a6070'][Math.floor(r() * 5)];
      const big = r() < 0.12;
      R(Math.floor(r() * 128), Math.floor(r() * 128), big ? 2 : 1, big ? 2 : 1, c);
    }
  });

  class ClassicRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.buf = document.createElement('canvas');
      this.buf.width = BW;
      this.buf.height = BH;
      this.b = this.buf.getContext('2d');
      this.starPat = this.b.createPattern(starTile, 'repeat');
      this.t = 0;
      this.hideHud = false;
      this.w = 1; this.h = 1;
      this.mapTex = null;
      this.stageRef = null;
      this.reset();
    }

    reset() {
      this.parts = []; this.booms = []; this.flash = 0; this.flashCol = '#ffffff'; this.shake = 0; this.popups = [];
    }

    resize(w, h) { this.w = w; this.h = h; }

    ensureMap(g) {
      if (this.stageRef !== g.stage) {
        this.stageRef = g.stage;
        this.mapTex = new global.MapTexture(g.stage, 'flat');
      }
    }

    /* ---------------- events ---------------- */

    onEvent(ev, g) {
      this.ensureMap(g);
      switch (ev.type) {
        case 'tile': this.mapTex.redraw(ev.tx, ev.ty); break;
        case 'explode': {
          const sz = ev.size || 1;
          this.boom(ev.x, ev.y, sz);
          this.debris(ev.x, ev.y, Math.round(8 * sz), ['#ffe060', '#ff8a20', '#e02020', '#3a3a3a']);
          if (!ev.flying) this.mapTex.crater(ev.x, ev.y, 9 + sz * 4, (ev.x * 13 + ev.y) | 0);
          if (ev.points) this.popups.push({ x: ev.x, y: ev.y, text: String(ev.points), life: 1 });
          this.shake = Math.max(this.shake, 1.5 * sz);
          break;
        }
        case 'blast':
          this.boom(ev.x, ev.y, ev.r / 26);
          this.debris(ev.x, ev.y, 12, ['#ffe060', '#ff8a20', '#7a7a7a']);
          this.mapTex.crater(ev.x, ev.y, ev.r * 0.35, (ev.x * 7 + ev.y) | 0);
          this.shake = Math.max(this.shake, 3);
          break;
        case 'hit': this.debris(ev.x, ev.y, 5, ['#ffffff', '#ffe060']); break;
        case 'spark': this.debris(ev.x, ev.y, 3, ev.enemy ? ['#ff9ad8', '#ffffff'] : ['#ffffff', '#a8e8ff']); break;
        case 'intercept': this.boom(ev.x, ev.y, 0.4); break;
        case 'shoot': this.debris(ev.x, ev.y, 2, ['#ffffff', '#a8e8ff']); break;
        case 'land': this.boom(ev.x, ev.y, 1.3); this.shake = 4; break;
        case 'playerDie':
          this.boom(ev.x, ev.y, 1.4);
          this.debris(ev.x, ev.y, 26, ['#ffffff', '#dfe3ea', '#f0d27a', '#ff8a20', '#2a50d0']);
          this.flash = 0.2; this.flashCol = '#ffffff'; this.shake = 6;
          break;
        case 'coreOpen': this.flash = 0.15; this.flashCol = '#ff5a3a'; break;
        case 'stageClear': this.flash = 0.3; this.flashCol = '#ffffff'; this.shake = 8; break;
        case 'extraLife': this.popups.push({ x: ev.x, y: ev.y, text: '1UP', life: 1.6 }); break;
      }
    }

    boom(x, y, size) { this.booms.push({ x, y, size, t: 0, dur: 0.5 + size * 0.15 }); }

    debris(x, y, n, cols) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = rnd(30, 140);
        this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.25, 0.7), col: cols[(Math.random() * cols.length) | 0] });
      }
    }

    update(dt) {
      this.t += dt;
      for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
      this.parts = this.parts.filter(p => p.life > 0);
      for (const b of this.booms) b.t += dt;
      this.booms = this.booms.filter(b => b.t < b.dur);
      for (const p of this.popups) p.life -= dt;
      this.popups = this.popups.filter(p => p.life > 0);
      if (this.flash > 0) this.flash -= dt;
      this.shake = Math.max(0, this.shake - dt * 14);
    }

    /* ---------------- drawing ---------------- */

    rot(img, x, y, a, px, py, sc) {
      const b = this.b;
      b.save();
      b.translate(x, y);
      b.rotate(a);
      if (sc && sc !== 1) b.scale(sc, sc);
      b.drawImage(img, -px, -py);
      b.restore();
    }

    shadow(x, y, rx, ry, alpha) {
      const b = this.b;
      b.fillStyle = 'rgba(0,0,0,' + alpha + ')';
      b.beginPath(); b.ellipse(x, y, rx, ry, 0, 0, TAU); b.fill();
    }

    drawWorld(g) {
      const b = this.b, p = g.player, t = this.t;
      const zoom = 1 - 0.4 * (p.lift || 0) - 0.12 * (p.jump ? p.alt : 0);
      const ca = Math.cos(g.camA), sa = Math.sin(g.camA);
      const sdx = (ox, oy) => [ox * ca - oy * sa, ox * sa + oy * ca];
      const upx = Math.sin(g.camA), upy = -Math.cos(g.camA);

      b.save();
      let shx = 0, shy = 0;
      if (this.shake > 0) { shx = Math.round((Math.random() - 0.5) * this.shake); shy = Math.round((Math.random() - 0.5) * this.shake); }
      b.translate(BW / 2 + shx, Math.round(BH * 0.7) + shy);
      b.scale(zoom, zoom);
      b.rotate(-g.camA);
      b.translate(-p.x, -p.y);

      // Space, then the island texture (only the visible window)
      const R = Math.hypot(BW, BH) / zoom * 0.75 + 32;
      b.fillStyle = this.starPat;
      b.fillRect(p.x - R, p.y - R, R * 2, R * 2);
      const cw = this.mapTex.canvas.width, ch = this.mapTex.canvas.height;
      const sx = clamp(Math.floor(p.x - R), 0, cw), sy = clamp(Math.floor(p.y - R), 0, ch);
      const ex = clamp(Math.ceil(p.x + R), 0, cw), ey = clamp(Math.ceil(p.y + R), 0, ch);
      if (ex > sx && ey > sy) b.drawImage(this.mapTex.canvas, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);

      // Water glints
      if (Math.floor(t * 3) % 2 === 0) {
        const s = g.stage;
        b.fillStyle = 'rgba(220,250,250,0.55)';
        const tx0 = Math.max(0, Math.floor(sx / TS)), tx1 = Math.min(s.MW - 1, Math.floor(ex / TS));
        const ty0 = Math.max(0, Math.floor(sy / TS)), ty1 = Math.min(s.MH - 1, Math.floor(ey / TS));
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          if (s.map[ty * s.MW + tx] !== T.WATER) continue;
          b.fillRect(tx * TS + ((tx * 7 + ty * 3) % 20) + 2, ty * TS + ((tx * 5 + ty * 11) % 24) + 4, 4, 1);
        }
      }

      // Stage exit hole once the fortress falls
      if (g.stage.cleared) {
        const f = g.stage.fort, hx = f.cx * TS, hy = f.cy * TS;
        b.fillStyle = '#9a9aaa';
        b.beginPath(); b.arc(hx, hy, 26, 0, TAU); b.fill();
        b.fillStyle = '#5a5a68';
        b.beginPath(); b.arc(hx, hy, 23, 0, TAU); b.fill();
        b.fillStyle = '#000000';
        b.beginPath(); b.arc(hx + 1, hy + 1, 21, 0, TAU); b.fill();
      }

      // Mortar target markers
      for (const gr of g.grenades) {
        if (gr.owner !== 'enemy' || Math.floor(t * 10) % 2) continue;
        b.strokeStyle = '#ff6ac0';
        b.lineWidth = 1;
        b.beginPath(); b.arc(gr.x1, gr.y1, gr.r * 0.8, 0, TAU); b.stroke();
        b.fillStyle = '#ff6ac0';
        b.fillRect(gr.x1 - 6, gr.y1, 13, 1); b.fillRect(gr.x1, gr.y1 - 6, 1, 13);
      }

      // Ground units
      for (const e of g.enemies) {
        if (e.flying) continue;
        switch (e.type) {
          case 'tank':
            this.rot(enemyTankFrames[Math.floor(e.tread / 4) % 3], e.x, e.y, e.a, 12, 14);
            this.rot(enemyTurretTop, e.x, e.y, e.ta, 7, 15);
            break;
          case 'turret':
            this.rot(turretBase, e.x, e.y, 0, 15, 15);
            this.rot(turretTop, e.x, e.y, e.ta, 11, 18);
            break;
          case 'mortar':
            this.rot(mortarBase, e.x, e.y, 0, 14, 14);
            this.rot(mortarTube, e.x, e.y, e.ta, 5, 15);
            break;
          case 'fortgun':
            this.shadow(e.x + 3, e.y + 4, 12, 10, 0.3);
            this.rot(pyramid, e.x, e.y, e.a + Math.PI / 2, 13, 14);
            if (e.fireCd < 0.15 && Math.floor(t * 20) % 2) { b.fillStyle = 'rgba(255,240,200,0.8)'; b.beginPath(); b.arc(e.x, e.y, 5, 0, TAU); b.fill(); }
            break;
          case 'core':
            this.drawCore(g, e);
            break;
        }
        if (e.hitFlash > 0) { b.fillStyle = 'rgba(255,255,255,0.75)'; b.beginPath(); b.arc(e.x, e.y, Math.min(e.r, 22) * 0.8, 0, TAU); b.fill(); }
      }

      const airborne = p.alive && p.alt > 0.02;
      if (p.alive && !airborne) this.drawPlayer(g, p, 1);

      // Player shots: pale blue tracers
      for (const s of g.shots) {
        const a = Math.atan2(s.vx, -s.vy);
        b.save(); b.translate(s.x, s.y); b.rotate(a);
        b.fillStyle = '#4ab0f0'; b.fillRect(-1.5, -5, 3, 9);
        b.fillStyle = '#e8f8ff'; b.fillRect(-0.5, -5, 1.5, 6);
        b.restore();
      }
      // Enemy fire: pink orbs
      for (const s of g.eshots) {
        const big = s.kind === 'plasma';
        const r = big ? 3.5 : 3;
        b.fillStyle = '#b8408a';
        b.beginPath(); b.arc(s.x, s.y, r + 1, 0, TAU); b.fill();
        b.fillStyle = Math.floor(t * 14) % 2 ? '#ff9ad8' : '#ffc4ea';
        b.beginPath(); b.arc(s.x, s.y, r, 0, TAU); b.fill();
        b.fillStyle = '#ffffff';
        b.fillRect(s.x - 1, s.y - 1, 2, 2);
      }

      // Grenades and bombs
      for (const gr of g.grenades) {
        this.shadow(gr.x, gr.y, 4, 3, 0.4);
        const h = gr.alt * 34;
        const bx = gr.x + upx * h, by = gr.y + upy * h, r = 3 + gr.alt * 2;
        b.fillStyle = gr.owner === 'enemy' ? '#5a2a40' : '#3a4a2a';
        b.beginPath(); b.arc(bx, by, r, 0, TAU); b.fill();
        b.fillStyle = gr.owner === 'enemy' ? '#ff9ad8' : '#c8f070';
        b.fillRect(bx - 1, by - 1, 2, 2);
      }

      // Explosions: fireball with a red shock ring, then smoke
      for (const bm of this.booms) {
        const k = bm.t / bm.dur, r = bm.size * (7 + 14 * Math.sqrt(k));
        if (k < 0.7) {
          b.strokeStyle = '#e8201c';
          b.lineWidth = 2;
          b.beginPath(); b.arc(bm.x, bm.y, r * 1.15, 0, TAU); b.stroke();
          b.fillStyle = '#ff7a1c';
          b.beginPath(); b.arc(bm.x, bm.y, r, 0, TAU); b.fill();
          b.fillStyle = '#ffd23a';
          b.beginPath(); b.arc(bm.x - r * 0.1, bm.y - r * 0.1, r * 0.65, 0, TAU); b.fill();
          if (k < 0.35) {
            b.fillStyle = '#ffffff';
            b.beginPath(); b.arc(bm.x - r * 0.15, bm.y - r * 0.15, r * 0.35, 0, TAU); b.fill();
          }
        } else {
          b.fillStyle = 'rgba(40,36,36,' + (1 - k) * 2 + ')';
          for (let i = 0; i < 4; i++) { b.beginPath(); b.arc(bm.x + Math.cos(i * 1.7) * r * 0.5, bm.y + Math.sin(i * 1.7) * r * 0.5, r * 0.5, 0, TAU); b.fill(); }
        }
      }
      for (const pt of this.parts) {
        b.fillStyle = pt.col;
        b.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);
      }

      // Flyers
      for (const e of g.enemies) {
        if (!e.flying) continue;
        const [ox, oy] = sdx(10, 12);
        this.shadow(e.x + ox, e.y + oy, 9, 7, 0.35);
        this.rot(chopperBody, e.x, e.y, e.a, 11, 13);
        b.save();
        b.translate(e.x, e.y);
        b.rotate(t * 22);
        b.fillStyle = 'rgba(220,224,232,0.8)';
        b.fillRect(-16, -1, 32, 2);
        b.fillRect(-1, -16, 2, 32);
        b.restore();
        if (e.hitFlash > 0) { b.fillStyle = 'rgba(255,255,255,0.75)'; b.beginPath(); b.arc(e.x, e.y, 10, 0, TAU); b.fill(); }
      }
      if (airborne) {
        const [ox, oy] = sdx(8 + p.alt * 16, 10 + p.alt * 18);
        this.shadow(p.x + ox, p.y + oy, 12 + p.alt * 2, 10, 0.4);
        this.drawPlayer(g, p, 1 + p.alt * 0.35);
      }

      // Score popups
      for (const pp of this.popups) {
        b.save();
        b.translate(pp.x, pp.y - (1 - pp.life) * 20);
        b.rotate(g.camA);
        this.text(pp.text, 0, -4, Math.floor(t * 10) % 2 ? PINK : NUM, 'center', 8, true);
        b.restore();
      }

      // Exit sign: yellow disc with an arrow toward the fortress
      if (p.alive && g.state === 'play' && Math.floor(t * 3) % 3 !== 2) {
        const ga = g.guideAngle(p.x, p.y);
        b.save();
        b.translate(p.x + Math.sin(ga) * 44, p.y - Math.cos(ga) * 44);
        b.rotate(ga);
        b.fillStyle = '#000';
        b.beginPath(); b.arc(0, 0, 10, 0, TAU); b.fill();
        b.fillStyle = '#f8d020';
        b.beginPath(); b.arc(0, 0, 9, 0, TAU); b.fill();
        b.fillStyle = '#1a1a1a';
        b.beginPath(); b.moveTo(0, -7); b.lineTo(6, 0); b.lineTo(2, 0); b.lineTo(2, 6); b.lineTo(-2, 6); b.lineTo(-2, 0); b.lineTo(-6, 0); b.closePath(); b.fill();
        b.restore();
      }
      b.restore();
    }

    drawPlayer(g, p, sc) {
      const b = this.b;
      if (p.invuln > 0 && p.invuln < 50 && Math.floor(this.t * 14) % 2) return;
      b.save();
      b.translate(p.x, p.y);
      b.rotate(p.a);
      b.scale(sc, sc * (1 - 0.22 * p.wheelie));
      if (p.wheelie > 0) b.translate(0, 4 * p.wheelie);
      b.drawImage(playerFrames[Math.floor(p.tread / 4) % 3], -13, -17 + p.recoil * 2);
      b.restore();
    }

    drawCore(g, e) {
      const b = this.b, t = this.t;
      const pent = (r, rot) => {
        b.beginPath();
        for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * TAU / 5 + (rot || 0); b.lineTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r); }
        b.closePath();
      };
      pent(18); b.fillStyle = '#4a0808'; b.fill();
      pent(16); b.fillStyle = e.hitFlash > 0 ? '#ffffff' : '#d4302a'; b.fill();
      pent(10); b.fillStyle = '#5a0c0c'; b.fill();
      if (!g.coreOpen) {
        b.fillStyle = '#9a1c16';
        b.beginPath(); b.arc(e.x, e.y, 6, 0, TAU); b.fill();
        b.fillStyle = '#5a0c0c';
        b.beginPath(); b.arc(e.x, e.y, 3, 0, TAU); b.fill();
        return;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 9);
      b.fillStyle = '#ff4a2a';
      b.beginPath(); b.arc(e.x, e.y, 7 + pulse * 2, 0, TAU); b.fill();
      b.fillStyle = '#ffc890';
      b.beginPath(); b.arc(e.x, e.y, 3 + pulse * 2, 0, TAU); b.fill();
      b.fillStyle = '#ffffff';
      b.fillRect(e.x - 1, e.y - 1, 3, 3);
    }

    /* Arcade-style text: coloured fill with a dark outline. */
    text(str, x, y, col, align, size, outline) {
      const b = this.b;
      b.font = (size || 8) + 'px ' + FONT;
      b.textAlign = align || 'left';
      b.textBaseline = 'top';
      if (outline !== false) {
        b.fillStyle = col === NUM ? NUM_SHADOW : PINK_DARK;
        if (col === NUM) b.fillText(str, x + 1, y + 1);
        else for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) b.fillText(str, x + ox, y + oy);
      }
      b.fillStyle = col;
      b.fillText(str, x, y);
    }

    drawHud(g) {
      const b = this.b, t = this.t;
      this.text('SCORE', 12, 3, PINK);
      this.text(String(g.score), 84, 12, NUM, 'right');
      this.text('TOPSCORE', BW - 6, 3, PINK, 'right');
      this.text(String(Math.max(g.hiScore, g.score)), BW - 6, 12, NUM, 'right');
      this.text('TIME', BW / 2, 3, PINK, 'center');
      const tl = Math.max(0, Math.ceil(g.timeLeft));
      if (!(tl <= 20 && Math.floor(t * 4) % 2)) this.text(String(tl).padStart(2, '0'), BW / 2, 12, PINK, 'center', 16);
      const spare = Math.min(Math.max(g.lives - (g.player.alive ? 1 : 0), 0), 6);
      for (let i = 0; i < spare; i++) b.drawImage(lifeIcon, 6 + i * 12, BH - 13);

      const m = g.message;
      if (m && !(m.text === 'READY' && Math.floor(t * 4) % 2)) {
        const big = m.text === 'GAME OVER';
        let y = 104;
        this.text(m.text, BW / 2, y, big ? NUM : PINK, 'center', big ? 16 : 8);
        y += big ? 26 : 16;
        if (m.sub) for (const line of m.sub.split('\n')) { this.text(line, BW / 2, y, PINK, 'center'); y += 13; }
      }
    }

    render(g) {
      this.ensureMap(g);
      const b = this.b;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.imageSmoothingEnabled = false;
      b.fillStyle = '#000';
      b.fillRect(0, 0, BW, BH);
      this.drawWorld(g);
      if (this.flash > 0) {
        b.globalAlpha = Math.min(1, this.flash * 3);
        b.fillStyle = this.flashCol;
        b.fillRect(0, 0, BW, BH);
        b.globalAlpha = 1;
      }
      if (!this.hideHud) this.drawHud(g);
      this.present();
    }

    present() {
      const ctx = this.ctx, w = this.w, h = this.h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if ('filter' in ctx) ctx.filter = 'none';
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, w, h);

      // Vertical arcade monitor: 3:4 display aspect
      const pa = (3 / 4) / (BW / BH);
      const sy = Math.min(h * 0.97 / BH, w * 0.98 / (BW * pa));
      const sx = sy * pa;
      const dw = BW * sx, dh = BH * sy;
      const dx = (w - dw) / 2, dy = (h - dh) / 2;

      const pad = Math.max(6, sy * 3);
      ctx.fillStyle = '#0b0f14';
      roundRect(ctx, dx - pad, dy - pad, dw + pad * 2, dh + pad * 2, pad * 1.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148,163,184,0.12)';
      ctx.lineWidth = Math.max(1, sy * 0.4);
      ctx.stroke();

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.buf, dx, dy, dw, dh);

      if ('filter' in ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.16;
        ctx.filter = 'blur(' + Math.max(1, Math.round(sy * 1.5)) + 'px)';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.buf, dx, dy, dw, dh);
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, dw, dh);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      const lh = Math.max(1, sy * 0.28);
      for (let r = 0; r < BH; r++) ctx.fillRect(dx, dy + r * sy + sy - lh, dw, lh);
      const vg = ctx.createRadialGradient(dx + dw / 2, dy + dh / 2, Math.min(dw, dh) * 0.45, dx + dw / 2, dy + dh / 2, Math.max(dw, dh) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = vg;
      ctx.fillRect(dx, dy, dw, dh);
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  global.ClassicRenderer = ClassicRenderer;
  global.roundRectPath = roundRect;
})(window);
