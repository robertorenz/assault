/* Assault Revamped — Classic renderer.
 * Draws into a 160 x 216 pixel buffer (world / 3) with chunky sprites, a 3x5
 * bitmap font and 1983-console colours, then presents it through a CRT pass. */
(function (global) {
  'use strict';

  const { GROUND_Y, HEAT_WARN } = global.Assault;
  const S = 3;                 // world units per buffer pixel
  const BW = 160, BH = 216;
  const GROUND_TOP = 190, PLAY_H = 200;

  const C = {
    ground: '#6b4514', groundHi: '#8c5e1c', hud: '#101010',
    mother: '#3a74d4', motherDark: '#24508f', lights: ['#f4f4f4', '#f0c838', '#48d0f0'],
    player: '#b4c4cc', playerAcc: '#2ec4b6',
    saucer: '#f0c838', splitter: '#40c4e8', mini: '#94e8f8', gunner: '#ec6430', diver: '#5cdc5c',
    shot: '#f8f8f8', bomb: '#f05050', missile: '#f8a030', text: '#e4e4e4', score: '#f0c838'
  };

  // 3x5 font, rows top to bottom.
  const FONT = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001010010',
    '8': '111101111101111', '9': '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111', '!': '010010010000010', '-': '000000111000000',
    ':': '000010000010000', ' ': '000000000000000'
  };

  // Sprites: '#' main colour, 'o' cut-out / accent, 'L' animated lights.
  const SPR = {
    mother: [
      '..........########..........',
      '......################......',
      '..########################..',
      '############################',
      '#L##L##L##L##L##L##L##L##L##',
      '..########################..',
      '......####........####......'
    ],
    player: [
      '....###....',
      '...#####...',
      '.#########.',
      '###########',
      '#o#o#o#o#o#',
      '.#########.'
    ],
    saucer: [
      '...###...',
      '.#######.',
      '#o#o#o#o#',
      '.#######.',
      '..#...#..'
    ],
    splitter: [
      '.###..###.',
      '##########',
      '#o##oo##o#',
      '.###..###.',
      '..#....#..'
    ],
    mini: [
      '.####.',
      '#o##o#',
      '.####.',
      '#....#'
    ],
    gunner: [
      '..#####..',
      '.#######.',
      '###o#o###',
      '.#######.',
      '...###...',
      '....#....'
    ],
    diver: [
      '#.......#',
      '##.....##',
      '.###o###.',
      '..#####..',
      '....#....'
    ],
    crawlA: [
      '..#####..',
      '.#o###o#.',
      '#########',
      '#.#.#.#.#'
    ],
    crawlB: [
      '..#####..',
      '.#o###o#.',
      '#########',
      '.#.#.#.#.'
    ],
    life: [
      '..#..',
      '.###.',
      '#####'
    ]
  };

  const rnd = (a, b) => a + Math.random() * (b - a);

  class ClassicRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.buf = document.createElement('canvas');
      this.buf.width = BW;
      this.buf.height = BH;
      this.b = this.buf.getContext('2d');
      this.parts = [];
      this.bursts = [];
      this.bgFlash = 0;
      this.bgFlashColor = '#5a1010';
      this.shake = 0;
      this.t = 0;
      this.hideHud = false;
      this.w = 1;
      this.h = 1;
    }

    reset() { this.parts.length = 0; this.bursts.length = 0; this.bgFlash = 0; this.shake = 0; }

    resize(w, h) { this.w = w; this.h = h; }

    /* ---------------- events ---------------- */

    onEvent(ev) {
      const bx = ev.x / S, by = ev.y / S;
      switch (ev.type) {
        case 'explode':
          this.burst(bx, ev.crawl ? GROUND_TOP - 2 : by, C[ev.enemy] || '#fff', 18);
          this.bursts.push({ x: bx, y: ev.crawl ? GROUND_TOP - 2 : by, t: 0 });
          this.shake = Math.max(this.shake, 2);
          break;
        case 'split': this.burst(bx, by, C.splitter, 10); break;
        case 'hit': this.burst(bx, by, '#ffffff', 6); break;
        case 'spark': this.burst(bx, by, C.lights[2], 5); break;
        case 'intercept': this.burst(bx, by, C.missile, 6); break;
        case 'bulletGround': this.burst(bx, GROUND_TOP - 1, C.ground, 4); break;
        case 'land': this.burst(bx, GROUND_TOP - 1, C.groundHi, 8); break;
        case 'playerDie':
          this.burst(bx, GROUND_TOP - 4, C.player, 30);
          this.burst(bx, GROUND_TOP - 4, C.missile, 20);
          this.bursts.push({ x: bx, y: GROUND_TOP - 4, t: 0, big: true });
          this.bgFlash = 0.9;
          this.bgFlashColor = ev.reason === 'overheat' ? '#6a2c08' : '#5a1010';
          this.shake = 5;
          break;
        case 'waveClear':
          this.bgFlash = 0.5;
          this.bgFlashColor = '#0c3a36';
          break;
      }
    }

    burst(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = rnd(15, 70);
        this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: rnd(0.3, 0.9), color });
      }
    }

    update(dt) {
      this.t += dt;
      for (const p of this.parts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 90 * dt;
        p.life -= dt;
        if (p.y > GROUND_TOP - 1) { p.y = GROUND_TOP - 1; p.vy *= -0.3; p.vx *= 0.6; }
      }
      this.parts = this.parts.filter(p => p.life > 0);
      for (const b of this.bursts) b.t += dt;
      this.bursts = this.bursts.filter(b => b.t < (b.big ? 0.8 : 0.4));
      if (this.bgFlash > 0) this.bgFlash -= dt;
      this.shake = Math.max(0, this.shake - dt * 10);
    }

    /* ---------------- drawing helpers ---------------- */

    sprite(rows, cx, top, cmap) {
      const b = this.b, w = rows[0].length, x0 = Math.round(cx - w / 2);
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        let c = 0;
        while (c < w) {
          const ch = row[c];
          let run = 1;
          while (c + run < w && row[c + run] === ch) run++;
          if (ch !== '.' && cmap[ch]) {
            b.fillStyle = cmap[ch];
            b.fillRect(x0 + c, top + r, run, 1);
          }
          c += run;
        }
      }
    }

    text(str, x, y, color, scale, align) {
      scale = scale || 1;
      str = String(str).toUpperCase();
      const adv = 4 * scale, width = str.length * adv - scale;
      let x0 = Math.round(align === 'center' ? x - width / 2 : align === 'right' ? x - width : x);
      const b = this.b;
      b.fillStyle = color;
      for (const ch of str) {
        const g = FONT[ch] || FONT[' '];
        for (let i = 0; i < 15; i++) {
          if (g[i] === '1') b.fillRect(x0 + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
        }
        x0 += adv;
      }
    }

    /* ---------------- frame ---------------- */

    drawBuffer(g) {
      const b = this.b, t = this.t;
      const flashOn = this.bgFlash > 0 && Math.floor(this.bgFlash * 14) % 2 === 0;

      b.fillStyle = flashOn ? this.bgFlashColor : '#000000';
      b.fillRect(0, 0, BW, PLAY_H);

      // Ground band
      b.fillStyle = C.ground;
      b.fillRect(0, GROUND_TOP, BW, PLAY_H - GROUND_TOP);
      b.fillStyle = C.groundHi;
      b.fillRect(0, GROUND_TOP, BW, 2);
      b.fillStyle = '#4a300e';
      for (let x = (Math.floor(t * 4) % 8); x < BW; x += 8) b.fillRect(x, GROUND_TOP + 5, 3, 1);

      // Mothership
      const m = g.mother;
      const light = C.lights[Math.floor(t * 8) % 3];
      this.sprite(SPR.mother, m.x / S, Math.round(m.y / S) - 3, { '#': C.mother, L: light });
      if (m.bay > 0) {
        b.fillStyle = Math.floor(t * 20) % 2 ? C.lights[2] : '#ffffff';
        b.fillRect(Math.round(m.x / S) - 2, Math.round(m.y / S) + 4, 4, 1);
        const beam = Math.round(m.bay * 10);
        b.fillStyle = 'rgba(72,208,240,0.35)';
        b.fillRect(Math.round(m.x / S) - 1, Math.round(m.y / S) + 5, 2, beam);
      }

      // Enemies
      for (const e of g.enemies) {
        const color = e.hitFlash > 0 ? '#ffffff' : C[e.type];
        if (e.state === 'crawl') {
          const rows = Math.floor(e.t * 8) % 2 ? SPR.crawlA : SPR.crawlB;
          this.sprite(rows, e.x / S, GROUND_TOP - rows.length, { '#': color, o: '#000' });
        } else {
          const rows = SPR[e.type];
          const top = Math.round(e.y / S - rows.length / 2);
          // 2600-style colour shimmer on the cut-outs
          const accent = Math.floor(t * 6 + e.id) % 2 ? '#000' : '#ffffff';
          this.sprite(rows, e.x / S, top, { '#': color, o: accent });
        }
      }

      // Player
      const p = g.player;
      if (p.alive && !(p.invuln > 0 && Math.floor(t * 10) % 2)) {
        const px = Math.round(p.x / S), top = GROUND_TOP - SPR.player.length;
        this.sprite(SPR.player, px, top, { '#': C.player, o: C.playerAcc });
        const rc = p.recoil > 0.5 ? 1 : 0;
        const heatCol = g.heat >= HEAT_WARN && Math.floor(t * 8) % 2 ? '#f05050' : C.player;
        b.fillStyle = heatCol;
        if (p.aim === 'up') b.fillRect(px, top - 4 + rc, 1, 4);
        else if (p.aim === 'left') b.fillRect(px - 7 + rc, top + 1, 5, 1);
        else b.fillRect(px + 3 - rc, top + 1, 5, 1);
      }

      // Player shots
      b.fillStyle = C.shot;
      for (const s of g.shots) {
        const x = Math.round(s.x / S), y = Math.round(s.y / S);
        if (s.dir === 'up') b.fillRect(x, y - 2, 1, 4);
        else b.fillRect(x - 2, y, 4, 1);
      }

      // Enemy fire
      for (const bl of g.bullets) {
        const x = Math.round(bl.x / S), y = Math.round(bl.y / S);
        if (bl.kind === 'missile') {
          b.fillStyle = Math.floor(t * 16) % 2 ? C.missile : '#ffffff';
          b.fillRect(x - 1, y - 1, 2, 3);
        } else {
          b.fillStyle = Math.floor(t * 12) % 2 ? C.bomb : '#f8a0a0';
          b.fillRect(x, y - 1, 1, 3);
        }
      }

      // Burst rings (blocky cross-shaped flashes)
      for (const bs of this.bursts) {
        const r = Math.round(bs.t * (bs.big ? 40 : 30));
        b.fillStyle = Math.floor(bs.t * 20) % 2 ? '#ffffff' : '#f0c838';
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2;
          b.fillRect(Math.round(bs.x + Math.cos(a) * r), Math.round(bs.y + Math.sin(a) * r * 0.8), 1, 1);
        }
      }

      // Particles
      for (const pt of this.parts) {
        b.fillStyle = pt.life < 0.2 && Math.floor(t * 20) % 2 ? '#ffffff' : pt.color;
        b.fillRect(Math.round(pt.x), Math.round(pt.y), 1, 1);
      }

      // Top score line
      this.text(String(g.score).padStart(6, '0'), BW / 2, 3, C.score, 1, 'center');
      this.text('W' + g.wave, BW - 4, 3, C.text, 1, 'right');
      this.text('HI ' + Math.max(g.hiScore, g.score), 4, 3, '#8c8c8c', 1, 'left');

      // Bottom HUD strip
      b.fillStyle = C.hud;
      b.fillRect(0, PLAY_H, BW, BH - PLAY_H);
      for (let i = 0; i < Math.min(g.lives, 6); i++) this.sprite(SPR.life, 7 + i * 7, PLAY_H + 5, { '#': C.player });

      // Heat bar
      const hx = 52, hw = 56, hy = PLAY_H + 3;
      b.fillStyle = '#2a2a2a';
      b.fillRect(hx - 1, hy - 1, hw + 2, 6);
      const fill = Math.round(hw * g.heat / 100);
      const hot = g.heat >= HEAT_WARN;
      b.fillStyle = hot ? (Math.floor(t * 10) % 2 ? '#f05050' : '#f0c838') : g.heat > 45 ? '#f0c838' : '#5cdc5c';
      b.fillRect(hx, hy, fill, 4);
      this.text('HEAT', hx + hw / 2, hy + 7, '#6c6c6c', 1, 'center');
      if (hot && Math.floor(t * 4) % 2) this.text('HOT', hx + hw + 4, hy, '#f05050', 1, 'left');

      // Remaining hostiles
      const left = Math.max(0, g.quota - g.kills);
      this.sprite(SPR.mini, BW - 26, PLAY_H + 5, { '#': C.saucer, o: '#000' });
      this.text(String(left).padStart(2, '0'), BW - 5, PLAY_H + 5, C.text, 1, 'right');

      // Centre message
      if (!this.hideHud && g.message) {
        const msg = g.message;
        if (!(msg.text === 'READY' && Math.floor(t * 4) % 2)) {
          const scale = msg.text.length > 9 ? 1 : 2;
          this.text(msg.text, BW / 2, 84, '#ffffff', scale, 'center');
          if (msg.sub) this.text(msg.sub, BW / 2, 84 + 6 * scale + 4, C.score, 1, 'center');
        }
      }
    }

    render(g) {
      this.drawBuffer(g);
      const ctx = this.ctx, w = this.w, h = this.h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, w, h);

      // 2600 pixels are wider than they are tall
      const pa = 1.2;
      const sy = Math.min(h * 0.94 / BH, w * 0.96 / (BW * pa));
      const sx = sy * pa;
      const dw = BW * sx, dh = BH * sy;
      let dx = (w - dw) / 2, dy = (h - dh) / 2;
      if (this.shake > 0) { dx += (Math.random() - 0.5) * this.shake * sx; dy += (Math.random() - 0.5) * this.shake * sy; }

      // Bezel
      const pad = Math.max(8, sy * 4);
      ctx.fillStyle = '#0b0f14';
      roundRect(ctx, dx - pad, dy - pad, dw + pad * 2, dh + pad * 2, pad * 1.4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148,163,184,0.12)';
      ctx.lineWidth = Math.max(1, sy * 0.4);
      ctx.stroke();

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.buf, dx, dy, dw, dh);

      // Phosphor bloom
      if ('filter' in ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.32;
        ctx.filter = 'blur(' + Math.round(sy * 2.2) + 'px)';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.buf, dx, dy, dw, dh);
        ctx.restore();
      }

      // Scanlines, one dark line per buffer row
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, dw, dh);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      const lh = Math.max(1, sy * 0.3);
      for (let r = 0; r < BH; r++) ctx.fillRect(dx, dy + r * sy + sy - lh, dw, lh);

      // Screen curvature vignette
      const vg = ctx.createRadialGradient(dx + dw / 2, dy + dh / 2, Math.min(dw, dh) * 0.35, dx + dw / 2, dy + dh / 2, Math.max(dw, dh) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(dx, dy, dw, dh);
      // Glass sheen
      const sh = ctx.createLinearGradient(dx, dy, dx, dy + dh * 0.5);
      sh.addColorStop(0, 'rgba(255,255,255,0.05)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(dx, dy, dw, dh * 0.5);
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
