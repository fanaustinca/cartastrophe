import { PA_DEFAULT, type PaHost } from './fun';
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
  /** Store PA reads announcements aloud (speechSynthesis) when available. */
  voice = true;

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

  /** A held note with attack/release, optional pitch slide, vibrato and lowpass "mouth". */
  private hold(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0, vib = 0, vibHz = 6, lp = 0) {
    if (!this.ctx || gain <= 0) return;
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(Math.max(20, f1), t + dur);
    if (vib) {
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = vibHz; lg.gain.value = vib;
      l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.1);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.setValueAtTime(gain, t + Math.max(0.03, dur - 0.06)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = o.connect(g);
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 2; out = out.connect(f); }
    out.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Cart horns (H). v scales with distance for other people's honks. */
  horn(id: string, v = 1) {
    if (!this.ctx || v < 0.02) return;
    const h = this.hold.bind(this);
    switch (id) {
      case 'squeaky': h('square', 1300, 2100, 0.12, 0.05 * v, 0, 0, 0, 3000); h('square', 2100, 1200, 0.14, 0.05 * v, 0.16, 0, 0, 3000); return;
      case 'clown': for (const at of [0, 0.24]) { h('sawtooth', 390, 330, 0.18, 0.12 * v, at, 0, 0, 1400); h('square', 780, 660, 0.18, 0.04 * v, at, 0, 0, 2000); } return;
      case 'duck': for (const at of [0, 0.2, 0.32]) h('sawtooth', 760, 430, 0.12, 0.09 * v, at, 0, 0, 1800); return;
      case 'goat': h('sawtooth', 620, 470, 1.1, 0.12 * v, 0, 45, 9, 2200); h('square', 1240, 940, 1.1, 0.03 * v, 0, 60, 9, 3000); this.noise(1.0, 1800, 1.2, 0.05 * v, 'bandpass'); return;
      case 'trombone': [392, 370, 349].forEach((f, i) => h('sawtooth', f, f * 0.99, 0.32, 0.1 * v, i * 0.36, 0, 0, 1200)); h('sawtooth', 330, 318, 1.0, 0.1 * v, 1.08, 10, 6, 1100); return;
      case 'air': for (const at of [0, 0.42, 0.84]) { h('sawtooth', 466, 462, 0.36, 0.13 * v, at, 0, 0, 2600); h('sawtooth', 470, 466, 0.36, 0.1 * v, at, 0, 0, 2600); h('square', 932, 930, 0.36, 0.04 * v, at, 0, 0, 3500); } return;
      case 'cucaracha': {
        const C = 523, F = 698, A = 880, E = 659, D = 587;
        const tune: [number, number][] = [[C, 0.11], [C, 0.11], [C, 0.11], [F, 0.3], [A, 0.3], [C, 0.11], [C, 0.11], [C, 0.11], [F, 0.3], [A, 0.45], [F, 0.14], [F, 0.14], [E, 0.14], [E, 0.14], [D, 0.14], [D, 0.14], [C, 0.4]];
        let at = 0; for (const [f, d] of tune) { h('square', f, f, d * 0.9, 0.05 * v, at, 0, 0, 2400); h('sawtooth', f * 0.5, f * 0.5, d * 0.9, 0.04 * v, at, 0, 0, 1500); at += d; }
        return;
      }
      case 'train': for (const [at, d] of [[0, 0.45], [0.55, 1.1]] as const) for (const f of [220, 277, 330]) h('sawtooth', f * 1.02, f, d, 0.06 * v, at, 4, 5, 1600); this.noise(0.4, 600, 0.8, 0.08 * v, 'lowpass'); return;
      default: h('sine', 2100, 2095, 0.4, 0.1 * v); h('sine', 2800, 2795, 0.3, 0.05 * v); h('sine', 2100, 2095, 0.45, 0.1 * v, 0.14); h('sine', 2800, 2795, 0.35, 0.05 * v, 0.14);
    }
  }

  /** Store PA jingle before an announcement (each store's announcer has their own). */
  chime() {
    const h = this.hold.bind(this);
    switch (this.host.chime) {
      case 'warehouse': h('square', 196, 196, 0.32, 0.05, 0, 0, 6, 900); h('square', 147, 147, 0.5, 0.05, 0.34, 0, 6, 900); return; // bored two-tone buzz
      case 'sparkle': [784, 988, 1175, 1568].forEach((f, i) => h('sine', f, f, 0.3, 0.09, i * 0.09)); return; // bright rising arpeggio
      case 'windchime': [1047, 1319, 1175, 1568, 1397].forEach((f, i) => h('sine', f, f, 0.9, 0.05, i * 0.13 + Math.random() * 0.04)); return; // tinkly, unhurried
      case 'modem': [880, 1320, 660, 1760, 990, 1500].forEach((f, i) => h('square', f, f * 1.03, 0.07, 0.035, i * 0.075, 0, 6, 3200)); return; // bleep bloop
      default: h('triangle', 659, 659, 0.42, 0.11); h('triangle', 523, 523, 0.6, 0.11, 0.38); // classic ding-dong
    }
  }

  /** Which store's announcer is on the PA (voice, pitch, rate, chime). */
  setHost(h: PaHost) { this.host = h; this.paVoice = undefined; }
  private host: PaHost = PA_DEFAULT;
  private paVoice: SpeechSynthesisVoice | null | undefined;
  /** Best installed voice for the current announcer: named voices first, then accent, then any English one. */
  private pickVoice(): SpeechSynthesisVoice | null {
    if (this.paVoice !== undefined) return this.paVoice;
    const all = window.speechSynthesis.getVoices();
    if (!all.length) return null; // still loading; try again next time
    const en = all.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const pool = en.length ? en : all;
    const h = this.host;
    let v: SpeechSynthesisVoice | undefined;
    for (const n of h.voices) if ((v = pool.find((x) => x.name.toLowerCase().includes(n.toLowerCase())))) break;
    if (!v) for (const l of h.langs) if ((v = pool.find((x) => x.lang.replace('_', '-').toLowerCase() === l.toLowerCase()))) break;
    // otherwise spread the stores over whatever voices exist so they still sound different
    if (!v) { let k = 0; for (const c of h.name) k = (k * 31 + c.charCodeAt(0)) >>> 0; v = pool[k % pool.length]; }
    return (this.paVoice = v ?? null);
  }

  /** Read an announcement aloud in the current store announcer's voice. */
  speak(text: string) {
    if (!this.enabled || !this.voice) return;
    try {
      const s = window.speechSynthesis;
      if (!s) return;
      s.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s.,!?'’:;-]/gu, ''));
      const v = this.pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = this.host.rate; u.pitch = this.host.pitch; u.volume = Math.min(1, this.volume * 1.2);
      setTimeout(() => s.speak(u), 900); // after the chime
    } catch { /* no speech synthesis */ }
  }
  hushVoice() { try { window.speechSynthesis?.cancel(); } catch { /* none */ } }

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
      case 'dolphin': { const f = 2600 + Math.random() * 900; this.hold('sine', f, f * 1.35, 0.06, 0.035 * v, 0); this.hold('sine', f * 1.3, f * 0.9, 0.08, 0.035 * v, 0.07, 120, 40); return; }
      case 'whoopee': this.hold('sawtooth', 110 + Math.random() * 40, 70, 0.32, 0.07 * v, 0, 18, 28, 520); return;
      case 'baby': for (let i = 0; i < 3; i++) { const f = 520 + Math.random() * 80; this.hold('triangle', f, f * 0.8, 0.08, 0.05 * v, i * 0.1, 30, 14, 2000); } return;
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

  stopLoops() { if (this.rumble) { this.rumble.src.stop(); this.rumble = null; } this.hushVoice(); }
}
