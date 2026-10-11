// Game: one race in one store. Owns the physics world, store, carts, bots and race rules.
// Fixed 60 Hz physics with an accumulator; rendering/LOD/HUD run per frame.
import * as THREE from 'three';
import { Physics, RAPIER, G, groups } from './physics';
import { StoreWorld } from './store';
import { Cart, CartModel, CART, CartInput, NO_INPUT } from './cart';
import { Bot } from './bots';
import { Interpolator, Snap, Clock } from './net';
import { Customization, KIND_BY_ID, STORE_BY_ID, LIST_SIZE, MESS, INTERP_DELAY, bodyTail } from './config';
import { Rng } from './rng';
import { Guides } from './guides';
import { Restock } from './restock';
import { Popups } from './popups';
import { Announcer, PA_HOSTS, PA_DEFAULT, Chaos, newChaos, addChaos, talk, money, PRICE, SHELF_PRICE, BUMP_PRICE, DROP_PRICE, type PaEvent, type TalkEvent } from './fun';
import type { Item } from './items';
import type { Shelf } from './shelves';
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
  chaos: Chaos = newChaos();
  honkT = -9;
  constructor(public info: PlayerInfo, public cart: Cart, public remote: boolean) {}
  get slot() { return this.info.slot; }
}

export interface NetHooks {
  event: (e: Record<string, unknown>) => void;
  isHost: boolean;
  clock: Clock;
}

const _v = new THREE.Vector3();
/** Cart speed (m/s) needed to knock a shelf over: sprinting (9.4) or boosting does it, jogging (6.6) doesn't. */
export const SHELF_TIP_SPEED = 7.0;
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export class Game {
  static SHOVE = 3.0;
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
  input: CartInput = { ...NO_INPUT };
  camOverride: number[] | null = null; // [px,py,pz, tx,ty,tz] (tests / photo mode)
  inputOverride: CartInput | null = null;
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
  guides: Guides;
  restock: Restock;
  botsFrozen = false;
  readonly isSolo: boolean;
  /** Store PA: the announcement currently on screen. */
  pa: { text: string; t: number } | null = null;
  announcer: Announcer;
  popups = new Popups();
  private cartByCollider = new Map<number, Participant>();
  private cartMapT = -9;
  private shelfBy = new Map<number, { p: Participant; t: number }>();
  private shelfDown = new Set<number>();
  private pairT = new Map<string, number>();
  private said30 = false;
  private firstDone = false;
  private honkHeld = false;
  private botHonkT = 0;

  constructor(public cfg: RaceConfig, public localSlot: number, private sfx: Sfx, opts: { quality: 'low' | 'medium' | 'high'; envMap: THREE.Texture | null; net?: NetHooks | null; aspect: number; thumb?: (id: string) => HTMLCanvasElement }) {
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

    this.world = new StoreWorld(this.phys, def, cfg.seed, { shadows, envMap: this.envMap, thumb: opts.thumb });
    if (opts.quality === 'low') { this.world.items.hiDist = 9; this.world.items.cullDist = 45; this.world.shelves.lodDist = 25; }
    if (opts.quality === 'high') { this.world.items.hiDist = 22; this.world.items.cullDist = 90; }
    this.scene.add(this.world.group);
    if (!cfg.list.length) {
      const stock = new Map<string, number>();
      for (const it of this.world.items.all) stock.set(it.kind.id, (stock.get(it.kind.id) ?? 0) + 1);
      cfg.list = makeList(cfg.seed, stock);
    }
    this.world.items.onBreak = (it, f) => this.smash(it, f, true);
    this.announcer = new Announcer((text) => { this.pa = { text, t: 6.5 }; this.sfx.chime(); this.sfx.speak(text); });
    this.announcer.store = def.id;
    this.sfx.setHost(PA_HOSTS[def.id] ?? PA_DEFAULT);
    this.scene.add(this.popups.group);
    this.restock = new Restock(this.world);

    for (const info of cfg.players) this.addPlayer(info);
    this.local = this.players.find((p) => p.slot === localSlot)!;
    this.camYaw = this.local.cart.yaw;
    this.setCamMode('fp');
    if (this.isSolo) this.countdown = 3;
    this.guides = new Guides(this, opts.thumb ?? null);
    this.guides.refresh();
  }

  addPlayer(info: PlayerInfo) {
    const sp = this.world.spawns[info.slot % this.world.spawns.length];
    const isLocal = info.slot === this.localSlot;
    // a cart is simulated (dynamic) where its owner lives: local player, or bots on the host
    const remote = !isLocal && !(info.bot && this.authority);
    const model = new CartModel(info.custom, { local: isLocal, avatarColor: info.color, name: isLocal ? undefined : info.name, envMap: this.envMap });
    // a long cart starts pulled forward so its tail clears the wall behind the start line
    const h = bodyTail(model.body) / 2, x0 = sp.x + Math.sin(sp.yaw) * h, z0 = sp.z + Math.cos(sp.yaw) * h;
    const cart = new Cart(this.phys, model, new THREE.Vector3(x0, 0.05, z0), sp.yaw, remote);
    model.root.position.set(x0, 0, z0);
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
    cart.onDrop = (x, z) => this.dropOil(x, z, p, true);
    cart.onSpin = (t) => this.onSpin(p, t);
    if (isLocal) {
      cart.onNitro = () => this.sfx.boost();
      cart.onBoost = (k) => { this.sfx.boost(); this.flash(k === 'nitro' ? 'CHECKOUT NITRO!' : 'PROMO BOOST!', '#ffd23a'); };
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
      if (this.countdown <= 0) {
        this.phase = 'race'; this.sfx.beep(true); this.flash('GO! GO! GO!', '#7aff7a');
        // a ridiculous cart in the race gets called out at the start (the tallest first)
        const tower = this.players.find((p) => p.cart.stats.body.levels > 50);
        const train = this.players.find((p) => p.cart.stats.body.train);
        const nest = this.players.find((p) => p.cart.stats.body.nest);
        this.announce(tower ? 'tower' : nest ? 'long' : train && Math.random() < 0.6 ? 'train' : 'start', tower ?? nest ?? train ?? null);
      }
    } else if (this.phase === 'race') {
      this.raceTime += dt;
      if (!this.said30 && this.cfg.time - this.raceTime <= 30) { this.said30 = true; this.announce('last30'); }
      if (this.authority && (this.raceTime >= this.cfg.time || this.players.every((p) => p.done || p.left))) this.endRace();
    }

    const racing = this.phase === 'race';
    // local input
    const L = this.local.cart;
    const src = this.inputOverride ?? this.input;
    if (racing && !this.local.done) Object.assign(L.input, src);
    else { Object.assign(L.input, NO_INPUT); if (this.local.done) L.input.throttle = L.fwdSpeed > 0.3 ? -0.5 : 0; }
    // bots
    for (const p of this.players) if (p.bot) { if (racing && !this.botsFrozen) p.bot.update(dt); else Object.assign(p.cart.input, NO_INPUT); }
    // horn: on press (any time but after the race)
    if (src.honk && !this.honkHeld && this.phase !== 'over') this.honk(this.local, true);
    this.honkHeld = src.honk;
    if (racing && this.authority && !this.botsFrozen) this.botHonks(dt);
    // drive dynamic carts, pose kinematic (remote) carts from the interpolator
    const renderT = this.net ? this.net.clock.hostNow() - INTERP_DELAY : 0;
    for (const p of this.players) {
      if (!p.remote) p.cart.control(dt, this.world.hazards);
      else if (p.interp) { const o = p.interp.sample(renderT, dt); if (o) p.cart.moveTo(o.x, Math.max(0, o.y), o.z, o.yaw); }
    }
    this.world.shelves.stabilize(dt);
    this.phys.step();
    this.world.items.syncActive();
    this.world.items.watchdog(dt);
    this.restock.afterStep();
    this.simTime += dt;
    this.local.chaos.topSpeed = Math.max(this.local.chaos.topSpeed, L.speed());
    for (const sh of this.world.shelves.shelves) {
      if (sh.toppled && !this.shelfDown.has(sh.index)) { this.shelfDown.add(sh.index); this.onShelfDown(sh); }
      else if (!sh.toppled && this.shelfDown.has(sh.index)) this.shelfDown.delete(sh.index);
    }
    for (const p of this.players) if (!p.remote && p.cart.stats.addon === 'vacuum') this.vacuum(p, dt);
    if (this.authority) {
      const carts = this.players.map((q) => q.cart.body.translation());
      for (const g of this.restock.scan(dt, this.simTime, carts)) this.doRestock(g.index, true);
    }
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
    const S = p.cart.stats;
    const near = this.world.items.near(t.x + f.x * 0.15, t.z + f.z * 0.15, S.grab, this.tmpItems, (it) => it.alive && needs.has(it.kind.id) && it.body.translation().y < S.reach);
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
    if (p.bot && this.authority && Math.random() < 0.08) this.say(p, 'grab');
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
    this.world.hazards.addSlick(fr.mess, t.x, t.z, fr.radius * (0.85 + Math.random() * 0.3), 0.6, it.group);
    const col = MESS[fr.mess].color;
    this.world.hazards.burst(t.x, Math.max(0.05, t.y), t.z, col, 14, 2.4, 0.03);
    this.world.hazards.burst(t.x, Math.max(0.05, t.y), t.z, fr.mess === 'egg' ? 0xf6f0e6 : it.color.getHex(), 10, 3, 0.025);
    this.smashed++;
    // who did it: whoever last rammed the shelf it fell off, else the nearest cart
    const by = this.recentShelfHitter(it.shelf, 8) ?? this.nearestCart(t.x, t.z, 3.5);
    if (by) {
      const k = it.kind.id;
      by.chaos.smashed[k] = (by.chaos.smashed[k] ?? 0) + 1;
      this.book(by, PRICE[k] ?? 2, t.x, t.y + 0.4, t.z);
      this.announce(fr.mess as PaEvent, by, this.world.whereIs(t.x, t.z), by === this.local ? 0.3 : 0.12);
    }
    const d = Math.hypot(t.x - this.camera.position.x, t.z - this.camera.position.z);
    if (d < 18 && Math.random() < 0.6) this.sfx.splat(fr.mess);
    if (announce && this.net && it.id < this.world.items.all.length) this.net.event({ e: 'smash', id: it.id });
  }

  private onCartImpact(p: Participant, force: number, other: number) {
    const sh = this.world.shelves.byCollider.get(other);
    const sp = Math.max(p.cart.speed(), p.cart.preSpeed);
    if (p === this.local && force > 3000) {
      this.shake = Math.min(1, Math.max(this.shake, force / 30000));
      if (sp > 2) this.sfx.crash(force);
    }
    // dramatize shelf hits: a shove near the top. Normal-speed bumps only rock the shelf
    // (the stabilizer rights it); a sprinting / boosted ram is what sends it over.
    if (sh && sp > 2) this.shelfBy.set(sh.index, { p, t: this.simTime });
    const victim = sh ? undefined : this.cartOf(other);
    if (victim && victim !== p && sp > 2.5) this.onBump(p, victim, sp);
    if (sh && sp > 3 && !p.remote) {
      const last = this.shelfHitT.get(sh.index) ?? -9;
      if (this.simTime - last > 0.35) {
        this.shelfHitT.set(sh.index, this.simTime);
        // direction of travel before the impact (afterwards the cart has bounced)
        const pv = Math.hypot(p.cart.preVx, p.cart.preVz) || 1;
        const v = { x: p.cart.preVx / pv, z: p.cart.preVz / pv };
        const tip = SHELF_TIP_SPEED * p.cart.stats.topple;
        const k = (sp > tip ? Math.min(1.6, 1 + (sp - tip) / 4) : 0) * sh.body.mass() * Game.SHOVE;
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
      const j = CART.mass * sp * 0.6 * p.cart.stats.mass * (p.cart.stats.addon === 'ram' ? 2.2 : 1);
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
    p.chaos.flung++;
    if (p.bot && this.authority) this.say(p, 'flung', 0.8);
    if (p === this.local) { this.flash(`${KIND_BY_ID[kind].label.toUpperCase()} FLEW OUT!`, '#ff5a5a'); this.announce('flung', p, undefined, 0.3); }
  }

  /** Oil Dropper: a fresh slick behind the cart. */
  dropOil(x: number, z: number, by: Participant | null, announce: boolean) {
    this.world.hazards.addSlick('oil', x, z, 1.15, 0.5);
    this.world.hazards.burst(x, 0.3, z, MESS.oil.color, 10, 1.6, 0.03);
    if (by) { by.chaos.drops++; this.book(by, DROP_PRICE, x, 0.6, z); this.announce('drop', by, undefined, by === this.local ? 0.25 : 0.4); }
    if (by === this.local) { this.flash('OIL DROPPED! 😈', '#ffb03a'); this.sfx.splat('oil'); }
    if (announce && this.net) this.net.event({ e: 'drop', x, z, slot: by?.slot ?? -1 });
  }

  private vacT = new Map<Participant, { d: number; t: number }>();
  /** Mop-Vac: shrink the puddles under the nozzle; tell the other peers in batches. */
  private vacuum(p: Participant, dt: number) {
    const c = p.cart, n = c.nose(), r = 0.32 * c.stats.body.sx + 0.15, d = 1.5 * dt;
    if (c.speed() < 0.3 && !c.input.throttle) return;
    const hit = this.world.hazards.vacuum(n.x, n.z, r, d);
    let v = this.vacT.get(p); if (!v) this.vacT.set(p, (v = { d: 0, t: 0 }));
    if (hit) {
      v.d += d;
      if (Math.random() < 0.3) this.world.hazards.burst(n.x, 0.05, n.z, 0xd8d8d0, 2, 0.8, 0.015);
    }
    v.t += dt;
    if (v.t > 0.15) {
      if (v.d > 0 && this.net) this.net.event({ e: 'vac', x: n.x, z: n.z, r, d: v.d });
      v.t = 0; v.d = 0;
    }
  }

  /** Restock a wrecked shelf / display (host & solo decide; clients replay). */
  doRestock(index: number, announce: boolean) {
    const g = this.restock.groups[index];
    if (!g) return;
    this.restock.restock(g);
    if (announce && this.net) this.net.event({ e: 'restock', g: index });
    const t = this.local.cart.body.translation();
    if (Math.hypot(t.x - g.x, t.z - g.z) < 20) this.flash(g.shelf ? '♻ SHELF RESTOCKED' : '♻ DISPLAY RESTOCKED', '#7affb0');
    if (g.shelf) this.announce('restock', null, this.world.whereIs(g.x, g.z), 0.35);
  }

  // ---------------- comedy ----------------
  /** Store PA, with the usual context filled in. */
  announce(ev: PaEvent, who: Participant | null = null, where?: string, chance = 1) {
    if (!where && who) { const t = who.cart.body.translation(); where = this.world.whereIs(t.x, t.z); }
    this.announcer.say(ev, this.simTime, { name: who?.info.name, where, store: this.world.def.name }, chance);
  }

  /** A bot (on the machine that runs it) says something in a speech bubble; everyone sees it. */
  say(p: Participant, ev: TalkEvent, chance = 1) {
    if (Math.random() > chance || p.cart.model.bubble) return;
    const text = talk(p.info.name, ev);
    p.cart.model.speak(text);
    if (this.net) this.net.event({ e: 'say', slot: p.slot, text });
  }

  /** Book damages to a shopper; the local player gets a floating price tag and a combo. */
  private book(p: Participant, dollars: number, x: number, y: number, z: number, label?: string) {
    const m = addChaos(p.chaos, dollars, this.simTime);
    if (p !== this.local) return;
    const big = dollars >= 100;
    this.popups.spawn(label ?? '-' + money(dollars), x, y, z, big ? '#ff5a3a' : m > 1 ? '#ffb03a' : '#ffd23a', big ? 0.55 : 0.3, big ? 2 : 1.3);
    if (p.chaos.combo === 5 || p.chaos.combo === 10) this.announce('combo', p);
  }

  private nearestCart(x: number, z: number, r: number): Participant | null {
    let best: Participant | null = null, bd = r;
    for (const p of this.players) { const t = p.cart.body.translation(), d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  private recentShelfHitter(shelf: number, within: number): Participant | null {
    if (shelf < 0) return null;
    const h = this.shelfBy.get(shelf);
    return h && this.simTime - h.t < within ? h.p : null;
  }
  /** Collider handle → the cart it belongs to (rebuilt lazily: bodies can swap colliders). */
  private cartOf(h: number): Participant | undefined {
    const p = this.cartByCollider.get(h);
    if (p || this.simTime - this.cartMapT < 1) return p;
    this.cartMapT = this.simTime;
    this.cartByCollider.clear();
    for (const q of this.players) for (const c of q.cart.colliders) this.cartByCollider.set(c.handle, q);
    return this.cartByCollider.get(h);
  }

  private onShelfDown(sh: Shelf) {
    const t = sh.body.translation();
    const by = this.recentShelfHitter(sh.index, 6);
    const lt = this.local.cart.body.translation();
    if (Math.hypot(lt.x - t.x, lt.z - t.z) < 12) this.shake = Math.max(this.shake, 0.45);
    if (!by) return;
    by.chaos.shelves++;
    this.book(by, SHELF_PRICE, t.x, this.world.def.shelfHeight + 0.6, t.z, 'TIMBER! -' + money(SHELF_PRICE));
    if (by === this.local) this.flash('🏚 SHELF FLATTENED!', '#ff7a3a');
    this.announce('shelf', by, this.world.whereIs(t.x, t.z), by === this.local ? 0.8 : 0.35);
  }

  /** Cart-on-cart: counted once per pair per second, credited to whoever was going faster. */
  private onBump(p: Participant, victim: Participant, sp: number) {
    const key = Math.min(p.slot, victim.slot) + ':' + Math.max(p.slot, victim.slot);
    if (this.simTime - (this.pairT.get(key) ?? -9) < 1 || sp < victim.cart.speed() - 0.5) return;
    this.pairT.set(key, this.simTime);
    p.chaos.bumps++; victim.chaos.bumped++;
    const t = victim.cart.body.translation();
    this.book(p, BUMP_PRICE, t.x, 2.1, t.z, 'EMOTIONAL DAMAGE -' + money(BUMP_PRICE));
    if (this.authority) {
      if (victim.bot) this.say(victim, 'bumped', 0.75);
      else if (p.bot) this.say(p, 'bump', 0.5);
    }
    this.announce('bump', p, undefined, 0.06);
  }

  private onSpin(p: Participant, type: string) {
    p.chaos.spins++;
    if (p === this.local) {
      this.sfx.spin(); this.shake = Math.max(this.shake, 0.3);
      this.flash(type === 'oil' ? 'OIL SLICK! SPINNING OUT' : `SLIPPED ON ${type.toUpperCase()}!`, '#ff7a3a');
    }
    if (p.bot && this.authority) this.say(p, 'spin', 0.6);
    this.announce('spin', p, undefined, p === this.local ? 0.3 : 0.12);
  }

  /** Horn (H). Bots right in front of a honk jump out of their skin. */
  honk(p: Participant, announce: boolean) {
    if (this.simTime - p.honkT < 0.45) return;
    p.honkT = this.simTime;
    p.chaos.honks++;
    const a = p.cart.body.translation(), lt = this.local.cart.body.translation();
    const d = Math.hypot(a.x - lt.x, a.z - lt.z);
    this.sfx.horn(p.info.custom.horn, p === this.local ? 1 : Math.max(0, 1 - d / 28));
    this.popups.spawn('HONK!', a.x, 2.4 * Math.max(1, p.cart.stats.body.sy), a.z, '#ffffff', 0.3, 0.9);
    if (this.authority) {
      const f = p.cart.forward(_v), loud = p.info.custom.horn === 'air' || p.info.custom.horn === 'train' ? 1.35 : 1;
      for (const q of this.players) {
        if (!q.bot || q === p || q.remote) continue;
        const b = q.cart.body.translation(), dx = b.x - a.x, dz = b.z - a.z, ahead = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
        if (ahead < 0.3 || ahead > 7 * loud || side > 2.5) continue;
        q.cart.body.applyImpulse({ x: 0, y: q.cart.body.mass() * 2.6 * loud, z: 0 }, true);
        this.say(q, 'honked', 0.85);
      }
    }
    if (p === this.local && p.chaos.honks % 20 === 0) this.announce('honk', p);
    if (announce && this.net) this.net.event({ e: 'honk', slot: p.slot });
  }

  /** Bots lean on the horn when someone's in their way (or they just won). */
  private botHonks(dt: number) {
    this.botHonkT -= dt;
    if (this.botHonkT > 0) return;
    this.botHonkT = 0.5;
    for (const p of this.players) {
      if (!p.bot || p.done) continue;
      const a = p.cart.body.translation(), f = p.cart.forward(_v);
      const blocked = this.players.some((q) => {
        if (q === p) return false;
        const b = q.cart.body.translation(), dx = b.x - a.x, dz = b.z - a.z, ahead = dx * f.x + dz * f.z;
        return ahead > 0.4 && ahead < 4.5 && Math.abs(dx * f.z - dz * f.x) < 1.4;
      });
      if (blocked && p.cart.speed() < 3.5 && Math.random() < 0.12) this.honk(p, true);
    }
  }

  /** A remote peer's cart crossed the line. */
  remoteFinish(slot: number, time: number) {
    const p = this.players.find((q) => q.slot === slot);
    if (!p || p.done) return;
    p.done = true; p.finishTime = time;
    this.onFinished(p);
  }
  private onFinished(p: Participant) {
    if (!this.firstDone) { this.firstDone = true; this.announce('firstFinish', p); }
    if (p.bot && this.authority) { this.say(p, 'finish', 0.9); if (Math.random() < 0.5) this.honk(p, true); }
  }

  applyBump(slot: number, ix: number, iz: number) {
    const p = this.players.find((q) => q.slot === slot);
    if (!p || p.remote) return;
    // the ram soaks it up; and nothing (mega cart + ram at full nitro) launches you faster than 7 m/s
    const m = p.cart.body.mass(), j = Math.hypot(ix, iz) * (p.cart.stats.addon === 'ram' ? 0.35 : 1), k = Math.min(j, m * 7) / (Math.hypot(ix, iz) || 1);
    p.cart.body.applyImpulse({ x: ix * k, y: 0, z: iz * k }, true);
    if (p === this.local) { this.shake = Math.max(this.shake, 0.5); this.sfx.crash(12000); }
  }

  finish(p: Participant, time: number) {
    if (p.done) return;
    p.done = true; p.finishTime = time;
    if (p === this.local) { this.sfx.finish(); this.flash(`CHECKED OUT! ${time.toFixed(2)}s`, '#ffd23a'); }
    this.onFinished(p);
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
    this.guides.update(dt, time);
    this.popups.update(dt);
    if (this.pa) { this.pa.t -= dt; if (this.pa.t <= 0) this.pa = null; }
    if (this.phase === 'race') this.announcer.tick(dt, this.simTime);
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
      const eye = c.model.eye, back = riding ? eye.rideBack : eye.back, h = riding ? eye.rideHeight : eye.height;
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
    this.popups.dispose();
    this.sfx.stopLoops();
  }
}

