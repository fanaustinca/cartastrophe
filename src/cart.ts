// Shopping carts: visual model (with LOD + customization) and the arcade-realistic cart physics.
// Physics model: one Rapier body (cart + the shopper pushing it, ~100 kg) with frictionless
// wheel colliders; grip, drive, drift and spin-outs are applied as per-step impulses so the
// surface under each cart (oil, yolk, soda...) changes how it handles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, Physics, G, groups, ALL } from './physics';
import { Customization, WHEELS, SKINS, NEONS, TRIMS, BODIES, WheelDef, BodyDef, SkinDef, NeonDef, KIND_BY_ID, CartStats, cartStats, bodyTail, NEST_PITCH } from './config';
import { nameTagTexture } from './textures';
import { itemGeometry, itemMaterial } from './items';
import type { Hazards } from './hazards';

export interface CartInput { throttle: number; steer: number; sprint: boolean; ride: boolean; nitro: boolean; action: boolean; honk: boolean }
export const NO_INPUT: CartInput = { throttle: 0, steer: 0, sprint: false, ride: false, nitro: false, action: false, honk: false };

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

/** Basket corner profile: bottom narrower and lower at the front (nesting carts). w / l widen / lengthen it. */
function basketCorners(w = 1, l = 1) {
  const yb = 0.42, yt = 0.98;
  return {
    bfl: V(0.22 * w, yb + 0.05, 0.42 * l), bfr: V(-0.22 * w, yb + 0.05, 0.42 * l), bbl: V(0.25 * w, yb, -0.4 * l), bbr: V(-0.25 * w, yb, -0.4 * l),
    tfl: V(0.27 * w, yt - 0.02, 0.5 * l), tfr: V(-0.27 * w, yt - 0.02, 0.5 * l), tbl: V(0.29 * w, yt, -0.46 * l), tbr: V(-0.29 * w, yt, -0.46 * l),
  };
}

/**
 * A wire basket w times as wide and l times as long as a standard one. Built for its size (more wires,
 * same wire thickness and spacing) instead of scaling a standard basket, so a limo or a wide hauler
 * looks made that way rather than stretched.
 */
function frameGeometry(hi: boolean, w = 1, l = 1): THREE.BufferGeometry {
  const c = basketCorners(w, l);
  const parts: THREE.BufferGeometry[] = [];
  const r = 0.009;
  // rim and bottom outline
  const loops = [[c.tfl, c.tfr, c.tbr, c.tbl], [c.bfl, c.bfr, c.bbr, c.bbl]];
  for (const L of loops) for (let i = 0; i < 4; i++) parts.push(bar(L[i], L[(i + 1) % 4], r * 1.4));
  // vertical edges
  for (const [a, b] of [[c.bfl, c.tfl], [c.bfr, c.tfr], [c.bbl, c.tbl], [c.bbr, c.tbr]]) parts.push(bar(a, b, r * 1.4));
  const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
  const nl = hi ? Math.round(9 * l) : 0, nw = Math.round(6 * w);
  for (let i = 1; i <= nl; i++) {
    const t = i / (nl + 1);
    // side wires (vertical) left and right
    parts.push(bar(lerp(c.bbl, c.bfl, t), lerp(c.tbl, c.tfl, t), r));
    parts.push(bar(lerp(c.bbr, c.bfr, t), lerp(c.tbr, c.tfr, t), r));
  }
  if (hi) {
    // bottom grid along the length
    const nb = Math.round(4 * w);
    for (let i = 1; i <= nb; i++) { const t = i / (nb + 1); parts.push(bar(lerp(c.bfl, c.bfr, t), lerp(c.bbl, c.bbr, t), r)); }
    for (let i = 1; i <= nw; i++) {
      const t = i / (nw + 1);
      parts.push(bar(lerp(c.bfl, c.bfr, t), lerp(c.tfl, c.tfr, t), r)); // front wires
      parts.push(bar(lerp(c.bbl, c.bbr, t), lerp(c.tbl, c.tbr, t), r)); // back flap wires
    }
    for (let j = 1; j <= 3; j++) {
      const t = j / 4; // horizontal side wires
      parts.push(bar(lerp(c.bbl, c.tbl, t), lerp(c.bfl, c.tfl, t), r));
      parts.push(bar(lerp(c.bbr, c.tbr, t), lerp(c.bfr, c.tfr, t), r));
      parts.push(bar(lerp(c.bfl, c.tfl, t), lerp(c.bfr, c.tfr, t), r));
    }
    if (w > 1.6) {
      // wide baskets get a divider down the middle (two carts' worth of basket, one cart's worth of decisions)
      const f0 = lerp(c.bfl, c.bfr, 0.5), b0 = lerp(c.bbl, c.bbr, 0.5), f1 = lerp(c.tfl, c.tfr, 0.5), b1 = lerp(c.tbl, c.tbr, 0.5);
      parts.push(bar(f1, b1, r * 1.4), bar(f0, f1, r * 1.4), bar(b0, b1, r * 1.4));
      for (let i = 1; i <= Math.round(5 * l); i++) { const t = i / (Math.round(5 * l) + 1); parts.push(bar(lerp(b0, f0, t), lerp(b1, f1, t), r)); }
    }
  }
  // chassis: rails from wheels up to basket, lower tray
  const rails = w > 1.6 ? [0.2 * w, 0, -0.2 * w] : [0.2 * w, -0.2 * w];
  for (const x of rails) {
    parts.push(bar(V(x, 0.16, 0.38 * l), V(x, 0.16, -0.36 * l), r * 2.2));
    if (!x) continue;
    const ux = Math.sign(x) * (Math.abs(x) + 0.04);
    parts.push(bar(V(x, 0.16, -0.36 * l), V(ux * 1.0, 0.42, -0.4 * l), r * 2.2));
    parts.push(bar(V(ux, 0.42, -0.4 * l), V(Math.sign(x) * (Math.abs(x) + 0.08), 1.0, -0.4 * l - 0.15), r * 2));
  }
  if (l > 1.5) for (const x of [0.2 * w, -0.2 * w]) parts.push(bar(V(x, 0.16, 0), V(x * 1.15, 0.43, 0), r * 2)); // middle struts for the long ones
  const nt = hi ? Math.round(6 * l) : 2;
  for (let i = 0; i <= nt; i++) { const z = (0.34 - i * (0.68 / nt)) * l; parts.push(bar(V(0.2 * w, 0.2, z), V(-0.2 * w, 0.2, z), r)); }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}
/** Shared geometry (cached, never disposed by a cart). */
const SHARED = new WeakSet<THREE.BufferGeometry>();
const _geo = new Map<string, THREE.BufferGeometry>();
function shared(key: string, make: () => THREE.BufferGeometry) {
  let g = _geo.get(key);
  if (!g) { g = make(); _geo.set(key, g); SHARED.add(g); }
  return g;
}
const frameGeo = (hi: boolean, w = 1, l = 1) => shared(`frame|${hi}|${w.toFixed(2)}|${l.toFixed(2)}`, () => frameGeometry(hi, w, l));
const gripGeo = (w = 1) => shared(`grip|${w.toFixed(2)}`, () => new THREE.CylinderGeometry(0.02, 0.02, 0.4 * w + 0.22, 8).rotateZ(Math.PI / 2));
/** Where the handle sits on a basket l times as long (chassis units). */
const handleZ = (l = 1) => -(0.4 * l + 0.15);

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

/** Height of one stacked cart in a double / triple / 100-level tower (its rails sit on the rim below). */
export const LEVEL_H = 0.82;
const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; };

const _forkGeo = new THREE.BoxGeometry(0.012, 0.12, 0.05);
const _ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5).rotateX(Math.PI / 2);
const _ropeMat = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.9 });
SHARED.add(_forkGeo); SHARED.add(_ropeGeo);
/** The Choo-Choo's towed carts: first nose this far behind the leader's centre, then every `pitch` (m). */
export const TRAIN = { lead: 1.45, len: 0.92, pitch: 1.22 };

/** Wheel positions (root space, before the add-on) and which ones are swivelling casters. */
export function wheelLayout(b: BodyDef): [number, number, boolean][] {
  const h = bodyTail(b) / 2, X = 0.2 * b.sx, F = 0.36 * b.sz + h, R = -0.34 * b.sz - h;
  const L: [number, number, boolean][] = [[X, F, true], [-X, F, true], [X, R, false], [-X, R, false]];
  if (b.sx / b.sy > 1.6) L.push([0, F, true], [0, R, false]); // the wide hauler gets a middle pair
  if (b.sz / b.sy > 1.6) L.push([X, (F + R) / 2, false], [-X, (F + R) / 2, false]); // and the limo a third axle
  return L;
}

const _signs = new Map<string, THREE.CanvasTexture>();
/** A little printed sign (cached). */
function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const key = text + bg + fg;
  let t = _signs.get(key);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(4, 4, 248, 56);
  g.fillStyle = fg; g.font = '900 34px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34, 232);
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  _signs.set(key, t);
  return t;
}
const signMesh = (text: string, bg: string, fg: string, w: number, h: number) =>
  new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg), side: THREE.DoubleSide }));

type Fx = { stack: THREE.Object3D | null; exhaust: THREE.Object3D | null; beacon: THREE.Object3D | null; rocket: THREE.Mesh | null };

/** Details that make each body its own thing (chassis space: a w-wide, l-long basket). */
function bodyDeco(b: BodyDef, w: number, l: number, g: THREE.Group, trim: THREE.Material, fx: Fx) {
  const gold = std(0xffc830, { metalness: 1, roughness: 0.22 }), black = std(0x18181c), amber = new THREE.MeshBasicMaterial({ color: 0xffa020 });
  const hz = handleZ(l);
  if (b.id === 'mini') {
    // a kid-cart safety flag on a whippy pole
    g.add(mesh(bar(V(0.28, 0.98, hz + 0.1), V(0.3, 2.5, hz + 0.05), 0.012, 5), std(0xf0f0f0)));
    const flag = mesh(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, -0.3, 0), V(0, -0.15, 0.42)]), new THREE.MeshBasicMaterial({ color: 0xff6010, side: THREE.DoubleSide }), 0.3, 2.5, hz + 0.05);
    flag.geometry.computeVertexNormals(); g.add(flag);
  }
  if (w > 1.6) {
    const s = signMesh('WIDE LOAD', '#ffd21a', '#111', 0.85, 0.2); s.position.set(0, 0.62, -0.47 * l); g.add(s);
    for (const x of [-1, 1]) for (const z of [0.5 * l, -0.46 * l]) g.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), amber, x * 0.29 * w, 1.0, z));
  }
  if (l > 1.6) {
    // stretch limo: gold pinstripe, hood ornament, and two little flags up front
    const c = basketCorners(w, l);
    for (const sd of [1, -1]) g.add(mesh(bar(V(sd * 0.275 * w, 0.83, 0.47 * l), V(sd * 0.288 * w, 0.83, -0.44 * l), 0.012, 6), gold));
    g.add(mesh(new THREE.ConeGeometry(0.03, 0.12, 8), gold, 0, 1.02, c.tfl.z));
    g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), gold, 0, 1.1, c.tfl.z));
    for (const sd of [1, -1]) {
      g.add(mesh(bar(V(sd * 0.27 * w, 0.96, c.tfl.z), V(sd * 0.27 * w, 1.3, c.tfl.z), 0.006, 4), gold));
      g.add(mesh(new THREE.PlaneGeometry(0.14, 0.09).translate(-0.07, 0, 0), new THREE.MeshBasicMaterial({ color: sd > 0 ? 0xd02020 : 0x2040c0, side: THREE.DoubleSide }), sd * 0.27 * w, 1.25, c.tfl.z));
    }
  }
  if (b.id === 'giant') {
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.1, 0.08), black, 0, 0.26, 0.52));
    const s = signMesh('MEGA', '#ffd21a', '#111', 0.4, 0.12); s.position.set(0, 0.6, -0.47); g.add(s);
  }
  if (b.nest) {
    // a flashing beacon on the lead cart so oncoming traffic has a chance
    const bc = new THREE.Group(); bc.position.set(0, 0.99, 0.2);
    bc.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 12), black));
    bc.add(mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff7000, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 }), 0, 0.015));
    const beam = mesh(new THREE.PlaneGeometry(0.5, 0.05).translate(0.25, 0, 0), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0, 0.04);
    beam.castShadow = false; bc.add(beam);
    g.add(bc); fx.beacon = bc;
  }
  if (b.train) {
    // the locomotive: smokestack, cowcatcher, headlamp, bell
    const red = std(0xc81e1e, { roughness: 0.45 });
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.34, 12), black, 0, 1.12, 0.32));
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.12, 12, 1, true), black, 0, 1.34, 0.32));
    const top = new THREE.Object3D(); top.position.set(0, 1.42, 0.32); g.add(top); fx.stack = top;
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.42, 0.03), black, 0, 0.93, 0.46)); // stack bracket
    for (let i = 0; i <= 6; i++) { const x = (-0.5 + i / 6) * 0.5; g.add(mesh(bar(V(x * 0.15, 0.06, 0.78), V(x, 0.36, 0.53), 0.012, 4), red)); }
    g.add(mesh(bar(V(-0.26, 0.36, 0.53), V(0.26, 0.36, 0.53), 0.016, 5), red));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 14).rotateX(Math.PI / 2), black, 0, 0.82, 0.54));
    g.add(mesh(new THREE.CircleGeometry(0.052, 14), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }), 0, 0.82, 0.578));
    g.add(mesh(new THREE.ConeGeometry(0.045, 0.07, 12, 1, true), gold, 0.2, 1.06, 0.2));
    g.add(mesh(bar(V(0.2, 0.98, 0.2), V(0.2, 1.1, 0.2), 0.006, 4), black));
  }
  void trim;
}

/** Engines live on the bottom tray (chassis space). */
function engineModel(id: string, g: THREE.Group, fx: Fx) {
  const metal = std(0xc0c4c8, { metalness: 0.9, roughness: 0.3 });
  switch (id) {
    case 'electric':
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.24), std(0x1a2a40, { metalness: 0.6, roughness: 0.3 }), 0, 0.27, -0.05));
      g.add(mesh(new THREE.BoxGeometry(0.31, 0.025, 0.25), new THREE.MeshBasicMaterial({ color: 0x30e0ff }), 0, 0.3, -0.05));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 10).rotateZ(Math.PI / 2), metal, 0.2, 0.27, -0.05));
      break;
    case 'gas': {
      // a lawnmower engine: red block, black shroud, pull cord, rusty exhaust
      g.add(mesh(new THREE.BoxGeometry(0.24, 0.14, 0.2), std(0xc8261e, { roughness: 0.5 }), 0, 0.29, -0.05));
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), std(0x1c1c1c), 0, 0.39, -0.05));
      g.add(mesh(new THREE.BoxGeometry(0.07, 0.03, 0.025), std(0x111111), -0.16, 0.36, -0.05));
      g.add(mesh(bar(V(-0.12, 0.36, -0.05), V(-0.16, 0.36, -0.05), 0.004, 4), std(0x222222)));
      g.add(mesh(bar(V(0.1, 0.3, -0.12), V(0.13, 0.3, -0.4), 0.022, 8), std(0x6a4a30, { metalness: 0.6, roughness: 0.7 })));
      const ex = new THREE.Object3D(); ex.position.set(0.13, 0.3, -0.42); g.add(ex); fx.exhaust = ex;
      break;
    }
    case 'rocket': {
      // an actual rocket, zip-tied to the tray
      const white = std(0xf2f2f2, { roughness: 0.35 }), red = std(0xd82020, { roughness: 0.4 });
      g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 16).rotateX(Math.PI / 2), white, 0, 0.3, -0.12));
      g.add(mesh(new THREE.ConeGeometry(0.09, 0.22, 16).rotateX(Math.PI / 2), red, 0, 0.3, 0.3));
      g.add(mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.05, 16).rotateX(Math.PI / 2), red, 0, 0.3, 0.1));
      for (let i = 0; i < 3; i++) {
        const f = mesh(new THREE.BoxGeometry(0.01, 0.12, 0.16), red, 0, 0.3, -0.38);
        f.geometry.translate(0, 0.1, 0); f.rotation.z = (i / 3) * Math.PI * 2 + Math.PI; g.add(f);
      }
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.1, 14, 1, true).rotateX(Math.PI / 2), std(0x2a2a2e, { metalness: 0.8 }), 0, 0.3, -0.48));
      for (const z of [-0.25, 0.0]) g.add(mesh(new THREE.TorusGeometry(0.093, 0.008, 4, 16), std(0x111111), 0, 0.3, z));
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.5, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.25), new THREE.MeshBasicMaterial({ color: 0xff8a20, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      fl.position.set(0, 0.3, -0.53); fl.renderOrder = 3; g.add(fl); fx.rocket = fl;
      break;
    }
  }
}

/** Smoke puffs (exhaust, smokestack) in world space. */
class Puffs {
  group = new THREE.Group();
  private list: { s: THREE.Sprite; vx: number; vy: number; vz: number; t: number; life: number; size: number }[] = [];
  private next = 0;
  constructor(n = 22) {
    _glowTex ??= glowTexture();
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; this.group.add(s);
      this.list.push({ s, vx: 0, vy: 0, vz: 0, t: 0, life: 1, size: 0.2 });
    }
  }
  emit(p: THREE.Vector3, vx: number, vy: number, vz: number, color: number, size: number, life: number) {
    const q = this.list[this.next++ % this.list.length];
    q.s.position.copy(p); q.vx = vx; q.vy = vy; q.vz = vz; q.t = 0; q.life = life; q.size = size;
    (q.s.material as THREE.SpriteMaterial).color.setHex(color);
    q.s.visible = true;
  }
  update(dt: number) {
    for (const q of this.list) {
      if (!q.s.visible) continue;
      q.t += dt;
      if (q.t >= q.life) { q.s.visible = false; continue; }
      const k = q.t / q.life;
      q.s.position.x += q.vx * dt; q.s.position.y += q.vy * dt; q.s.position.z += q.vz * dt;
      q.vx *= 0.97; q.vz *= 0.97;
      q.s.scale.setScalar(q.size * (1 + k * 2.5));
      (q.s.material as THREE.SpriteMaterial).opacity = 0.75 * (1 - k);
    }
  }
  dispose() { for (const q of this.list) q.s.material.dispose(); this.group.removeFromParent(); }
}

/**
 * The path the Choo-Choo's towed carts follow. Driving forward they ride the exact line the shopper
 * took (so they take corners the way the leader did, never cutting through a shelf end); backing up
 * they get shoved straight back on their tow ropes (and jackknife, like real trailers).
 */
export class Trail {
  cars: { x: number; z: number; yaw: number }[] = [];
  private pts: number[] = [];
  private onPath = true;
  constructor(public n: number) { for (let i = 0; i < n; i++) this.cars.push({ x: 0, z: 0, yaw: 0 }); }

  /** Line the carts up straight behind; with less than `room` metres free back there they pile up nested and unspool as you go. */
  reset(x: number, z: number, yaw: number, room = Infinity) {
    this.pts = [];
    const total = Math.max(0.3, Math.min(TRAIN.lead + this.n * TRAIN.pitch + 2, room));
    for (let d = total; d > 0.05; d -= 0.3) this.pts.push(x - Math.sin(yaw) * d, z - Math.cos(yaw) * d);
    if (!this.pts.length) this.pts.push(x - Math.sin(yaw) * total, z - Math.cos(yaw) * total);
    this.onPath = true;
    this.sample(x, z);
  }

  update(x: number, z: number, yaw: number, reversing: boolean) {
    if (!this.pts.length) { this.reset(x, z, yaw); return; }
    if (reversing) { this.shove(x, z, yaw); return; }
    if (!this.onPath) {
      // rebuild the path from where the carts ended up (tail first)
      this.pts = [];
      for (let i = this.n - 1; i >= 0; i--) {
        const c = this.cars[i], fx = Math.sin(c.yaw) * TRAIN.len / 2, fz = Math.cos(c.yaw) * TRAIN.len / 2;
        if (i === this.n - 1) this.pts.push(c.x - fx * 3, c.z - fz * 3);
        this.pts.push(c.x - fx, c.z - fz, c.x + fx, c.z + fz);
      }
      this.onPath = true;
    }
    const k = this.pts.length;
    if (Math.hypot(x - this.pts[k - 2], z - this.pts[k - 1]) > 0.15) this.pts.push(x, z);
    // forget the path behind the caboose
    const need = TRAIN.lead + this.n * TRAIN.pitch + 1.5;
    let acc = Math.hypot(x - this.pts[this.pts.length - 2], z - this.pts[this.pts.length - 1]);
    for (let i = this.pts.length - 4; i >= 0; i -= 2) {
      acc += Math.hypot(this.pts[i + 2] - this.pts[i], this.pts[i + 3] - this.pts[i + 1]);
      if (acc > need) { if (i > 0) this.pts.splice(0, i); break; }
    }
    this.sample(x, z);
  }

  /** Pose every cart from the path: nose at lead + i·pitch behind the head, tail one cart-length further. */
  private sample(hx: number, hz: number) {
    const P = this.pts;
    let i = P.length - 2, ax = hx, az = hz, bx = P[i], bz = P[i + 1], s0 = 0, seg = Math.hypot(bx - ax, bz - az);
    const at = (d: number, out: number[]) => {
      while (d > s0 + seg && i >= 2) { s0 += seg; ax = bx; az = bz; i -= 2; bx = P[i]; bz = P[i + 1]; seg = Math.hypot(bx - ax, bz - az); }
      const t = seg > 1e-6 ? Math.min(1, (d - s0) / seg) : 0; // past the end of the path the carts pile up
      out[0] = ax + (bx - ax) * t; out[1] = az + (bz - az) * t;
    };
    for (let c = 0; c < this.n; c++) {
      const d = TRAIN.lead + c * TRAIN.pitch;
      at(d, _f); at(d + TRAIN.len, _r);
      const car = this.cars[c];
      car.x = (_f[0] + _r[0]) / 2; car.z = (_f[1] + _r[1]) / 2;
      car.yaw = Math.atan2(_f[0] - _r[0], _f[1] - _r[1]);
    }
  }

  /** Reversing: each cart is pushed by the one in front, swinging about like a trailer. */
  private shove(x: number, z: number, yaw: number) {
    this.onPath = false;
    let hx = x - Math.sin(yaw) * TRAIN.lead, hz = z - Math.cos(yaw) * TRAIN.lead;
    for (const c of this.cars) {
      const dx = hx - c.x, dz = hz - c.z, d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      c.x = hx - ux * TRAIN.len / 2; c.z = hz - uz * TRAIN.len / 2; c.yaw = Math.atan2(ux, uz);
      hx = c.x - ux * (TRAIN.pitch - TRAIN.len / 2); hz = c.z - uz * (TRAIN.pitch - TRAIN.len / 2);
    }
  }
}
const _f = [0, 0], _r = [0, 0];

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

/** Headwear, sat on top of the shopper's head (origin = crown of the head). */
function hatModel(id: string, shirt: THREE.Material, cartMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = mesh(geo, m, x, y, z); g.add(o); return o; };
  const half = (r: number) => new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  switch (id) {
    case 'none': break;
    case 'cone': add(new THREE.ConeGeometry(0.12, 0.36, 16), std(0xff6010), 0, 0.15); add(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 16), std(0xf4f4f4), 0, 0.14); add(new THREE.BoxGeometry(0.3, 0.02, 0.3), std(0xff6010), 0, -0.02); break;
    case 'party': add(new THREE.ConeGeometry(0.085, 0.28, 14), std(0xe030c0), 0, 0.12); add(new THREE.SphereGeometry(0.035, 8, 6), std(0xffe020), 0, 0.27); break;
    case 'chef': add(new THREE.CylinderGeometry(0.12, 0.115, 0.15, 16), std(0xfafafa, { roughness: 0.9 }), 0, 0.05); add(new THREE.SphereGeometry(0.16, 14, 10).scale(1, 0.7, 1), std(0xfafafa, { roughness: 0.9 }), 0, 0.16); break;
    case 'propeller': {
      add(half(0.14), std(0xe02020), 0, -0.04);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), std(0x333333), 0, 0.12);
      const p = new THREE.Group(); p.position.y = 0.16;
      p.add(mesh(new THREE.BoxGeometry(0.3, 0.008, 0.05), std(0x2060ff)), mesh(new THREE.BoxGeometry(0.05, 0.008, 0.3), std(0xffd020)));
      g.add(p); g.userData.spin = p; break;
    }
    case 'cowboy': add(new THREE.CylinderGeometry(0.27, 0.27, 0.015, 24), std(0x7a4a22, { roughness: 0.9 }), 0, 0); add(new THREE.CylinderGeometry(0.11, 0.13, 0.15, 16), std(0x7a4a22, { roughness: 0.9 }), 0, 0.075); add(new THREE.CylinderGeometry(0.131, 0.131, 0.03, 16), std(0x2a1a0a), 0, 0.02); break;
    case 'tinfoil': { const m = std(0xd8dce4, { metalness: 1, roughness: 0.35, flatShading: true }); add(new THREE.ConeGeometry(0.16, 0.26, 7), m, 0, 0.1); add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 7), m, 0, -0.02); break; }
    case 'viking': {
      add(half(0.145), std(0x8a8e96, { metalness: 0.8, roughness: 0.35 }), 0, -0.04);
      for (const s of [-1, 1]) { const h = add(new THREE.ConeGeometry(0.035, 0.18, 10), std(0xf2ead0), s * 0.17, 0.05); h.rotation.z = -s * 0.9; }
      break;
    }
    case 'tophat': add(new THREE.CylinderGeometry(0.11, 0.11, 0.27, 18), std(0x141418, { roughness: 0.4 }), 0, 0.135); add(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 24), std(0x141418), 0, 0); add(new THREE.CylinderGeometry(0.112, 0.112, 0.04, 18), std(0xc02020), 0, 0.04); break;
    case 'fish': {
      const m = std(0x8ab0c8, { metalness: 0.6, roughness: 0.3 });
      add(new THREE.SphereGeometry(0.1, 14, 10).scale(2.2, 0.75, 0.6), m, 0, 0.05);
      const t = add(new THREE.ConeGeometry(0.08, 0.12, 4), m, -0.27, 0.05); t.rotation.z = Math.PI / 2;
      for (const z of [-0.05, 0.05]) add(new THREE.SphereGeometry(0.014, 6, 4), std(0x101010), 0.17, 0.07, z);
      break;
    }
    case 'duck': add(new THREE.SphereGeometry(0.1, 14, 10).scale(1.15, 0.85, 1), std(0xffd420), 0, 0.06); add(new THREE.SphereGeometry(0.065, 12, 8), std(0xffd420), 0, 0.17, 0.06); add(new THREE.ConeGeometry(0.03, 0.08, 8).rotateX(Math.PI / 2), std(0xff7a10), 0, 0.165, 0.14); for (const x of [-0.03, 0.03]) add(new THREE.SphereGeometry(0.011, 6, 4), std(0x101010), x, 0.19, 0.115); break;
    case 'crown': {
      const m = std(0xffc830, { metalness: 1, roughness: 0.2 });
      add(new THREE.CylinderGeometry(0.125, 0.115, 0.08, 16, 1, true), m, 0, 0.03).material = m;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(new THREE.ConeGeometry(0.025, 0.07, 6), m, Math.sin(a) * 0.12, 0.1, Math.cos(a) * 0.12); }
      add(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff1040, emissive: 0x600010 }), 0, 0.04, 0.125);
      break;
    }
    case 'cart': { const c = mesh(frameGeo(false), cartMat); c.scale.setScalar(0.3); c.position.set(0, -0.11, 0); g.add(c); break; }
    default: add(new THREE.CylinderGeometry(0.135, 0.14, 0.07, 12), shirt, 0, -0.02); add(new THREE.BoxGeometry(0.2, 0.015, 0.12), shirt, 0, -0.05, 0.13);
  }
  return g;
}

/** Comic speech bubble with a tail, word-wrapped to at most 3 lines. */
function bubbleTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas'), g = c.getContext('2d')!;
  const font = '800 34px Arial, sans-serif';
  g.font = font;
  const words = text.split(' '), lines: string[] = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > 380 && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur);
  const L = lines.slice(0, 3);
  const w = Math.min(420, Math.max(...L.map((l) => g.measureText(l).width))) + 48, h = L.length * 40 + 34 + 26;
  c.width = Math.ceil(w); c.height = h;
  g.font = font;
  g.fillStyle = '#ffffff'; g.strokeStyle = '#111'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(4, 4, w - 8, h - 30, 22); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(w / 2 - 14, h - 28); g.lineTo(w / 2, h - 4); g.lineTo(w / 2 + 14, h - 28); g.closePath(); g.fill(); g.stroke();
  g.fillRect(w / 2 - 12, h - 34, 24, 8);
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  L.forEach((l, i) => g.fillText(l, w / 2, 24 + i * 40 + 6, w - 30));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
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
  bubble: THREE.Sprite | null = null;
  bubbleText = '';
  private bubbleT = 0;
  private hat: THREE.Group | null = null;
  private hatId = '';
  private shirtMat: THREE.Material | null = null;
  addon: THREE.Group | null = null;
  /** The engine bolted to the bottom tray (lawnmower / electric / rocket). */
  motor = new THREE.Group();
  private engineId = '';
  private fHi: THREE.Mesh; private fLo: THREE.Mesh; private panel: THREE.Mesh; private seat: THREE.Mesh;
  private grips: THREE.Mesh[] = [];
  /** Body-specific details (chassis space): the limo's hood ornament, the train's smokestack... */
  private deco = new THREE.Group();
  /** Nested (Ground-Scraper) or towed (Choo-Choo) carts, in root space. */
  private extra = new THREE.Group();
  private towed: { frames: THREE.InstancedMesh; grips: THREE.InstancedMesh; wheels: THREE.InstancedMesh; ropes: THREE.InstancedMesh } | null = null;
  /** The Choo-Choo's path; set by the physics cart (null in the garage: the train sits straight). */
  trail: Trail | null = null;
  private fx = { stack: null as THREE.Object3D | null, exhaust: null as THREE.Object3D | null, beacon: null as THREE.Object3D | null, rocket: null as THREE.Mesh | null, chuff: 0, puff: 0 };
  private puffs: Puffs | null = null;
  /** Half the extra length of a nested body (m): the front cart sits this far ahead of centre. */
  half = 0;
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
    const hi = new THREE.Group(), lo = new THREE.Group();
    this.fHi = new THREE.Mesh(frameGeo(true), this.skinMat); this.fHi.castShadow = true; hi.add(this.fHi);
    this.fLo = new THREE.Mesh(frameGeo(false), this.skinMat); lo.add(this.fLo);
    // lo: a see-through panel box so the silhouette still reads as a basket far away
    this.panel = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.92), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.25, depthWrite: false }));
    this.panel.position.set(0, 0.72, 0.02); lo.add(this.panel);
    // handle with plastic grip
    for (const g of [hi, lo]) { const grip = new THREE.Mesh(gripGeo(), this.trimMat); grip.position.set(0, 1.0, handleZ()); g.add(grip); this.grips.push(grip); }
    // child seat flap plate
    this.seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.16), this.trimMat);
    this.seat.position.set(0, 0.95, -0.38); hi.add(this.seat);
    this.lod.addLevel(hi, 0);
    this.lod.addLevel(lo, 22);
    this.chassis.add(this.lod, this.deco);
    this.root.add(this.chassis, this.extra);
    _glowTex ??= glowTexture();
    this.neonMat = new THREE.MeshBasicMaterial({ map: _glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xff00ff });
    this.neon = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.9).rotateX(-Math.PI / 2), this.neonMat);
    this.neon.position.y = 0.012; this.neon.renderOrder = 2;
    this.root.add(this.neon);
    this.neonStrip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
    this.neonStrip.position.y = 0.13;
    this.chassis.add(this.neonStrip);
    this.root.add(this.cargo);

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
    if (c.engine !== this.engineId) {
      this.engineId = c.engine;
      this.motor.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.motor.clear();
      this.fx.rocket = this.fx.exhaust = null;
      engineModel(c.engine, this.motor, this.fx);
    }
    if (this.avatar && c.hat !== this.hatId) {
      this.hatId = c.hat;
      if (this.hat) { this.avatar.remove(this.hat); this.hat.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !SHARED.has(m.geometry)) m.geometry.dispose(); }); }
      this.hat = hatModel(c.hat, this.shirtMat!, this.skinMat);
      this.hat.position.set(0, 1.84, 0.02);
      this.avatar.add(this.hat);
    }
    const key = `${c.body}|${c.wheel}|${c.addon}`;
    if (key !== this.builtKey) { this.builtKey = key; this.build(); }
  }

  /** Lay out everything that depends on the body / wheels / add-on. */
  private build() {
    const b = (this.body = BODIES.find((x) => x.id === this.custom.body) ?? BODIES[0]);
    const W = this.wheelDef;
    const ws = (this.ws = Math.min(b.sx, b.sy, b.sz));
    const lift = (this.lift = (W.radius - 0.07) * ws);
    const h = (this.half = bodyTail(b) / 2);
    // the basket is built for its proportions and only scaled uniformly (no stretched wires)
    const u = b.sy, w = b.sx / u, l = b.sz / u;
    this.chassis.scale.setScalar(u);
    this.chassis.position.set(0, lift, h);
    this.fHi.geometry = frameGeo(true, w, l);
    this.fLo.geometry = frameGeo(false, w, l);
    this.panel.geometry.dispose(); this.panel.geometry = new THREE.BoxGeometry(0.54 * w, 0.5, 0.92 * l);
    for (const g of this.grips) { g.geometry = gripGeo(w); g.position.z = handleZ(l); }
    this.seat.position.z = -0.38 * l;

    // wheels: rear fixed, front casters swivel
    for (const p of this.pivots) this.root.remove(p);
    this.wheels = []; this.pivots = []; this.forks = []; this.casters = [];
    const wg = wheelGeometry(W);
    for (const [x, z, caster] of wheelLayout(b)) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, z);
      const fork = new THREE.Mesh(_forkGeo, this.skinMat);
      fork.scale.set(ws, Math.max(1, (W.radius / 0.07) * 0.8) * ws, ws); fork.position.set(0.03 * ws, W.radius * ws + 0.05 * ws, 0);
      const wheel = new THREE.Mesh(wg, this.wheelMat); wheel.castShadow = true;
      wheel.scale.setScalar(ws); wheel.position.y = W.radius * ws;
      pivot.add(fork, wheel);
      this.root.add(pivot);
      this.wheels.push(wheel); this.pivots.push(pivot); this.forks.push(fork);
      if (caster) this.casters.push(pivot);
    }
    this.neon.scale.set(Math.max(0.6, b.sx), 1, Math.max(0.6, b.sz + 2 * h / 0.92));
    this.cargo.position.set(0, lift + 0.47 * b.sy, 0);
    this.cargo.scale.setScalar(ws);

    // stacked levels (double / triple / 100-storey tower)
    for (const lv of this.levels) this.chassis.remove(lv);
    this.levels = [];
    if (this.tower) { this.chassis.remove(this.tower); this.tower.dispose(); this.tower = null; }
    for (let i = 1; i < Math.min(b.levels, 4); i++) {
      const g = new THREE.Group();
      g.add(mesh(frameGeo(true, w, l), this.skinMat));
      g.add(mesh(gripGeo(w), this.trimMat, 0, 1.0, handleZ(l)));
      g.position.y = i * LEVEL_H;
      this.levels.push(g); this.chassis.add(g);
    }
    if (b.levels > 4) {
      this.tower = new THREE.InstancedMesh(frameGeo(false, w, l), this.skinMat, b.levels - 4);
      this.tower.frustumCulled = false;
      this.chassis.add(this.tower);
    }
    this.sway.x = this.sway.vx = this.sway.z = this.sway.vz = 0;
    this.layoutLevels();

    // per-body details, nested / towed carts
    this.deco.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !SHARED.has(m.geometry)) m.geometry.dispose(); });
    this.deco.clear();
    this.fx.stack = this.fx.beacon = null;
    bodyDeco(b, w, l, this.deco, this.trimMat, this.fx);
    this.extra.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose(); if (!SHARED.has(m.geometry) && m.geometry !== wg) m.geometry.dispose(); } });
    this.extra.clear();
    this.towed = null;
    if (b.nest) this.buildNest(b, wg, lift);
    if (b.train) this.buildTrain(b, wg, lift);

    // front add-on
    if (this.addon) { this.root.remove(this.addon); this.addon.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); }
    this.addon = this.custom.addon !== 'none' ? addonModel(this.custom.addon) : null;
    if (this.addon) {
      const wide = this.custom.addon === 'vacuum' || this.custom.addon === 'ram';
      this.addon.scale.set(wide ? b.sx : ws, b.sy, ws);
      this.addon.position.set(0, lift, 0.5 * b.sz + h);
      this.root.add(this.addon);
    }
    this.flames.forEach((f) => f.position.set(f.userData.side * 0.2 * b.sx, lift + 0.2 * b.sy, -0.46 * b.sz - h));

    // the shopper stays human-sized (a bit bigger for the mega cart) and stands at the handle
    const as = (this.avatarScale = b.sy > 1 ? Math.min(1.45, b.sy * 0.8) : 1);
    const handleY = lift + 1.0 * b.sy, hz = handleZ(l) * u - h;
    if (this.avatar) { this.avatar.scale.setScalar(as); }
    if (this.hands) this.hands.position.set(0, handleY - 1.0, hz + 0.55);
    if (this.tag) this.tag.position.set(0, Math.max(2.25 * as, handleY + 1), hz - 0.35);
    this.eye = {
      back: -hz + 0.43, height: Math.max(1.62 * as, handleY + 0.45),
      rideBack: -hz + 0.07, rideHeight: handleY + 0.95,
    };
  }

  /** Ground-Scraper: 99 more carts nested behind the front one, each with its own handle and four wheels. */
  private buildNest(b: BodyDef, wg: THREE.BufferGeometry, lift: number) {
    const n = (b.nest ?? 1) - 1, W = this.wheelDef, h = this.half;
    const frames = new THREE.InstancedMesh(frameGeo(true), this.skinMat, n);
    const grips = new THREE.InstancedMesh(gripGeo(), this.trimMat, n);
    const wheels = new THREE.InstancedMesh(wg, this.wheelMat, n * 4);
    for (let k = 0; k < n; k++) {
      const z = h - (k + 1) * NEST_PITCH;
      frames.setMatrixAt(k, _m2.makeTranslation(0, lift, z));
      grips.setMatrixAt(k, _m2.makeTranslation(0, lift + 1.0, z + handleZ()));
      [[0.2, 0.36], [-0.2, 0.36], [0.2, -0.34], [-0.2, -0.34]].forEach(([x, wz], j) => wheels.setMatrixAt(k * 4 + j, _m2.makeTranslation(x, W.radius, z + wz)));
    }
    for (const m of [frames, grips, wheels]) { m.frustumCulled = false; m.castShadow = true; this.extra.add(m); }
    // OVERSIZE LOAD banner across the back
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), new THREE.MeshBasicMaterial({ map: signTexture('OVERSIZE LOAD', '#ffd21a', '#111'), side: THREE.DoubleSide }));
    sign.position.set(0, lift + 0.62, -h - 0.47); sign.rotation.y = Math.PI;
    this.extra.add(sign);
  }

  /** Choo-Choo: carts on a tow rope behind the shopper (posed every frame from the trail). */
  private buildTrain(b: BodyDef, wg: THREE.BufferGeometry, lift: number) {
    const n = b.train ?? 0;
    const frames = new THREE.InstancedMesh(frameGeo(true), this.skinMat, n);
    const grips = new THREE.InstancedMesh(gripGeo(), this.trimMat, n);
    const wheels = new THREE.InstancedMesh(wg, this.wheelMat, n * 4);
    const ropes = new THREE.InstancedMesh(_ropeGeo, _ropeMat, n);
    for (const m of [frames, grips, wheels, ropes]) { m.frustumCulled = false; m.castShadow = m !== ropes; this.extra.add(m); }
    frames.position.y = grips.position.y = lift;
    this.towed = { frames, grips, wheels, ropes };
    this.poseTrain(0);
  }

  /** Put the towed carts where the trail says (or in a straight line when there's no trail: the garage). */
  private poseTrain(spin: number) {
    const T = this.towed; if (!T) return;
    const n = T.frames.count, W = this.wheelDef, r = this.root;
    const c = Math.cos(r.rotation.y), sn = Math.sin(r.rotation.y);
    let px = 0, pz = this.avatar?.position.z ?? -0.95; // the rope is tied to the shopper's belt
    _qs.setFromAxisAngle(_ax, spin);
    for (let i = 0; i < n; i++) {
      let x: number, z: number, yaw: number;
      const car = this.trail?.cars[i];
      if (car) {
        // world → this cart's local frame
        const dx = car.x - r.position.x, dz = car.z - r.position.z;
        x = dx * c - dz * sn; z = dx * sn + dz * c; yaw = car.yaw - r.rotation.y;
      } else { x = 0; z = -(TRAIN.lead + TRAIN.len / 2 + i * TRAIN.pitch); yaw = 0; }
      _q2.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      T.frames.setMatrixAt(i, _m2.compose(_p2.set(x, 0, z), _q2, _one));
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      T.grips.setMatrixAt(i, _m2.compose(_p2.set(x + fx * handleZ(), 1.0, z + fz * handleZ()), _q2, _one));
      [[0.2, 0.36], [-0.2, 0.36], [0.2, -0.34], [-0.2, -0.34]].forEach(([wx, wz], j) => {
        _p2.set(x + fz * wx + fx * wz, W.radius, z - fx * wx + fz * wz);
        T.wheels.setMatrixAt(i * 4 + j, _m2.compose(_p2, _q3.copy(_q2).multiply(_qs), _one));
      });
      // rope from the previous hitch to this cart's nose
      const nx = x + fx * 0.5, nz = z + fz * 0.5, ddx = nx - px, ddz = nz - pz, d = Math.max(0.01, Math.hypot(ddx, ddz));
      _q3.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-ddx, -ddz));
      T.ropes.setMatrixAt(i, _m2.compose(_p2.set((nx + px) / 2, 0.32, (nz + pz) / 2), _q3, _s.set(1, 1, d)));
      px = x - fx * 0.48; pz = z - fz * 0.48;
    }
    for (const m of [T.frames, T.grips, T.wheels, T.ropes]) m.instanceMatrix.needsUpdate = true;
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

  /** Pop a speech bubble over the shopper's head for a couple of seconds. */
  speak(text: string, dur = 2.6) {
    this.clearBubble();
    const { tex, aspect } = bubbleTexture(text);
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.bubble.renderOrder = 900;
    this.bubble.center.set(0.5, 0);
    this.bubble.userData.aspect = aspect;
    this.bubble.userData.dur = dur;
    this.bubbleText = text;
    this.bubbleT = dur;
    this.root.add(this.bubble);
  }
  private clearBubble() {
    if (!this.bubble) return;
    this.root.remove(this.bubble);
    const m = this.bubble.material as THREE.SpriteMaterial; m.map?.dispose(); m.dispose();
    this.bubble = null; this.bubbleText = '';
  }

  private buildAvatar(color: number) {
    const a = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b090, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 8), shirt); torso.position.set(0, 1.25, 0); torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin); head.position.set(0, 1.72, 0.02); head.castShadow = true;
    this.shirtMat = shirt;
    a.add(torso, head);
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
    this.animateParts(dt, time, speed, boosting);
    const prop = this.hat?.userData.spin as THREE.Object3D | undefined;
    if (prop) prop.rotation.y += dt * (3 + Math.abs(speed) * 5);
    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) this.clearBubble();
      else {
        const age = this.bubble.userData.dur - this.bubbleT, pop = Math.min(1, age * 7) * (1 + Math.max(0, 0.15 - age) * 2);
        const h = 0.5 * pop, b = this.body, top = this.tag ? this.tag.position.y + 0.2 : Math.max(2.15 * this.avatarScale, this.lift + 1.0 * b.sy + 1.1);
        this.bubble.scale.set(h * this.bubble.userData.aspect, h, 1);
        this.bubble.position.set(0, top, this.tag ? this.tag.position.z : -0.55 * b.sz - 0.4);
        (this.bubble.material as THREE.SpriteMaterial).opacity = Math.min(1, this.bubbleT * 3);
      }
    }

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
      const hz = handleZ(b.sz / b.sy) * b.sy - this.half;
      this.avatar.position.z = riding ? hz - 0.07 : hz - 0.4 * as;
      this.avatar.rotation.x = riding ? -0.1 : 0.25 * run;
    }
  }

  /** Engines, smoke, the beacon and the towed carts. */
  private animateParts(dt: number, time: number, speed: number, boosting: boolean) {
    const fx = this.fx, sp = Math.abs(speed);
    if (fx.beacon) fx.beacon.rotation.y += dt * 7;
    if (fx.rocket) {
      // always lit; roars with speed and nitro
      const k = (0.55 + Math.min(1, sp / 8) * 0.6 + (boosting ? 1.1 : 0)) * (0.85 + Math.random() * 0.3);
      fx.rocket.scale.set(1 + (boosting ? 0.4 : 0), 1 + (boosting ? 0.4 : 0), k);
      (fx.rocket.material as THREE.MeshBasicMaterial).color.copy(hsl(0.06 + Math.random() * 0.06, 1, boosting ? 0.62 : 0.55));
    }
    if (this.engineId === 'gas') this.motor.position.set((Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.006, 0); // it rattles
    if ((fx.stack || fx.exhaust) && this.root.parent && dt > 0) {
      if (!this.puffs) this.puffs = new Puffs();
      if (this.puffs.group.parent !== this.root.parent) this.root.parent.add(this.puffs.group);
      const fwdX = Math.sin(this.root.rotation.y), fwdZ = Math.cos(this.root.rotation.y);
      if (fx.exhaust) {
        fx.puff -= dt;
        if (fx.puff <= 0) {
          fx.puff = 0.22 / (1 + sp * 0.25);
          fx.exhaust.getWorldPosition(_wp);
          this.puffs.emit(_wp, -fwdX * 0.6 + (Math.random() - 0.5) * 0.2, 0.35, -fwdZ * 0.6 + (Math.random() - 0.5) * 0.2, 0x55524c, 0.12, 0.9);
        }
      }
      if (fx.stack) {
        fx.chuff -= dt;
        if (fx.chuff <= 0) {
          fx.chuff = 0.18 + 0.9 / (1 + sp * 0.8); // choo... choo.. choo.choo.choo
          fx.stack.getWorldPosition(_wp);
          this.puffs.emit(_wp, -fwdX * sp * 0.4, 1.2 + Math.random() * 0.4, -fwdZ * sp * 0.4, 0xe8e8e8, 0.22, 1.6);
        }
      }
    }
    this.puffs?.update(dt);
    if (this.towed) this.poseTrain(this.wheelSpin);
    void time;
  }

  dispose() {
    this.puffs?.dispose();
    this.clearBubble();
    this.tower?.dispose();
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !SHARED.has(m.geometry)) m.geometry.dispose(); });
  }
}
const _e = new THREE.Euler(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _p2 = new THREE.Vector3(), _m2 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _s = new THREE.Vector3(), _ax = new THREE.Vector3(1, 0, 0), _wp = new THREE.Vector3();

// ---------------- physics ----------------
const _v = new THREE.Vector3(), _qt = new THREE.Quaternion();

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
    const h = bodyTail(B) / 2; // nested carts: the whole row is one long basket
    // tall stacks get colliders for the first few storeys (they'll clip high shelves); the rest is scenery
    for (let i = 0; i < Math.min(B.levels, 5); i++) mk(RAPIER.ColliderDesc.cuboid(0.28 * B.sx, 0.27 * B.sy, 0.46 * B.sz + h).setTranslation(0, lift + (0.71 + i * LEVEL_H) * B.sy, 0).setMass((i ? 6 : 16) * mm));
    mk(RAPIER.ColliderDesc.cuboid(0.22 * B.sx, 0.04 * B.sy, 0.38 * B.sz + h).setTranslation(0, lift + 0.2 * B.sy, 0).setMass(6 * mm));
    for (const [x, z] of wheelLayout(B)) mk(RAPIER.ColliderDesc.ball(wr).setTranslation(x, wr, z).setMass(2 * mm));
    if (this.stats.addon !== 'none') mk(RAPIER.ColliderDesc.cuboid(0.3 * (this.stats.addon === 'vacuum' || this.stats.addon === 'ram' ? B.sx : ws), 0.2 * B.sy, 0.1 * ws).setTranslation(0, lift + 0.4 * B.sy, 0.5 * B.sz + h + 0.1 * ws).setMass(3 * mm));
    // the shopper: a capsule behind the handle (they collide with shelves too)
    mk(RAPIER.ColliderDesc.capsule(0.5, 0.22).setTranslation(0, 0.9, -(0.46 * B.sz + 0.42 + h)).setMass(70 * mm));
    this.buildTrain();
  }

  /**
   * Choo-Choo: the towed carts follow a trail. Carts this machine simulates also push loose stock
   * around with them (kinematic boxes that only touch items: they can't wreck shelves or rivals).
   */
  private buildTrain() {
    for (const c of this.towBodies) this.phys.world.removeRigidBody(c);
    this.towBodies = [];
    const n = this.stats.body.train ?? 0;
    this.trail = n ? new Trail(n) : null;
    this.model.trail = this.trail;
    if (!this.trail) return;
    const t = this.body.translation();
    this.trail.reset(t.x, t.z, this.yaw, this.roomBehind());
    if (this.kinematic) return;
    for (const c of this.trail.cars) {
      const rb = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, 0, c.z));
      this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(0.28, 0.3, 0.46).setTranslation(0, 0.6, 0).setCollisionGroups(groups(G.CART, G.ITEM)), rb);
      this.towBodies.push(rb);
    }
  }
  trail: Trail | null = null;
  private towBodies: RAPIER.RigidBody[] = [];

  /** Free floor straight behind the cart (to the nearest wall / shelf / counter), for laying out the train. */
  private roomBehind(): number {
    const t = this.body.translation(), y = this.yaw;
    const ray = new RAPIER.Ray({ x: t.x, y: 0.5, z: t.z }, { x: -Math.sin(y), y: 0, z: -Math.cos(y) });
    const hit = this.phys.world.castRay(ray, 40, true, undefined, groups(ALL, G.STATIC | G.SHELF), undefined, this.body);
    return hit ? hit.timeOfImpact - 0.4 : 40;
  }

  /** Move the towed carts along (after the leader's control step, or from a remote pose). */
  private tow(x: number, z: number, yaw: number, reversing: boolean) {
    if (!this.trail) return;
    this.trail.update(x, z, yaw, reversing);
    this.trail.cars.forEach((c, i) => {
      const rb = this.towBodies[i]; if (!rb) return;
      rb.setNextKinematicTranslation({ x: c.x, y: 0, z: c.z });
      rb.setNextKinematicRotation(_qt.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, c.yaw));
    });
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
        const back = 0.46 * S.body.sz + 1.6 + bodyTail(S.body) / 2 + (S.body.train ? TRAIN.lead + S.body.train * TRAIN.pitch : 0);
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
      } else if (S.motor && inp.throttle > 0) a = inp.throttle * S.ride * S.accel * Math.max(0, 1 - vF / (vmax * 0.95)); // the motor drives you while you ride
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
    this.tow(t.x, t.z, yaw, vF < -0.15);
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
    this.trail?.reset(x, z, yaw, this.roomBehind());
  }

  /** Front of the cart (vacuum nozzle / magnet) in world space. */
  nose(out = { x: 0, z: 0 }) {
    const t = this.body.translation(), y = this.yaw, d = 0.5 * this.stats.body.sz + 0.2 + bodyTail(this.stats.body) / 2;
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
      if (this.trail) {
        const r = this.model.root.position;
        if (Math.hypot(pose.x - r.x, pose.z - r.z) > 6) this.trail.reset(pose.x, pose.z, pose.yaw); // teleported / first pose
        else this.tow(pose.x, pose.z, pose.yaw, pose.speed < -0.15);
      }
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
    for (const c of this.towBodies) this.phys.world.removeRigidBody(c);
    for (const c of this.colliders) this.phys.offForce(c.handle);
    this.phys.world.removeRigidBody(this.body);
    this.model.dispose();
  }
}
