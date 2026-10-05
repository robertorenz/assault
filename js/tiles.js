/* Assault Revamped — map texture painter.
 * Paints a stage's tile map into a canvas at 1 px per world unit.
 *   mode 'flat'  : full top-down pixel art (walls bevelled, trees drawn) for the Classic view
 *   mode 'floor' : ground layer only (tall tiles become footprints) for the 2.5D mode-7 floor */
(function (global) {
  'use strict';

  const { TS, T } = global.Assault;

  const PALETTES = {
    desert: {
      g: ['#c8a266', '#b9925a', '#d8b47a', '#a88050'], crack: '#9a7446',
      wall: '#9a7a52', wallHi: '#c9a878', wallLo: '#5e4428', wallTop: '#b08c60',
      block: '#8a6a4a', blockHi: '#b89270', blockLo: '#4e3622',
      tree: ['#4e6a2a', '#6e8a3a', '#2e4218'], rubble: ['#8a6a46', '#6a5034', '#a8865c'],
      water: '#2a6aa0', waterHi: '#78b4e0', waterLo: '#1a4a78', bridge: '#8a5a32', bridgeHi: '#b07a48',
      fort: '#6a6670', fortHi: '#a8a4ae', fortLo: '#34323a', shadow: 'rgba(60,34,8,0.42)', foot: '#7a5e3c'
    },
    base: {
      g: ['#5a6470', '#4e5864', '#68737f', '#434b56'], crack: '#3a414a',
      wall: '#38414e', wallHi: '#8494a8', wallLo: '#1a1f27', wallTop: '#465060',
      block: '#7a6a48', blockHi: '#a8946a', blockLo: '#44391f',
      tree: ['#3a5a3a', '#4e7a4a', '#223822'], rubble: ['#4a525c', '#383e46', '#6a747e'],
      water: '#1e5080', waterHi: '#5a9ad0', waterLo: '#123458', bridge: '#5a5e66', bridgeHi: '#8a8e96',
      fort: '#4a3e3e', fortHi: '#8a7272', fortLo: '#241c1c', shadow: 'rgba(0,0,0,0.45)', foot: '#2a3038', light: '#2dd4bf'
    },
    forest: {
      g: ['#3e7432', '#35662a', '#4c843a', '#2c5622'], crack: '#2a4e20',
      wall: '#74746a', wallHi: '#a8a89a', wallLo: '#3e3e36', wallTop: '#86867a',
      block: '#7a5a3a', blockHi: '#a47c52', blockLo: '#44301c',
      tree: ['#1e5a24', '#3a8a3a', '#0e3412'], rubble: ['#5a5a4e', '#44443a', '#7a7a6a'],
      water: '#245e94', waterHi: '#6aa8dc', waterLo: '#143e66', bridge: '#7a5230', bridgeHi: '#a87444',
      fort: '#5a5a62', fortHi: '#9a9aa4', fortLo: '#2a2a32', shadow: 'rgba(0,20,0,0.42)', foot: '#2c4a22'
    },
    river: {
      g: ['#6a8a3e', '#5c7a34', '#7a9a4a', '#4e6a2c'], crack: '#4a6428',
      wall: '#7e7a6e', wallHi: '#b0aa9a', wallLo: '#46423a', wallTop: '#908a7c',
      block: '#7a5a3a', blockHi: '#a47c52', blockLo: '#44301c',
      tree: ['#2a6a2a', '#4a9a40', '#144016'], rubble: ['#6a6656', '#504c40', '#86826e'],
      water: '#2266a8', waterHi: '#74b6ea', waterLo: '#164878', bridge: '#86582e', bridgeHi: '#b47c44',
      fort: '#5e5a64', fortHi: '#a09ca8', fortLo: '#2c2a32', shadow: 'rgba(0,20,10,0.42)', foot: '#3e5226'
    }
  };

  function hash(x, y, k) {
    let h = (x * 374761393 + y * 668265263 + (k || 0) * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  class MapTexture {
    constructor(stage, mode) {
      this.stage = stage;
      this.mode = mode;
      this.pal = PALETTES[stage.theme.key];
      this.canvas = document.createElement('canvas');
      this.canvas.width = stage.MW * TS;
      this.canvas.height = stage.MH * TS;
      this.ctx = this.canvas.getContext('2d');
      this.paintRegion(0, 0, stage.MW - 1, stage.MH - 1);
    }

    tile(tx, ty) {
      const s = this.stage;
      if (tx < 0 || ty < 0 || tx >= s.MW || ty >= s.MH) return T.WALL;
      return s.map[ty * s.MW + tx];
    }

    isTall(v) { return v === T.WALL || v === T.BLOCK || v === T.TREE || v === T.FORT; }

    /* Repaint tiles around (tx,ty) after a tile changes. */
    redraw(tx, ty) {
      const c = this.ctx;
      c.save();
      c.beginPath();
      c.rect((tx - 1) * TS, (ty - 1) * TS, TS * 3, TS * 3);
      c.clip();
      this.paintRegion(tx - 2, ty - 2, tx + 2, ty + 2);
      c.restore();
    }

    paintRegion(x0, y0, x1, y1) {
      const s = this.stage;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0);
      x1 = Math.min(s.MW - 1, x1); y1 = Math.min(s.MH - 1, y1);
      // 1. floor layer
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.paintFloor(x, y);
      // 2. cast shadows (toward the south-east)
      const c = this.ctx;
      c.fillStyle = this.pal.shadow;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const v = this.tile(x, y);
        if (!this.isTall(v)) continue;
        const off = v === T.BLOCK ? 4 : v === T.TREE ? 5 : 6;
        if (v === T.TREE) {
          c.beginPath(); c.arc(x * TS + 16 + off, y * TS + 16 + off, 14, 0, Math.PI * 2); c.fill();
        } else {
          c.fillRect(x * TS + off, y * TS + off, TS, TS);
        }
      }
      // 3. tall tiles
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const v = this.tile(x, y);
        if (this.isTall(v)) this.paintTall(x, y, v);
      }
    }

    paintGround(x, y) {
      const c = this.ctx, P = this.pal, X = x * TS, Y = y * TS, key = this.stage.theme.key;
      c.fillStyle = P.g[0];
      c.fillRect(X, Y, TS, TS);
      if (key === 'base') {
        // Riveted deck plates
        c.fillStyle = P.g[3];
        c.fillRect(X, Y, TS, 1);
        c.fillRect(X, Y, 1, TS);
        c.fillStyle = P.g[2];
        c.fillRect(X + 1, Y + 1, TS - 1, 1);
        c.fillRect(X + 1, Y + 1, 1, TS - 1);
        c.fillStyle = P.g[1];
        if (hash(x, y, 1) < 0.5) c.fillRect(X + 4, Y + 15, 24, 2);
        else c.fillRect(X + 15, Y + 4, 2, 24);
        c.fillStyle = P.g[2];
        for (const [rx, ry] of [[3, 3], [28, 3], [3, 28], [28, 28]]) c.fillRect(X + rx, Y + ry, 2, 2);
        if (hash(x, y, 2) < 0.08) {
          c.fillStyle = '#c8a028';
          for (let i = 0; i < 4; i++) c.fillRect(X + 2 + i * 8, Y + 26, 4, 4);
        }
        return;
      }
      const n = 22;
      for (let i = 0; i < n; i++) {
        const r1 = hash(x, y, i * 3 + 1), r2 = hash(x, y, i * 3 + 2), r3 = hash(x, y, i * 3 + 3);
        c.fillStyle = P.g[1 + Math.floor(r3 * 3)];
        if (key === 'desert') c.fillRect(X + Math.floor(r1 * 31), Y + Math.floor(r2 * 31), 2, 1);
        else c.fillRect(X + Math.floor(r1 * 31), Y + Math.floor(r2 * 30), 1, 2);
      }
      if (key === 'desert' && hash(x, y, 9) < 0.18) {
        c.fillStyle = P.crack;
        let cx = X + 6 + Math.floor(hash(x, y, 10) * 18), cy = Y + 6;
        for (let k = 0; k < 9; k++) { c.fillRect(cx, cy, 1, 2); cx += Math.floor(hash(x, y, 20 + k) * 3) - 1; cy += 2; }
      }
      if (key === 'desert' && hash(x, y, 11) < 0.05) {
        // small crater
        c.fillStyle = P.g[3];
        c.beginPath(); c.ellipse(X + 16, Y + 16, 9, 7, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = P.g[2];
        c.beginPath(); c.ellipse(X + 17, Y + 17, 6, 4, 0, 0, Math.PI * 2); c.fill();
      }
      if ((key === 'forest' || key === 'river') && hash(x, y, 12) < 0.12) {
        c.fillStyle = hash(x, y, 13) < 0.5 ? '#d8c84a' : '#e8e8d8';
        c.fillRect(X + 4 + Math.floor(hash(x, y, 14) * 24), Y + 4 + Math.floor(hash(x, y, 15) * 24), 2, 2);
      }
    }

    paintFloor(x, y) {
      const c = this.ctx, P = this.pal, X = x * TS, Y = y * TS;
      const v = this.tile(x, y);
      switch (v) {
        case T.WATER: {
          c.fillStyle = P.water;
          c.fillRect(X, Y, TS, TS);
          c.fillStyle = P.waterLo;
          for (let i = 0; i < 4; i++) c.fillRect(X + Math.floor(hash(x, y, 40 + i) * 24), Y + 3 + i * 8, 8, 1);
          c.fillStyle = P.waterHi;
          for (let i = 0; i < 5; i++) c.fillRect(X + Math.floor(hash(x, y, 50 + i) * 26), Y + 1 + i * 6 + Math.floor(hash(x, y, 60 + i) * 3), 6, 1);
          // shoreline foam
          c.fillStyle = 'rgba(230,240,250,0.55)';
          if (this.tile(x, y - 1) !== T.WATER) c.fillRect(X, Y, TS, 2);
          if (this.tile(x, y + 1) !== T.WATER) c.fillRect(X, Y + TS - 2, TS, 2);
          if (this.tile(x - 1, y) !== T.WATER) c.fillRect(X, Y, 2, TS);
          if (this.tile(x + 1, y) !== T.WATER) c.fillRect(X + TS - 2, Y, 2, TS);
          return;
        }
        case T.BRIDGE: {
          c.fillStyle = P.water;
          c.fillRect(X, Y, TS, TS);
          c.fillStyle = P.bridge;
          c.fillRect(X, Y + 1, TS, TS - 2);
          c.fillStyle = P.bridgeHi;
          for (let i = 0; i < 8; i++) c.fillRect(X + i * 4, Y + 1, 1, TS - 2);
          c.fillStyle = 'rgba(0,0,0,0.25)';
          for (let i = 0; i < 8; i++) c.fillRect(X + i * 4 + 3, Y + 1, 1, TS - 2);
          if (this.tile(x - 1, y) !== T.BRIDGE) { c.fillStyle = '#3a2a1a'; c.fillRect(X, Y, 3, TS); }
          if (this.tile(x + 1, y) !== T.BRIDGE) { c.fillStyle = '#3a2a1a'; c.fillRect(X + TS - 3, Y, 3, TS); }
          return;
        }
        case T.LIFT:
        case T.PAD_USED: {
          this.paintGround(x, y);
          const used = v === T.PAD_USED;
          // find the pad's shared centre corner
          const right = this.isPad(x + 1, y), down = this.isPad(x, y + 1);
          const ccx = right ? X + TS : X, ccy = down ? Y + TS : Y;
          c.save();
          c.beginPath(); c.rect(X, Y, TS, TS); c.clip();
          c.fillStyle = used ? '#3a3e44' : '#22262c';
          c.fillRect(ccx - 30, ccy - 30, 60, 60);
          // hazard border
          c.fillStyle = used ? '#6a6a5a' : '#f2c230';
          c.fillRect(ccx - 30, ccy - 30, 60, 3); c.fillRect(ccx - 30, ccy + 27, 60, 3);
          c.fillRect(ccx - 30, ccy - 30, 3, 60); c.fillRect(ccx + 27, ccy - 30, 3, 60);
          c.fillStyle = '#22262c';
          for (let i = -30; i < 30; i += 6) { c.fillRect(ccx + i, ccy - 30, 3, 3); c.fillRect(ccx + i, ccy + 27, 3, 3); c.fillRect(ccx - 30, ccy + i, 3, 3); c.fillRect(ccx + 27, ccy + i, 3, 3); }
          c.strokeStyle = used ? '#55595e' : '#2dd4bf';
          c.lineWidth = 2;
          for (const r of [22, 15, 8]) { c.beginPath(); c.arc(ccx, ccy, r, 0, Math.PI * 2); c.stroke(); }
          c.fillStyle = used ? '#55595e' : '#f2c230';
          c.fillRect(ccx - 2, ccy - 2, 4, 4);
          c.restore();
          return;
        }
        case T.JUMP: {
          this.paintGround(x, y);
          c.fillStyle = '#2a2e34';
          c.fillRect(X + 2, Y + 2, TS - 4, TS - 4);
          c.fillStyle = '#f08a24';
          for (let k = 0; k < 3; k++) {
            const yy = Y + 6 + k * 8;
            for (let i = 0; i < 8; i++) {
              c.fillRect(X + 8 + i, yy + 7 - i, 2, 2);
              c.fillRect(X + 22 - i, yy + 7 - i, 2, 2);
            }
          }
          c.fillStyle = '#f2c230';
          c.fillRect(X + 2, Y + 2, TS - 4, 2);
          return;
        }
        case T.RUBBLE: {
          this.paintGround(x, y);
          for (let i = 0; i < 14; i++) {
            c.fillStyle = P.rubble[Math.floor(hash(x, y, 70 + i) * 3)];
            const w = 2 + Math.floor(hash(x, y, 90 + i) * 4);
            c.fillRect(X + 2 + Math.floor(hash(x, y, 110 + i) * 26), Y + 2 + Math.floor(hash(x, y, 130 + i) * 26), w, w - 1);
          }
          c.fillStyle = 'rgba(20,14,8,0.25)';
          c.beginPath(); c.ellipse(X + 16, Y + 16, 13, 11, 0, 0, Math.PI * 2); c.fill();
          return;
        }
        default:
          this.paintGround(x, y);
          if (this.mode === 'floor' && this.isTall(v)) {
            c.fillStyle = v === T.TREE ? 'rgba(0,0,0,0.25)' : P.foot;
            if (v !== T.TREE) c.fillRect(X, Y, TS, TS);
          }
      }
    }

    isPad(x, y) { const v = this.tile(x, y); return v === T.LIFT || v === T.PAD_USED; }

    paintTall(x, y, v) {
      if (this.mode === 'floor') return;
      const c = this.ctx, P = this.pal, X = x * TS, Y = y * TS, key = this.stage.theme.key;
      const same = (dx, dy) => this.tile(x + dx, y + dy) === v;
      if (v === T.TREE) {
        const ox = X + 16 + Math.floor((hash(x, y, 3) - 0.5) * 6), oy = Y + 16 + Math.floor((hash(x, y, 4) - 0.5) * 6);
        c.fillStyle = P.tree[2];
        c.beginPath(); c.arc(ox, oy, 15, 0, Math.PI * 2); c.fill();
        c.fillStyle = P.tree[0];
        c.beginPath(); c.arc(ox - 1, oy - 1, 13, 0, Math.PI * 2); c.fill();
        c.fillStyle = P.tree[1];
        for (let i = 0; i < 7; i++) {
          const a = hash(x, y, 30 + i) * Math.PI * 2, r = hash(x, y, 40 + i) * 8;
          c.beginPath(); c.arc(ox - 3 + Math.cos(a) * r, oy - 3 + Math.sin(a) * r, 3 + hash(x, y, 50 + i) * 2, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = 'rgba(255,255,220,0.18)';
        c.beginPath(); c.arc(ox - 5, oy - 6, 5, 0, Math.PI * 2); c.fill();
        return;
      }
      const top = v === T.WALL ? P.wallTop : v === T.BLOCK ? P.block : P.fort;
      const hi = v === T.WALL ? P.wallHi : v === T.BLOCK ? P.blockHi : P.fortHi;
      const lo = v === T.WALL ? P.wallLo : v === T.BLOCK ? P.blockLo : P.fortLo;
      const bev = v === T.BLOCK ? 3 : 4;
      c.fillStyle = top;
      c.fillRect(X, Y, TS, TS);
      // Bevel only on edges not joined to the same tile type, so runs read as one mass
      c.fillStyle = hi;
      if (!same(0, -1)) c.fillRect(X, Y, TS, bev);
      if (!same(-1, 0)) c.fillRect(X, Y, bev, TS);
      c.fillStyle = lo;
      if (!same(0, 1)) c.fillRect(X, Y + TS - bev, TS, bev);
      if (!same(1, 0)) c.fillRect(X + TS - bev, Y, bev, TS);

      if (v === T.BLOCK) {
        c.fillStyle = lo;
        c.fillRect(X + 6, Y + 6, TS - 12, 2);
        c.fillRect(X + 6, Y + TS - 8, TS - 12, 2);
        for (let i = 0; i < 18; i++) c.fillRect(X + 7 + i, Y + 7 + i, 2, 2);
        c.fillStyle = hi;
        c.fillRect(X + 6, Y + 8, 2, TS - 16);
      } else if (v === T.WALL) {
        if (key === 'base') {
          c.fillStyle = P.wallLo;
          c.fillRect(X + 8, Y + 8, 16, 16);
          c.fillStyle = (x + y) % 3 === 0 ? P.light : '#5a6a7e';
          c.fillRect(X + 13, Y + 13, 6, 6);
        } else if (key === 'desert') {
          c.fillStyle = P.wallLo;
          for (let i = 0; i < 6; i++) c.fillRect(X + 5 + Math.floor(hash(x, y, 80 + i) * 20), Y + 5 + Math.floor(hash(x, y, 90 + i) * 20), 3, 2);
          c.fillStyle = P.wallHi;
          for (let i = 0; i < 4; i++) c.fillRect(X + 5 + Math.floor(hash(x, y, 100 + i) * 20), Y + 5 + Math.floor(hash(x, y, 110 + i) * 20), 2, 1);
        } else {
          // stone blocks
          c.fillStyle = P.wallLo;
          c.fillRect(X, Y + 15, TS, 1);
          c.fillRect(X + ((y % 2) ? 10 : 22), Y, 1, 15);
          c.fillRect(X + ((y % 2) ? 22 : 10), Y + 16, 1, 16);
        }
      } else if (v === T.FORT) {
        c.fillStyle = P.fortLo;
        c.fillRect(X, Y + 15, TS, 2);
        c.fillRect(X + 15, Y, 2, TS);
        c.fillStyle = '#c84a2a';
        if ((x + y) % 2 === 0) c.fillRect(X + 4, Y + 4, 4, 2);
      }
    }
  }

  global.MapTexture = MapTexture;
  global.MAP_PALETTES = PALETTES;
})(window);
