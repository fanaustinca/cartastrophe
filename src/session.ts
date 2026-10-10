// Multiplayer session: lobby membership, race start, and the in-race protocol.
//
// Host-relayed star:   client ──st (own cart, 20 Hz)──▶ host ──ss (all carts, 20 Hz)──▶ clients
//                      any    ──ev (collect/smash/fin/bump)──▶ host ──relay──▶ others
// Each machine simulates its own cart (instant response); the host also simulates bots.
// Remote carts are kinematic bodies posed by the Interpolator, so they still shove shelves
// and items locally. Timestamps are in host-clock seconds (Clock does ping/pong sync).
import { Transport, PeerTransport, LocalTransport, Clock, Msg, Snap } from './net';
import { Customization, MAX_PLAYERS, BOT_NAMES, RACE_TIME, NET_HZ, STORES, DEFAULT_CUSTOM, WHEELS, SKINS, NEONS, SQUEAKS } from './config';
import { PlayerInfo, RaceConfig, SLOT_COLORS, Game, ResultRow } from './game';

export interface LobbyPlayer { id: string; name: string; custom: Customization; slot: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class Session {
  clock = new Clock();
  players: LobbyPlayer[] = [];
  storeId = STORES[0].id;
  game: Game | null = null;
  onLobby: () => void = () => {};
  onStart: (cfg: RaceConfig, slot: number, startAt: number) => void = () => {};
  onEnd: (r: ResultRow[]) => void = () => {};
  onClosed: (why: string) => void = () => {};
  private sendTimer = 0;
  private pingTimer = 0;
  private latest = new Map<number, (number | string)[]>(); // host: freshest state per human slot

  private constructor(public t: Transport, public code: string, private me: { name: string; custom: Customization }) {
    t.onMessage = (from, m) => this.recv(from, m);
    t.onLeave = (peer) => this.left(peer);
    if (t.isHost) {
      this.players.push({ id: t.selfId, name: me.name, custom: me.custom, slot: 0 });
      t.onJoin = () => { /* wait for hello */ };
    }
  }

  get isHost() { return this.t.isHost; }
  get mySlot() { return this.players.find((p) => p.id === this.t.selfId)?.slot ?? -1; }

  static async host(code: string, me: { name: string; custom: Customization }, local: boolean) {
    const t = local ? await LocalTransport.host(code) : await PeerTransport.host(code);
    return new Session(t, code, me);
  }
  static async join(code: string, me: { name: string; custom: Customization }, local: boolean) {
    const t = local ? await LocalTransport.join(code) : await PeerTransport.join(code);
    const s = new Session(t, code, me);
    // resolve once the host has seated us (its lobby broadcast includes our peer id)
    const seated = new Promise<void>((res, rej) => {
      const timer = setTimeout(() => rej(new Error('Host did not respond')), 10000);
      s.onLobby = () => { if (s.mySlot >= 0) { clearTimeout(timer); res(); } };
      s.onClosed = (why) => { clearTimeout(timer); rej(new Error(why)); };
    });
    s.toHost({ k: 'hello', name: me.name, custom: me.custom });
    s.ping();
    try { await seated; } catch (e) { s.close(); throw e; }
    return s;
  }

  private hostId() { return this.t.isHost ? this.t.selfId : this.t.peers()[0]; }
  private toHost(m: Msg) { this.t.send(this.hostId(), m); }
  private ping() { this.toHost({ k: 'ping', t0: this.clock.now() }); }

  private lobbyMsg(): Msg { return { k: 'lobby', players: this.players, store: this.storeId }; }

  setStore(id: string) { if (this.isHost) { this.storeId = id; this.t.broadcast(this.lobbyMsg()); this.onLobby(); } }

  /** Host: fill the remaining slots with bots and start everyone at the same host-clock moment. */
  start() {
    if (!this.isHost) return;
    const seed = (Math.random() * 2 ** 31) | 0;
    const infos: PlayerInfo[] = this.players.map((p) => ({ slot: p.slot, id: p.id, name: p.name, color: SLOT_COLORS[p.slot], custom: sanitize(p.custom), bot: false }));
    const used = new Set(infos.map((i) => i.slot));
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) infos.push({ slot: s, id: 'bot' + s, name: names.pop()!, color: SLOT_COLORS[s], custom: randomCustom(), bot: true });
    infos.sort((a, b) => a.slot - b.slot);
    const cfg: RaceConfig = { storeId: this.storeId, seed, time: RACE_TIME, list: [], players: infos }; // list is derived from the built store on every peer
    const startAt = this.clock.hostNow() + 4.5;
    this.t.broadcast({ k: 'start', cfg, startAt });
    this.onStart(cfg, 0, startAt);
  }

  attach(g: Game | null) { this.game = g; this.latest.clear(); }

  /** Call every frame while racing. */
  tick(dt: number) {
    this.pingTimer -= dt;
    if (!this.isHost && this.pingTimer <= 0) { this.pingTimer = 1; this.ping(); }
    const g = this.game;
    if (!g) return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = 1 / NET_HZ;
    const now = this.clock.hostNow();
    if (!this.isHost) {
      const s = g.localSnap(g.local, now);
      this.toHost({ k: 'st', s: pack(g.local.slot, s, g.itemsCollected(g.local)) });
    } else {
      const c: (number | string)[][] = [];
      for (const p of g.players) {
        if (!p.remote) c.push(pack(p.slot, g.localSnap(p, now), g.itemsCollected(p)));
        else { const l = this.latest.get(p.slot); if (l) c.push(l); }
      }
      this.t.broadcast({ k: 'ss', c });
    }
  }

  /** Game → network (events originate from whoever simulates that cart). */
  event(e: Record<string, unknown>) {
    if (this.isHost) this.t.broadcast({ k: 'ev', e });
    else this.toHost({ k: 'ev', e });
  }

  private applyEvent(e: Record<string, unknown>) {
    const g = this.game;
    if (!g) return;
    switch (e.e) {
      case 'collect': {
        const it = g.world.items.all[e.id as number];
        const p = g.players.find((q) => q.slot === e.slot);
        if (it && it.alive) g.world.items.remove(it);
        if (p && p.remote) { p.cargo.push(e.kind as string); p.cart.model.setCargo(p.cargo); }
        break;
      }
      case 'smash': { const it = g.world.items.all[e.id as number]; if (it?.alive) g.smash(it, 0, false); break; }
      case 'fin': { const p = g.players.find((q) => q.slot === e.slot); if (p) { p.done = true; p.finishTime = e.time as number; } break; }
      case 'bump': g.applyBump(e.to as number, e.ix as number, e.iz as number); break;
      case 'end': g.endRace(e.results as ResultRow[]); break;
    }
  }

  private recv(from: string, m: Msg) {
    switch (m.k) {
      case 'ping': this.t.send(from, { k: 'pong', t0: m.t0, th: this.clock.now() }); break;
      case 'pong': this.clock.sample(m.t0, m.th); break;
      case 'hello': {
        if (!this.isHost) break;
        if (this.players.length >= MAX_PLAYERS || this.game) { this.t.send(from, { k: 'full' }); break; }
        const used = new Set(this.players.map((p) => p.slot));
        let slot = 0; while (used.has(slot)) slot++;
        this.players.push({ id: from, name: String(m.name).slice(0, 16) || 'Shopper', custom: sanitize(m.custom), slot });
        this.t.broadcast(this.lobbyMsg());
        this.onLobby();
        break;
      }
      case 'full': this.onClosed('Lobby is full or already racing'); break;
      case 'lobby': this.players = m.players; this.storeId = m.store; this.onLobby(); break;
      case 'start': this.onStart(m.cfg, this.mySlot, m.startAt); break;
      case 'st': {
        if (!this.isHost) break;
        const arr = m.s as (number | string)[];
        const slot = this.players.find((p) => p.id === from)?.slot;
        if (slot === undefined || arr[0] !== slot) break; // a peer may only drive its own slot
        this.latest.set(slot, arr);
        const [s, n] = unpack(arr);
        this.game?.pushSnap(slot, s, n);
        break;
      }
      case 'ss': for (const arr of m.c as (number | string)[][]) { const [s, n] = unpack(arr); this.game?.pushSnap(arr[0] as number, s, n); } break;
      case 'ev':
        if (this.isHost) this.t.broadcast({ k: 'ev', e: m.e }, from);
        this.applyEvent(m.e);
        break;
    }
  }

  private left(peer: string) {
    if (this.isHost) {
      const p = this.players.find((q) => q.id === peer);
      this.players = this.players.filter((q) => q.id !== peer);
      if (p && this.game) { const gp = this.game.players.find((q) => q.slot === p.slot); if (gp) { gp.left = true; } }
      this.t.broadcast(this.lobbyMsg());
      this.onLobby();
    } else this.onClosed('Host left the lobby');
  }

  close() { this.t.close(); }
}

function pack(slot: number, s: Snap, items: number): (number | string)[] {
  return [slot, r3(s.t), r3(s.x), r3(s.y), r3(s.z), r3(s.yaw), r3(s.vx), r3(s.vz), r3(s.w), s.fl, items];
}
function unpack(a: (number | string)[]): [Snap, number] {
  const n = a as number[];
  return [{ t: n[1], x: n[2], y: n[3], z: n[4], yaw: n[5], vx: n[6], vz: n[7], w: n[8], fl: n[9] }, n[10]];
}

export function sanitize(c: Partial<Customization> | undefined): Customization {
  const ok = <T extends { id: string }>(list: T[], id: unknown, d: string) => (list.some((x) => x.id === id) ? (id as string) : d);
  return {
    wheel: ok(WHEELS, c?.wheel, DEFAULT_CUSTOM.wheel), skin: ok(SKINS, c?.skin, DEFAULT_CUSTOM.skin),
    neon: ok(NEONS, c?.neon, DEFAULT_CUSTOM.neon), squeak: ok(SQUEAKS, c?.squeak, DEFAULT_CUSTOM.squeak),
  };
}
export function randomCustom(): Customization {
  const p = <T extends { id: string }>(l: T[]) => l[Math.floor(Math.random() * l.length)].id;
  return { wheel: p(WHEELS), skin: p(SKINS), neon: p(NEONS), squeak: p(SQUEAKS) };
}
