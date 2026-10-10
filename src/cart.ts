// Shopping carts: visual model (with LOD + customization) and the arcade-realistic cart physics.
// Physics model: one Rapier body (cart + the shopper pushing it, ~100 kg) with frictionless
// wheel colliders; grip, drive, drift and spin-outs are applied as per-step impulses so the
// surface under each cart (oil, yolk, soda...) changes how it handles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Physics, G, groups, ALL } from './physics';
import { Customization, WHEELS, SKINS, NEONS, WheelDef, KIND_BY_ID } from './config';
import { nameTagTexture } from './textures';
import { itemGeometry, itemMaterial } from './items';
import type { Hazards } from './hazards';

export interface CartInput { throttle: number; steer: number; sprint: boolean; ride: boolean }
export const NO_INPUT: CartInput = { throttle: 0, steer: 0, sprint: false, ride: false };

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
  const t = new THREE.CylinderGeometry(w.radius, w.radius, w.id === 'knobby' ? 0.06 : 0.04, w.id === 'knobby' ? 8 : 14);
  t.rotateZ(Math.PI / 2); t.deleteAttribute('uv');
  parts.push(t);
  const hub = new THREE.CylinderGeometry(w.radius * 0.4, w.radius * 0.4, 0.05, 8); hub.rotateZ(Math.PI / 2); hub.deleteAttribute('uv');
  parts.push(hub);
  return mergeGeometries(parts, false)!;
}

function hsl(t: number) { return new THREE.Color().setHSL(t % 1, 0.9, 0.55); }

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

export class CartModel {
  root = new THREE.Group();
  lod = new THREE.LOD();
  skinMat: THREE.MeshStandardMaterial;
  wheels: THREE.Object3D[] = [];
  casters: THREE.Object3D[] = [];
  neon: THREE.Mesh;
  neonMat: THREE.MeshBasicMaterial;
  neonStrip: THREE.Mesh;
  cargo = new THREE.Group();
  avatar: THREE.Group | null = null;
  hands: THREE.Group | null = null;
  tag: THREE.Sprite | null = null;
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private wheelSpin = 0;
  custom!: Customization;
  wheelDef!: WheelDef;
  private wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });

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
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.5 }));
    grip.position.set(0, 1.0, -0.55); hi.add(grip); lo.add(grip.clone());
    // child seat flap plate
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.16), new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.6 }));
    seat.position.set(0, 0.95, -0.38); hi.add(seat);
    this.lod.addLevel(hi, 0);
    this.lod.addLevel(lo, 22);
    this.root.add(this.lod);

    // wheels: rear fixed, front casters swivel
    for (const [x, z, caster] of [[0.2, 0.36, true], [-0.2, 0.36, true], [0.2, -0.34, false], [-0.2, -0.34, false]] as const) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0, z);
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.05), this.skinMat); fork.position.set(0.03, 0.12, 0); pivot.add(fork);
      const wheel = new THREE.Mesh(undefined, this.wheelMat); wheel.castShadow = true;
      pivot.add(wheel);
      this.root.add(pivot);
      this.wheels.push(wheel);
      if (caster) this.casters.push(pivot);
    }
    _glowTex ??= glowTexture();
    this.neonMat = new THREE.MeshBasicMaterial({ map: _glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xff00ff });
    this.neon = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.9).rotateX(-Math.PI / 2), this.neonMat);
    this.neon.position.y = 0.012; this.neon.renderOrder = 2;
    this.root.add(this.neon);
    this.neonStrip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
    this.neonStrip.position.y = 0.13;
    this.root.add(this.neonStrip);
    this.cargo.position.set(0, 0.47, 0);
    this.root.add(this.cargo);

    this.buildAvatar(opts.avatarColor ?? 0x3070d0);
    if (opts.local) this.buildHands();
    if (opts.name) this.setName(opts.name, opts.avatarColor ?? 0xffffff);
    this.applyCustom(custom);
  }

  applyCustom(c: Customization) {
    this.custom = c;
    const skin = SKINS.find((s) => s.id === c.skin) ?? SKINS[0];
    this.skinMat.color.setHex(skin.color); this.skinMat.metalness = skin.metal; this.skinMat.roughness = skin.rough;
    this.wheelDef = WHEELS.find((w) => w.id === c.wheel) ?? WHEELS[0];
    const wg = wheelGeometry(this.wheelDef);
    for (const w of this.wheels) { (w as THREE.Mesh).geometry = wg; w.position.y = this.wheelDef.radius; }
    this.wheelMat.color.setHex(this.wheelDef.color);
    this.wheelMat.emissive.setHex(this.wheelDef.id === 'hover' ? 0x0a6080 : 0x000000);
    const neon = NEONS.find((n) => n.id === c.neon) ?? NEONS[0];
    this.neon.visible = this.neonStrip.visible = neon.color !== null;
    if (neon.color !== null) { this.neonMat.color.setHex(neon.color); (this.neonStrip.material as THREE.MeshBasicMaterial).color.setHex(neon.color); }
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
    kinds.slice(-10).forEach((id, i) => {
      const k = KIND_BY_ID[id]; if (!k) return;
      const m = new THREE.InstancedMesh(itemGeometry(k, true), itemMaterial(k), 1);
      m.setMatrixAt(0, new THREE.Matrix4());
      m.setColorAt(0, new THREE.Color(k.colors[0]));
      const scale = Math.min(1, 0.32 / Math.max(...k.size));
      m.scale.setScalar(scale);
      m.position.set(((i % 3) - 1) * 0.15, k.size[1] * scale / 2 + Math.floor(i / 6) * 0.12, (Math.floor(i / 3) % 2 - 0.5) * 0.3);
      m.rotation.y = i * 1.3;
      this.cargo.add(m);
    });
  }

  /** speed: forward speed m/s; velYaw: direction of travel relative to cart for caster swivel. */
  animate(dt: number, time: number, speed: number, lateral: number, riding: boolean, boosting: boolean) {
    this.wheelSpin += (speed / Math.max(0.05, this.wheelDef.radius)) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    const sw = Math.atan2(lateral, Math.abs(speed) + 0.3);
    for (const c of this.casters) c.rotation.y += (sw - c.rotation.y) * Math.min(1, dt * 8);
    const skin = SKINS.find((s) => s.id === this.custom.skin);
    if (skin?.rainbow) this.skinMat.color.copy(hsl(time * 0.15));
    const neon = NEONS.find((n) => n.id === this.custom.neon);
    if (neon?.rainbow) { const c = hsl(time * 0.5); this.neonMat.color.copy(c); (this.neonStrip.material as THREE.MeshBasicMaterial).color.copy(c); }
    this.neonMat.opacity = boosting ? 1 : 0.7 + Math.sin(time * 6) * 0.1;
    if (this.avatar) {
      const run = Math.min(1, Math.abs(speed) / 8);
      const ph = time * (6 + run * 8);
      this.legs.forEach((l, i) => { l.rotation.x = riding ? (i ? -0.2 : 0.4) : Math.sin(ph + i * Math.PI) * 0.9 * run; });
      this.avatar.position.y = riding ? 0.32 : Math.abs(Math.sin(ph)) * 0.06 * run;
      this.avatar.position.z = riding ? -0.62 : -0.95;
      this.avatar.rotation.x = riding ? -0.1 : 0.25 * run;
    }
  }

  dispose() {
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry !== _frameHi.g && m.geometry !== _frameLo.g) m.geometry.dispose(); });
  }
}

// ---------------- physics ----------------
const _v = new THREE.Vector3();

export interface CartState { x: number; y: number; z: number; yaw: number; vx: number; vz: number; w: number; riding: boolean; boost: number }

export class Cart {
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[] = [];
  model: CartModel;
  input: CartInput = { ...NO_INPUT };
  stamina = 1;
  boost = 0;
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
  private wheel: WheelDef;

  constructor(private phys: Physics, model: CartModel, pos: THREE.Vector3, yaw: number, kinematic = false) {
    this.model = model;
    this.kinematic = kinematic;
    this.wheel = model.wheelDef;
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    const desc = (kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic().enabledRotations(false, true, false).setCcdEnabled(true))
      .setTranslation(pos.x, pos.y, pos.z).setRotation(q).setLinearDamping(0.05).setAngularDamping(3).setCanSleep(false);
    this.body = phys.world.createRigidBody(desc);
    const member = kinematic ? G.REMOTE : G.CART;
    const mk = (cd: RAPIER.ColliderDesc) => {
      cd.setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.25)
        .setCollisionGroups(groups(member, ALL)).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(2500);
      const c = phys.world.createCollider(cd, this.body);
      this.colliders.push(c);
      phys.onForce(c.handle, (other, f) => this.onImpact?.(f, other));
      return c;
    };
    mk(RAPIER.ColliderDesc.cuboid(0.28, 0.27, 0.46).setTranslation(0, 0.71, 0).setMass(16));
    mk(RAPIER.ColliderDesc.cuboid(0.22, 0.04, 0.38).setTranslation(0, 0.2, 0).setMass(6));
    for (const [x, z] of [[0.2, 0.36], [-0.2, 0.36], [0.2, -0.34], [-0.2, -0.34]]) mk(RAPIER.ColliderDesc.ball(0.08).setTranslation(x, 0.08, z).setMass(2));
    // the shopper: a capsule behind the handle (they collide with shelves too)
    mk(RAPIER.ColliderDesc.capsule(0.5, 0.22).setTranslation(0, 0.9, -0.88).setMass(70));
  }

  get yaw() { const r = this.body.rotation(); return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)); }

  setCustom(c: Customization) { this.model.applyCustom(c); this.wheel = this.model.wheelDef; }

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
    const W = this.wheel;
    const surfGrip = s.grip + (1 - s.grip) * W.slickResist;
    let grip = surfGrip * W.grip * (this.riding ? 0.3 : 1);

    // timers
    this.boost = Math.max(0, this.boost - dt);
    this.spinCooldown = Math.max(0, this.spinCooldown - dt);
    this.padCooldown = Math.max(0, this.padCooldown - dt);

    // boost pads
    const pad = hz.padAt(t.x, t.z);
    if (pad && grounded && (pad !== this.lastPad || this.padCooldown <= 0)) {
      this.boost = pad.kind === 'nitro' ? 2.0 : 1.4;
      this.padCooldown = 1.2;
      b.applyImpulse({ x: fx * m * 4, y: 0, z: fz * m * 4 }, true);
      this.onBoost?.(pad.kind);
    }
    this.lastPad = pad;

    if (grounded) {
      // drive (the shopper's legs need traction too)
      const sprint = inp.sprint && this.stamina > 0.02 && inp.throttle > 0 && !this.riding;
      this.stamina = Math.min(1, Math.max(0, this.stamina + (sprint ? -0.22 : 0.13) * dt));
      const cargoPenalty = 1 - Math.min(0.25, this.cargoMass * 0.006);
      const vmax = (sprint ? 9.4 : 6.6) * W.speed * cargoPenalty * (this.boost > 0 ? 1.65 : 1);
      const footGrip = Math.max(0.12, Math.min(1, surfGrip * 1.2));
      let a = 0;
      if (!this.riding) {
        if (inp.throttle > 0) a = inp.throttle * (sprint ? 9 : 7) * Math.max(0, 1 - vF / vmax);
        else if (inp.throttle < 0) a = vF > 0.4 ? inp.throttle * 10 : inp.throttle * 4 * Math.max(0, 1 + vF / 3.2);
      }
      if (this.boost > 0 && vF < vmax) a += 6;
      a *= footGrip;
      // rolling resistance + sticky surfaces
      const roll = (this.riding ? 0.12 : 0.35) * W.rolling + s.drag;
      a -= vF * roll;
      const dvF = a * dt;
      // lateral grip: remove a fraction of sideways slide each step (drift when low)
      const keep = Math.max(0, 1 - Math.min(1, grip * 13 * dt));
      const dvL = -vL * (1 - keep);
      b.applyImpulse({ x: (fx * dvF + rx * dvL) * m, y: 0, z: (fz * dvF + rz * dvL) * m }, true);
      vF += dvF; vL += dvL;

      // steering: yaw toward the target rate; control authority scales with grip
      const sp = Math.abs(vF);
      let rate = this.riding ? 1.5 : 3.1 - Math.min(1, sp / 9) * 1.2;
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

  state(): CartState {
    const t = this.body.translation(), v = this.body.linvel();
    return { x: t.x, y: t.y, z: t.z, yaw: this.yaw, vx: v.x, vz: v.z, w: this.body.angvel().y, riding: this.riding, boost: this.boost };
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
    this.model.animate(dt, time, this.fwdSpeed, this.latSpeed, this.riding, this.boost > 0);
  }

  speed() { const v = this.body.linvel(); return Math.hypot(v.x, v.z); }

  forward(out = _v) { const y = this.yaw; return out.set(Math.sin(y), 0, Math.cos(y)); }

  destroy() {
    for (const c of this.colliders) this.phys.offForce(c.handle);
    this.phys.world.removeRigidBody(this.body);
    this.model.dispose();
  }
}
