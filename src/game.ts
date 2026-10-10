// Game: one race in one store. Owns the physics world, store, carts, bots and race rules.
// Fixed 60 Hz physics with an accumulator; rendering/LOD/HUD run per frame.
import * as THREE from 'three';
import { Physics, RAPIER, G, groups } from './physics';
import { StoreWorld } from './store';
import { Cart, CartModel, CART } from './cart';
import { Bot } from './bots';
import { Interpolator, Snap, Clock } from './net';
import { Customization, KIND_BY_ID, STORE_BY_ID, LIST_SIZE, MESS, INTERP_DELAY } from './config';
import { Rng } from './rng';
import type { Item } from './items';
import type { Sfx } from './audio';

export interface PlayerInfo { slot: number; id: string; name: string; color: number; custom: Customization; bot: boolean }
export interface ListEntry { kind: string; qty: number }
export interface RaceConfig { storeId: string; seed: number; time: number; list: ListEntry[]; players: PlayerInfo[] }
export interface ResultRow { slot: number; name: string; bot: boolean; color: number; done: boolean; time: number; items: number; place: number }

export const SLOT_COLORS = [0x2a8af0, 0xf03a3a, 0x3ac85a, 0xf0b020, 0xb050f0, 0x20d0d0, 0xf07ac0, 0xa0a0a0];

/** Pick the race's shopping list from kinds actually stocked (≥ minCount of each) in the built store. */
export function makeList(seed: number, stock: Map<string, number>, minCount = 12): ListEntry[] {
  const rng = new Rng(seed ^ 0x11577);
  const pool = [...stock.entries()].filter(([, n]) => n >= minCount).map(([k]) => k).sort();
  rng.shuffle(pool);
  // always include something fragile: carrying eggs back is half the fun
  const pick = new Set<string>();
  const fragile = pool.find((k) => KIND_BY_ID[k].fragile);
  if (fragile) pick.add(fragile);
  for (const k of pool) { if (pick.size >= LIST_SIZE) break; pick.add(k); }
  return [...pick].map((kind, i) => ({ kind, qty: i % 3 === 1 && KIND_BY_ID[kind].mass < 3 && (stock.get(kind) ?? 0) >= 30 ? 2 : 1 }));
}

export class Participant {
  collected: Record<string, number> = {};
  cargo: string[] = [];
  done = false;
  finishTime = -1;
  bot: Bot | null = null;
  interp: Interpolator | null = null;
  netItems = 0; // remote: collected count from snapshots
  lastGrab = 0;
  left = false;
  constructor(public info: PlayerInfo, public cart: Cart, public remote: boolean) {}
  get slot() { return this.info.slot; }
}

export interface NetHooks {
  event: (e: Record<string, unknown>) => void;
  isHost: boolean;
  clock: Clock;
}

const _v = new THREE.Vector3();
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export class Game {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  phys = new Physics();
  world: StoreWorld;
  players: Participant[] = [];
  local!: Participant;
  phase: 'countdown' | 'race' | 'over' = 'countdown';
  countdown = 3;
  raceTime = 0;
  simTime = 0;
  frameTime = 0;
  camMode: 'fp' | 'chase' = 'fp';
  results: ResultRow[] | null = null;
  input = { throttle: 0, steer: 0, sprint: false, ride: false };
  camOverride: number[] | null = null; // [px,py,pz, tx,ty,tz] (tests / photo mode)
  inputOverride: { throttle: number; steer: number; sprint: boolean; ride: boolean } | null = null;
  shake = 0;
  messages: { text: string; t: number; color: string }[] = [];
  stats = { fps: 60, frameMs: 0, physMs: 0, steps: 0 };
  smashed = 0;
  startAt = 0; // host-clock start time (multiplayer)
  net: NetHooks | null = null;
  onEnd: ((r: ResultRow[]) => void) | null = null;
  onCountdownTick: ((n: number) => void) | null = null;
  private acc = 0;
  private camYaw = 0;
  private lastCount = 4;
  private sun: THREE.DirectionalLight;
  private shelfHitT = new Map<number, number>();
  private bumpT = 0;
  private remoteColliders = new Map<number, Participant>();
  private tmpItems: Item[] = [];
  private envMap: THREE.Texture | null;
  readonly authority: boolean;
  readonly isSolo: boolean;

  constructor(public cfg: RaceConfig, public localSlot: number, private sfx: Sfx, opts: { quality: 'low' | 'medium' | 'high'; envMap: THREE.Texture | null; net?: NetHooks | null; aspect: number }) {
    this.net = opts.net ?? null;
    this.isSolo = !this.net;
    this.authority = !this.net || this.net.isHost;
    this.envMap = opts.envMap;
    const def = STORE_BY_ID[cfg.storeId];
    const shadows = opts.quality !== 'low';
    this.camera = new THREE.PerspectiveCamera(75, opts.aspect, 0.05, 140);
    this.scene.background = new THREE.Color(def.fogColor);
    this.scene.fog = new THREE.Fog(def.fogColor, 35, 110);

    // lighting: bright fluorescent interior
    this.scene.add(new THREE.HemisphereLight(def.colors.light, def.colors.floor, def.id === 'bestbuyout' ? 1.4 : 1.9));
    this.sun = new THREE.DirectionalLight(0xffffff, def.id === 'bestbuyout' ? 1.1 : 1.6);
    this.sun.position.set(8, 20, 6);
    if (shadows) {
      this.sun.castShadow = true;
      const s = opts.quality === 'high' ? 2048 : 1024;
      this.sun.shadow.mapSize.set(s, s);
      const c = this.sun.shadow.camera; c.left = -22; c.right = 22; c.top = 22; c.bottom = -22; c.near = 1; c.far = 50;
      this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun, this.sun.target);

    this.world = new StoreWorld(this.phys, def, cfg.seed, { shadows, envMap: this.envMap });
    if (opts.quality === 'low') { this.world.items.hiDist = 9; this.world.items.cullDist = 45; this.world.shelves.lodDist = 25; }
    if (opts.quality === 'high') { this.world.items.hiDist = 22; this.world.items.cullDist = 90; }
    this.scene.add(this.world.group);
    if (!cfg.list.length) {
      const stock = new Map<string, number>();
      for (const it of this.world.items.all) stock.set(it.kind.id, (stock.get(it.kind.id) ?? 0) + 1);
      cfg.list = makeList(cfg.seed, stock);
    }
    this.world.items.onBreak = (it, f) => this.smash(it, f, true);

    for (const info of cfg.players) this.addPlayer(info);
    this.local = this.players.find((p) => p.slot === localSlot)!;
    this.camYaw = this.local.cart.yaw;
    this.setCamMode('fp');
    if (this.isSolo) this.countdown = 3;
  }

  addPlayer(info: PlayerInfo) {
    const sp = this.world.spawns[info.slot % this.world.spawns.length];
    const isLocal = info.slot === this.localSlot;
    // a cart is simulated (dynamic) where its owner lives: local player, or bots on the host
    const remote = !isLocal && !(info.bot && this.authority);
    const model = new CartModel(info.custom, { local: isLocal, avatarColor: info.color, name: isLocal ? undefined : info.name, envMap: this.envMap });
    const cart = new Cart(this.phys, model, new THREE.Vector3(sp.x, 0.05, sp.z), sp.yaw, remote);
    model.root.position.set(sp.x, 0, sp.z);
    this.scene.add(model.root);
    const p = new Participant(info, cart, remote);
    if (remote) { p.interp = new Interpolator(); for (const c of cart.colliders) this.remoteColliders.set(c.handle, p); }
    if (info.bot && this.authority) {
      p.bot = new Bot(cart, {
        world: this.world, phys: this.phys,
        needs: () => this.needs(p), complete: () => this.complete(p), finished: () => p.done || this.phase !== 'race',
        rivals: () => this.players.map((q) => q.cart),
      }, info.slot * 977 + this.cfg.seed);
    }
    cart.onImpact = (force, other) => this.onCartImpact(p, force, other);
    if (isLocal) {
      cart.onBoost = (k) => { this.sfx.boost(); this.flash(k === 'nitro' ? 'CHECKOUT NITRO!' : 'PROMO BOOST!', '#ffd23a'); };
      cart.onSpin = (t) => { this.sfx.spin(); this.flash(t === 'oil' ? 'OIL SLICK! SPINNING OUT' : `SLIPPED ON ${t.toUpperCase()}!`, '#ff7a3a'); this.shake = Math.max(this.shake, 0.3); };
    }
    this.players.push(p);
    return p;
  }

  needs(p: Participant): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of this.cfg.list) { const left = e.qty - (p.collected[e.kind] ?? 0); if (left > 0) m.set(e.kind, left); }
    return m;
  }
  complete(p: Participant) { return this.needs(p).size === 0; }
  itemsCollected(p: Participant) {
    if (p.remote && !p.info.bot) return p.netItems;
    if (p.remote) return p.netItems;
    return this.cfg.list.reduce((s, e) => s + Math.min(e.qty, p.collected[e.kind] ?? 0), 0);
  }
  listTotal() { return this.cfg.list.reduce((s, e) => s + e.qty, 0); }

  setCamMode(m: 'fp' | 'chase') {
    this.camMode = m;
    this.local.cart.model.setFirstPerson(m === 'fp');
  }

  flash(text: string, color = '#fff') { this.messages.push({ text, t: 2.2, color }); if (this.messages.length > 4) this.messages.shift(); }

  // ---------------- simulation ----------------
  private fixedStep(dt: number) {
    // countdown / race clock
    if (this.phase === 'countdown') {
      if (this.isSolo) this.countdown -= dt;
      else this.countdown = this.startAt - this.net!.clock.hostNow();
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n >= 0) { this.lastCount = n; if (n > 0) this.sfx.beep(false); this.onCountdownTick?.(n); }
      if (this.countdown <= 0) { this.phase = 'race'; this.sfx.beep(true); this.flash('GO! GO! GO!', '#7aff7a'); }
    } else if (this.phase === 'race') {
      this.raceTime += dt;
      if (this.authority && (this.raceTime >= this.cfg.time || this.players.every((p) => p.done || p.left))) this.endRace();
    }

    const racing = this.phase === 'race';
    // local input
    const L = this.local.cart;
    const src = this.inputOverride ?? this.input;
    if (racing && !this.local.done) Object.assign(L.input, src);
    else { L.input.throttle = 0; L.input.steer = 0; L.input.sprint = false; L.input.ride = false; if (this.local.done) L.input.throttle = L.fwdSpeed > 0.3 ? -0.5 : 0; }
    // bots
    for (const p of this.players) if (p.bot) { if (racing) p.bot.update(dt); else { p.cart.input.throttle = 0; p.cart.input.steer = 0; } }
    // drive dynamic carts, pose kinematic (remote) carts from the interpolator
    const renderT = this.net ? this.net.clock.hostNow() - INTERP_DELAY : 0;
    for (const p of this.players) {
      if (!p.remote) p.cart.control(dt, this.world.hazards);
      else if (p.interp) { const o = p.interp.sample(renderT, dt); if (o) p.cart.moveTo(o.x, Math.max(0, o.y), o.z, o.yaw); }
    }
    this.phys.step();
    this.world.items.syncActive();
    this.simTime += dt;
    this.bumpT -= dt;

    // collection + finish for carts we own
    if (racing) for (const p of this.players) {
      if (p.remote || p.done) continue;
      this.tryCollect(p);
      if (this.complete(p) && this.inLane(p)) this.finish(p, this.raceTime);
    }
  }

  private inLane(p: Participant) {
    const t = p.cart.body.translation();
    return this.world.lanes.some((l) => Math.abs(t.x - l.x) < l.hw && Math.abs(t.z - l.z) < l.hd);
  }

  private tryCollect(p: Participant) {
    if (this.simTime - p.lastGrab < 0.35) return;
    const needs = this.needs(p);
    if (!needs.size) return;
    const t = p.cart.body.translation();
    const f = p.cart.forward(_v);
    const near = this.world.items.near(t.x + f.x * 0.15, t.z + f.z * 0.15, 1.4, this.tmpItems, (it) => it.alive && needs.has(it.kind.id) && it.body.translation().y < 2.45);
    if (!near.length) return;
    this.collect(p, near[0], true);
  }

  collect(p: Participant, it: Item, announce: boolean) {
    if (!it.alive) return;
    this.world.items.remove(it);
    p.collected[it.kind.id] = (p.collected[it.kind.id] ?? 0) + 1;
    p.cargo.push(it.kind.id);
    p.lastGrab = this.simTime;
    p.cart.setCargoMass(p.cargo.reduce((s, k) => s + KIND_BY_ID[k].mass, 0));
    p.cart.model.setCargo(p.cargo);
    if (p === this.local) {
      this.sfx.pickup();
      const left = this.needs(p);
      this.flash(`GOT ${it.kind.label.toUpperCase()}!` + (left.size ? '' : '  → CHECKOUT!'), left.size ? '#7affb0' : '#ffd23a');
    }
    if (announce && this.net) this.net.event({ e: 'collect', slot: p.slot, id: it.id, kind: it.kind.id });
  }

  /** Fragile item breaks: decal + slick + particles. */
  smash(it: Item, _force: number, announce: boolean) {
    if (!it.alive || !it.kind.fragile) return;
    const t = it.body.translation();
    const fr = it.kind.fragile;
    this.world.items.remove(it);
    this.world.hazards.addSlick(fr.mess, t.x, t.z, fr.radius * (0.85 + Math.random() * 0.3));
    const col = MESS[fr.mess].color;
    this.world.hazards.burst(t.x, Math.max(0.05, t.y), t.z, col, 14, 2.4, 0.03);
    this.world.hazards.burst(t.x, Math.max(0.05, t.y), t.z, fr.mess === 'egg' ? 0xf6f0e6 : it.color.getHex(), 10, 3, 0.025);
    this.smashed++;
    const d = Math.hypot(t.x - this.camera.position.x, t.z - this.camera.position.z);
    if (d < 18 && Math.random() < 0.6) this.sfx.splat(fr.mess);
    if (announce && this.net && it.id < this.world.items.all.length) this.net.event({ e: 'smash', id: it.id });
  }

  private onCartImpact(p: Participant, force: number, other: number) {
    const sh = this.world.shelves.byCollider.get(other);
    const sp = p.cart.speed();
    if (p === this.local && force > 3000) {
      this.shake = Math.min(1, Math.max(this.shake, force / 30000));
      if (sp > 2) this.sfx.crash(force);
    }
    // dramatize shelf hits: extra shove near the top so they rock and topple
    if (sh && sp > 2.5 && !p.remote) {
      const last = this.shelfHitT.get(sh.index) ?? -9;
      if (this.simTime - last > 0.35) {
        this.shelfHitT.set(sh.index, this.simTime);
        const v = p.cart.body.linvel();
        const k = Math.min(1.2, (sp - 2) / 6) * CART.mass * 0.32;
        const st = sh.body.translation();
        const H = this.world.def.shelfHeight;
        sh.body.applyImpulseAtPoint({ x: v.x * k, y: 0, z: v.z * k }, { x: st.x, y: st.y + H * 0.85, z: st.z }, true);
        if (p === this.local) this.sfx.clatter();
      }
    }
    // bump remote carts: tell their owner to apply the impulse
    const rp = this.remoteColliders.get(other);
    if (rp && this.net && !p.remote && this.bumpT <= 0 && sp > 2) {
      this.bumpT = 0.4;
      const a = p.cart.body.translation(), b = rp.cart.body.translation();
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
      const j = CART.mass * sp * 0.6;
      this.net.event({ e: 'bump', to: rp.slot, ix: (dx / d) * j, iz: (dz / d) * j });
    }
    // huge hits can knock an item out of your basket
    if (!p.remote && force > 14000 && p.cargo.length && this.phase === 'race' && Math.random() < 0.35 && !p.done) this.spill(p);
  }

  private spill(p: Participant) {
    const idx = Math.floor(Math.random() * p.cargo.length);
    const kind = p.cargo.splice(idx, 1)[0];
    p.collected[kind] = Math.max(0, (p.collected[kind] ?? 1) - 1);
    p.cart.setCargoMass(p.cargo.reduce((s, k) => s + KIND_BY_ID[k].mass, 0));
    p.cart.model.setCargo(p.cargo);
    const t = p.cart.body.translation(), v = p.cart.body.linvel();
    const it = this.world.items.spawn(KIND_BY_ID[kind], new THREE.Vector3(t.x, 1.3, t.z), new THREE.Vector3(v.x * 0.6 + (Math.random() - 0.5) * 3, 3.5, v.z * 0.6 + (Math.random() - 0.5) * 3));
    if (it) p.lastGrab = this.simTime + 0.8; // don't instantly re-grab it
    if (p === this.local) this.flash(`${KIND_BY_ID[kind].label.toUpperCase()} FLEW OUT!`, '#ff5a5a');
  }

  applyBump(slot: number, ix: number, iz: number) {
    const p = this.players.find((q) => q.slot === slot);
    if (!p || p.remote) return;
    p.cart.body.applyImpulse({ x: ix, y: 0, z: iz }, true);
    if (p === this.local) { this.shake = Math.max(this.shake, 0.5); this.sfx.crash(12000); }
  }

  finish(p: Participant, time: number) {
    if (p.done) return;
    p.done = true; p.finishTime = time;
    if (p === this.local) { this.sfx.finish(); this.flash(`CHECKED OUT! ${time.toFixed(2)}s`, '#ffd23a'); }
    if (this.net && !p.remote) this.net.event({ e: 'fin', slot: p.slot, time });
  }

  endRace(results?: ResultRow[]) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.results = results ?? this.computeResults();
    if (this.net?.isHost) this.net.event({ e: 'end', results: this.results });
    this.onEnd?.(this.results);
  }

  computeResults(): ResultRow[] {
    const rows = this.players.map((p) => ({ slot: p.slot, name: p.info.name, bot: p.info.bot, color: p.info.color, done: p.done, time: p.finishTime, items: p.done ? this.listTotal() : this.itemsCollected(p), place: 0 }));
    rows.sort((a, b) => (a.done !== b.done ? (a.done ? -1 : 1) : a.done ? a.time - b.time : b.items - a.items));
    rows.forEach((r, i) => (r.place = i + 1));
    return rows;
  }

  standings() { return this.computeResults(); }

  // ---------------- remote state ----------------
  pushSnap(slot: number, s: Snap, items?: number) {
    const p = this.players.find((q) => q.slot === slot);
    if (!p || !p.remote || !p.interp) return;
    p.interp.push(s);
    if (items !== undefined) p.netItems = items;
  }

  localSnap(p: Participant, t: number): Snap {
    const s = p.cart.state();
    return { t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, vx: s.vx, vz: s.vz, w: s.w, fl: (s.riding ? 1 : 0) | (s.boost > 0 ? 2 : 0) };
  }

  // ---------------- frame ----------------
  advance(dt: number) {
    this.acc += Math.min(dt, 0.1);
    const h = 1 / 60;
    let n = 0;
    const t0 = performance.now();
    while (this.acc >= h && n < 4) { this.fixedStep(h); this.acc -= h; n++; }
    if (n === 4) this.acc = 0;
    this.stats.physMs = performance.now() - t0;
    this.stats.steps = n;
  }

  frame(dt: number) {
    this.frameTime += dt;
    this.advance(dt);
    const time = this.frameTime;
    const renderT = this.net ? this.net.clock.hostNow() - INTERP_DELAY : 0;
    for (const p of this.players) {
      if (p.remote && p.interp) {
        const o = p.interp.sample(renderT, 0);
        if (o) {
          const yaw = o.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw);
          p.cart.syncModel(dt, time, { x: o.x, y: Math.max(0, o.y), z: o.z, yaw, speed: o.vx * fx + o.vz * fz, lat: -(o.vx * -fz + o.vz * fx), riding: !!(o.fl & 1), boost: !!(o.fl & 2) });
        }
      } else p.cart.syncModel(dt, time);
    }
    this.updateCamera(dt);
    this.world.update(dt, time, this.camera);
    // shadow camera follows the player
    const ct = this.local.cart.model.root.position;
    this.sun.position.set(ct.x + 8, 20, ct.z + 6); this.sun.target.position.set(ct.x, 0, ct.z);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
    if (this.phase === 'race') this.sfx.wheels(this.local.cart.speed(), this.local.info.custom.squeak, dt);
  }

  private updateCamera(dt: number) {
    const c = this.local.cart;
    const root = c.model.root;
    const yaw = root.rotation.y;
    // the shopper clings to the handle: camera yaw follows the cart with a little lag
    this.camYaw = lerpAngle(this.camYaw, yaw, Math.min(1, dt * (this.camMode === 'fp' ? 9 : 5)));
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const sp = c.speed();
    const riding = c.riding;
    const bob = this.camMode === 'fp' && !riding ? Math.sin(this.frameTime * (7 + sp)) * Math.min(0.05, sp * 0.006) : 0;
    if (this.camMode === 'fp') {
      const back = riding ? 0.62 : 0.98, h = riding ? 1.95 : 1.62;
      this.camera.position.set(root.position.x - Math.sin(yaw) * back, root.position.y + h + bob, root.position.z - Math.cos(yaw) * back);
      this.camera.lookAt(this.camera.position.x + fx * 6, root.position.y + 0.75, this.camera.position.z + fz * 6);
    } else {
      // boom arm with collision: pull the camera in front of walls/shelves behind the cart
      const ox = root.position.x, oy = root.position.y + 1.6, oz = root.position.z;
      const dx = -fx * 4.6, dy = 1.1, dz = -fz * 4.6, len = Math.hypot(dx, dy, dz);
      const hit = this.phys.world.castRay(new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx / len, y: dy / len, z: dz / len }), len, true, undefined, groups(0xffff, G.STATIC | G.SHELF));
      const k = hit ? Math.max(0.15, (hit.timeOfImpact - 0.3) / len) : 1;
      this.camera.position.set(ox + dx * k, oy + dy * k, oz + dz * k);
      this.camera.lookAt(root.position.x + fx * 1.5, root.position.y + 0.9, root.position.z + fz * 1.5);
    }
    if (this.camOverride) { const o = this.camOverride; this.camera.position.set(o[0], o[1], o[2]); this.camera.lookAt(o[3], o[4], o[5]); }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s;
    }
    const fov = 72 + Math.min(14, sp * 1.1) + (c.boost > 0 ? 8 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4); this.camera.updateProjectionMatrix(); }
  }

  resetLocal() {
    const t = this.local.cart.body.translation();
    this.local.cart.reset(t.x, t.z, this.local.cart.yaw);
  }

  dispose() {
    for (const p of this.players) p.cart.destroy();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) { for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v !== this.envMap) v.dispose(); mat.dispose(); }
    });
    this.phys.free();
    this.sfx.stopLoops();
  }
}

