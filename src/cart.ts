// Shopping carts: visual model (with LOD + customization) and the arcade-realistic cart physics.
// Physics model: one Rapier body (cart + the shopper pushing it, ~100 kg) with frictionless
// wheel colliders; grip, drive, drift and spin-outs are applied as per-step impulses so the
// surface under each cart (oil, yolk, soda...) changes how it handles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Physics, G, groups, ALL } from './physics';
import { Customization, WHEELS, SKINS, NEONS, TRIMS, BODIES, WheelDef, BodyDef, SkinDef, NeonDef, KIND_BY_ID, CartStats, cartStats } from './config';
import { nameTagTexture } from './textures';
import { itemGeometry, itemMaterial } from './items';
import type { Hazards } from './hazards';

export interface CartInput { throttle: number; steer: number; sprint: boolean; ride: boolean; nitro: boolean; action: boolean }
export const NO_INPUT: CartInput = { throttle: 0, steer: 0, sprint: false, ride: false, nitro: false, action: false };

export const CART = { halfW: 0.29, halfL: 0.46, mass: 100, handleZ: -0.5 };

// ---------------- visual ----------------
function bar(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 4) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.deleteAttribute('uv');
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q).translate(mid.x, mid.y, mid.z);
  return g;
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Basket corner profile: bottom narrower and lower at the front (nesting carts). */
function basketCorners() {
  const yb = 0.42, yt = 0.98;
  return {
    bfl: V(0.22, yb + 0.05, 0.42), bfr: V(-0.22, yb + 0.05, 0.42), bbl: V(0.25, yb, -0.4), bbr: V(-0.25, yb, -0.4),
    tfl: V(0.27, yt - 0.02, 0.5), tfr: V(-0.27, yt - 0.02, 0.5), tbl: V(0.29, yt, -0.46), tbr: V(-0.29, yt, -0.46),
  };
}

function frameGeometry(hi: boolean): THREE.BufferGeometry {
  const c = basketCorners();
  const parts: THREE.BufferGeometry[] = [];
  const r = 0.009;
  // rim and bottom outline
  const loops = [[c.tfl, c.tfr, c.tbr, c.tbl], [c.bfl, c.bfr, c.bbr, c.bbl]];
  for (const L of loops) for (let i = 0; i < 4; i++) parts.push(bar(L[i], L[(i + 1) % 4], r * 1.4));
  // vertical edges
  for (const [a, b] of [[c.bfl, c.tfl], [c.bfr, c.tfr], [c.bbl, c.tbl], [c.bbr, c.tbr]]) parts.push(bar(a, b, r * 1.4));
  const n = hi ? 9 : 0;
  const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    // side wires (vertical) left and right
    parts.push(bar(lerp(c.bbl, c.bfl, t), lerp(c.tbl, c.tfl, t), r));
    parts.push(bar(lerp(c.bbr, c.bfr, t), lerp(c.tbr, c.tfr, t), r));
    // bottom grid along length
    if (i % 2) parts.push(bar(lerp(c.bfl, c.bfr, t), lerp(c.bbl, c.bbr, t), r));
  }
  if (hi) {
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      parts.push(bar(lerp(c.bfl, c.bfr, t), lerp(c.tfl, c.tfr, t), r)); // front wires
      parts.push(bar(lerp(c.bbl, c.bbr, t), lerp(c.tbl, c.tbr, t), r)); // back flap wires
    }
    for (let j = 1; j <= 3; j++) {
      const t = j / 4; // horizontal side wires
      parts.push(bar(lerp(c.bbl, c.tbl, t), lerp(c.bfl, c.tfl, t), r));
      parts.push(bar(lerp(c.bbr, c.tbr, t), lerp(c.bfr, c.tfr, t), r));
      parts.push(bar(lerp(c.bfl, c.tfl, t), lerp(c.bfr, c.tfr, t), r));
    }
  } else {
    // lo: cheap translucent-looking panels are in a separate mesh; frame only here
  }
  // chassis: two rails from wheels up to basket, lower tray
  for (const x of [0.2, -0.2]) {
    parts.push(bar(V(x, 0.16, 0.38), V(x, 0.16, -0.36), r * 2.2));
    parts.push(bar(V(x, 0.16, -0.36), V(x * 1.2, 0.42, -0.4), r * 2.2));
    parts.push(bar(V(x * 1.2, 0.42, -0.4), V(x * 1.4, 1.0, -0.55), r * 2));
  }
  for (let i = 0; i <= (hi ? 6 : 2); i++) { const z = 0.34 - i * (0.68 / (hi ? 6 : 2)); parts.push(bar(V(0.2, 0.2, z), V(-0.2, 0.2, z), r)); }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

function wheelGeometry(w: WheelDef) {
  const parts: THREE.BufferGeometry[] = [];
  const wide = w.radius > 0.12 ? 0.08 : w.id === 'knobby' ? 0.06 : 0.04;
  const t = new THREE.CylinderGeometry(w.radius, w.radius, wide, w.id === 'knobby' || w.id === 'monster' ? 9 : 14);
  t.rotateZ(Math.PI / 2); t.deleteAttribute('uv');
  parts.push(t);
  const hub = new THREE.CylinderGeometry(w.radius * 0.4, w.radius * 0.4, wide + 0.01, 8); hub.rotateZ(Math.PI / 2); hub.deleteAttribute('uv');
  parts.push(hub);
  return mergeGeometries(parts, false)!;
}

function hsl(t: number, s = 0.9, l = 0.55) { return new THREE.Color().setHSL(((t % 1) + 1) % 1, s, l); }

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let _glowTex: THREE.Texture | null = null;
const _frameHi = { g: null as THREE.BufferGeometry | null }, _frameLo = { g: null as THREE.BufferGeometry | null };

/** Height of one stacked cart in a double / triple / 100-level tower (its rails sit on the rim below). */
export const LEVEL_H = 0.82;
const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; };

/** Front add-ons. Origin = front centre of the basket at floor level, +Z forward. */
function addonModel(id: string): THREE.Group {
  const g = new THREE.Group();
  const metal = std(0x9aa0a8, { metalness: 0.8, roughness: 0.3 });
  switch (id) {
    case 'vacuum': {
      g.add(mesh(new THREE.BoxGeometry(0.56, 0.05, 0.14), std(0x2a2d33), 0, 0.05, 0.14));
      g.add(mesh(new THREE.BoxGeometry(0.54, 0.025, 0.02), std(0xffd020), 0, 0.02, 0.21));
      g.add(mesh(bar(V(0, 0.08, 0.1), V(0, 0.5, 0.02), 0.025, 8), std(0x50565e)));
      g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.26, 14), std(0xd02828, { roughness: 0.35 }), 0, 0.62, 0.06));
      g.add(mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.04, 14), metal, 0, 0.77, 0.06));
      g.userData.spin = mesh(new THREE.BoxGeometry(0.15, 0.012, 0.03), std(0xffffff), 0, 0.795, 0.06); // fan on the lid
      g.add(g.userData.spin);
      break;
    }
    case 'dropper': {
      g.add(mesh(new THREE.BoxGeometry(0.22, 0.28, 0.11), std(0x2a2410, { roughness: 0.4 }), 0, 0.62, 0.07));
      g.add(mesh(new THREE.BoxGeometry(0.225, 0.07, 0.115), std(0xffd020), 0, 0.62, 0.07));
      g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 8), std(0x111111), 0.07, 0.8, 0.07));
      g.add(mesh(bar(V(0.07, 0.82, 0.07), V(0.3, 0.3, -0.2), 0.015, 6), std(0x111111)));
      break;
    }
    case 'tank': {
      const blue = std(0x1a50d0, { metalness: 0.7, roughness: 0.25 }), band = new THREE.MeshBasicMaterial({ color: 0x40f0ff });
      for (const y of [0.52, 0.68]) {
        g.add(mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.44, 14).rotateZ(Math.PI / 2), blue, 0, y, 0.08));
        g.add(mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.04, 14).rotateZ(Math.PI / 2), band, 0.12, y, 0.08));
        g.add(mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.04, 14).rotateZ(Math.PI / 2), band, -0.12, y, 0.08));
        g.add(mesh(new THREE.SphereGeometry(0.065, 10, 8).scale(0.4, 1, 1), metal, 0.23, y, 0.08));
      }
      break;
    }
    case 'magnet': {
      const m = mesh(new THREE.TorusGeometry(0.15, 0.05, 8, 20, Math.PI).rotateX(-Math.PI / 2), std(0xd82020, { roughness: 0.35 }), 0, 0.55, 0.2);
      g.add(m);
      for (const x of [-0.15, 0.15]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.07), metal, x, 0.55, 0.23));
      g.add(mesh(bar(V(0, 0.55, 0.05), V(0, 0.55, -0.02), 0.03, 8), metal));
      break;
    }
    case 'ram': {
      const stripe = std(0xffd020), dark = std(0x18181c);
      for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(0.11, 0.3, 0.05), i % 2 ? dark : stripe, -0.275 + i * 0.11, 0.32, 0.12));
      for (const x of [-0.2, 0, 0.2]) g.add(mesh(new THREE.ConeGeometry(0.045, 0.16, 10).rotateX(Math.PI / 2), metal, x, 0.32, 0.22));
      for (const x of [-0.18, 0.18]) g.add(mesh(bar(V(x, 0.3, 0.1), V(x, 0.3, -0.02), 0.02, 6), metal));
      break;
    }
  }
  return g;
}

function flameMaterial() { return new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }); }

export class CartModel {
  root = new THREE.Group();
  /** The cart itself, scaled by the body (the shopper isn't). */
  chassis = new THREE.Group();
  lod = new THREE.LOD();
  skinMat: THREE.MeshStandardMaterial;
  trimMat = new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.5 });
  wheels: THREE.Mesh[] = [];
  casters: THREE.Object3D[] = [];
  pivots: THREE.Object3D[] = [];
  forks: THREE.Object3D[] = [];
  neon: THREE.Mesh;
  neonMat: THREE.MeshBasicMaterial;
  neonStrip: THREE.Mesh;
  cargo = new THREE.Group();
  avatar: THREE.Group | null = null;
  hands: THREE.Group | null = null;
  tag: THREE.Sprite | null = null;
  addon: THREE.Group | null = null;
  motor: THREE.Group;
  flames: THREE.Mesh[] = [];
  /** First-person eye placement for this body (game camera). */
  eye = { back: 0.98, height: 1.62, rideBack: 0.62, rideHeight: 1.95 };
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private wheelSpin = 0;
  custom!: Customization;
  wheelDef!: WheelDef;
  body!: BodyDef;
  private wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  private levels: THREE.Object3D[] = [];
  private tower: THREE.InstancedMesh | null = null;
  private sway = { x: 0, vx: 0, z: 0, vz: 0, yaw: 0, speed: 0 };
  private lift = 0;
  private ws = 1;
  private avatarScale = 1;
  private skin: SkinDef = SKINS[0];
  private neonDef: NeonDef = NEONS[0];
  private builtKey = '';
  private flameMat = flameMaterial();

  constructor(custom: Customization, opts: { avatarColor?: number; name?: string; local?: boolean; envMap?: THREE.Texture | null }) {
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.3, envMap: opts.envMap ?? null });
    _frameHi.g ??= frameGeometry(true);
    _frameLo.g ??= frameGeometry(false);
    const hi = new THREE.Group(), lo = new THREE.Group();
    const fh = new THREE.Mesh(_frameHi.g, this.skinMat); fh.castShadow = true; hi.add(fh);
    const fl = new THREE.Mesh(_frameLo.g, this.skinMat); lo.add(fl);
    // lo: a see-through panel box so the silhouette still reads as a basket far away
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.92), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.25, depthWrite: false }));
    panel.position.set(0, 0.72, 0.02); lo.add(panel);
    // handle with plastic grip
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8).rotateZ(Math.PI / 2), this.trimMat);
    grip.position.set(0, 1.0, -0.55); hi.add(grip); lo.add(grip.clone());
    // child seat flap plate
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.16), this.trimMat);
    seat.position.set(0, 0.95, -0.38); hi.add(seat);
    this.lod.addLevel(hi, 0);
    this.lod.addLevel(lo, 22);
    this.chassis.add(this.lod);
    this.root.add(this.chassis);

    // wheels: rear fixed, front casters swivel
    for (const [x, z, caster] of [[0.2, 0.36, true], [-0.2, 0.36, true], [0.2, -0.34, false], [-0.2, -0.34, false]] as const) {
      const pivot = new THREE.Group(); pivot.userData.base = [x, z];
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.05), this.skinMat); fork.position.set(0.03, 0.12, 0); pivot.add(fork);
      const wheel = new THREE.Mesh(undefined, this.wheelMat); wheel.castShadow = true;
      pivot.add(wheel);
      this.root.add(pivot);
      this.wheels.push(wheel); this.pivots.push(pivot); this.forks.push(fork);
      if (caster) this.casters.push(pivot);
    }
    _glowTex ??= glowTexture();
    this.neonMat = new THREE.MeshBasicMaterial({ map: _glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xff00ff });
    this.neon = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.9).rotateX(-Math.PI / 2), this.neonMat);
    this.neon.position.y = 0.012; this.neon.renderOrder = 2;
    this.root.add(this.neon);
    this.neonStrip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
    this.neonStrip.position.y = 0.13;
    this.chassis.add(this.neonStrip);
    this.root.add(this.cargo);

    // electric motor on the bottom tray
    this.motor = new THREE.Group();
    this.motor.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.24), std(0x1a2a40, { metalness: 0.6, roughness: 0.3 }), 0, 0.27, -0.05));
    this.motor.add(mesh(new THREE.BoxGeometry(0.31, 0.025, 0.25), new THREE.MeshBasicMaterial({ color: 0x30e0ff }), 0, 0.3, -0.05));
    this.motor.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 10).rotateZ(Math.PI / 2), std(0xc0c4c8, { metalness: 0.9 }), 0.2, 0.27, -0.05));
    this.chassis.add(this.motor);
    // nitro flames out the back
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.22), this.flameMat);
      f.userData.side = s; f.visible = false; f.renderOrder = 3;
      this.flames.push(f); this.root.add(f);
    }

    this.buildAvatar(opts.avatarColor ?? 0x3070d0);
    if (opts.local) this.buildHands();
    if (opts.name) this.setName(opts.name, opts.avatarColor ?? 0xffffff);
    this.applyCustom(custom);
  }

  applyCustom(c: Customization) {
    this.custom = c;
    this.skin = SKINS.find((s) => s.id === c.skin) ?? SKINS[0];
    const skin = this.skin;
    this.skinMat.color.setHex(skin.color); this.skinMat.metalness = skin.metal; this.skinMat.roughness = skin.rough;
    this.skinMat.emissive.setHex(skin.emissive ?? 0);
    const ghost = skin.opacity !== undefined && skin.opacity < 1;
    if (this.skinMat.transparent !== ghost) { this.skinMat.transparent = ghost; this.skinMat.needsUpdate = true; }
    this.skinMat.opacity = skin.opacity ?? 1;
    this.skinMat.depthWrite = !ghost;
    const trim = TRIMS.find((t) => t.id === c.trim) ?? TRIMS[0];
    this.trimMat.color.setHex(trim.color); this.trimMat.metalness = trim.metal ?? 0; this.trimMat.roughness = trim.metal ? 0.25 : 0.5;
    this.wheelDef = WHEELS.find((w) => w.id === c.wheel) ?? WHEELS[0];
    this.wheelMat.color.setHex(this.wheelDef.color);
    this.wheelMat.emissive.setHex(this.wheelDef.glow ?? 0);
    this.neonDef = NEONS.find((n) => n.id === c.neon) ?? NEONS[0];
    const neon = this.neonDef;
    this.neon.visible = this.neonStrip.visible = neon.color !== null;
    if (neon.color !== null) { this.neonMat.color.setHex(neon.color); (this.neonStrip.material as THREE.MeshBasicMaterial).color.setHex(neon.color); }
    this.motor.visible = c.engine === 'electric';
    const key = `${c.body}|${c.wheel}|${c.addon}`;
    if (key !== this.builtKey) { this.builtKey = key; this.build(); }
  }

  /** Lay out everything that depends on the body / wheels / add-on. */
  private build() {
    const b = (this.body = BODIES.find((x) => x.id === this.custom.body) ?? BODIES[0]);
    const W = this.wheelDef;
    const ws = (this.ws = Math.min(b.sx, b.sy, b.sz));
    const lift = (this.lift = (W.radius - 0.07) * ws);
    this.chassis.scale.set(b.sx, b.sy, b.sz);
    this.chassis.position.y = lift;
    const wg = wheelGeometry(W);
    this.pivots.forEach((p, i) => {
      const [x, z] = p.userData.base as [number, number];
      p.position.set(x * b.sx, 0, z * b.sz);
      const w = this.wheels[i];
      w.geometry?.dispose(); w.geometry = wg;
      w.scale.setScalar(ws); w.position.y = W.radius * ws;
      const f = this.forks[i];
      f.scale.set(ws, Math.max(1, (W.radius / 0.07) * 0.8) * ws, ws); f.position.set(0.03 * ws, W.radius * ws + 0.05 * ws, 0);
    });
    this.neon.scale.set(Math.max(0.6, b.sx), 1, Math.max(0.6, b.sz));
    this.cargo.position.set(0, lift + 0.47 * b.sy, 0);
    this.cargo.scale.setScalar(ws);

    // stacked levels (double / triple / 100-storey tower)
    for (const l of this.levels) this.chassis.remove(l);
    this.levels = [];
    if (this.tower) { this.chassis.remove(this.tower); this.tower.dispose(); this.tower = null; }
    for (let i = 1; i < Math.min(b.levels, 4); i++) {
      const g = new THREE.Group();
      g.add(mesh(_frameHi.g!, this.skinMat));
      const grip = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8).rotateZ(Math.PI / 2), this.trimMat, 0, 1.0, -0.55);
      g.add(grip);
      g.position.y = i * LEVEL_H;
      this.levels.push(g); this.chassis.add(g);
    }
    if (b.levels > 4) {
      this.tower = new THREE.InstancedMesh(_frameLo.g!, this.skinMat, b.levels - 4);
      this.tower.frustumCulled = false;
      this.chassis.add(this.tower);
    }
    this.sway.x = this.sway.vx = this.sway.z = this.sway.vz = 0;
    this.layoutLevels();

    // front add-on
    if (this.addon) { this.root.remove(this.addon); this.addon.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); }
    this.addon = this.custom.addon !== 'none' ? addonModel(this.custom.addon) : null;
    if (this.addon) {
      const wide = this.custom.addon === 'vacuum' || this.custom.addon === 'ram';
      this.addon.scale.set(wide ? b.sx : ws, b.sy, ws);
      this.addon.position.set(0, lift, 0.5 * b.sz);
      this.root.add(this.addon);
    }
    this.flames.forEach((f) => f.position.set(f.userData.side * 0.2 * b.sx, lift + 0.2 * b.sy, -0.46 * b.sz));

    // the shopper stays human-sized (a bit bigger for the mega cart) and stands at the handle
    const as = (this.avatarScale = b.sy > 1 ? Math.min(1.45, b.sy * 0.8) : 1);
    const handleY = lift + 1.0 * b.sy, handleZ = -0.55 * b.sz;
    if (this.avatar) { this.avatar.scale.setScalar(as); }
    if (this.hands) this.hands.position.set(0, handleY - 1.0, handleZ + 0.55);
    if (this.tag) this.tag.position.set(0, Math.max(2.25 * as, handleY + 1), handleZ - 0.35);
    this.eye = {
      back: -handleZ + 0.43, height: Math.max(1.62 * as, handleY + 0.45),
      rideBack: -handleZ + 0.07, rideHeight: handleY + 0.95,
    };
  }

  /** Stacked carts bend like a cantilever: offset grows with height², each level tilts with the slope. */
  private layoutLevels() {
    const Hc = 14, s = this.sway;
    const place = (o: THREE.Object3D | null, i: number, m?: THREE.Matrix4) => {
      const h = i * LEVEL_H;
      const ox = (s.x * h * h) / (2 * Hc), oz = (s.z * h * h) / (2 * Hc);
      const rz = -(s.x * h) / Hc, rx = (s.z * h) / Hc;
      if (o) { o.position.set(ox, h, oz); o.rotation.set(rx, 0, rz); }
      if (m) { _e.set(rx, 0, rz); _q2.setFromEuler(_e); m.compose(_p2.set(ox, h, oz), _q2, _one); }
    };
    this.levels.forEach((l, k) => place(l, k + 1));
    if (this.tower) {
      for (let i = 0; i < this.tower.count; i++) { place(null, i + 4, _m2); this.tower.setMatrixAt(i, _m2); }
      this.tower.instanceMatrix.needsUpdate = true;
    }
  }

  /** Local player: hands on the handle in first person, full body in chase cam. */
  setFirstPerson(fp: boolean) {
    if (this.hands) this.hands.visible = fp;
    if (this.avatar) this.avatar.visible = !fp;
  }

  setName(name: string, color: number) {
    if (this.tag) this.root.remove(this.tag);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(name, color), depthTest: true, transparent: true }));
    this.tag.scale.set(1.2, 0.3, 1);
    this.tag.position.set(0, 2.25, -0.9);
    this.root.add(this.tag);
  }

  private buildAvatar(color: number) {
    const a = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b090, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 8), shirt); torso.position.set(0, 1.25, 0); torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin); head.position.set(0, 1.72, 0.02); head.castShadow = true;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.07, 12), shirt); hat.position.set(0, 1.82, 0.02);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.12), shirt); brim.position.set(0, 1.79, 0.15);
    a.add(torso, head, hat, brim);
    for (const s of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(s * 0.09, 0.92, 0);
      const lm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.68, 3, 6), pants); lm.position.y = -0.44; lm.castShadow = true;
      leg.add(lm); a.add(leg); this.legs.push(leg);
      const arm = new THREE.Group(); arm.position.set(s * 0.22, 1.45, 0.02);
      const am = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.5, 3, 6), shirt);
      am.position.set(0, -0.12, 0.25); am.rotation.x = Math.PI / 2.6; arm.add(am); a.add(arm); this.arms.push(arm);
    }
    a.position.set(0, 0, -0.95);
    this.avatar = a;
    this.root.add(a);
  }

  private buildHands() {
    const h = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b090, roughness: 0.75 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2a6ad0, roughness: 0.8 });
    for (const s of [-1, 1]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.8, 1.3), skin);
      hand.position.set(s * 0.17, 1.0, -0.56);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.35, 3, 8), sleeve);
      fore.position.set(s * 0.2, 1.08, -0.78); fore.rotation.x = Math.PI / 2.3; fore.rotation.z = -s * 0.15;
      h.add(hand, fore);
    }
    this.hands = h;
    this.root.add(h);
  }

  setCargo(kinds: string[]) {
    this.cargo.clear();
    const b = this.body, kx = Math.min(2, b.sx / this.ws), kz = Math.min(2, b.sz / this.ws);
    kinds.slice(-10).forEach((id, i) => {
      const k = KIND_BY_ID[id]; if (!k) return;
      const m = new THREE.InstancedMesh(itemGeometry(k, true), itemMaterial(k), 1);
      m.setMatrixAt(0, new THREE.Matrix4());
      m.setColorAt(0, new THREE.Color(k.colors[0]));
      const scale = Math.min(1, 0.32 / Math.max(...k.size));
      m.scale.setScalar(scale);
      m.position.set(((i % 3) - 1) * 0.15 * kx, k.size[1] * scale / 2 + Math.floor(i / 6) * 0.12, (Math.floor(i / 3) % 2 - 0.5) * 0.3 * kz);
      m.rotation.y = i * 1.3;
      this.cargo.add(m);
    });
  }

  /** speed: forward speed m/s; lateral: sideways slide (caster swivel); boosting shows the flames. */
  animate(dt: number, time: number, speed: number, lateral: number, riding: boolean, boosting: boolean) {
    this.wheelSpin += (speed / Math.max(0.03, this.wheelDef.radius * this.ws)) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    const sw = Math.atan2(lateral, Math.abs(speed) + 0.3);
    for (const c of this.casters) c.rotation.y += (sw - c.rotation.y) * Math.min(1, dt * 8);
    const skin = this.skin;
    switch (skin.anim) {
      case 'rainbow': this.skinMat.color.copy(hsl(time * 0.15)); break;
      case 'police': { const on = Math.floor(time * 4) % 2 === 0; this.skinMat.color.setHex(on ? 0xff1a1a : 0x1a3aff); this.skinMat.emissive.setHex(on ? 0x600000 : 0x000a60); break; }
      case 'lava': { const k = 0.5 + 0.5 * Math.sin(time * 2.2); this.skinMat.color.copy(hsl(0.02 + k * 0.06, 1, 0.5)); this.skinMat.emissive.copy(hsl(0.02, 1, 0.12 + k * 0.18)); break; }
      case 'galaxy': this.skinMat.color.copy(hsl(0.62 + Math.sin(time * 0.7) * 0.12, 0.8, 0.45)); this.skinMat.emissive.copy(hsl(0.75 + Math.sin(time * 1.3) * 0.08, 0.9, 0.12)); break;
      case 'pulse': this.skinMat.emissiveIntensity = 0.6 + 0.6 * Math.sin(time * 4); break;
    }
    const neon = this.neonDef;
    if (neon.rainbow || neon.police) {
      const c = neon.rainbow ? hsl(time * 0.5) : new THREE.Color(Math.floor(time * 5) % 2 ? 0xff1010 : 0x1040ff);
      this.neonMat.color.copy(c); (this.neonStrip.material as THREE.MeshBasicMaterial).color.copy(c);
    }
    this.neonMat.opacity = boosting ? 1 : 0.7 + Math.sin(time * 6) * 0.1;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) { const k = 0.8 + Math.random() * 0.5; f.scale.set(this.ws, this.ws, k * this.ws); }
    }
    if (boosting) this.flameMat.color.copy(hsl(0.06 + Math.random() * 0.05, 1, 0.55));
    const spin = this.addon?.userData.spin as THREE.Object3D | undefined;
    if (spin) spin.rotation.y += dt * 25;

    // stacked carts sway with cornering (centripetal) and braking/accelerating
    if (this.body.levels > 1 && dt > 0) {
      const s = this.sway;
      let dyaw = this.root.rotation.y - s.yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      s.yaw = this.root.rotation.y;
      const aLat = Math.max(-25, Math.min(25, speed * (dyaw / dt))), aLong = Math.max(-25, Math.min(25, (speed - s.speed) / dt));
      s.speed = speed;
      const k = 7, c = 1.4, gain = 0.0016;
      s.vx += (-k * s.x - c * s.vx + aLat * gain * k) * dt; s.x += s.vx * dt;
      s.vz += (-k * s.z - c * s.vz - aLong * gain * k) * dt; s.z += s.vz * dt;
      s.x = Math.max(-0.08, Math.min(0.08, s.x)); s.z = Math.max(-0.08, Math.min(0.08, s.z));
      this.layoutLevels();
    }
    if (this.avatar) {
      const run = Math.min(1, Math.abs(speed) / 8);
      const ph = time * (6 + run * 8);
      const as = this.avatarScale, b = this.body;
      this.legs.forEach((l, i) => { l.rotation.x = riding ? (i ? -0.2 : 0.4) : Math.sin(ph + i * Math.PI) * 0.9 * run; });
      this.avatar.position.y = riding ? this.lift + 0.32 * b.sy : Math.abs(Math.sin(ph)) * 0.06 * run;
      this.avatar.position.z = riding ? -0.62 * b.sz : -(0.49 * b.sz + 0.46 * as);
      this.avatar.rotation.x = riding ? -0.1 : 0.25 * run;
    }
  }

  dispose() {
    this.tower?.dispose();
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry !== _frameHi.g && m.geometry !== _frameLo.g) m.geometry.dispose(); });
  }
}
const _e = new THREE.Euler(), _q2 = new THREE.Quaternion(), _p2 = new THREE.Vector3(), _m2 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);

// ---------------- physics ----------------
const _v = new THREE.Vector3();

export interface CartState { x: number; y: number; z: number; yaw: number; vx: number; vz: number; w: number; riding: boolean; boost: number }

export class Cart {
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[] = [];
  model: CartModel;
  input: CartInput = { ...NO_INPUT };
  stats: CartStats;
  stamina = 1;
  boost = 0;
  /** Nitro fuel in seconds of burn; E fires it. */
  nitro = 0;
  nitroOn = false;
  /** Oil Dropper charges (Q). */
  charges = 0;
  private chargeT = 0;
  private actionHeld = false;
  spinCooldown = 0;
  padCooldown = 0;
  lastPad: unknown = null;
  surface = { grip: 1, drag: 0, spin: 0, type: '' as string };
  cargoMass = 0;
  fwdSpeed = 0;
  latSpeed = 0;
  riding = false;
  /** Speed at the start of the last step, i.e. before any impact in that step. */
  preSpeed = 0;
  preVx = 0;
  preVz = 0;
  kinematic: boolean;
  onImpact: ((force: number, other: number) => void) | null = null;
  onNitro: (() => void) | null = null;
  onDrop: ((x: number, z: number) => void) | null = null;
  private wheel: WheelDef;

  constructor(private phys: Physics, model: CartModel, pos: THREE.Vector3, yaw: number, kinematic = false) {
    this.model = model;
    this.kinematic = kinematic;
    this.wheel = model.wheelDef;
    this.stats = cartStats(model.custom);
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    const desc = (kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic().enabledRotations(false, true, false).setCcdEnabled(true))
      .setTranslation(pos.x, pos.y, pos.z).setRotation(q).setLinearDamping(0.05).setAngularDamping(3).setCanSleep(false);
    this.body = phys.world.createRigidBody(desc);
    this.buildColliders();
    this.nitro = this.stats.nitroCap;
    this.charges = 4;
  }

  /** Colliders follow the body: scaled basket(s), tray, wheels sized to the tyres, and the shopper. */
  private buildColliders() {
    const phys = this.phys;
    for (const c of this.colliders) { phys.offForce(c.handle); phys.world.removeCollider(c, false); }
    this.colliders = [];
    const member = this.kinematic ? G.REMOTE : G.CART;
    const mk = (cd: RAPIER.ColliderDesc) => {
      cd.setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.25)
        .setCollisionGroups(groups(member, ALL)).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(2500);
      const c = phys.world.createCollider(cd, this.body);
      this.colliders.push(c);
      phys.onForce(c.handle, (other, f) => this.onImpact?.(f, other));
      return c;
    };
    const B = this.stats.body, W = this.stats.wheel, mm = this.stats.mass;
    const ws = Math.min(B.sx, B.sy, B.sz), wr = Math.max(0.035, W.radius * ws), lift = (W.radius - 0.07) * ws;
    // tall stacks get colliders for the first few storeys (they'll clip high shelves); the rest is scenery
    for (let i = 0; i < Math.min(B.levels, 5); i++) mk(RAPIER.ColliderDesc.cuboid(0.28 * B.sx, 0.27 * B.sy, 0.46 * B.sz).setTranslation(0, lift + (0.71 + i * LEVEL_H) * B.sy, 0).setMass((i ? 6 : 16) * mm));
    mk(RAPIER.ColliderDesc.cuboid(0.22 * B.sx, 0.04 * B.sy, 0.38 * B.sz).setTranslation(0, lift + 0.2 * B.sy, 0).setMass(6 * mm));
    for (const [x, z] of [[0.2, 0.36], [-0.2, 0.36], [0.2, -0.34], [-0.2, -0.34]]) mk(RAPIER.ColliderDesc.ball(wr).setTranslation(x * B.sx, wr, z * B.sz).setMass(2 * mm));
    if (this.stats.addon !== 'none') mk(RAPIER.ColliderDesc.cuboid(0.3 * (this.stats.addon === 'vacuum' || this.stats.addon === 'ram' ? B.sx : ws), 0.2 * B.sy, 0.1 * ws).setTranslation(0, lift + 0.4 * B.sy, 0.5 * B.sz + 0.1 * ws).setMass(3 * mm));
    // the shopper: a capsule behind the handle (they collide with shelves too)
    mk(RAPIER.ColliderDesc.capsule(0.5, 0.22).setTranslation(0, 0.9, -(0.46 * B.sz + 0.42)).setMass(70 * mm));
  }

  get yaw() { const r = this.body.rotation(); return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)); }

  setCustom(c: Customization) {
    this.model.applyCustom(c); this.wheel = this.model.wheelDef;
    this.stats = cartStats(c);
    this.buildColliders();
    this.nitro = Math.min(this.nitro, this.stats.nitroCap);
  }

  setCargoMass(kg: number) {
    this.cargoMass = kg;
    if (!this.kinematic) this.body.setAdditionalMass(kg, true);
  }

  /** One fixed physics step of driver control. */
  control(dt: number, hz: Hazards) {
    if (this.kinematic) return;
    const b = this.body;
    const t = b.translation();
    const v = b.linvel();
    const yaw = this.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -fz, rz = fx; // driver's right
    this.preSpeed = Math.hypot(v.x, v.z); this.preVx = v.x; this.preVz = v.z;
    let vF = v.x * fx + v.z * fz;
    let vL = v.x * rx + v.z * rz;
    const grounded = t.y < 0.25;
    const inp = this.input;
    const m = b.mass();
    this.riding = inp.ride && grounded;

    const s = hz.surfaceAt(t.x, t.z, this.surface as never);
    const W = this.wheel, S = this.stats;
    const surfGrip = s.grip + (1 - s.grip) * W.slickResist;
    let grip = surfGrip * W.grip * (this.riding ? 0.3 : 1);

    // timers
    this.boost = Math.max(0, this.boost - dt);
    this.spinCooldown = Math.max(0, this.spinCooldown - dt);
    this.padCooldown = Math.max(0, this.padCooldown - dt);

    // nitro: hold E to burn the tank; it trickles back on its own and pads top it up
    const firing = inp.nitro && this.nitro > 0.02 && grounded;
    if (firing && !this.nitroOn) this.onNitro?.();
    this.nitroOn = firing;
    this.nitro = firing ? Math.max(0, this.nitro - dt) : Math.min(S.nitroCap, this.nitro + S.nitroRegen * dt);
    // add-on button (Q): the oil dropper dumps a slick behind the shopper
    if (S.addon === 'dropper') {
      if (this.charges < 4) { this.chargeT += dt; if (this.chargeT > 9) { this.chargeT = 0; this.charges++; } }
      if (inp.action && !this.actionHeld && this.charges >= 1) {
        this.charges--;
        const back = 0.46 * S.body.sz + 1.6;
        this.onDrop?.(t.x - Math.sin(yaw) * back, t.z - Math.cos(yaw) * back);
      }
    }
    this.actionHeld = inp.action;

    // boost pads
    const pad = hz.padAt(t.x, t.z);
    if (pad && grounded && (pad !== this.lastPad || this.padCooldown <= 0)) {
      this.boost = pad.kind === 'nitro' ? 2.0 : 1.4;
      this.nitro = Math.min(S.nitroCap, this.nitro + (pad.kind === 'nitro' ? S.nitroCap : 0.8));
      this.padCooldown = 1.2;
      b.applyImpulse({ x: fx * m * 4, y: 0, z: fz * m * 4 }, true);
      this.onBoost?.(pad.kind);
    }
    this.lastPad = pad;

    if (grounded) {
      // drive (the shopper's legs need traction too)
      const sprint = inp.sprint && this.stamina > 0.02 && inp.throttle > 0 && !this.riding;
      this.stamina = Math.min(1, Math.max(0, this.stamina + (sprint ? -0.22 : 0.13) * dt));
      const cargoPenalty = 1 - Math.min(0.25, this.cargoMass * 0.006 * S.cargo);
      const kick = Math.max(this.boost > 0 ? 1.65 : 1, firing ? S.nitroPower : 1);
      const vmax = (sprint ? 9.4 : 6.6) * S.speed * cargoPenalty * kick;
      const footGrip = Math.max(0.12, Math.min(1, surfGrip * 1.2));
      let a = 0;
      if (!this.riding) {
        if (inp.throttle > 0) a = inp.throttle * (sprint ? 9 : 7) * S.accel * Math.max(0, 1 - vF / vmax);
        else if (inp.throttle < 0) a = vF > 0.4 ? inp.throttle * 10 : inp.throttle * 4 * Math.max(0, 1 + vF / 3.2);
      } else if (S.motor && inp.throttle > 0) a = inp.throttle * 3.4 * S.accel * Math.max(0, 1 - vF / (vmax * 0.95)); // the motor drives you while you ride
      // torque: a shove off the line that doesn't care how full the basket is
      if (S.torque && inp.throttle > 0) a += S.torque * 0.8 * Math.max(0, 1 - vF / 4);
      if ((this.boost > 0 || firing) && vF < vmax) a += firing ? 5.5 + 0.9 * (S.nitroPower - 1.45) / 0.07 : 6;
      a *= footGrip;
      // rolling resistance + sticky surfaces (sticky wheels / motor torque fight the soda)
      const roll = (this.riding ? 0.12 : 0.35) * W.rolling + s.drag * (1 - W.dragResist) * (1 - Math.min(0.6, S.torque * 0.1));
      a -= vF * roll;
      const dvF = a * dt;
      // lateral grip: remove a fraction of sideways slide each step (drift when low)
      const keep = Math.max(0, 1 - Math.min(1, grip * 13 * dt));
      const dvL = -vL * (1 - keep);
      b.applyImpulse({ x: (fx * dvF + rx * dvL) * m, y: 0, z: (fz * dvF + rz * dvL) * m }, true);
      vF += dvF; vL += dvL;

      // steering: yaw toward the target rate; control authority scales with grip
      const sp = Math.abs(vF);
      let rate = (this.riding ? 1.5 : 3.1 - Math.min(1, sp / 9) * 1.2) * S.steer;
      if (vF < -0.3) rate = -rate;
      const target = -inp.steer * rate;
      const w = b.angvel().y;
      const authority = Math.min(1, (this.riding ? 0.45 : 1) * Math.max(0.04, grip) * 10 * dt);
      b.setAngvel({ x: 0, y: w + (target - w) * authority, z: 0 }, true);
      b.setAngularDamping(grip < 0.4 ? 0.25 : 3);

      // spin-out kick when hitting a slick at speed
      if (s.spin > 0 && sp > 3 && this.spinCooldown <= 0 && W.slickResist < 0.5) {
        const dir = vL !== 0 ? Math.sign(vL) : Math.random() < 0.5 ? -1 : 1;
        b.setAngvel({ x: 0, y: w + dir * s.spin * sp * 0.55, z: 0 }, true);
        this.spinCooldown = 1.2;
        this.onSpin?.(s.type);
      }
    }
    this.fwdSpeed = vF; this.latSpeed = vL;
    // keep it from tunnelling below the floor after a huge hit
    if (t.y < -1) { b.setTranslation({ x: t.x, y: 0.3, z: t.z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }
  }
  onBoost: ((kind: string) => void) | null = null;
  onSpin: ((type: string) => void) | null = null;

  /** Kinematic (remote) carts: drive to an interpolated pose. */
  moveTo(x: number, y: number, z: number, yaw: number) {
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setNextKinematicRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw));
  }

  reset(x: number, z: number, yaw: number) {
    this.body.setTranslation({ x, y: 0.05, z }, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Front of the cart (vacuum nozzle / magnet) in world space. */
  nose(out = { x: 0, z: 0 }) {
    const t = this.body.translation(), y = this.yaw, d = 0.5 * this.stats.body.sz + 0.2;
    out.x = t.x + Math.sin(y) * d; out.z = t.z + Math.cos(y) * d;
    return out;
  }

  state(): CartState {
    const t = this.body.translation(), v = this.body.linvel();
    return { x: t.x, y: t.y, z: t.z, yaw: this.yaw, vx: v.x, vz: v.z, w: this.body.angvel().y, riding: this.riding, boost: this.nitroOn ? Math.max(this.boost, 0.1) : this.boost };
  }

  /** Sync the visual model to the body (local/bot carts) — remote carts are posed by the interpolator. */
  syncModel(dt: number, time: number, pose?: { x: number; y: number; z: number; yaw: number; speed: number; lat: number; riding: boolean; boost: boolean }) {
    if (pose) {
      this.model.root.position.set(pose.x, pose.y, pose.z);
      this.model.root.rotation.set(0, pose.yaw, 0);
      this.model.animate(dt, time, pose.speed, pose.lat, pose.riding, pose.boost);
      return;
    }
    const t = this.body.translation();
    this.model.root.position.set(t.x, t.y, t.z);
    this.model.root.rotation.set(0, this.yaw, 0);
    this.model.animate(dt, time, this.fwdSpeed, this.latSpeed, this.riding, this.boost > 0 || this.nitroOn);
  }

  speed() { const v = this.body.linvel(); return Math.hypot(v.x, v.z); }

  forward(out = _v) { const y = this.yaw; return out.set(Math.sin(y), 0, Math.cos(y)); }

  destroy() {
    for (const c of this.colliders) this.phys.offForce(c.handle);
    this.phys.world.removeRigidBody(this.body);
    this.model.dispose();
  }
}
