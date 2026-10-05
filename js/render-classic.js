/* Assault Revamped — Classic renderer.
 * Recreates the arcade presentation: a 288x224 pixel playfield that rotates
 * around the player's tank (nearest-neighbour, like the System 2 rotation
 * hardware), pixel-art sprites, the Namco-style HUD, then a CRT pass. */
(function (global) {
  'use strict';

  const { T } = global.Assault;
  const BW = 288, BH = 224;
  const FONT = '"Press Start 2P", "Courier New", monospace';

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function makeSprite(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    draw((px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); }, x);
    return c;
  }

  /* ---------------- sprites (all face "up") ---------------- */

  function treads(R, x0, y0, len, phase, base, lug, hi) {
    R(x0, y0, 5, len, '#15171c');
    R(x0 + 1, y0, 3, len, base);
    for (let y = y0 + (phase % 4); y < y0 + len; y += 4) R(x0, y, 5, 1, lug);
    R(x0, y0, 1, len, hi);
  }

  const playerFrames = [0, 1, 2, 3].map(ph => makeSprite(22, 30, R => {
    treads(R, 0, 7, 22, ph, '#3a3f48', '#16181d', '#6a707c');
    treads(R, 17, 7, 22, ph, '#3a3f48', '#16181d', '#6a707c');
    R(5, 9, 12, 19, '#7c8694');
    R(6, 9, 10, 18, '#d6dbe3');
    R(6, 9, 10, 1, '#ffffff');
    R(6, 22, 10, 4, '#a8b0bc');
    R(7, 23, 2, 2, '#2a2e36'); R(13, 23, 2, 2, '#2a2e36');
    R(5, 27, 12, 1, '#5a6270');
    R(7, 11, 8, 10, '#6a7482');
    R(8, 11, 6, 9, '#eef1f5');
    R(8, 16, 6, 2, '#2f6fd8');
    R(10, 12, 2, 2, '#1c1f25');
    R(10, 0, 2, 13, '#aab2be');
    R(10, 0, 1, 13, '#eef1f5');
    R(9, 0, 4, 2, '#6a7280');
    R(17, 26, 2, 2, '#f2c230'); R(3, 26, 2, 2, '#f2c230');
  }));

  const enemyTankFrames = [0, 1, 2, 3].map(ph => makeSprite(20, 26, R => {
    treads(R, 0, 3, 22, ph, '#3a2a24', '#140e0c', '#6a4a3e');
    treads(R, 15, 3, 22, ph, '#3a2a24', '#140e0c', '#6a4a3e');
    R(5, 5, 10, 18, '#6e2618');
    R(5, 5, 10, 17, '#b0442a');
    R(5, 5, 10, 1, '#e06a40');
    R(6, 18, 8, 3, '#8a3420');
    R(7, 19, 2, 1, '#2a1a14'); R(11, 19, 2, 1, '#2a1a14');
  }));
  const enemyTurretTop = makeSprite(14, 26, R => {
    R(6, 0, 2, 13, '#2a2420');
    R(6, 0, 1, 13, '#5a4e46');
    R(3, 10, 8, 9, '#5a1e12');
    R(4, 10, 6, 8, '#d0583a');
    R(4, 10, 6, 1, '#f08a5a');
    R(6, 13, 2, 2, '#2a1a14');
  });

  const turretBase = makeSprite(28, 28, R => {
    R(6, 0, 16, 28, '#4a4e56'); R(0, 6, 28, 16, '#4a4e56'); R(3, 3, 22, 22, '#4a4e56');
    R(7, 1, 14, 26, '#6e737c'); R(1, 7, 26, 14, '#6e737c'); R(4, 4, 20, 20, '#6e737c');
    R(7, 1, 14, 1, '#9aa0aa'); R(1, 7, 1, 14, '#9aa0aa');
    R(8, 8, 12, 12, '#3a3d44');
  });
  const turretTop = makeSprite(18, 30, R => {
    R(5, 0, 2, 14, '#2a2a2e'); R(11, 0, 2, 14, '#2a2a2e');
    R(5, 0, 1, 14, '#6a6a72'); R(11, 0, 1, 14, '#6a6a72');
    R(3, 10, 12, 12, '#6a1a12');
    R(4, 11, 10, 10, '#c0402a');
    R(5, 11, 8, 2, '#f07050');
    R(7, 15, 4, 3, '#2a0e08');
    R(8, 16, 2, 1, '#ffd860');
  });

  const mortarBase = makeSprite(30, 30, R => {
    const bags = 12;
    for (let i = 0; i < bags; i++) {
      const a = i / bags * Math.PI * 2, x = 15 + Math.cos(a) * 11, y = 15 + Math.sin(a) * 11;
      R(Math.round(x - 3), Math.round(y - 2), 6, 5, '#6a5a3a');
      R(Math.round(x - 3), Math.round(y - 2), 6, 1, '#b8a070');
      R(Math.round(x - 2), Math.round(y - 1), 4, 3, '#a08a5a');
    }
    R(10, 10, 10, 10, '#3a3428');
  });
  const mortarTube = makeSprite(10, 20, R => {
    R(2, 0, 6, 12, '#2a2a26');
    R(3, 0, 4, 12, '#5a5a50');
    R(2, 0, 6, 2, '#141412');
    R(1, 11, 8, 8, '#6a3420');
    R(2, 12, 6, 6, '#a84a2a');
  });

  const chopperBody = makeSprite(20, 34, R => {
    R(9, 20, 2, 12, '#2a3440'); R(5, 30, 10, 2, '#2a3440');
    R(5, 4, 10, 18, '#22303e');
    R(6, 4, 8, 17, '#3e5468');
    R(6, 4, 8, 1, '#6a8aa4');
    R(7, 5, 6, 5, '#7ad8f0');
    R(7, 5, 6, 1, '#d8f6ff');
    R(6, 14, 8, 2, '#c84a2a');
    R(2, 12, 3, 6, '#2a3440'); R(15, 12, 3, 6, '#2a3440');
  });

  const fortGunTop = makeSprite(26, 34, R => {
    R(11, 0, 4, 16, '#1a1a1e');
    R(11, 0, 2, 16, '#5a5a62');
    R(10, 0, 6, 3, '#0a0a0c');
    R(3, 12, 20, 18, '#3a1414');
    R(4, 13, 18, 16, '#7a2a24');
    R(4, 13, 18, 2, '#b04a3a');
    R(9, 18, 8, 6, '#2a0a08');
    R(11, 20, 4, 2, '#ff6a3a');
  });

  const lifeIcon = makeSprite(9, 10, R => {
    R(0, 2, 2, 8, '#3a3f48'); R(7, 2, 2, 8, '#3a3f48');
    R(2, 3, 5, 6, '#d6dbe3'); R(3, 4, 3, 3, '#2f6fd8');
    R(4, 0, 1, 4, '#d6dbe3');
  });

  class ClassicRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.buf = document.createElement('canvas');
      this.buf.width = BW;
      this.buf.height = BH;
      this.b = this.buf.getContext('2d');
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
          this.debris(ev.x, ev.y, Math.round(10 * sz), ev.enemy === 'tree' ? ['#2e5a24', '#5a8a3a', '#6a4a2a'] : ['#f8e848', '#f08a24', '#c8381c', '#5a4a40']);
          if (ev.points) this.popups.push({ x: ev.x, y: ev.y, text: String(ev.points), life: 1 });
          this.shake = Math.max(this.shake, 1.5 * sz);
          break;
        }
        case 'blast':
          this.boom(ev.x, ev.y, ev.r / 26);
          this.debris(ev.x, ev.y, 14, ['#f8e848', '#f08a24', '#8a6a4a']);
          this.shake = Math.max(this.shake, 3);
          break;
        case 'hit': this.debris(ev.x, ev.y, 5, ['#ffffff', '#f8e848']); break;
        case 'spark': this.debris(ev.x, ev.y, 3, ev.enemy ? ['#f08a24', '#ffffff'] : ['#ffffff', '#a8e8ff']); break;
        case 'intercept': this.boom(ev.x, ev.y, 0.4); break;
        case 'shoot': this.debris(ev.x, ev.y, 2, ['#ffffff', '#f8e848']); break;
        case 'land': this.boom(ev.x, ev.y, 1.4); this.shake = 4; break;
        case 'playerDie':
          this.boom(ev.x, ev.y, 1.3);
          this.debris(ev.x, ev.y, 30, ['#ffffff', '#d6dbe3', '#f8e848', '#f08a24', '#2f6fd8']);
          this.flash = 0.25; this.flashCol = '#f84838'; this.shake = 6;
          break;
        case 'coreOpen': this.flash = 0.2; this.flashCol = '#f8e848'; break;
        case 'stageClear': this.flash = 0.35; this.flashCol = '#ffffff'; this.shake = 8; break;
        case 'extraLife': this.popups.push({ x: ev.x, y: ev.y, text: '1UP', life: 1.6 }); break;
      }
    }

    boom(x, y, size) { this.booms.push({ x, y, size, t: 0, dur: 0.45 + size * 0.15 }); }

    debris(x, y, n, cols) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = rnd(30, 140);
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
      b.beginPath(); b.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); b.fill();
    }

    drawWorld(g) {
      const b = this.b, p = g.player, t = this.t;
      const zoom = 1 - 0.42 * (p.lift || 0) - 0.12 * (p.jump ? p.alt : 0);
      // Screen "down-right" in world space, for consistent shadow offsets
      const ca = Math.cos(g.camA), sa = Math.sin(g.camA);
      const sdx = (ox, oy) => [ox * ca - oy * sa, ox * sa + oy * ca];
      const upx = Math.sin(g.camA), upy = -Math.cos(g.camA);

      b.save();
      let shx = 0, shy = 0;
      if (this.shake > 0) { shx = Math.round((Math.random() - 0.5) * this.shake); shy = Math.round((Math.random() - 0.5) * this.shake); }
      b.translate(Math.round(BW / 2) + shx, Math.round(BH * 0.6) + shy);
      b.scale(zoom, zoom);
      b.rotate(-g.camA);
      b.translate(-p.x, -p.y);

      // Map (only the visible window)
      const R = Math.hypot(BW, BH) / zoom * 0.62 + 32;
      const cw = this.mapTex.canvas.width, ch = this.mapTex.canvas.height;
      const sx = clamp(Math.floor(p.x - R), 0, cw), sy = clamp(Math.floor(p.y - R), 0, ch);
      const ex = clamp(Math.ceil(p.x + R), 0, cw), ey = clamp(Math.ceil(p.y + R), 0, ch);
      if (ex > sx && ey > sy) b.drawImage(this.mapTex.canvas, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);

      // Water shimmer
      if (Math.floor(t * 3) % 2 === 0) {
        const s = g.stage, TS = 32;
        b.fillStyle = 'rgba(200,230,255,0.35)';
        const tx0 = Math.max(0, Math.floor(sx / TS)), tx1 = Math.min(s.MW - 1, Math.floor(ex / TS));
        const ty0 = Math.max(0, Math.floor(sy / TS)), ty1 = Math.min(s.MH - 1, Math.floor(ey / TS));
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          if (s.map[ty * s.MW + tx] !== T.WATER) continue;
          b.fillRect(tx * TS + ((tx * 7 + ty * 3) % 20) + 2, ty * TS + ((tx * 5 + ty * 11) % 24) + 4, 5, 1);
        }
      }

      // Mortar target markers
      for (const gr of g.grenades) {
        if (gr.owner !== 'enemy') continue;
        if (Math.floor(t * 10) % 2) continue;
        b.strokeStyle = '#f84838';
        b.lineWidth = 1;
        b.beginPath(); b.arc(gr.x1, gr.y1, gr.r * 0.8, 0, Math.PI * 2); b.stroke();
        b.fillStyle = '#f84838';
        b.fillRect(gr.x1 - 6, gr.y1, 13, 1); b.fillRect(gr.x1, gr.y1 - 6, 1, 13);
      }

      // Ground units
      for (const e of g.enemies) {
        if (e.flying) continue;
        const fl = e.hitFlash > 0;
        switch (e.type) {
          case 'tank':
            this.rot(enemyTankFrames[Math.floor(e.tread / 4) & 3], e.x, e.y, e.a, 10, 13);
            this.rot(enemyTurretTop, e.x, e.y, e.ta, 7, 14);
            break;
          case 'turret':
            this.rot(turretBase, e.x, e.y, 0, 14, 14);
            this.rot(turretTop, e.x, e.y, e.ta, 9, 16);
            break;
          case 'mortar':
            this.rot(mortarBase, e.x, e.y, 0, 15, 15);
            this.rot(mortarTube, e.x, e.y, e.ta, 5, 15);
            break;
          case 'fortgun':
            this.rot(fortGunTop, e.x, e.y, e.ta, 13, 21);
            break;
          case 'core':
            this.drawCore(g, e);
            break;
        }
        if (fl) { b.fillStyle = 'rgba(255,255,255,0.7)'; b.beginPath(); b.arc(e.x, e.y, e.r * 0.8, 0, Math.PI * 2); b.fill(); }
      }

      // Player (on the ground)
      const airborne = p.alive && p.alt > 0.02;
      if (p.alive && !airborne) this.drawPlayer(g, p, 1);

      // Player shots
      for (const s of g.shots) {
        const a = Math.atan2(s.vx, -s.vy);
        b.save(); b.translate(s.x, s.y); b.rotate(a);
        b.fillStyle = '#f8e848'; b.fillRect(-1, -4, 3, 8);
        b.fillStyle = '#ffffff'; b.fillRect(0, -4, 1, 5);
        b.restore();
      }
      // Enemy shots
      for (const s of g.eshots) {
        const blink = Math.floor(t * 16) % 2;
        if (s.kind === 'plasma') {
          b.fillStyle = blink ? '#ff4a8a' : '#ffffff';
          b.fillRect(s.x - 2, s.y - 2, 5, 5);
          b.fillStyle = '#ff2a2a';
          b.fillRect(s.x - 1, s.y - 1, 3, 3);
        } else {
          b.fillStyle = blink ? '#f8a830' : '#ffffff';
          b.fillRect(s.x - 2, s.y - 2, 4, 4);
        }
      }

      // Grenades and bombs: ground shadow plus a ball raised toward the viewer
      for (const gr of g.grenades) {
        this.shadow(gr.x, gr.y, 4, 3, 0.4);
        const h = gr.alt * 34;
        const bx = gr.x + upx * h, by = gr.y + upy * h, r = 3 + gr.alt * 2;
        b.fillStyle = gr.owner === 'enemy' ? '#3a2a20' : '#2a3a2a';
        b.beginPath(); b.arc(bx, by, r, 0, Math.PI * 2); b.fill();
        b.fillStyle = gr.owner === 'enemy' ? '#f08a24' : '#a8f070';
        b.fillRect(bx - 1, by - 1, 2, 2);
      }

      // Explosions
      for (const bm of this.booms) {
        const k = bm.t / bm.dur, r = bm.size * (6 + 16 * Math.sqrt(k));
        const cols = k < 0.15 ? ['#ffffff', '#ffffff'] : k < 0.4 ? ['#f8e848', '#ffffff'] : k < 0.7 ? ['#f08a24', '#f8e848'] : ['#6a4a3a', '#c8381c'];
        b.fillStyle = cols[0];
        b.beginPath(); b.arc(bm.x, bm.y, r, 0, Math.PI * 2); b.fill();
        b.fillStyle = cols[1];
        b.beginPath(); b.arc(bm.x + 1, bm.y - 1, r * 0.55, 0, Math.PI * 2); b.fill();
      }
      for (const pt of this.parts) {
        b.fillStyle = pt.col;
        b.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);
      }

      // Flyers: choppers and the airborne player
      for (const e of g.enemies) {
        if (!e.flying) continue;
        const [ox, oy] = sdx(10, 12);
        this.shadow(e.x + ox, e.y + oy, 9, 7, 0.35);
        this.rot(chopperBody, e.x, e.y, e.a, 10, 13);
        b.save();
        b.translate(e.x, e.y);
        b.rotate(t * 22);
        b.fillStyle = 'rgba(200,210,220,0.75)';
        b.fillRect(-15, -1, 30, 2);
        b.fillRect(-1, -15, 2, 30);
        b.restore();
        if (e.hitFlash > 0) { b.fillStyle = 'rgba(255,255,255,0.7)'; b.beginPath(); b.arc(e.x, e.y, 10, 0, Math.PI * 2); b.fill(); }
      }
      if (airborne) {
        const [ox, oy] = sdx(8 + p.alt * 16, 10 + p.alt * 18);
        this.shadow(p.x + ox, p.y + oy, 11 + p.alt * 2, 9, 0.4);
        this.drawPlayer(g, p, 1 + p.alt * 0.35);
      }

      // Score popups
      b.save();
      b.font = '8px ' + FONT;
      b.textAlign = 'center';
      for (const pp of this.popups) {
        b.save();
        b.translate(pp.x, pp.y - (1 - pp.life) * 20);
        b.rotate(g.camA);
        b.fillStyle = '#000';
        b.fillText(pp.text, 1, 1);
        b.fillStyle = Math.floor(t * 10) % 2 ? '#f8e848' : '#ffffff';
        b.fillText(pp.text, 0, 0);
        b.restore();
      }
      b.restore();

      // Exit arrow
      if (p.alive && g.state === 'play' && Math.floor(t * 3) % 2 === 0) {
        const ga = g.guideAngle(p.x, p.y);
        b.save();
        b.translate(p.x + Math.sin(ga) * 42, p.y - Math.cos(ga) * 42);
        b.rotate(ga);
        b.fillStyle = '#000';
        b.beginPath(); b.moveTo(0, -9); b.lineTo(8, 1); b.lineTo(3, 1); b.lineTo(3, 8); b.lineTo(-3, 8); b.lineTo(-3, 1); b.lineTo(-8, 1); b.closePath(); b.fill();
        b.fillStyle = '#f8e848';
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
      b.drawImage(playerFrames[Math.floor(p.tread / 4) & 3], -11, -16 + p.recoil * 2);
      if (p.wheelie > 0.5) {
        b.fillStyle = 'rgba(248,232,72,' + (p.wheelie * 0.6) + ')';
        b.fillRect(-11, 12, 22, 3);
      }
      b.restore();
    }

    drawCore(g, e) {
      const b = this.b, t = this.t;
      if (!g.coreOpen) {
        b.fillStyle = '#2a2a32';
        b.fillRect(e.x - 26, e.y - 14, 52, 28);
        b.fillStyle = '#5a5a66';
        for (let i = 0; i < 4; i++) b.fillRect(e.x - 24 + i * 13, e.y - 12, 11, 24);
        b.fillStyle = '#8a8a96';
        for (let i = 0; i < 4; i++) b.fillRect(e.x - 24 + i * 13, e.y - 12, 11, 2);
        b.fillStyle = Math.floor(t * 4) % 2 ? '#c8381c' : '#5a1a10';
        b.fillRect(e.x - 3, e.y - 3, 6, 6);
        return;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 8);
      b.fillStyle = '#1a0a08';
      b.beginPath(); b.arc(e.x, e.y, 26, 0, Math.PI * 2); b.fill();
      b.fillStyle = e.hitFlash > 0 ? '#ffffff' : '#a8281c';
      b.beginPath(); b.arc(e.x, e.y, 20, 0, Math.PI * 2); b.fill();
      b.fillStyle = '#f08a24';
      b.beginPath(); b.arc(e.x, e.y, 10 + pulse * 5, 0, Math.PI * 2); b.fill();
      b.fillStyle = '#ffffff';
      b.beginPath(); b.arc(e.x, e.y, 4 + pulse * 2, 0, Math.PI * 2); b.fill();
    }

    text(str, x, y, col, align, size) {
      const b = this.b;
      b.font = (size || 8) + 'px ' + FONT;
      b.textAlign = align || 'left';
      b.textBaseline = 'top';
      b.fillStyle = '#000';
      b.fillText(str, x + 1, y + 1);
      b.fillStyle = col;
      b.fillText(str, x, y);
    }

    drawHud(g) {
      const b = this.b, t = this.t;
      this.text('1UP', 8, 4, Math.floor(t * 2) % 2 ? '#f84838' : '#f8f8f8');
      this.text(String(g.score).padStart(7, ' '), 8, 14, '#f8f8f8');
      this.text('HI-SCORE', BW / 2, 4, '#f84838', 'center');
      this.text(String(Math.max(g.hiScore, g.score)).padStart(7, ' '), BW / 2, 14, '#f8e848', 'center');
      this.text('TIME', BW - 8, 4, '#f8f8f8', 'right');
      const tl = Math.ceil(g.timeLeft);
      const tc = tl <= 30 ? (Math.floor(t * 4) % 2 ? '#f84838' : '#f8e848') : '#5ad8f8';
      this.text(String(tl).padStart(3, '0'), BW - 8, 14, tc, 'right');
      for (let i = 0; i < Math.min(Math.max(g.lives - (g.player.alive ? 1 : 0), 0), 6); i++) b.drawImage(lifeIcon, 8 + i * 11, BH - 14);
      this.text('AREA ' + g.stageNum, BW - 8, BH - 13, '#f8f8f8', 'right');
      if (g.player.lift > 0.9) this.text('LIFT', BW / 2, BH - 13, Math.floor(t * 6) % 2 ? '#2dd4bf' : '#f8f8f8', 'center');
      else if (g.coreOpen && g.state === 'play' && Math.floor(t * 3) % 2) this.text('CORE OPEN', BW / 2, BH - 13, '#f84838', 'center');

      const m = g.message;
      if (m && !(m.text === 'READY' && Math.floor(t * 4) % 2)) {
        const big = m.text.length <= 12;
        this.text(m.text, BW / 2, 82, '#f8f8f8', 'center', big ? 16 : 8);
        if (m.sub) this.text(m.sub, BW / 2, big ? 106 : 96, '#f8e848', 'center');
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

      const pa = (4 / 3) / (BW / BH);
      const sy = Math.min(h * 0.96 / BH, w * 0.98 / (BW * pa));
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
        ctx.globalAlpha = 0.18;
        ctx.filter = 'blur(' + Math.max(1, Math.round(sy * 1.6)) + 'px)';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.buf, dx, dy, dw, dh);
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, dw, dh);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      const lh = Math.max(1, sy * 0.28);
      for (let r = 0; r < BH; r++) ctx.fillRect(dx, dy + r * sy + sy - lh, dw, lh);
      const vg = ctx.createRadialGradient(dx + dw / 2, dy + dh / 2, Math.min(dw, dh) * 0.4, dx + dw / 2, dy + dh / 2, Math.max(dw, dh) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
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
