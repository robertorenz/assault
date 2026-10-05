/* Assault Revamped — synthesized sound effects (WebAudio, no assets).
 * style 'classic' leans on raw square waves; 'modern' layers filtered noise. */
(function (global) {
  'use strict';

  class AssaultAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.volume = 0.55;
      this.style = 'modern';
    }

    unlock() {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }

    get ok() { return !!this.ctx && !this.muted; }

    tone(o) {
      if (!this.ok) return;
      const c = this.ctx, t = c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.1, vol = o.vol || 0.15;
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }

    noise(o) {
      if (!this.ok) return;
      const c = this.ctx, t = c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.3;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const flt = c.createBiquadFilter();
      flt.type = o.filter || 'lowpass';
      flt.frequency.setValueAtTime(o.freq || 1500, t);
      if (o.freq2) flt.frequency.exponentialRampToValueAtTime(o.freq2, t + dur);
      flt.Q.value = o.q || 0.7;
      const g = c.createGain();
      g.gain.setValueAtTime(o.vol || 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt);
      flt.connect(g);
      g.connect(this.master);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
    }

    arp(notes, step, type, vol) {
      notes.forEach((f, i) => this.tone({ f, dur: step * 1.6, type, vol, delay: i * step }));
    }

    play(ev) {
      if (!this.ok) return;
      const classic = this.style === 'classic';
      switch (ev.type) {
        case 'shoot':
          if (classic) this.tone({ f: 1500, f2: 260, dur: 0.09, vol: 0.1 });
          else {
            this.tone({ f: 1900, f2: 380, dur: 0.12, type: 'sawtooth', vol: 0.06 });
            this.noise({ dur: 0.07, vol: 0.12, freq: 3500, filter: 'highpass' });
          }
          break;
        case 'enemyShoot':
          this.tone({ f: ev.kind === 'missile' ? 520 : 380, f2: 160, dur: 0.14, type: classic ? 'square' : 'triangle', vol: 0.05 });
          break;
        case 'explode':
          this.noise({ dur: ev.crawl ? 0.5 : 0.42, vol: classic ? 0.32 : 0.42, freq: 2400, freq2: 180 });
          this.tone({ f: 220, f2: 40, dur: 0.35, type: classic ? 'square' : 'sine', vol: classic ? 0.1 : 0.22 });
          break;
        case 'hit':
          this.tone({ f: 700, f2: 500, dur: 0.06, vol: 0.1 });
          break;
        case 'split':
          this.noise({ dur: 0.25, vol: 0.25, freq: 3000, freq2: 600 });
          this.tone({ f: 900, f2: 1600, dur: 0.14, type: 'triangle', vol: 0.1 });
          break;
        case 'launch':
          this.tone({ f: 180, f2: 640, dur: 0.35, type: classic ? 'square' : 'triangle', vol: 0.06 });
          break;
        case 'land':
          this.tone({ f: 140, f2: 50, dur: 0.22, type: classic ? 'square' : 'sine', vol: 0.18 });
          break;
        case 'spark':
          this.noise({ dur: 0.05, vol: 0.12, freq: 5000, filter: 'highpass' });
          this.tone({ f: 2400, dur: 0.04, type: 'triangle', vol: 0.04 });
          break;
        case 'intercept':
          this.tone({ f: 1800, f2: 2600, dur: 0.06, type: 'triangle', vol: 0.08 });
          break;
        case 'bulletGround':
          this.noise({ dur: 0.08, vol: 0.06, freq: 900 });
          break;
        case 'playerDie':
          this.noise({ dur: 1.3, vol: 0.55, freq: 1800, freq2: 60 });
          this.tone({ f: 440, f2: 30, dur: 1.1, type: 'sawtooth', vol: 0.14 });
          break;
        case 'heatWarn':
          this.tone({ f: 880, dur: 0.08, vol: 0.09 });
          this.tone({ f: 880, dur: 0.08, vol: 0.09, delay: 0.12 });
          break;
        case 'waveStart':
          this.arp([262, 330, 392, 523], 0.09, classic ? 'square' : 'triangle', 0.08);
          break;
        case 'waveClear':
          this.arp([392, 523, 659, 784, 1047], 0.08, classic ? 'square' : 'triangle', 0.1);
          break;
        case 'extraLife':
          this.arp([784, 988, 1175, 1568], 0.07, 'square', 0.08);
          break;
        case 'gameOver':
          this.arp([392, 330, 262, 196], 0.22, classic ? 'square' : 'triangle', 0.1);
          break;
      }
    }

    click() { this.tone({ f: 1200, f2: 900, dur: 0.05, type: 'triangle', vol: 0.06 }); }
  }

  global.AssaultAudio = AssaultAudio;
})(window);
