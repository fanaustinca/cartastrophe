// ShelfSystem: free-standing gondola shelves as heavy dynamic bodies that wobble and tip.
// All shelves of a store share one InstancedMesh; matrices are only rewritten while a shelf is awake.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Physics, G, groups, ALL } from './physics';
import type { StoreDef } from './config';

export const SHELF_LEN = 2.4;
export const SHELF_DEPTH = 1.0;

export interface Shelf {
  index: number;
  body: RAPIER.RigidBody;
  home: THREE.Vector3;
  yaw: number;
  tilt: number; // radians from upright
  moved: boolean; // displaced/tipped enough to matter for navigation
  wasAwake: boolean;
  toppled: boolean; // tipped past the point of no return: the stabilizer lets go
  stock: { body: RAPIER.RigidBody; alive: boolean }[]; // items stocked on it (woken when it moves)
  wokeAt: { x: number; y: number; z: number; tilt: number }; // pose when its stock was last woken
}

/** Beyond this tilt a shelf is going over; below it the (bolted, bottom-heavy) unit rights itself. */
export const TIP_ANGLE = 0.42;

export interface ShelfLayout { boards: number[]; spacing: number; height: number; back: boolean }

export function shelfLayout(s: StoreDef): ShelfLayout {
  const H = s.shelfHeight, n = s.shelfLevels;
  const spacing = (H - 0.14 - 0.06) / n;
  const boards: number[] = [];
  for (let i = 0; i < n; i++) boards.push(0.14 + i * spacing);
  return { boards, spacing, height: H, back: s.shelfStyle !== 'rack' };
}

function colored(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const col = new THREE.Color(c);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);

/** Visual model of one shelf unit, local X = length, Z = depth (two faces at ±Z), Y up from floor. */
export function shelfGeometry(s: StoreDef, lo = false): THREE.BufferGeometry {
  const L = SHELF_LEN, D = SHELF_DEPTH, lay = shelfLayout(s), H = lay.height;
  const c = s.colors.shelf;
  const dark = new THREE.Color(c).multiplyScalar(0.7).getHex();
  const parts: THREE.BufferGeometry[] = [];
  const tagColor = s.shelfStyle === 'tech' ? 0x30a0ff : s.shelfStyle === 'wood' ? 0xf0e0b0 : 0xffe23a;
  // base / kick plate
  parts.push(box(L, 0.14, D, 0, 0.07, 0, s.shelfStyle === 'rack' ? 0x3a3a3a : dark));
  if (s.shelfStyle === 'rack') {
    for (const x of [-L / 2 + 0.04, 0, L / 2 - 0.04]) for (const z of [-D / 2 + 0.04, D / 2 - 0.04]) parts.push(box(0.08, H, 0.08, x, H / 2, z, c));
    for (const y of lay.boards) {
      for (const z of [-D / 2 + 0.03, D / 2 - 0.03]) parts.push(box(L, 0.1, 0.06, 0, y - 0.03, z, 0xf08a1a));
      parts.push(box(L - 0.04, 0.025, D - 0.06, 0, y, 0, 0xb89a6a));
    }
    if (!lo) for (let i = 0; i < 6; i++) parts.push(box(0.03, H * 0.9, 0.03, -L / 2 + 0.2 + i * 0.4, H * 0.5, 0, 0x707070));
  } else {
    // back panel (pegboard look: slightly darker)
    parts.push(box(L, H, 0.04, 0, H / 2, 0, dark));
    // end uprights
    for (const x of [-L / 2 + 0.02, L / 2 - 0.02]) parts.push(box(0.04, H, D, x, H / 2, 0, s.shelfStyle === 'wood' ? dark : c));
    // top cap
    parts.push(box(L, 0.05, D * 0.5, 0, H - 0.025, 0, c));
    for (const y of lay.boards) {
      parts.push(box(L - 0.06, 0.025, D - 0.02, 0, y, 0, s.shelfStyle === 'wood' ? 0xb07a48 : c));
      if (!lo) for (const z of [-1, 1]) parts.push(box(L - 0.08, 0.045, 0.012, 0, y + 0.005, z * (D / 2 - 0.008), tagColor));
    }
    if (s.shelfStyle === 'tech' && !lo) for (const z of [-1, 1]) parts.push(box(0.03, H - 0.2, 0.03, 0, H / 2, z * (D / 2 - 0.02), 0x2080ff));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

function shelfColliders(s: StoreDef): RAPIER.ColliderDesc[] {
  const L = SHELF_LEN, D = SHELF_DEPTH, lay = shelfLayout(s), H = lay.height;
  const out: RAPIER.ColliderDesc[] = [];
  const heavy = s.shelfStyle === 'rack' ? 2.2 : 1;
  out.push(RAPIER.ColliderDesc.cuboid(L / 2, 0.07, D / 2).setTranslation(0, 0.07, 0).setDensity(300 * heavy));
  if (lay.back) out.push(RAPIER.ColliderDesc.cuboid(L / 2, H / 2, 0.02).setTranslation(0, H / 2, 0).setDensity(260 * heavy));
  for (const x of [-L / 2 + 0.02, L / 2 - 0.02]) out.push(RAPIER.ColliderDesc.cuboid(0.02, H / 2, D / 2).setTranslation(x, H / 2, 0).setDensity(180 * heavy));
  for (const y of lay.boards) out.push(RAPIER.ColliderDesc.cuboid(L / 2 - 0.03, 0.0125, D / 2 - 0.01).setTranslation(0, y, 0).setDensity(200 * heavy));
  for (const c of out) c.setFriction(0.85).setRestitution(0.05).setCollisionGroups(groups(G.SHELF, ALL & ~G.SHELF))
    .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(1500);
  return out;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3();

export class ShelfSystem {
  /** Righting spring (rad/s² per rad) and damper. */
  static K = 6;
  static C = 1.5;
  shelves: Shelf[] = [];
  byCollider = new Map<number, Shelf>();
  mesh!: THREE.InstancedMesh;
  meshLo!: THREE.InstancedMesh;
  lodDist = 38;
  private lods: number[] = [];

  constructor(private phys: Physics, private store: StoreDef) {}

  build(placements: { x: number; z: number; yaw: number }[], shadows: boolean) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: this.store.shelfStyle === 'tech' ? 0.4 : 0.7, metalness: this.store.shelfStyle === 'rack' ? 0.3 : 0.1 });
    this.mesh = new THREE.InstancedMesh(shelfGeometry(this.store), mat, placements.length);
    this.meshLo = new THREE.InstancedMesh(shelfGeometry(this.store, true), mat, placements.length);
    for (const m of [this.mesh, this.meshLo]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = shadows; m.receiveShadow = shadows; }
    const cols = shelfColliders(this.store);
    placements.forEach((p, i) => {
      const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      const body = this.phys.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, 0.001, p.z).setRotation(q)
          .setCanSleep(true).setAngularDamping(0.25).setLinearDamping(0.2),
      );
      const sh: Shelf = { index: i, body, home: new THREE.Vector3(p.x, 0, p.z), yaw: p.yaw, tilt: 0, moved: false, wasAwake: true, toppled: false, stock: [], wokeAt: { x: p.x, y: 0.001, z: p.z, tilt: 0 } };
      for (const cd of cols) {
        const c = this.phys.world.createCollider(cd, body);
        this.byCollider.set(c.handle, sh);
      }
      this.shelves.push(sh);
      this.lods.push(-1);
    });
  }

  update(camera: THREE.Camera) {
    let dirty = false;
    for (const sh of this.shelves) {
      const awake = !sh.body.isSleeping();
      const t = sh.body.translation();
      const d2 = (t.x - camera.position.x) ** 2 + (t.z - camera.position.z) ** 2;
      const lod = d2 < this.lodDist * this.lodDist ? 0 : 1;
      if (!awake && !sh.wasAwake && lod === this.lods[sh.index]) continue;
      sh.wasAwake = awake;
      const r = sh.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p.set(t.x, t.y, t.z), _q, _s);
      this.mesh.setMatrixAt(sh.index, lod === 0 ? _m : ZERO);
      this.meshLo.setMatrixAt(sh.index, lod === 1 ? _m : ZERO);
      this.lods[sh.index] = lod;
      _up.set(0, 1, 0).applyQuaternion(_q);
      sh.tilt = Math.acos(Math.min(1, _up.y));
      if (!sh.moved && (sh.tilt > 0.25 || Math.hypot(t.x - sh.home.x, t.z - sh.home.z) > 0.6)) sh.moved = true;
      dirty = true;
    }
    if (dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.meshLo.instanceMatrix.needsUpdate = true; }
  }

  /**
   * Per physics step, before world.step():
   *  - a righting torque (spring + damper) on shelves tilted less than TIP_ANGLE, so normal
   *    bumps make them wobble and settle instead of starting a store-wide collapse;
   *  - wakes the stock of any shelf that has moved, so nothing is left asleep in mid-air
   *    when the boards under it rock or fall away.
   */
  stabilize(dt: number) {
    for (const sh of this.shelves) {
      const b = sh.body;
      if (b.isSleeping()) continue;
      const r = b.rotation(), t = b.translation();
      _q.set(r.x, r.y, r.z, r.w);
      _up.set(0, 1, 0).applyQuaternion(_q);
      const tilt = Math.acos(Math.min(1, _up.y));
      sh.tilt = tilt;
      // wake the stock when the shelf has moved since we last did (not merely because it's
      // awake: a shelf resting at a slight lean would otherwise keep its whole stock awake forever)
      const w0 = sh.wokeAt;
      if (Math.hypot(t.x - w0.x, t.z - w0.z) > 0.015 || Math.abs(t.y - w0.y) > 0.015 || Math.abs(tilt - w0.tilt) > 0.012) {
        w0.x = t.x; w0.y = t.y; w0.z = t.z; w0.tilt = tilt;
        for (const it of sh.stock) if (it.alive && it.body.isSleeping()) it.body.wakeUp();
      }
      if (sh.toppled) continue;
      if (tilt > TIP_ANGLE) { sh.toppled = true; continue; }
      // axis that rotates `up` back toward +Y is up × Y = (-up.z, 0, up.x)
      const ax = -_up.z, az = _up.x, al = Math.hypot(ax, az);
      const w = b.angvel();
      if (tilt < 0.006 && Math.abs(w.x) + Math.abs(w.z) < 0.03) continue; // settled: let it sleep
      const I = b.mass() * (this.store.shelfHeight ** 2) / 3;
      const k = ShelfSystem.K, c = ShelfSystem.C;
      const s0 = al > 1e-6 ? (k * tilt) / al : 0;
      b.applyTorqueImpulse({ x: (ax * s0 - c * w.x) * I * dt, y: 0, z: (az * s0 - c * w.z) * I * dt }, false);
    }
  }

  awakeCount() { let n = 0; for (const s of this.shelves) if (!s.body.isSleeping()) n++; return n; }
}
