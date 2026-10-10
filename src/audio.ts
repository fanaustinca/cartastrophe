// All sound is synthesized with WebAudio: wheel rumble, customizable squeaks, crashes,
// egg splats, boosts, pickups, countdown. No audio files.
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private rumble: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noiseBuf!: AudioBuffer;
  private squeakPhase = 0;
  enabled = true;
  volume = 0.7;

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { this.enabled = false; return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  private noise(dur: number, f: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', at = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Continuous wheel rumble; call every frame with speed. */
  wheels(speed: number, squeak: string, dt: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.rumble) {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300;
      const gain = c.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master); src.start();
      this.rumble = { src, gain, filter };
    }
    const s = Math.min(1, speed / 12);
    this.rumble.gain.gain.setTargetAtTime(s * 0.18, c.currentTime, 0.05);
    this.rumble.filter.frequency.setTargetAtTime(180 + s * 900, c.currentTime, 0.05);
    // squeaks happen per wheel revolution-ish
    this.squeakPhase += dt * speed * 0.55;
    if (this.squeakPhase > 1 && speed > 0.6) { this.squeakPhase = 0; if (Math.random() < 0.7) this.squeak(squeak, 0.5 + s * 0.5); }
  }

  squeak(kind: string, v = 1) {
    switch (kind) {
      case 'silent': return;
      case 'duck': this.tone('sawtooth', 900, 500, 0.12, 0.06 * v); this.tone('square', 1350, 700, 0.1, 0.02 * v); return;
      case 'chicken': this.tone('sawtooth', 1800 + Math.random() * 600, 900, 0.28, 0.05 * v); return;
      case 'kazoo': { this.tone('square', 330 + Math.random() * 120, 300, 0.18, 0.04 * v); this.tone('sawtooth', 660, 640, 0.18, 0.02 * v); return; }
      default: this.tone('sine', 2400 + Math.random() * 600, 1700, 0.09, 0.035 * v);
    }
  }

  crash(force: number) {
    const v = Math.min(1, force / 20000);
    this.noise(0.25 + v * 0.3, 300 + v * 400, 0.7, 0.25 + v * 0.5, 'lowpass');
    this.noise(0.15, 2500, 2, 0.15 * v, 'bandpass', 0.01);
    this.tone('triangle', 140, 60, 0.25, 0.2 * v);
  }
  clatter() { for (let i = 0; i < 4; i++) this.noise(0.06, 1500 + Math.random() * 2500, 4, 0.06, 'bandpass', i * 0.05 + Math.random() * 0.04); }
  splat(type: string) {
    this.noise(0.18, type === 'egg' ? 2200 : 900, 1.5, 0.35, 'bandpass');
    this.tone('sine', 220, 70, 0.2, 0.25);
    if (type === 'egg') this.noise(0.05, 5000, 3, 0.2, 'highpass', 0.01);
  }
  boost() { this.tone('sawtooth', 200, 1200, 0.45, 0.12); this.noise(0.5, 1200, 0.6, 0.15, 'bandpass'); }
  spin() { this.tone('sine', 1200, 300, 0.6, 0.08); this.noise(0.6, 3000, 1, 0.08, 'highpass'); }
  pickup() { this.tone('square', 880, 880, 0.08, 0.08); this.tone('square', 1320, 1320, 0.12, 0.08, 0.08); }
  wrong() { this.tone('square', 220, 180, 0.15, 0.06); }
  beep(high = false) { this.tone('square', high ? 1046 : 523, high ? 1046 : 523, high ? 0.5 : 0.18, 0.12); }
  finish() { [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.18, 0.1, i * 0.12)); }
  scan() { this.tone('sine', 1900, 1900, 0.09, 0.08); }

  stopLoops() { if (this.rumble) { this.rumble.src.stop(); this.rumble = null; } }
}
