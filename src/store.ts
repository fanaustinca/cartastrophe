// StoreBuilder: lays out one of the five parody stores from its StoreDef + a shared seed.
// Every peer builds the identical store (same item ids) from the host's seed.
//
// Layout (top view, +Z = front):           back wall: open dairy cases (eggs, milk)
//   ┌──────────────────────────────────────────────┐
//   │ produce │ ‖ ‖ ‖ ‖ ‖ ‖ ‖ ‖  gondola runs │ freezers │
//   │ bins    │ ── cross aisle (pallets) ──  │ egg      │
//   │         │ ‖ ‖ ‖ ‖ ‖ ‖ ‖ ‖              │ tables   │
//   │      action alley (promo tiles, oil drums)        │
//   │  ▭ ▭ ▭ ▭ ▭ checkouts (nitro strips = finish) ▭ ▭  │
//   │            spawn line   ▯ entrance ▯              │
//   └──────────────────────────────────────────────┘
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Physics, G, groups, ALL } from './physics';
import { Rng } from './rng';
import { StoreDef, ITEM_KINDS, KIND_BY_ID, ItemKind, kindName } from './config';
import { ShelfSystem, SHELF_LEN, SHELF_DEPTH, shelfLayout } from './shelves';
import { ItemSystem } from './items';
import { Hazards, Pad } from './hazards';
import { NavGrid } from './nav';
import { floorTexture, logoTexture, signTexture, aisleSignTexture, tvScreen } from './textures';

export interface Lane { x: number; z: number; hw: number; hd: number }
export interface Spawn { x: number; z: number; yaw: number }

interface PlannedItem { kind: ItemKind; pos: THREE.Vector3; yaw: number; color: number; shelf: number }

const hexc = (c: number) => new THREE.Color(c);

export class StoreWorld {
  group = new THREE.Group();
  shelves: ShelfSystem;
  items: ItemSystem;
  hazards = new Hazards();
  nav: NavGrid;
  spawns: Spawn[] = [];
  lanes: Lane[] = [];
  kindsInStore: string[] = [];
  checkoutZ = 0;
  bounds: { w: number; d: number };
  aisleSigns: { x: number; z: number; label: string }[] = [];
  /** Named areas for "where is it" hints: exact aisle rectangles, then nearest landmark. */
  aisleZones: { x0: number; x1: number; z0: number; z1: number; name: string }[] = [];
  landmarks: { x: number; z: number; name: string }[] = [];
  aisleCenter = new Map<string, number>();
  private thumb: ((id: string) => HTMLCanvasElement) | null;
  private staticParts = new Map<number, THREE.BufferGeometry[]>();
  private staticEmissive: THREE.BufferGeometry[] = [];
  private tv: ReturnType<typeof tvScreen> | null = null;
  private dynTimer = 0;
  private shadows: boolean;

  constructor(private phys: Physics, public def: StoreDef, seed: number, opts: { shadows: boolean; envMap: THREE.Texture | null; thumb?: (id: string) => HTMLCanvasElement }) {
    this.shadows = opts.shadows;
    this.thumb = opts.thumb ?? null;
    const rng = new Rng(seed ^ 0x5eed);
    const [W, D] = def.size;
    this.bounds = { w: W, d: D };
    this.nav = new NavGrid(W, D);
    this.shelves = new ShelfSystem(phys, def);
    this.items = new ItemSystem(phys);

    this.buildShell(W, D);
    const plan: PlannedItem[] = [];
    const shelfPlacements = this.layoutAisles(W, D, rng, plan);
    this.buildPerimeter(W, D, rng, plan);
    this.buildFront(W, D, rng);
    this.buildHazards(W, D, rng);

    // physics + visuals for dynamic stuff
    this.shelves.build(shelfPlacements, this.shadows);
    this.group.add(this.shelves.mesh, this.shelves.meshLo);
    const counts = new Map<ItemKind, number>();
    for (const p of plan) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    // every catalog kind gets a batch (pool headroom) even if no shelf slot used it
    for (const id of Object.keys(def.catalog)) if (!counts.has(KIND_BY_ID[id])) counts.set(KIND_BY_ID[id], 0);
    this.items.allocate(counts, this.shadows);
    for (const p of plan) {
      const it = this.items.add(p.kind, p.pos, p.yaw, p.color, p.shelf);
      if (p.shelf >= 0) this.shelves.shelves[p.shelf].stock.push(it);
    }
    this.group.add(this.items.group, this.hazards.group);
    this.kindsInStore = [...new Set(plan.map((p) => p.kind.id))];

    // nav: shelves as obstacles
    for (const p of shelfPlacements) this.nav.rect(this.nav.staticBlock, p.x, p.z, SHELF_LEN / 2, SHELF_DEPTH / 2, p.yaw, 0.55, 255);
    this.nav.resetDynamic();
    this.flushStatic(opts.envMap);
    this.settle();
  }

  /**
   * Rapier only computes contacts for awake bodies: a body created asleep sinks into its
   * support the moment it wakes. So everything is built awake, stepped twice to create the
   * resting contacts, then put to sleep — untouched shelves/items then cost nothing.
   */
  private settle() {
    const w = this.phys.world;
    w.step(); w.step();
    w.forEachRigidBody((b) => {
      if (!b.isDynamic()) return;
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.sleep();
    });
  }

  // ---------------- static geometry helpers ----------------
  private addBox(x: number, y: number, z: number, hw: number, hh: number, hd: number, color: number, opts: { collide?: boolean; nav?: boolean; yaw?: number; emissive?: boolean; friction?: number } = {}) {
    const yaw = opts.yaw ?? 0;
    const g = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2).rotateY(yaw).translate(x, y, z);
    if (opts.emissive) this.staticEmissive.push(this.colorize(g, color));
    else { let arr = this.staticParts.get(0); if (!arr) this.staticParts.set(0, (arr = [])); arr.push(this.colorize(g, color)); }
    if (opts.collide !== false) {
      const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)));
      this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(hw, hh, hd).setFriction(opts.friction ?? 0.7).setCollisionGroups(groups(G.STATIC, ALL)), body);
    }
    if (opts.nav !== false && opts.collide !== false && y - hh < 0.9) this.nav.rect(this.nav.staticBlock, x, z, hw, hd, yaw, 0.55, 255);
  }

  private colorize(g: THREE.BufferGeometry, color: number) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    const c = hexc(color), n = ng.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return ng;
  }

  private flushStatic(envMap: THREE.Texture | null) {
    const parts = this.staticParts.get(0) ?? [];
    if (parts.length) {
      const m = new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.1, envMap, envMapIntensity: 0.4 }));
      m.receiveShadow = this.shadows; m.castShadow = this.shadows;
      this.group.add(m);
    }
    if (this.staticEmissive.length) this.group.add(new THREE.Mesh(mergeGeometries(this.staticEmissive, false)!, new THREE.MeshBasicMaterial({ vertexColors: true })));
    this.staticParts.clear(); this.staticEmissive = [];
  }

  /** Sign plane; twoSided adds a back-to-back copy so text never reads mirrored. */
  private texturedPlane(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, yaw: number, twoSided = false) {
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const g = new THREE.Group();
    for (const flip of twoSided ? [0, Math.PI] : [0]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.rotation.y = flip;
      m.position.z = flip ? -0.01 : 0.01;
      g.add(m);
    }
    g.position.set(x, y, z); g.rotation.y = yaw;
    this.group.add(g);
    return g;
  }

  // ---------------- shell: floor, walls, ceiling, lights, branding ----------------
  private buildShell(W: number, D: number) {
    const def = this.def, H = def.ceiling;
    const ftex = floorTexture(def);
    ftex.repeat.set(W / 4, D / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ftex, roughness: def.floorPattern === 'tile' || def.floorPattern === 'checker' ? 0.25 : 0.8, metalness: 0.0 }));
    floor.receiveShadow = this.shadows;
    this.group.add(floor);
    const fb = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2 + 5, 0.5, D / 2 + 5).setFriction(0.8).setCollisionGroups(groups(G.STATIC, ALL)), fb);

    const wc = def.colors.wall, t = 0.3;
    this.addBox(0, H / 2, -D / 2 - t, W / 2 + t, H / 2, t, wc);
    this.addBox(0, H / 2, D / 2 + t, W / 2 + t, H / 2, t, wc);
    this.addBox(-W / 2 - t, H / 2, 0, t, H / 2, D / 2, wc);
    this.addBox(W / 2 + t, H / 2, 0, t, H / 2, D / 2, wc);
    // brand stripe band around the walls
    const band = def.colors.primary;
    this.addBox(0, 2.6, -D / 2 + 0.02, W / 2, 0.25, 0.02, band, { collide: false });
    this.addBox(-W / 2 + 0.02, 2.6, 0, 0.02, 0.25, D / 2, band, { collide: false });
    this.addBox(W / 2 - 0.02, 2.6, 0, 0.02, 0.25, D / 2, band, { collide: false });
    this.addBox(0, 0.1, D / 2 - 0.02, W / 2, 0.1, 0.02, def.colors.secondary, { collide: false });
    // ceiling + light panels
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: def.id === 'bestbuyout' ? 0x141824 : 0x8a8c90 }));
    ceil.position.y = H; this.group.add(ceil);
    const lc = def.colors.light;
    for (let x = -W / 2 + 4; x < W / 2 - 2; x += 6) for (let z = -D / 2 + 4; z < D / 2 - 2; z += 5) {
      this.addBox(x, H - 0.03, z, def.id === 'costplenty' ? 0.25 : 1.1, 0.03, def.id === 'costplenty' ? 0.25 : 0.3, lc, { collide: false, emissive: true });
    }
    if (def.id === 'costplenty') for (let x = -W / 2 + 4; x < W / 2; x += 8) this.addBox(x, H - 0.4, 0, 0.12, 0.3, D / 2, 0x5a6070, { collide: false });

    // big logos: back wall (visible down every aisle) and above the entrance
    const logo = logoTexture(def);
    this.texturedPlane(logo, 14, 3.5, 0, Math.min(H - 2, 5.2), -D / 2 + 0.06, 0);
    this.texturedPlane(logo, 10, 2.5, 0, Math.min(H - 1.5, 4.6), D / 2 - 0.06, Math.PI);
    // entrance: glass doors on the front wall
    for (const x of [-3.2, 3.2]) {
      this.addBox(x, 1.3, D / 2 - 0.08, 1.4, 1.3, 0.04, 0x90b8d0, { collide: false });
      this.addBox(x, 2.65, D / 2 - 0.1, 1.5, 0.06, 0.06, 0x404448, { collide: false });
    }
  }

  // ---------------- gondola aisles ----------------
  private layoutAisles(W: number, D: number, rng: Rng, plan: PlannedItem[]) {
    const def = this.def;
    const placements: { x: number; z: number; yaw: number }[] = [];
    const aisleW = 3.4;
    const pitch = SHELF_DEPTH + aisleW;
    let lines = def.aisleLines;
    while (lines > 3 && lines * pitch > W - 20) lines--;
    const checkoutZ = D / 2 - 9;
    this.checkoutZ = checkoutZ;
    const zBack = -D / 2 + 6.5, zFront = checkoutZ - 7;
    let segs = def.segsPerRun;
    while (segs > 2 && segs * 2 * SHELF_LEN + 4.5 > zFront - zBack) segs--;
    const runLen = segs * SHELF_LEN;
    const cross = Math.max(4.5, (zFront - zBack) - 2 * runLen);
    const z0 = (zBack + zFront) / 2 - (runLen * 2 + cross) / 2;
    const x0 = -((lines - 1) * pitch) / 2;
    const lay = shelfLayout(def);
    const kinds = Object.entries(def.catalog).filter(([id]) => KIND_BY_ID[id].shape !== 'sphere');
    let aisleNo = 0;
    const aisleKinds = new Map<number, Set<string>>();
    // each aisle × run is a "department" of 2–3 kinds, dealt from a shuffled deck so every kind
    // shows up in a few aisles: finding your list means reading the hanging signs
    let deck: string[] = [];
    const themes = new Map<number, [string, number][]>();
    const theme = (key: number) => {
      let t = themes.get(key);
      if (!t) {
        t = [];
        const n = rng.int(2, 3);
        while (t.length < n) {
          if (!deck.length) deck = rng.shuffle(kinds.map(([id]) => id));
          const id = deck.pop()!;
          if (!t.some(([k]) => k === id)) t.push([id, def.catalog[id]]);
        }
        themes.set(key, t);
      }
      return t;
    };

    for (let li = 0; li < lines; li++) {
      const x = x0 + li * pitch;
      for (let run = 0; run < 2; run++) {
        const zs = z0 + run * (runLen + cross);
        for (let s = 0; s < segs; s++) {
          const z = zs + SHELF_LEN / 2 + s * SHELF_LEN;
          const idx = placements.length;
          placements.push({ x, z, yaw: Math.PI / 2 });
          // stock both faces; local +Z face → world -X after yaw π/2 (and vice versa)
          for (const face of [-1, 1]) {
            const aisle = face > 0 ? li : li + 1; // aisle index bordering this face
            let set = aisleKinds.get(aisle * 2 + run); if (!set) aisleKinds.set(aisle * 2 + run, (set = new Set()));
            this.stockFace(idx, x, z, Math.PI / 2, face, lay, theme(aisle * 2 + run), kinds, rng, plan, set);
          }
        }
      }
    }
    // hanging aisle signs over each aisle × run with what's stocked there
    this.runsTmp = [[z0, z0 + runLen], [z0 + runLen + cross, z0 + 2 * runLen + cross]];
    for (let a = 0; a <= lines; a++) {
      // a = 0 / lines are the outer faces of the block: real aisles too (along produce / egg tables)
      const ax = x0 + (a - 0.5) * pitch + (a === 0 ? 0.6 : a === lines ? -0.6 : 0);
      aisleNo++;
      for (let run = 0; run < 2; run++) {
        const set = aisleKinds.get(a * 2 + run);
        const z = z0 + run * (runLen + cross) + runLen / 2;
        const kinds = set ? [...set].slice(0, 3) : [];
        const labels = kinds.map((id) => KIND_BY_ID[id].label.split(' ')[0]).join(' · ');
        // front row (nearest the checkouts, seen first) is 1…N left to right; the back row continues N+1…
        const n = run === 1 ? aisleNo : aisleNo + lines + 1;
        const tex = aisleSignTexture(`AISLE ${n}`, kinds.map((id) => ({ label: kindName(id), thumb: this.thumb ? this.thumb(id) : null })), def.colors.primary);
        // hung high (just under the ceiling, well above the shelf tops) so it reads down the
        // whole aisle and from the cross aisle / action alley
        const y = Math.min(def.ceiling - 1.15, Math.max(def.shelfHeight + 1.35, 3.3));
        this.texturedPlane(tex, 3.3, 1.72, ax, y, z, 0, true);
        for (const sx of [-1.2, 1.2]) this.addBox(ax + sx, (y + 0.86 + def.ceiling) / 2, z, 0.01, (def.ceiling - y - 0.86) / 2, 0.01, 0x333333, { collide: false });
        const zr = this.runsTmp[run];
        this.aisleZones.push({ x0: x0 + (a - 1) * pitch, x1: x0 + a * pitch, z0: zr[0] - 1, z1: zr[1] + 1, name: `Aisle ${n}` });
        this.landmarks.push({ x: ax, z, name: `Aisle ${n}` });
        this.aisleCenter.set(`Aisle ${n}`, x0 + (a - 0.5) * pitch);
        this.aisleSigns.push({ x: ax, z, label: `${n}: ${labels}` });
      }
    }
    // pallets in the cross aisle ends + promo tiles in aisles handled in buildHazards
    this.crossZ = z0 + runLen + cross / 2;
    this.aisleXs = []; for (let a = 1; a < lines; a++) this.aisleXs.push(x0 + (a - 0.5) * pitch);
    this.runs = [[z0, z0 + runLen], [z0 + runLen + cross, z0 + 2 * runLen + cross]];
    this.blockX = [x0 - SHELF_DEPTH / 2, x0 + (lines - 1) * pitch + SHELF_DEPTH / 2];
    return placements;
  }
  private runsTmp: [number, number][] = [];
  crossZ = 0;
  aisleXs: number[] = [];
  runs: [number, number][] = [];
  blockX: [number, number] = [0, 0];

  private stockFace(shelf: number, sx: number, sz: number, syaw: number, face: number, lay: ReturnType<typeof shelfLayout>, themeKinds: [string, number][], allKinds: [string, number][], rng: Rng, plan: PlannedItem[], set: Set<string>) {
    const c = Math.cos(syaw), s = Math.sin(syaw);
    const toWorld = (lx: number, ly: number, lz: number) => new THREE.Vector3(sx + lx * c + lz * s, ly, sz - lx * s + lz * c);
    const fits = ([id]: [string, number]) => KIND_BY_ID[id].size[1] < lay.spacing - 0.04 && KIND_BY_ID[id].size[2] < SHELF_DEPTH / 2 - 0.04;
    for (const by of lay.boards) {
      let fit = themeKinds.filter(fits);
      if (!fit.length) fit = allKinds.filter(fits);
      if (!fit.length) continue;
      const w: Record<string, number> = Object.fromEntries(fit);
      // 1–2 product blocks per board segment
      if (rng.chance(0.12)) continue; // sold out
      const blocks = rng.chance(0.5) ? 1 : 2;
      const span = SHELF_LEN - 0.16;
      for (let bI = 0; bI < blocks; bI++) {
        const k = KIND_BY_ID[rng.weighted(w)];
        set.add(k.id);
        const color = rng.pick(k.colors);
        const bx0 = -span / 2 + (bI * span) / blocks, bw = span / blocks;
        const gap = Math.max(0.03, k.size[0] * 0.3);
        const n = Math.min(k.size[0] < 0.15 ? 7 : 5, Math.floor(bw / (k.size[0] + gap)));
        if (n <= 0) continue;
        const step = bw / n;
        const empty = rng.int(0, Math.min(2, n - 1)); // a few gaps where shoppers already grabbed stuff
        const missing = new Set<number>(); for (let e = 0; e < empty; e++) missing.add(rng.int(0, n - 1));
        for (let i = 0; i < n; i++) {
          if (missing.has(i)) continue;
          const lx = bx0 + step * (i + 0.5);
          const ly = by + 0.0125 + k.size[1] / 2 + 0.002;
          const lz = face * (SHELF_DEPTH / 2 - 0.06 - k.size[2] / 2);
          plan.push({ kind: k, pos: toWorld(lx, ly, lz), yaw: syaw + (face > 0 ? 0 : Math.PI), color, shelf });
        }
      }
    }
  }

  // ---------------- perimeter departments ----------------
  private buildPerimeter(W: number, D: number, rng: Rng, plan: PlannedItem[]) {
    const def = this.def;
    // back wall: open dairy cases with eggs/milk/kombucha (static case, dynamic stock)
    const dairy = ['eggs', 'milk', 'kombucha', 'soda', 'energy'].filter((id) => def.catalog[id]);
    if (dairy.length) {
      const caseLen = 3.6, depth = 0.9, z = -D / 2 + depth / 2 + 0.05;
      for (let x = -W / 2 + 6; x + caseLen < W / 2 - 6; x += caseLen + 0.1) {
        const cx = x + caseLen / 2;
        this.addBox(cx, 1.1, z - depth / 2 + 0.05, caseLen / 2, 1.1, 0.05, 0xe8eef2);
        this.addBox(cx, 0.25, z, caseLen / 2, 0.25, depth / 2, 0x2a3a4a);
        this.addBox(cx, 2.15, z, caseLen / 2, 0.08, depth / 2, def.colors.primary, { collide: true, nav: false });
        this.addBox(cx, 2.05, z - 0.1, caseLen / 2 - 0.05, 0.02, 0.3, 0xffffff, { collide: false, emissive: true });
        for (const sx of [-1, 1]) this.addBox(cx + sx * (caseLen / 2 - 0.03), 1.1, z, 0.03, 1.1, depth / 2, 0xd0d6dc);
        for (const by of [0.5, 0.95, 1.4]) {
          this.addBox(cx, by, z, caseLen / 2 - 0.06, 0.012, depth / 2 - 0.05, 0xc0c8d0, { nav: false });
          const k = KIND_BY_ID[rng.pick(dairy)];
          const n = Math.min(10, Math.floor((caseLen - 0.2) / (k.size[0] + 0.03)));
          for (let i = 0; i < n; i++) {
            const lx = -caseLen / 2 + 0.1 + (i + 0.5) * ((caseLen - 0.2) / n);
            plan.push({ kind: k, pos: new THREE.Vector3(cx + lx, by + 0.012 + k.size[1] / 2 + 0.002, z + 0.15), yaw: 0, color: rng.pick(k.colors), shelf: -2 });
          }
        }
      }
      this.deptSign(def.id === 'bestbuyout' ? 'COLD DRINKS' : 'DAIRY', 0, -D / 2 + 1.05, 0, 2.62);
    }
    // left side: produce bins (static tables, dynamic piles of fruit)
    const produce = ['apple', 'avocado', 'melon'].filter((id) => def.catalog[id] || def.features.produce > 2);
    const lx = -W / 2 + 3.2;
    const leftSpan = [-D / 2 + 5, this.checkoutZ - 6];
    const nProd = def.features.produce;
    for (let i = 0; i < nProd; i++) {
      const z = leftSpan[0] + ((i + 0.5) * (leftSpan[1] - leftSpan[0])) / Math.max(1, nProd);
      const kid = produce.length ? produce[i % produce.length] : 'apple';
      this.produceBin(lx, z, KIND_BY_ID[kid], rng, plan);
    }
    if (nProd) this.deptSign(def.id === 'wholefarm' ? 'FARM FRESH' : 'PRODUCE', lx, (leftSpan[0] + leftSpan[1]) / 2, Math.PI / 2);

    // right side: freezers along the wall, egg tables in front of them
    const rx = W / 2 - 0.7;
    if (def.features.freezers) {
      for (let z = -D / 2 + 4; z < this.checkoutZ - 5; z += 3.1) {
        this.addBox(rx, 1.05, z, 0.6, 1.05, 1.5, 0x3a4450);
        this.addBox(rx - 0.61, 1.05, z, 0.01, 0.95, 1.4, 0x9fd8ff, { collide: false, emissive: true });
        for (let d = -1; d <= 1; d += 2) this.addBox(rx - 0.63, 1.05, z + d * 0.7, 0.02, 0.95, 0.02, 0xd0d4d8, { collide: false });
      }
      this.deptSign('FROZEN', rx - 1, (-D / 2 + this.checkoutZ) / 2, -Math.PI / 2);
    }
    if (def.features.tvWall) {
      this.tv = tvScreen();
      const mat = new THREE.MeshBasicMaterial({ map: this.tv.texture });
      for (let z = -D / 2 + 5; z < this.checkoutZ - 6; z += 2.2) for (const y of [1.3, 2.6]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.07), mat);
        m.position.set(W / 2 - 0.08, y, z); m.rotation.y = -Math.PI / 2; this.group.add(m);
        this.addBox(W / 2 - 0.05, y, z, 0.03, 0.58, 1.0, 0x111111, { collide: false });
      }
      this.deptSign('HOME THEATER', W / 2 - 1, -D / 2 + 10, -Math.PI / 2);
    }
    const tableX = W / 2 - (def.features.freezers || def.features.tvWall ? 3.4 : 2.2);
    for (let i = 0; i < def.features.eggTables; i++) {
      const z = -D / 2 + 7 + (i * (this.checkoutZ - 14 + D / 2)) / Math.max(1, def.features.eggTables);
      this.eggTable(tableX, z, rng, plan);
    }

    // pallets: cross aisle and action alley, stacked with heavy boxes
    const big = ['tp', 'microwave', 'tv', 'dogfood', 'detergent', 'cereal', 'chips'].filter((id) => def.catalog[id]);
    const spots: [number, number][] = [];
    for (let i = 0; i < this.aisleXs.length; i += 2) spots.push([this.aisleXs[i], this.crossZ]);
    for (let x = this.blockX[0] + 3; x < this.blockX[1] - 3; x += 7) spots.push([x, this.runs[1][1] + 2.6]);
    rng.shuffle(spots);
    for (let i = 0; i < Math.min(def.features.pallets, spots.length); i++) {
      if (!big.length) break;
      this.pallet(spots[i][0] + rng.range(-0.3, 0.3), spots[i][1], KIND_BY_ID[rng.pick(big)], rng, plan);
    }
    if (def.id === 'costplenty') this.forklift(-W / 2 + 7, this.crossZ, rng);
  }

  private deptSign(text: string, x: number, z: number, yaw: number, y = Math.min(this.def.ceiling - 0.7, 3.8)) {
    if (!text.startsWith('CHECKOUT')) this.landmarks.push({ x, z, name: text.charAt(0) + text.slice(1).toLowerCase() });
    const tex = signTexture(text, '', this.def.colors.primary, 0xffffff, 512, 128);
    this.texturedPlane(tex, 3.2, 0.8, x, y, z, yaw, true);
  }

  private produceBin(x: number, z: number, k: ItemKind, rng: Rng, plan: PlannedItem[]) {
    const hw = 0.9, hd = 1.4, top = 0.75;
    const wood = this.def.id === 'wholefarm' ? 0x8a5a30 : 0x6a4a2a;
    this.addBox(x, top / 2, z, hw, top / 2, hd, wood);
    for (const [ox, oz, w, d] of [[hw, 0, 0.03, hd], [-hw, 0, 0.03, hd], [0, hd, hw, 0.03], [0, -hd, hw, 0.03]]) this.addBox(x + ox, top + 0.1, z + oz, w, 0.1, d, wood, { nav: false });
    const r = (k.size[0] + k.size[1] + k.size[2]) / 6;
    const step = r * 2.05;
    const nx = Math.floor((hw * 2 - 0.1) / step), nz = Math.floor((hd * 2 - 0.1) / step);
    const cap = k.id === 'melon' ? 3 : 2;
    for (let layer = 0; layer < cap; layer++) {
      const off = layer * r;
      for (let i = 0; i < nx - layer; i++) for (let j = 0; j < nz - layer; j++) {
        if (k.id !== 'melon' && (i + j) % 2 && layer) continue;
        plan.push({ kind: k, pos: new THREE.Vector3(x - hw + 0.05 + r + off + i * step, top + r + layer * r * 1.6 + 0.003, z - hd + 0.05 + r + off + j * step), yaw: rng.range(0, 6), color: rng.pick(k.colors), shelf: -3 });
      }
    }
  }

  private eggTable(x: number, z: number, rng: Rng, plan: PlannedItem[]) {
    // a wobbly dynamic display table: ram it and the whole egg pyramid goes over
    const top = 0.8, hw = 0.75, hd = 0.5;
    this.landmarks.push({ x, z, name: 'Egg table' });
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, z).setCanSleep(true));
    const cols = [RAPIER.ColliderDesc.cuboid(hw, 0.03, hd).setTranslation(0, top, 0).setMass(12)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cols.push(RAPIER.ColliderDesc.cuboid(0.03, top / 2, 0.03).setTranslation(sx * (hw - 0.05), top / 2, sz * (hd - 0.05)).setMass(2));
    for (const c of cols) this.phys.world.createCollider(c.setFriction(0.8).setCollisionGroups(groups(G.SHELF, ALL)), body);
    const g = mergeGeometries([
      this.colorize(new THREE.BoxGeometry(hw * 2, 0.06, hd * 2).translate(0, top, 0), 0xf4f0e8),
      this.colorize(new THREE.BoxGeometry(hw * 2 + 0.02, 0.25, hd * 2 + 0.02).translate(0, top - 0.15, 0), this.def.colors.primary),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => this.colorize(new THREE.BoxGeometry(0.06, top, 0.06).translate(sx * (hw - 0.05), top / 2, sz * (hd - 0.05)), 0x888888))),
      this.colorize(new THREE.BoxGeometry(0.5, 0.35, 0.02).translate(0, top + 0.7, -hd + 0.05), 0xffe23a),
    ], false)!;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    mesh.castShadow = this.shadows;
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    this.dynamicProps.push({ body, mesh });
    this.nav.rect(this.nav.staticBlock, x, z, hw, hd, 0, 0.5, 200);
    const eggs = KIND_BY_ID.eggs;
    const [w, h, d] = eggs.size;
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 4 - layer; i++) for (let j = 0; j < 6 - layer; j++) {
      plan.push({ kind: eggs, pos: new THREE.Vector3(x - 1.5 * (w + 0.02) + (i + layer / 2) * (w + 0.02), top + 0.03 + h / 2 + layer * (h + 0.003) + 0.002, z - 2.5 * (d + 0.02) + (j + layer / 2) * (d + 0.02)), yaw: 0, color: rng.pick(eggs.colors), shelf: -4 });
    }
  }
  dynamicProps: { body: RAPIER.RigidBody; mesh: THREE.Mesh }[] = [];

  private pallet(x: number, z: number, k: ItemKind, rng: Rng, plan: PlannedItem[]) {
    const ph = 0.14;
    this.addBox(x, ph / 2, z, 0.6, ph / 2, 0.5, 0xb08a58, { nav: false });
    this.landmarks.push({ x, z, name: 'Pallet display' });
    this.nav.rect(this.nav.staticBlock, x, z, 0.6, 0.5, 0, 0.55, 180);
    const [w, h, d] = k.size;
    const nx = Math.max(1, Math.floor(1.2 / (w + 0.01))), nz = Math.max(1, Math.floor(1.0 / (d + 0.01)));
    const layers = Math.min(4, Math.max(2, Math.floor(1.3 / h)));
    const color = rng.pick(k.colors);
    for (let l = 0; l < layers; l++) for (let i = 0; i < Math.min(nx, 4); i++) for (let j = 0; j < Math.min(nz, 4); j++) {
      plan.push({ kind: k, pos: new THREE.Vector3(x - (Math.min(nx, 4) - 1) * (w + 0.01) / 2 + i * (w + 0.01), ph + h / 2 + l * (h + 0.002) + 0.002, z - (Math.min(nz, 4) - 1) * (d + 0.01) / 2 + j * (d + 0.01)), yaw: 0, color, shelf: -5 });
    }
  }

  private forklift(x: number, z: number, _rng: Rng) {
    this.addBox(x, 0.7, z, 0.6, 0.55, 1.0, 0xf0b020);
    this.addBox(x, 1.6, z - 0.2, 0.55, 0.05, 0.6, 0x222222, { collide: false });
    for (const sx of [-0.5, 0.5]) this.addBox(x + sx, 1.2, z - 0.75, 0.04, 0.5, 0.04, 0x222222, { collide: false });
    this.addBox(x, 1.2, z + 1.1, 0.45, 1.1, 0.06, 0x333333);
    for (const sx of [-0.25, 0.25]) this.addBox(x + sx, 0.1, z + 1.7, 0.06, 0.03, 0.6, 0x555555, { nav: false });
  }

  // ---------------- checkouts + spawn ----------------
  private buildFront(W: number, D: number, rng: Rng) {
    const z = this.checkoutZ, def = this.def;
    const counterLen = 3.0;
    const pitch = 3.6;
    const span = W - 16;
    const n = Math.max(4, Math.floor(span / pitch));
    const x0 = -((n - 1) * pitch) / 2;
    const pads: Omit<Pad, 'cos' | 'sin'>[] = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch;
      // counter with conveyor, register, candy rack, lane light
      this.addBox(x, 0.45, z, 0.45, 0.45, counterLen / 2, 0x5a5a62);
      this.addBox(x, 0.92, z + 0.2, 0.32, 0.02, counterLen / 2 - 0.4, 0x151515, { collide: false });
      this.addBox(x, 1.15, z - counterLen / 2 + 0.3, 0.2, 0.2, 0.2, 0x202024, { collide: false });
      this.addBox(x - 0.2, 0.7, z + counterLen / 2 + 0.3, 0.25, 0.7, 0.18, def.colors.accent);
      this.addBox(x + 0.3, 1.7, z - counterLen / 2 + 0.1, 0.03, 0.8, 0.03, 0x333333, { collide: false });
      this.addBox(x + 0.3, 2.6, z - counterLen / 2 + 0.1, 0.18, 0.18, 0.05, def.colors.primary, { collide: false, emissive: true });
      if (i < n - 1) {
        const lx = x + pitch / 2;
        this.lanes.push({ x: lx, z, hw: (pitch - 0.9) / 2, hd: counterLen / 2 });
        pads.push({ kind: 'nitro', x: lx, z, hw: 0.55, hd: counterLen / 2 - 0.2, yaw: 0 });
      }
    }
    this.hazards.addPads(pads);
    this.deptSign('CHECKOUT — FINISH HERE', 0, z - counterLen / 2 - 0.5, 0);
    // spawn line between checkouts and entrance, facing into the store (−Z)
    const central = [...this.lanes].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).slice(0, 8).sort((a, b) => a.x - b.x);
    for (let i = 0; i < 8; i++) {
      const l = central[i % central.length];
      this.spawns.push({ x: l.x, z: D / 2 - 3.2 - Math.floor(i / central.length) * 2, yaw: Math.PI });
    }
    // cart corral prop by the door
    this.addBox(W / 2 - 4, 0.5, D / 2 - 2, 1.5, 0.5, 0.6, 0x909aa4);
    void rng;
  }

  // ---------------- hazards: promo tiles, oil drums, starter spills ----------------
  private buildHazards(W: number, D: number, rng: Rng) {
    const pads: Omit<Pad, 'cos' | 'sin'>[] = [];
    for (let i = 0; i < this.def.features.boostTiles; i++) {
      if (i % 3 === 2) {
        pads.push({ kind: 'promo', x: rng.range(this.blockX[0] + 2, this.blockX[1] - 2), z: this.crossZ + rng.range(-0.5, 0.5), hw: 0.7, hd: 1.0, yaw: Math.PI / 2 });
      } else {
        const run = this.runs[rng.int(0, 1)];
        pads.push({ kind: 'promo', x: rng.pick(this.aisleXs), z: rng.range(run[0] + 1.5, run[1] - 1.5), hw: 0.7, hd: 1.0, yaw: rng.chance(0.5) ? 0 : Math.PI });
      }
    }
    // action alley tiles (in front of the checkouts)
    for (let x = -W / 2 + 8; x < W / 2 - 8; x += 9) pads.push({ kind: 'promo', x, z: this.checkoutZ - 3.6, hw: 0.7, hd: 1.0, yaw: Math.PI / 2 });
    this.hazards.addPads(pads);
    // leaking oil drums: static drum, slick that slowly spreads
    for (let i = 0; i < this.def.features.oilDrums; i++) {
      const x = rng.chance(0.5) ? rng.pick(this.aisleXs) + rng.range(-1.1, 1.1) : rng.range(this.blockX[0], this.blockX[1]);
      const z = rng.chance(0.5) ? this.crossZ + rng.range(-1.5, 1.5) : this.runs[1][1] + rng.range(1.5, 3.5);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), new THREE.MeshStandardMaterial({ color: 0x1f4a8a, roughness: 0.5, metalness: 0.5 }));
      drum.position.set(x, 0.45, z); drum.castShadow = this.shadows; this.group.add(drum);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.25, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd020 }));
      label.position.copy(drum.position); this.group.add(label);
      const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.45, z).setCanSleep(true));
      this.phys.world.createCollider(RAPIER.ColliderDesc.cylinder(0.45, 0.3).setMass(60).setFriction(0.6).setCollisionGroups(groups(G.SHELF, ALL)), body);
      this.dynamicProps.push({ body, mesh: drum });
      this.drumLabels.push([body, label]);
      this.hazards.addSlick('oil', x + 0.6, z + 0.3, rng.range(1.4, 2.0), 40); // spreads over 40 s
    }
    // a couple of fresh spills already on the floor
    for (let i = 0; i < 2; i++) this.hazards.addSlick(rng.chance(0.6) ? 'oil' : 'egg', rng.pick(this.aisleXs), rng.range(this.runs[0][0] + 2, this.runs[1][1] - 2), rng.range(0.9, 1.3), 0);
    void D;
  }
  private drumLabels: [RAPIER.RigidBody, THREE.Mesh][] = [];

  /** Human-readable location, e.g. "Aisle 7", "Dairy", "Pallet display". */
  whereIs(x: number, z: number): string {
    for (const a of this.aisleZones) if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return a.name;
    let best = '', bd = Infinity;
    for (const l of this.landmarks) { const d = (l.x - x) ** 2 + (l.z - z) ** 2; if (d < bd) { bd = d; best = l.name; } }
    return best;
  }

  // ---------------- per-frame ----------------
  update(dt: number, time: number, camera: THREE.Camera) {
    this.shelves.update(camera);
    this.items.update(camera, dt);
    this.hazards.update(dt, time, camera.position);
    for (const p of this.dynamicProps) {
      if (p.body.isSleeping()) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z); p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (const [b, l] of this.drumLabels) { const t = b.translation(), r = b.rotation(); l.position.set(t.x, t.y, t.z); l.quaternion.set(r.x, r.y, r.z, r.w); }
    if (this.tv) this.tv.update(time);
    // refresh dynamic nav costs (toppled shelves, slicks) a couple of times a second
    this.dynTimer -= dt;
    if (this.dynTimer <= 0) {
      this.dynTimer = 0.7;
      this.nav.resetDynamic();
      for (const sh of this.shelves.shelves) {
        if (!sh.moved) continue;
        const t = sh.body.translation();
        this.nav.circle(this.nav.cost, t.x, t.z, 1.6, 200);
      }
      for (const s of this.hazards.slicks) if (s.active && s.type !== 'soda') this.nav.circle(this.nav.cost, s.x, s.z, s.r, 90);
    }
  }
}
