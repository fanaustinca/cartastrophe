// ItemSystem: thousands of physical grocery items.
// - One pair of InstancedMeshes (hi / lo LOD) per item kind: ~2 draw calls per kind.
// - Every item is a Rapier body that starts asleep; untouched items cost ~nothing.
// - Instance matrices are only rewritten for awake items or on LOD bucket changes.
// - Items are pooled: removed items keep their body (disabled) and are reused by spawn().
// - Awake-body budget: when too many items roll around, the slowest far ones are put to sleep.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Physics, G, groups, ALL } from './physics';
import type { ItemKind } from './config';
import { labelTexture } from './labels';

export interface Item {
  id: number;
  kind: ItemKind;
  slot: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  alive: boolean;
  lod: number; // 0 hi, 1 lo, 2 culled
  cell: number;
  color: THREE.Color;
  shelf: number; // shelf index it was stocked on, -1 otherwise
  home: THREE.Vector3; // where it was stocked
  spawned: boolean; // came from the pool at runtime (cargo spill etc.)
  homeYaw: number;
  group: number; // restock group (its shelf or display), -1 for runtime spawns
  touched: boolean; // woken / taken since it was last (re)stocked
}

interface KindBatch { kind: ItemKind; hi: THREE.InstancedMesh; lo: THREE.InstancedMesh; items: Item[]; free: Item[]; dirty: boolean }

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

// --- geometry: every part carries uv + aTone (grey value, mix) + aLab (0/1) so one material per
// kind can show grey caps/rims, the per-instance product color, and the printed label (labels.ts) ---
function part(g: THREE.BufferGeometry, value = 0, mix = 0, label = false) {
  if (g.index) g = g.toNonIndexed();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const a = new Float32Array(n * 2), l = new Float32Array(n);
  for (let i = 0; i < n; i++) { a[i * 2] = value; a[i * 2 + 1] = mix; l[i] = label ? 1 : 0; }
  g.setAttribute('aTone', new THREE.BufferAttribute(a, 2));
  g.setAttribute('aLab', new THREE.BufferAttribute(l, 1));
  return g;
}
const tone = (g: THREE.BufferGeometry, value: number, mix: number) => part(g, value, mix);
const label = (g: THREE.BufferGeometry) => part(g, 0, 0, true);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
/** Front (+z) and back (−z) label decals of size w×h centered at height y, just proud of a face at ±z. */
const faces = (w: number, h: number, y: number, z: number) => [
  label(new THREE.PlaneGeometry(w, h).translate(0, y, z + 0.0015)),
  label(new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(0, y, -z - 0.0015)),
];
/** Label band wrapped around a cylinder. */
// rotated so a label copy (drawn centred at u = ¼ and ¾) faces the item front (+z), not the seam
const band = (r: number, h: number, y: number, seg: number) => label(new THREE.CylinderGeometry(r, r, h, seg, 1, true).rotateY(-Math.PI / 2).translate(0, y, 0));

export function itemGeometry(k: ItemKind, hi: boolean): THREE.BufferGeometry {
  const [w, h, d] = k.size;
  const r = Math.min(w, d) / 2;
  const seg = hi ? 16 : 8;
  const parts: THREE.BufferGeometry[] = [];
  switch (k.id === 'tp' ? 'tp' : k.id === 'bread' ? 'bread' : k.shape) {
    case 'tp': {
      // a real-looking pack: 3×2 rolls, two layers, with the printed sleeve around the middle
      const rr = Math.min(w / 6, d / 4) - 0.002, lh = h / 2 - 0.004;
      if (hi) {
        for (let l = 0; l < 2; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          const x = (i - 1) * (w / 3), z = (j - 0.5) * (d / 2), y = (l - 0.5) * (h / 2);
          parts.push(tone(at(new THREE.CylinderGeometry(rr, rr, lh, 12), x, y, z), 0, 0));
          if (l === 1) parts.push(tone(at(new THREE.CylinderGeometry(rr * 0.3, rr * 0.3, 0.004, 8), x, y + lh / 2 + 0.001, z), 0.45, 1));
        }
      } else parts.push(tone(new THREE.BoxGeometry(w * 0.98, h, d * 0.98), 0, 0));
      const bh = h * 0.38;
      parts.push(...faces(w, bh, 0, d / 2));
      parts.push(label(new THREE.PlaneGeometry(d, bh).rotateY(Math.PI / 2).translate(w / 2 + 0.0015, 0, 0)));
      parts.push(label(new THREE.PlaneGeometry(d, bh).rotateY(-Math.PI / 2).translate(-w / 2 - 0.0015, 0, 0)));
      break;
    }
    case 'bread': {
      // loaf: domed top, printed bag on the long sides
      const g = new THREE.BoxGeometry(w, h, d, 4, 4, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) p.setZ(i, p.getZ(i) * (1 - 0.45 * (y / (h / 2)) ** 2)); }
      g.computeVertexNormals();
      parts.push(tone(g, 0, 0));
      parts.push(...faces(w * 0.9, h * 0.62, -h * 0.15, d / 2));
      break;
    }
    case 'box':
      parts.push(tone(new THREE.BoxGeometry(w, h, d), 0, 0));
      parts.push(...faces(w * 0.98, h * 0.98, 0, d / 2));
      break;
    case 'can':
      parts.push(tone(new THREE.CylinderGeometry(r, r, h, seg), 0.78, 1));
      parts.push(band(r * 1.02, h * 0.72, 0, seg));
      break;
    case 'bottle':
      parts.push(tone(at(new THREE.CylinderGeometry(r, r, h * 0.62, seg), 0, -h * 0.19, 0), 0, 0));
      parts.push(tone(at(new THREE.CylinderGeometry(r * 0.35, r, h * 0.26, seg), 0, h * 0.25, 0), 0, 0));
      parts.push(tone(at(new THREE.CylinderGeometry(r * 0.38, r * 0.38, h * 0.12, seg), 0, h * 0.44, 0), 0.12, 1));
      parts.push(band(r * 1.03, h * 0.25, -h * 0.17, seg));
      break;
    case 'carton':
      parts.push(tone(at(new THREE.BoxGeometry(w, h * 0.55, d), 0, -h * 0.22, 0), 0, 0));
      parts.push(tone(at(new THREE.BoxGeometry(w * 0.98, h * 0.12, d * 0.98), 0, h * 0.44, 0), 0, 0));
      if (hi) for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) parts.push(tone(at(new THREE.SphereGeometry(w / 13, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), -w * 0.4 + i * w * 0.16, h * 0.05, (j - 0.5) * d * 0.48), 0.9, 0.7));
      parts.push(...faces(w * 0.98, h * 0.52, -h * 0.22, d / 2));
      break;
    case 'jug':
      parts.push(tone(new THREE.BoxGeometry(w, h * 0.8, d), 0, 0));
      parts.push(tone(at(new THREE.CylinderGeometry(r * 0.32, r * 0.32, h * 0.12, seg), 0, h * 0.45, 0), k.id === 'milk' ? 0.1 : 0.95, 1));
      parts.push(tone(at(new THREE.BoxGeometry(w * 0.15, h * 0.35, d * 0.5), w * 0.42, h * 0.22, 0), 0, 0));
      parts.push(...faces(w * 0.94, h * 0.76, 0, d / 2));
      break;
    case 'bag': {
      const pinch = (y: number) => 0.4 + 0.6 * (1 - Math.pow(Math.abs(y) / (h / 2), 3) * 0.6);
      const g = new THREE.BoxGeometry(w, h, d, 2, 6, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * pinch(p.getY(i)));
      g.computeVertexNormals();
      parts.push(tone(g, 0, 0));
      for (const sz of [1, -1]) {
        const f = new THREE.PlaneGeometry(w * 0.97, h * 0.97, 1, 8);
        if (sz < 0) f.rotateY(Math.PI);
        const fp = f.attributes.position;
        for (let i = 0; i < fp.count; i++) fp.setZ(i, sz * ((d / 2) * pinch(fp.getY(i)) + 0.0015));
        f.computeVertexNormals();
        parts.push(label(f));
      }
      break;
    }
    case 'sphere': {
      const g = new THREE.SphereGeometry(0.5, hi ? 14 : 7, hi ? 10 : 5).scale(w, h, d);
      parts.push(tone(g, 0, 0));
      if (hi && k.id !== 'melon') parts.push(tone(at(new THREE.CylinderGeometry(0.004, 0.004, h * 0.25, 4), 0, h * 0.55, 0), 0.25, 1));
      if (hi && k.id === 'melon') for (let i = 0; i < 6; i++) { const s = new THREE.SphereGeometry(0.505, 3, 10, (i / 6) * Math.PI * 2, 0.18).scale(w, h, d); parts.push(tone(s, 0.15, 0.55)); }
      break;
    }
    case 'jar':
      parts.push(tone(new THREE.CylinderGeometry(r, r, h * 0.85, seg), 0.95, 1));
      parts.push(tone(at(new THREE.CylinderGeometry(r * 0.85, r * 0.85, h * 0.15, seg), 0, h * 0.42, 0), 0.15, 1));
      parts.push(band(r * 1.02, h * 0.5, -h * 0.05, seg));
      break;
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * One material per item kind (each kind is already its own InstancedMesh, so no extra draw calls).
 * Color = instance color, toned toward grey on caps/rims, with the premultiplied label composited on top.
 */
const BLANK = new THREE.DataTexture(new Uint8Array(4), 1, 1);
BLANK.needsUpdate = true;
export function itemMaterial(k: ItemKind): THREE.MeshStandardMaterial {
  const hit = materials.get(k.id);
  if (hit) return hit;
  const map = labelTexture(k);
  // The label goes in its own sampler, not `map`: patching three's map path broke the draw
  // ("texture format / sampler type mismatch") whenever shadows were on, i.e. empty shelves.
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.labelMap = { value: map ?? BLANK };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTone;\nattribute float aLab;\nvarying float vLab;\nvarying vec2 vLabUv;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvLab = aLab;\nvLabUv = uv;\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb = mix(vColor.rgb, vec3(aTone.x), aTone.y);\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLab;\nvarying vec2 vLabUv;\nuniform sampler2D labelMap;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec4 labTex = texture2D(labelMap, vLabUv) * vLab;\ndiffuseColor.rgb = diffuseColor.rgb * (1.0 - labTex.a) + labTex.rgb;');
  };
  m.userData.label = map;
  m.customProgramCacheKey = () => 'item-label2';
  materials.set(k.id, m);
  return m;
}

export function itemCollider(k: ItemKind): RAPIER.ColliderDesc {
  const [w, h, d] = k.size;
  let c: RAPIER.ColliderDesc;
  switch (k.shape) {
    case 'can': case 'bottle': case 'jar': c = RAPIER.ColliderDesc.cylinder(h / 2, Math.min(w, d) / 2); break;
    case 'sphere': c = RAPIER.ColliderDesc.ball((w + h + d) / 6); break;
    default: c = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2);
  }
  return c.setMass(k.mass).setFriction(0.6).setRestitution(k.shape === 'sphere' ? 0.35 : 0.15)
    .setCollisionGroups(groups(G.ITEM, ALL));
}

const CELL = 2;
const cellKey = (x: number, z: number) => ((Math.floor(x / CELL) + 512) << 10) | (Math.floor(z / CELL) + 512);

export class ItemSystem {
  group = new THREE.Group();
  batches: KindBatch[] = [];
  all: Item[] = [];
  byCollider = new Map<number, Item>();
  byBody = new Map<number, Item>();
  grid = new Map<number, Set<Item>>();
  hiDist = 16;
  cullDist = 70;
  maxAwake = 650;
  awakeCount = 0;
  onBreak: ((it: Item, force: number) => void) | null = null;
  private budgetTimer = 0;
  private tmpWake: Item[] = [];

  constructor(private phys: Physics) {}

  /** plan: kind → number of items. Allocates meshes with headroom for pooled spawns. */
  allocate(plan: Map<ItemKind, number>, shadows: boolean) {
    for (const [kind, n] of plan) {
      const cap = n + 12;
      const mat = itemMaterial(kind);
      const hi = new THREE.InstancedMesh(itemGeometry(kind, true), mat, cap);
      const lo = new THREE.InstancedMesh(itemGeometry(kind, false), mat, cap);
      for (const m of [hi, lo]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.count = 0;
        this.group.add(m);
      }
      hi.castShadow = shadows; hi.receiveShadow = shadows; lo.receiveShadow = shadows;
      this.batches.push({ kind, hi, lo, items: [], free: [], dirty: true });
    }
  }

  private batch(kind: ItemKind) { return this.batches.find((b) => b.kind === kind)!; }

  /** Create a stocked item (awake; StoreWorld.settle() puts the whole store to sleep once contacts exist). */
  add(kind: ItemKind, pos: THREE.Vector3, yaw: number, color: number, shelf = -1): Item {
    const b = this.batch(kind);
    const slot = b.items.length;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setRotation(_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw))
      .setLinearDamping(0.15).setAngularDamping(0.4).setCanSleep(true);
    const body = this.phys.world.createRigidBody(desc);
    const cd = itemCollider(kind);
    if (kind.fragile) cd.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(kind.fragile.threshold);
    const collider = this.phys.world.createCollider(cd, body);
    const it: Item = { id: this.all.length, kind, slot, body, collider, alive: true, lod: -1, cell: -1, color: new THREE.Color(color), shelf, home: pos.clone(), spawned: false, homeYaw: yaw, group: -1, touched: false };
    b.items.push(it);
    b.lo.count = b.items.length;
    b.lo.setColorAt(slot, it.color);
    if (!b.hi.instanceColor) b.hi.setColorAt(0, it.color);
    this.all.push(it);
    this.byCollider.set(collider.handle, it);
    this.byBody.set(body.handle, it);
    if (kind.fragile) this.phys.onForce(collider.handle, (_o, f) => { if (it.alive && this.onBreak) this.onBreak(it, f); });
    this.place(it);
    return it;
  }

  /** Take an item out of the world (collected / smashed). Its body is kept for pooling. */
  remove(it: Item) {
    if (!it.alive) return;
    it.alive = false;
    it.touched = true;
    const t = it.body.translation(), top = t.y - it.kind.size[1] / 2 - 0.02;
    it.body.setEnabled(false);
    // whatever was resting on it (stacked pallets, pyramids) must fall, not hover
    for (const o of this.near(t.x, t.z, 0.7, this.tmpWake)) if (o !== it && o.body.isSleeping() && o.body.translation().y > top) o.body.wakeUp();
    const b = this.batch(it.kind);
    b.lo.setMatrixAt(it.slot, ZERO);
    it.lod = 2;
    b.dirty = true;
    this.unplace(it);
    if (it.spawned) b.free.push(it);
  }

  /** Put a stocked item back where it came from (restocking). Leaves it awake; the caller settles it. */
  restore(it: Item) {
    if (!it.alive) {
      it.alive = true;
      it.body.setEnabled(true);
      it.lod = -1;
      this.batch(it.kind).dirty = true;
    }
    it.body.setTranslation(it.home, true);
    it.body.setRotation(_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.homeYaw), true);
    it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    it.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    it.lod = -1;
    it.touched = false;
    this.wdWokeY.delete(it);
    this.place(it);
  }

  /** Reuse a pooled body (or a free slot) to put a loose item into the world. */
  spawn(kind: ItemKind, pos: THREE.Vector3, vel: THREE.Vector3, color?: number): Item | null {
    const b = this.batch(kind);
    if (!b) return null;
    let it = b.free.pop();
    if (!it) {
      if (b.items.length >= b.hi.instanceMatrix.count) return null;
      it = this.add(kind, pos, 0, color ?? kind.colors[0], -1);
      it.spawned = true;
    } else {
      it.alive = true;
      it.body.setEnabled(true);
      it.body.setTranslation(pos, true);
      it.lod = -1;
      this.place(it);
    }
    it.body.setLinvel(vel, true);
    it.body.setAngvel({ x: Math.random() * 6 - 3, y: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }, true);
    return it;
  }

  private place(it: Item) {
    const t = it.body.translation();
    const k = cellKey(t.x, t.z);
    if (k === it.cell) return;
    this.unplace(it);
    let s = this.grid.get(k);
    if (!s) this.grid.set(k, (s = new Set()));
    s.add(it);
    it.cell = k;
  }
  private unplace(it: Item) {
    if (it.cell >= 0) this.grid.get(it.cell)?.delete(it);
    it.cell = -1;
  }

  /** After each physics step: re-bucket only the bodies Rapier reports as active. */
  syncActive() {
    this.phys.world.forEachActiveRigidBody((b) => {
      const it = this.byBody.get(b.handle);
      if (it && it.alive) { this.place(it); it.touched = true; }
    });
  }

  /** Items within radius r of (x,z), optional filter. */
  near(x: number, z: number, r: number, out: Item[] = [], filter?: (it: Item) => boolean): Item[] {
    out.length = 0;
    const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const s = this.grid.get(((cx + 512) << 10) | (cz + 512));
      if (!s) continue;
      for (const it of s) {
        const t = it.body.translation();
        if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r && (!filter || filter(it))) out.push(it);
      }
    }
    return out;
  }

  /**
   * Called once per rendered frame.
   * lo mesh: one fixed slot per item, rewritten only when the item is awake or changes LOD.
   * hi mesh: packed each frame with just the items near the camera (a few hundred), so far
   * items never pay for hi-poly vertices and only near items cast shadows.
   */
  update(camera: THREE.Camera, dt: number) {
    const cx = camera.position.x, cz = camera.position.z;
    const hi2 = this.hiDist ** 2, cull2 = this.cullDist ** 2;
    let awake = 0;
    for (const b of this.batches) {
      let hiN = 0;
      for (const it of b.items) {
        if (!it.alive) continue;
        const sleeping = it.body.isSleeping();
        if (!sleeping) awake++;
        const t = it.body.translation();
        const d2 = (t.x - cx) ** 2 + (t.z - cz) ** 2;
        const lod = d2 < hi2 ? 0 : d2 < cull2 ? 1 : 2;
        if (!sleeping && t.y < -5) { this.remove(it); continue; } // fell out of the world
        if (lod === 0 || (!sleeping && lod === 1) || lod !== it.lod) {
          const r = it.body.rotation();
          _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s);
        }
        if (lod === 0) { b.hi.setMatrixAt(hiN, _m); b.hi.setColorAt(hiN, it.color); hiN++; }
        if (lod !== it.lod) { b.lo.setMatrixAt(it.slot, lod === 1 ? _m : ZERO); it.lod = lod; b.dirty = true; }
        else if (lod === 1 && !sleeping) { b.lo.setMatrixAt(it.slot, _m); b.dirty = true; }
      }
      if (hiN || b.hi.count) {
        b.hi.count = hiN;
        b.hi.instanceMatrix.needsUpdate = true;
        if (b.hi.instanceColor) b.hi.instanceColor.needsUpdate = true;
      }
      if (b.dirty) {
        b.lo.instanceMatrix.needsUpdate = true;
        if (b.lo.instanceColor) b.lo.instanceColor.needsUpdate = true;
        b.dirty = false;
      }
    }
    this.awakeCount = awake;
    this.budgetTimer -= dt;
    if (awake > this.maxAwake && this.budgetTimer <= 0) { this.budgetTimer = 0.5; this.enforceBudget(camera); }
  }

  /**
   * Safety net for anything the explicit wake-ups miss: a few times a second, check a slice of the
   * sleeping, elevated, *displaced* items (untouched stock is supported by construction) with short
   * downward rays, and wake any that have nothing under them.
   */
  watchdog(dt: number) {
    this.wdT -= dt;
    if (this.wdT > 0) return;
    this.wdT = 0.25;
    const n = this.all.length;
    let checked = 0;
    for (let k = 0; k < n && checked < 120; k++) {
      this.wdIdx = (this.wdIdx + 1) % n;
      const it = this.all[this.wdIdx];
      if (!it.alive || !it.body.isSleeping()) continue;
      const t = it.body.translation();
      if (t.y < 0.2) continue;
      if (!it.spawned && Math.abs(t.y - it.home.y) < 0.01 && Math.abs(t.x - it.home.x) + Math.abs(t.z - it.home.z) < 0.02) continue;
      // woken before and didn't budge: it *is* resting on something; stop poking it
      const prev = this.wdWokeY.get(it);
      if (prev !== undefined && Math.abs(prev - t.y) < 0.01) continue;
      checked++;
      if (!this.supported(it, t)) { it.body.wakeUp(); this.wdWokeY.set(it, t.y); this.wdWoken++; }
    }
  }
  wdWoken = 0;
  private wdT = 0;
  private wdIdx = 0;
  private wdWokeY = new Map<Item, number>();

  /** Does the item's own collider, nudged 3 cm down, overlap anything? (any orientation, any contact point) */
  private supported(it: Item, t: { x: number; y: number; z: number }) {
    return !!this.phys.world.intersectionWithShape({ x: t.x, y: t.y - 0.03, z: t.z }, it.body.rotation(), it.collider.shape, undefined, undefined, it.collider);
  }

  /** Put the slowest, furthest awake items to sleep so the solver never drowns. */
  private enforceBudget(camera: THREE.Camera) {
    const cand: [number, Item][] = [];
    for (const it of this.all) {
      if (!it.alive || it.body.isSleeping()) continue;
      const v = it.body.linvel();
      const sp = v.x * v.x + v.y * v.y + v.z * v.z;
      if (sp > 1.5) continue;
      const t = it.body.translation();
      // only freeze things lying on the floor: an item slowed at the top of its fall, or on a
      // rocking board, would otherwise be left hanging in the air
      if (t.y > Math.max(it.kind.size[0], it.kind.size[1], it.kind.size[2]) * 0.6 + 0.05) continue;
      const d2 = (t.x - camera.position.x) ** 2 + (t.z - camera.position.z) ** 2;
      cand.push([d2 - sp * 400, it]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    const excess = this.awakeCount - this.maxAwake * 0.8;
    for (let i = 0; i < Math.min(excess, cand.length); i++) cand[i][1].body.sleep();
  }


  stats() {
    let alive = 0, fallen = 0;
    for (const it of this.all) {
      if (!it.alive) continue;
      alive++;
      const t = it.body.translation();
      if (!it.spawned && (Math.abs(t.y - it.home.y) > 0.2 || Math.hypot(t.x - it.home.x, t.z - it.home.z) > 0.5)) fallen++;
    }
    return { total: this.all.length, alive, awake: this.awakeCount, fallen };
  }
}
