/* Assault Revamped — core simulation.
 * Renderer-agnostic: both the Classic and 2.5D views read this state and
 * consume the events it emits. World space is 480 x 600, y grows downward. */
(function (global) {
  'use strict';

  const W = 480, H = 600;
  const GROUND_Y = 556;          // centre line of the player's ground track
  const MOTHER_Y = 64;           // mothership cruising line
  const ROWS = [150, 225, 300, 375, 450];   // patrol lanes, top to bottom

  const HEAT_PER_SHOT = 13;
  const HEAT_COOL = 28;          // per second, once the delay has passed
  const HEAT_DELAY = 0.3;
  const HEAT_WARN = 72;
  const SHOT_SPEED = 560;
  const FIRE_COOLDOWN = 0.2;

  const TYPES = {
    saucer:   { w: 26, h: 12, speed: 80,  score: 100, fireRate: 1.0, rowTime: [2.5, 4.5] },
    splitter: { w: 30, h: 12, speed: 70,  score: 150, fireRate: 0.7, rowTime: [3.0, 5.0] },
    mini:     { w: 16, h: 9,  speed: 150, score: 75,  fireRate: 0.5, rowTime: [1.5, 3.0] },
    gunner:   { w: 28, h: 14, speed: 60,  score: 250, fireRate: 1.8, rowTime: [3.0, 5.0], aimed: true, hp: 2 },
    diver:    { w: 22, h: 12, speed: 110, score: 150, fireRate: 0.6, rowTime: [0.8, 1.6] }
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.hiScore = opts.hiScore || 0;
      this.nextId = 1;
      this.reset();
    }

    reset() {
      this.score = 0;
      this.lives = 3;
      this.nextLife = 10000;
      this.time = 0;
      this.events = [];
      this.player = { x: W / 2, y: GROUND_Y, w: 34, h: 18, alive: true, invuln: 0, aim: 'up', recoil: 0, vx: 0, fireCd: 0 };
      this.heat = 0;
      this.heatDelay = 0;
      this.heatWarned = false;
      this.shots = [];
      this.bullets = [];
      this.enemies = [];
      this.mother = { x: W / 2, y: MOTHER_Y, vx: 64, launchCd: 2, bay: 0, w: 150, h: 26 };
      this.message = null;
      this.over = false;
      this.startWave(1);
    }

    get difficulty() { return 1 + (this.wave - 1) * 0.11; }

    emit(type, data) { this.events.push(Object.assign({}, data, { type })); }

    drainEvents() { const e = this.events; this.events = []; return e; }

    setState(s, t) { this.state = s; this.stateTimer = t || 0; }

    say(text, sub, dur) { this.message = { text, sub: sub || '', t: 0, dur: dur || 2 }; }

    startWave(n) {
      this.wave = n;
      this.kills = 0;
      this.quota = Math.min(10 + (n - 1) * 2, 24);
      this.spawned = 0;
      this.enemies = [];
      this.bullets = [];
      this.shots = [];
      this.heat = 0;
      this.heatWarned = false;
      this.mother.launchCd = 2.4;
      this.setState('ready', 2.4);
      this.say('WAVE ' + n, 'GET READY', 2.4);
      this.emit('waveStart', { wave: n });
    }

    /* ---------------------------------------------------------------- */

    update(dt, input) {
      input = input || {};
      this.time += dt;
      if (this.message) {
        this.message.t += dt;
        if (this.message.t >= this.message.dur) this.message = null;
      }

      this.updateMother(dt);
      if (this.player.alive && this.state !== 'gameover') this.updatePlayer(dt, input);
      else this.coolHeat(dt);
      if (this.state === 'play') this.spawnLogic(dt);
      this.updateEnemies(dt);
      this.updateShots(dt);
      this.updateBullets(dt);
      this.enemies = this.enemies.filter(e => !e.dead);

      if (this.stateTimer > 0) this.stateTimer -= dt;
      switch (this.state) {
        case 'ready': if (this.stateTimer <= 0) this.setState('play'); break;
        case 'play': if (this.kills >= this.quota) this.clearWave(); break;
        case 'dying': if (this.stateTimer <= 0) this.afterDeath(); break;
        case 'waveclear': if (this.stateTimer <= 0) this.startWave(this.wave + 1); break;
      }
    }

    updatePlayer(dt, input) {
      const p = this.player;
      const mv = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      p.vx = mv * 215;
      p.x = clamp(p.x + p.vx * dt, 24, W - 24);
      if (p.invuln > 0) p.invuln -= dt;
      if (p.recoil > 0) p.recoil = Math.max(0, p.recoil - dt * 6);
      p.fireCd -= dt;
      this.coolHeat(dt);

      const dir = input.fireUp ? 'up' : input.fireLeft ? 'left' : input.fireRight ? 'right' : null;
      if (dir && p.fireCd <= 0 && this.state !== 'waveclear' && this.shots.length < 4) this.fire(dir);
    }

    coolHeat(dt) {
      if (this.heatDelay > 0) this.heatDelay -= dt;
      else this.heat = Math.max(0, this.heat - HEAT_COOL * dt);
      if (this.heat < HEAT_WARN - 8) this.heatWarned = false;
    }

    fire(dir) {
      const p = this.player;
      p.fireCd = FIRE_COOLDOWN;
      p.aim = dir;
      p.recoil = 1;
      const s = { dir, x: p.x, y: p.y - 4, vx: 0, vy: 0 };
      if (dir === 'up') { s.y = p.y - 16; s.vy = -SHOT_SPEED; }
      else { s.x += dir === 'left' ? -20 : 20; s.vx = dir === 'left' ? -SHOT_SPEED : SHOT_SPEED; }
      this.shots.push(s);
      this.heat += HEAT_PER_SHOT;
      this.heatDelay = HEAT_DELAY;
      this.emit('shoot', { dir, x: s.x, y: s.y });
      if (this.heat >= 100) {
        this.heat = 100;
        this.killPlayer('overheat');
      } else if (this.heat >= HEAT_WARN && !this.heatWarned) {
        this.heatWarned = true;
        this.emit('heatWarn', {});
      }
    }

    updateMother(dt) {
      const m = this.mother;
      const speed = 60 + this.wave * 6;
      m.vx = (m.vx < 0 ? -1 : 1) * speed;
      m.x += m.vx * dt;
      if (m.x < 90) { m.x = 90; m.vx = speed; }
      if (m.x > W - 90) { m.x = W - 90; m.vx = -speed; }
      if (m.bay > 0) m.bay = Math.max(0, m.bay - dt * 1.5);
    }

    spawnLogic(dt) {
      const m = this.mother;
      m.launchCd -= dt;
      if (m.launchCd > 0) return;
      const maxActive = Math.min(2 + Math.floor(this.wave / 2), 6);
      if (this.enemies.length < maxActive && this.spawned < this.quota) {
        this.launch();
        m.launchCd = rand(1.1, 2.3) / this.difficulty;
      } else {
        m.launchCd = 0.4;
      }
    }

    pickType() {
      const r = Math.random();
      if (this.wave === 1) return r < 0.8 ? 'saucer' : 'diver';
      if (r < 0.36) return 'saucer';
      if (r < 0.6) return 'splitter';
      if (r < 0.8) return 'diver';
      return this.wave >= 3 ? 'gunner' : 'saucer';
    }

    makeEnemy(type, x, y, state) {
      const spec = TYPES[type];
      return {
        id: this.nextId++, type, x, y, w: spec.w, h: spec.h, vx: 0, state,
        row: 0, targetY: 0, rowTimer: 0, fireCd: rand(1.2, 2.6), hp: spec.hp || 1,
        t: 0, hitFlash: 0, dead: false, turnCd: rand(1, 3)
      };
    }

    launch() {
      const m = this.mother;
      const type = this.pickType();
      const e = this.makeEnemy(type, m.x, m.y + 14, 'drop');
      this.enemies.push(e);
      this.spawned++;
      m.bay = 1;
      this.emit('launch', { x: e.x, y: e.y, enemy: type });
    }

    beginPatrol(e) {
      const spec = TYPES[e.type];
      e.state = 'patrol';
      if (!e.vx) e.vx = Math.random() < 0.5 ? -1 : 1;
      e.vx = Math.sign(e.vx) * spec.speed * this.difficulty;
      e.rowTimer = rand(spec.rowTime[0], spec.rowTime[1]) / this.difficulty;
    }

    updateEnemies(dt) {
      const d = this.difficulty, p = this.player;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const spec = TYPES[e.type];
        e.t += dt;
        if (e.hitFlash > 0) e.hitFlash -= dt;

        switch (e.state) {
          case 'drop':
            e.y += 150 * dt;
            if (e.y >= ROWS[0]) { e.y = ROWS[0]; e.row = 0; this.beginPatrol(e); }
            break;

          case 'patrol': {
            e.x += e.vx * dt;
            const half = e.w / 2 + 8;
            if (e.x < half) { e.x = half; e.vx = Math.abs(e.vx); }
            if (e.x > W - half) { e.x = W - half; e.vx = -Math.abs(e.vx); }
            e.turnCd -= dt;
            if (e.turnCd <= 0) { e.turnCd = rand(1.2, 3.5); if (Math.random() < 0.35) e.vx = -e.vx; }
            e.rowTimer -= dt;
            if (e.rowTimer <= 0) {
              e.state = 'descend';
              e.targetY = e.row + 1 < ROWS.length ? ROWS[e.row + 1] : GROUND_Y;
            }
            if (this.state === 'play') {
              e.fireCd -= dt;
              if (e.fireCd <= 0) {
                this.enemyFire(e);
                e.fireCd = rand(1.5, 3.4) / (spec.fireRate * d);
              }
            }
            break;
          }

          case 'descend': {
            e.y += (e.type === 'diver' ? 210 : 120) * d * dt;
            e.x = clamp(e.x + e.vx * 0.25 * dt, 16, W - 16);
            if (e.y >= e.targetY) {
              e.y = e.targetY;
              if (e.targetY >= GROUND_Y) {
                e.state = 'crawl';
                e.vx = (p.x >= e.x ? 1 : -1) * (48 + this.wave * 5);
                this.emit('land', { x: e.x, y: e.y, enemy: e.type });
              } else {
                e.row++;
                this.beginPatrol(e);
              }
            }
            if (p.alive && p.invuln <= 0 && e.y > GROUND_Y - 18 &&
                Math.abs(e.x - p.x) < (e.w + p.w) / 2 - 4) this.killPlayer('crushed');
            break;
          }

          case 'crawl':
            e.x += e.vx * dt;
            if (e.x < 14) { e.x = 14; e.vx = Math.abs(e.vx); }
            if (e.x > W - 14) { e.x = W - 14; e.vx = -Math.abs(e.vx); }
            e.turnCd -= dt;
            if (e.turnCd <= 0 && p.alive) {
              e.turnCd = rand(1.5, 3);
              e.vx = (p.x >= e.x ? 1 : -1) * Math.abs(e.vx);
            }
            if (p.alive && p.invuln <= 0 && Math.abs(e.x - p.x) < (e.w + p.w) / 2 - 6) this.killPlayer('crawler');
            break;
        }
      }
    }

    enemyFire(e) {
      if (this.bullets.length >= 3 + Math.floor(this.wave / 2)) return;
      const spec = TYPES[e.type], p = this.player;
      const vy = 170 + this.wave * 10;
      let vx = 0;
      if (spec.aimed) vx = clamp((p.x - e.x) / ((GROUND_Y - e.y) / vy), -90, 90);
      const kind = spec.aimed ? 'missile' : 'bomb';
      this.bullets.push({ x: e.x, y: e.y + e.h / 2, vx, vy, kind });
      this.emit('enemyShoot', { x: e.x, y: e.y, kind });
    }

    updateShots(dt) {
      const m = this.mother;
      for (const s of this.shots) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        if (s.dir === 'up') {
          if (s.y < -10) { s.dead = true; continue; }
          // The mothership is armoured: shots spark harmlessly off its hull.
          if (Math.abs(s.x - m.x) < m.w / 2 && Math.abs(s.y - m.y) < m.h / 2) {
            s.dead = true;
            this.emit('spark', { x: s.x, y: m.y + m.h / 2 });
            continue;
          }
          for (const b of this.bullets) {
            if (!b.dead && Math.abs(b.x - s.x) < 7 && Math.abs(b.y - s.y) < 12) {
              b.dead = s.dead = true;
              this.addScore(10);
              this.emit('intercept', { x: b.x, y: b.y });
              break;
            }
          }
          if (s.dead) continue;
          for (const e of this.enemies) {
            if (e.dead || e.state === 'crawl') continue;
            if (Math.abs(e.x - s.x) < e.w / 2 + 2 && Math.abs(e.y - s.y) < e.h / 2 + 8) {
              s.dead = true;
              this.hitEnemy(e);
              break;
            }
          }
        } else {
          if (s.x < -10 || s.x > W + 10) { s.dead = true; continue; }
          for (const e of this.enemies) {
            if (e.dead) continue;
            const low = e.state === 'crawl' || e.y > GROUND_Y - 30;
            if (low && Math.abs(e.x - s.x) < e.w / 2 + 4) {
              s.dead = true;
              this.hitEnemy(e);
              break;
            }
          }
        }
      }
      this.shots = this.shots.filter(s => !s.dead);
    }

    hitEnemy(e) {
      e.hp--;
      if (e.hp > 0) {
        e.hitFlash = 0.15;
        this.addScore(25);
        this.emit('hit', { x: e.x, y: e.y, enemy: e.type, state: e.state });
        return;
      }
      e.dead = true;

      if (e.type === 'splitter' && e.state !== 'crawl') {
        this.addScore(TYPES.splitter.score);
        for (const dir of [-1, 1]) {
          const mini = this.makeEnemy('mini', clamp(e.x + dir * 10, 16, W - 16), e.y, 'patrol');
          mini.row = e.row;
          mini.vx = dir;
          this.beginPatrol(mini);
          this.enemies.push(mini);
        }
        this.spawned++;
        this.emit('split', { x: e.x, y: e.y, points: TYPES.splitter.score });
        return;
      }

      const crawl = e.state === 'crawl';
      const points = TYPES[e.type].score + (crawl ? 150 : 0);
      this.addScore(points);
      this.kills++;
      this.emit('explode', { x: e.x, y: e.y, enemy: e.type, crawl, points, state: e.state });
    }

    updateBullets(dt) {
      const p = this.player;
      for (const b of this.bullets) {
        if (b.dead) continue;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y >= GROUND_Y + 14) {
          b.dead = true;
          this.emit('bulletGround', { x: b.x, y: GROUND_Y + 14 });
          continue;
        }
        if (p.alive && p.invuln <= 0 && Math.abs(b.x - p.x) < p.w / 2 && Math.abs(b.y - p.y) < p.h / 2 + 4) {
          b.dead = true;
          this.killPlayer('shot');
        }
      }
      this.bullets = this.bullets.filter(b => !b.dead);
    }

    killPlayer(reason) {
      const p = this.player;
      if (!p.alive) return;
      p.alive = false;
      this.lives--;
      this.emit('playerDie', { x: p.x, y: p.y, reason });
      for (const b of this.bullets) b.dead = true;
      // Clear the ground so the respawn is fair; those enemies go back in the pool.
      for (const e of this.enemies) {
        if (!e.dead && (e.state === 'crawl' || e.y > GROUND_Y - 40)) {
          e.dead = true;
          this.spawned--;
          this.emit('explode', { x: e.x, y: e.y, enemy: e.type, crawl: e.state === 'crawl', points: 0, state: e.state });
        }
      }
      this.heat = 0;
      this.setState('dying', 2.4);
      if (reason === 'overheat') this.say('OVERHEAT!', 'CANNON MELTDOWN', 2.2);
    }

    afterDeath() {
      const p = this.player;
      if (this.lives > 0) {
        p.alive = true;
        p.x = W / 2;
        p.invuln = 2.2;
        p.aim = 'up';
        this.setState('ready', 1.4);
        this.say('READY', '', 1.4);
      } else {
        this.setState('gameover');
        this.over = true;
        if (this.score > this.hiScore) this.hiScore = this.score;
        this.say('GAME OVER', '', 1e9);
        this.emit('gameOver', { score: this.score, wave: this.wave });
      }
    }

    clearWave() {
      const bonus = 500 * this.wave + Math.round((100 - this.heat) * 5);
      for (const e of this.enemies) {
        if (!e.dead) {
          e.dead = true;
          this.emit('explode', { x: e.x, y: e.y, enemy: e.type, crawl: e.state === 'crawl', points: 0, state: e.state });
        }
      }
      for (const b of this.bullets) b.dead = true;
      this.addScore(bonus);
      this.setState('waveclear', 3.2);
      this.say('WAVE ' + this.wave + ' CLEARED', 'BONUS ' + bonus, 3.2);
      this.emit('waveClear', { bonus });
    }

    addScore(n) {
      this.score += n;
      while (this.score >= this.nextLife) {
        this.nextLife += 10000;
        if (this.lives < 6) {
          this.lives++;
          this.emit('extraLife', { x: this.player.x, y: this.player.y });
        }
      }
    }
  }

  /* Attract-mode autopilot used behind the start menu. */
  function aiInput(g) {
    const p = g.player, inp = {};
    if (!p.alive || g.state === 'gameover') return inp;

    let threat = null;
    for (const b of g.bullets) {
      if (b.y > p.y - 150 && b.y < p.y) {
        const landX = b.x + b.vx * ((p.y - b.y) / b.vy);
        if (Math.abs(landX - p.x) < 26) { threat = b; break; }
      }
    }

    let crawler = null, cd = 1e9, target = null, best = -1;
    for (const e of g.enemies) {
      if (e.state === 'crawl' || e.y > GROUND_Y - 30) {
        const dd = Math.abs(e.x - p.x);
        if (dd < cd) { cd = dd; crawler = e; }
      } else if ((e.state === 'patrol' || e.state === 'descend') && e.y > best) {
        best = e.y; target = e;
      }
    }

    let tx = p.x;
    if (target) tx = target.x + target.vx * ((p.y - target.y) / SHOT_SPEED);
    if (threat) tx = p.x + (threat.x < p.x ? 70 : -70);
    if (tx < p.x - 6) inp.left = true;
    else if (tx > p.x + 6) inp.right = true;

    const cool = g.heat < 60;
    if (crawler && cd < 230 && cool) {
      if (crawler.x < p.x) inp.fireLeft = true; else inp.fireRight = true;
    } else if (target && Math.abs(tx - p.x) < 12 && cool) {
      inp.fireUp = true;
    }
    return inp;
  }

  global.Assault = { Game, aiInput, W, H, GROUND_Y, MOTHER_Y, ROWS, TYPES, HEAT_WARN };
})(window);
