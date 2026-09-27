// Synthesized sound: gunshot, steel ring, dirt thud, turret clicks, rain/wind ambience.

export class Sound {
  constructor() { this.ctx = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.rainGain = this.loop(1800, 0.5);
    this.windGain = this.loop(260, 0.8);
  }

  loop(freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  ambient(rain, wind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * 0.35, t, 0.5);
    this.windGain.gain.setTargetAtTime(Math.min(0.5, wind * 0.035), t, 0.8);
  }

  shot(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0 * Math.min(1.3, power), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + power * 0.4);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 1.5);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.4);
    // echo off the terrain
    const e = ctx.createBufferSource(); e.buffer = this.noise;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 700;
    const eg = ctx.createGain(); eg.gain.setValueAtTime(0.0001, t + 0.35);
    eg.gain.exponentialRampToValueAtTime(0.12, t + 0.45); eg.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    e.connect(ef).connect(eg).connect(this.master); e.start(t); e.stop(t + 1.8);
  }

  ping(delay, dist) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const vol = Math.min(0.6, 180 / Math.max(dist, 100));
    for (const [fr, a] of [[1320, 1], [2710, 0.5], [4150, 0.25]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * a, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 1);
    }
  }

  thud(delay, dist) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const vol = Math.min(0.5, 120 / Math.max(dist, 100));
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 0.3);
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.03);
  }

  bolt() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [dt, fr] of [[0.25, 900], [0.45, 650], [0.7, 1100]]) {
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.08);
      src.connect(f).connect(g).connect(this.master); src.start(t + dt); src.stop(t + dt + 0.1);
    }
  }
}
