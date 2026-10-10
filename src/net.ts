// Networking: star-topology P2P (host relays). Two interchangeable transports:
//  - PeerTransport: WebRTC data channels via PeerJS (public signalling server, real play)
//  - LocalTransport: BroadcastChannel between tabs of one browser (offline dev + headless tests)
// Plus a host-clock sync and a snapshot interpolator for remote carts.
import Peer, { DataConnection } from 'peerjs';

export const PEER_PREFIX = 'cartastrophe-v1-';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { k: string; [key: string]: any };

export interface Transport {
  selfId: string;
  isHost: boolean;
  peers(): string[];
  send(to: string, msg: Msg): void;
  broadcast(msg: Msg, except?: string): void;
  onMessage: (from: string, msg: Msg) => void;
  onJoin: (peer: string) => void;
  onLeave: (peer: string) => void;
  close(): void;
}

export function lobbyCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

const timeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

export class PeerTransport implements Transport {
  selfId = '';
  isHost = false;
  onMessage: (from: string, msg: Msg) => void = () => {};
  onJoin: (peer: string) => void = () => {};
  onLeave: (peer: string) => void = () => {};
  private peer!: Peer;
  private conns = new Map<string, DataConnection>();

  static async host(code: string): Promise<PeerTransport> {
    const t = new PeerTransport();
    t.isHost = true;
    t.peer = new Peer(PEER_PREFIX + code, { debug: 0 });
    await timeout(new Promise<void>((res, rej) => {
      t.peer.on('open', (id) => { t.selfId = id; res(); });
      t.peer.on('error', (e) => rej(e));
    }), 15000, 'Signalling server');
    t.peer.on('connection', (c) => {
      c.on('open', () => { t.conns.set(c.peer, c); t.onJoin(c.peer); });
      c.on('data', (d) => t.onMessage(c.peer, d as Msg));
      const gone = () => { if (t.conns.delete(c.peer)) t.onLeave(c.peer); };
      c.on('close', gone); c.on('error', gone);
    });
    return t;
  }

  static async join(code: string): Promise<PeerTransport> {
    const t = new PeerTransport();
    t.peer = new Peer({ debug: 0 });
    await timeout(new Promise<void>((res, rej) => {
      t.peer.on('open', (id) => {
        t.selfId = id;
        const c = t.peer.connect(PEER_PREFIX + code, { serialization: 'json', reliable: true });
        c.on('open', () => { t.conns.set(c.peer, c); res(); });
        c.on('data', (d) => t.onMessage(c.peer, d as Msg));
        c.on('close', () => { t.conns.delete(c.peer); t.onLeave(c.peer); });
      });
      t.peer.on('error', (e) => rej(e.type === 'peer-unavailable' ? new Error('Lobby not found') : e));
    }), 15000, 'Joining lobby');
    return t;
  }

  peers() { return [...this.conns.keys()]; }
  send(to: string, msg: Msg) { const c = this.conns.get(to); if (c?.open) c.send(msg); }
  broadcast(msg: Msg, except?: string) { for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg); }
  hostId() { return this.peers()[0]; }
  close() { for (const c of this.conns.values()) c.close(); this.peer?.destroy(); }
}

/** Same-browser transport over BroadcastChannel; envelope {from,to,msg}. */
export class LocalTransport implements Transport {
  selfId: string;
  isHost: boolean;
  onMessage: (from: string, msg: Msg) => void = () => {};
  onJoin: (peer: string) => void = () => {};
  onLeave: (peer: string) => void = () => {};
  private ch: BroadcastChannel;
  private known = new Set<string>();
  /** Simulated network conditions for testing (?lag=ms&jitter=ms): delays and reorders packets. */
  static lag = 0;
  static jitter = 0;
  private post(m: unknown) {
    const d = LocalTransport.lag + Math.random() * LocalTransport.jitter;
    if (d <= 0) this.ch.postMessage(m); else setTimeout(() => { try { this.ch.postMessage(m); } catch { /* closed */ } }, d);
  }

  private constructor(code: string, host: boolean) {
    this.isHost = host;
    this.selfId = host ? 'host' : 'p' + Math.random().toString(36).slice(2, 8);
    this.ch = new BroadcastChannel('cartastrophe-' + code);
    this.ch.onmessage = (e) => {
      const { from, to, msg, sys } = e.data;
      if (to !== '*' && to !== this.selfId) return;
      if (sys === 'hello' && this.isHost) { this.known.add(from); this.ch.postMessage({ from: this.selfId, to: from, sys: 'welcome' }); this.onJoin(from); return; }
      if (sys === 'welcome') { this.known.add(from); this.welcomed?.(); return; }
      if (sys === 'bye') { if (this.known.delete(from)) this.onLeave(from); return; }
      if (msg) this.onMessage(from, msg);
    };
  }
  private welcomed?: () => void;

  static async host(code: string) { return new LocalTransport(code, true); }
  static async join(code: string) {
    const t = new LocalTransport(code, false);
    await timeout(new Promise<void>((res) => { t.welcomed = res; t.ch.postMessage({ from: t.selfId, to: 'host', sys: 'hello' }); }), 5000, 'Joining local lobby');
    return t;
  }
  peers() { return [...this.known]; }
  send(to: string, msg: Msg) { this.post({ from: this.selfId, to, msg }); }
  broadcast(msg: Msg, except?: string) {
    for (const p of this.known) if (p !== except) this.post({ from: this.selfId, to: p, msg });
  }
  close() { this.ch.postMessage({ from: this.selfId, to: '*', sys: 'bye' }); this.ch.close(); }
}

/** Estimates host-clock offset from ping/pong round trips (keeps the lowest-RTT samples). */
export class Clock {
  offset = 0;
  rtt = 0;
  private samples: { rtt: number; off: number }[] = [];
  now() { return performance.now() / 1000; }
  hostNow() { return this.now() + this.offset; }
  sample(t0: number, hostT: number) {
    const t1 = this.now(), rtt = t1 - t0;
    this.samples.push({ rtt, off: hostT + rtt / 2 - t1 });
    this.samples.sort((a, b) => a.rtt - b.rtt);
    if (this.samples.length > 12) this.samples.length = 12;
    const best = this.samples.slice(0, 4);
    const target = best.reduce((s, x) => s + x.off, 0) / best.length;
    // slew, don't jump: snapshot timestamps must stay evenly spaced or the receiver
    // derives bogus velocities from them (first sample / big errors snap)
    const d = target - this.offset;
    this.offset = this.samples.length === 1 || Math.abs(d) > 0.5 ? target : this.offset + Math.max(-0.004, Math.min(0.004, d));
    this.rtt = best[0].rtt;
  }
}

export interface Snap { t: number; x: number; y: number; z: number; yaw: number; vx: number; vz: number; w: number; fl: number }

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/**
 * Snapshot interpolation with bounded extrapolation and smoothed error correction.
 * Renders remote carts INTERP_DELAY behind the host clock so there are normally two
 * snapshots to blend between; on packet gaps it extrapolates with velocity + yaw rate
 * for ≤250 ms, and corrections blend in over ~100 ms instead of snapping (no rubber-banding).
 */
export class Interpolator {
  buf: Snap[] = [];
  out = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, fl: 0, extrapolating: false };
  private shown: { x: number; z: number; yaw: number } | null = null;

  push(s: Snap) {
    if (this.buf.length && s.t <= this.buf[this.buf.length - 1].t) return; // out-of-order / duplicate
    this.buf.push(s);
    if (this.buf.length > 40) this.buf.splice(0, this.buf.length - 40);
  }

  sample(renderT: number, dt: number) {
    const b = this.buf, o = this.out;
    if (!b.length) return null;
    while (b.length > 2 && b[1].t <= renderT) b.shift();
    let x: number, y: number, z: number, yaw: number;
    if (renderT <= b[0].t) { ({ x, y, z, yaw } = b[0]); o.vx = b[0].vx; o.vz = b[0].vz; o.fl = b[0].fl; o.extrapolating = false; }
    else if (b.length >= 2 && renderT <= b[1].t) {
      const a = b[0], c = b[1], u = (renderT - a.t) / Math.max(1e-4, c.t - a.t);
      // cubic Hermite on position using velocities: smoother than linear through turns
      const h = c.t - a.t, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      // Fritsch–Carlson clamp: tangents never point against the chord or exceed 3× it, so the
      // curve is monotone between snapshots (a sender whose sim lags its clock can't make us
      // overshoot and slide back)
      const tan = (v: number, d: number) => (d === 0 || Math.sign(v) !== Math.sign(d) ? 0 : Math.sign(d) * Math.min(Math.abs(v * h), 3 * Math.abs(d)));
      const dx = c.x - a.x, dz = c.z - a.z;
      x = h00 * a.x + h10 * tan(a.vx, dx) + h01 * c.x + h11 * tan(c.vx, dx);
      z = h00 * a.z + h10 * tan(a.vz, dz) + h01 * c.z + h11 * tan(c.vz, dz);
      y = a.y + (c.y - a.y) * u;
      yaw = lerpAngle(a.yaw, c.yaw, u);
      o.vx = a.vx + (c.vx - a.vx) * u; o.vz = a.vz + (c.vz - a.vz) * u; o.fl = c.fl; o.extrapolating = false;
    } else {
      // extrapolate with the velocity actually observed between the last two snapshots
      const l = b[b.length - 1], p = b.length >= 2 ? b[b.length - 2] : null, e = Math.min(0.25, renderT - l.t);
      const span = p ? l.t - p.t : 0;
      let evx = l.vx, evz = l.vz;
      if (p && span > 0.03) {
        evx = (l.x - p.x) / span; evz = (l.z - p.z) / span;
        // trust the observed motion only up to what the sender says it's doing
        const cap = Math.hypot(l.vx, l.vz) * 1.25 + 0.5, m = Math.hypot(evx, evz);
        if (m > cap) { evx *= cap / m; evz *= cap / m; }
      }
      x = l.x + evx * e; z = l.z + evz * e; y = l.y; yaw = l.yaw + l.w * e;
      o.vx = l.vx; o.vz = l.vz; o.fl = l.fl; o.extrapolating = true;
    }
    // smooth corrections (e.g. when extrapolation guessed wrong) unless it's a teleport
    if (!this.shown || Math.hypot(x - this.shown.x, z - this.shown.z) > 3) this.shown = { x, z, yaw };
    else {
      const k = Math.min(1, dt * 18);
      let dx = x - this.shown.x, dz = z - this.shown.z;
      // never slide a moving cart backwards along its travel direction (that's what reads as
      // rubber-banding after an over-extrapolation): hold, and let the real data catch up
      const vl = Math.hypot(o.vx, o.vz);
      if (vl > 0.5) {
        const along = (dx * o.vx + dz * o.vz) / vl;
        if (along < 0 && along > -1.5) { dx -= (along * o.vx) / vl; dz -= (along * o.vz) / vl; }
      }
      this.shown.x += dx * k; this.shown.z += dz * k;
      this.shown.yaw = lerpAngle(this.shown.yaw, yaw, k);
    }
    o.x = this.shown.x; o.y = y; o.z = this.shown.z; o.yaw = this.shown.yaw;
    return o;
  }
}
