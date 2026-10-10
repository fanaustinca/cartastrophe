// Floor hazards and power-ups:
// - Slicks (egg / milk / oil / soda / mayo puddles) — pooled instanced decals with a procedural
//   puddle shader; each one is also a friction zone the cart physics samples every step.
// - Boost pads: shiny promo tiles and checkout nitro strips (animated chevron shader).
// - Particles: pooled shell shards / splash droplets / sparks, simulated on the CPU (no physics bodies).
import * as THREE from 'three';
import { MESS, MessType } from './config';

export interface Slick { type: MessType; x: number; z: number; r: number; target: number; grow: number; slot: number; active: boolean; seed: number }
export interface Pad { kind: 'promo' | 'nitro'; x: number; z: number; hw: number; hd: number; yaw: number; cos: number; sin: number }

const MESS_IDX: Record<MessType, number> = { egg: 0, milk: 1, oil: 2, soda: 3, mayo: 4 };

const puddleVert = /* glsl */ `
attribute float aType;
attribute float aSeed;
varying vec2 vUv;
varying float vType;
varying float vSeed;
varying vec3 vWorld;
void main() {
  vUv = uv; vType = aType; vSeed = aSeed;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const puddleFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
varying vec2 vUv;
varying float vType;
varying float vSeed;
varying vec3 vWorld;
float h(float n) { return fract(sin(n) * 43758.5453); }
float blob(vec2 p, float s) {
  float a = atan(p.y, p.x);
  float r = length(p);
  float wob = 0.10 * sin(a * 3.0 + s * 6.0) + 0.07 * sin(a * 5.0 + s * 11.0) + 0.05 * sin(a * 9.0 + s * 3.0);
  return r - (0.78 + wob);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = blob(p, vSeed);
  if (d > 0.0) discard;
  float edge = smoothstep(0.0, -0.12, d);
  vec3 col; float alpha;
  vec3 V = normalize(uCam - vWorld);
  float spec = pow(max(0.0, dot(reflect(-V, vec3(0.0, 1.0, 0.0)), normalize(vec3(0.3, 1.0, 0.2)))), 24.0);
  int t = int(vType + 0.5);
  if (t == 0) { // egg: clear albumen + yolks
    col = vec3(0.97, 0.95, 0.85); alpha = 0.45 * edge;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 c = vec2(h(vSeed * 7.0 + fi) - 0.5, h(vSeed * 13.0 + fi * 3.0) - 0.5) * 0.7;
      float yd = length(p - c) - (0.16 + 0.06 * h(vSeed + fi));
      if (yd < 0.0) { col = mix(vec3(1.0, 0.62, 0.05), vec3(1.0, 0.8, 0.2), smoothstep(-0.18, 0.0, yd)); alpha = 1.0; }
    }
  } else if (t == 1) { col = vec3(0.98, 0.98, 0.95); alpha = 0.85 * edge; }
  else if (t == 2) { // oil: dark with thin-film iridescence
    float f = length(p) * 6.0 - uTime * 0.6 + vSeed * 10.0;
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + f * 0.25));
    col = mix(vec3(0.12, 0.1, 0.03), irid, 0.35 * smoothstep(0.2, 0.9, length(p))); alpha = 0.88 * edge;
  } else if (t == 3) { col = vec3(0.35, 0.12, 0.04); alpha = 0.7 * edge; }
  else { col = vec3(0.97, 0.94, 0.8); alpha = 0.9 * edge; }
  col += spec * 0.9;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

const padFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vType;
void main() {
  vec2 uv = vUv;
  float chev = fract(uv.y * 3.0 - abs(uv.x - 0.5) * 1.6 - uTime * 2.2);
  float stripe = smoothstep(0.45, 0.5, chev) * (1.0 - smoothstep(0.85, 0.9, chev));
  float border = step(0.06, uv.x) * step(uv.x, 0.94) * step(0.04, uv.y) * step(uv.y, 0.96);
  vec3 base, hi;
  if (vType < 0.5) { // promo: shiny gold/rainbow
    base = vec3(0.9, 0.7, 0.1); hi = 0.6 + 0.4 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + uv.y + uTime * 0.4));
  } else { base = vec3(0.9, 0.15, 0.05); hi = vec3(1.0, 0.85, 0.2); }
  vec3 col = mix(base * 0.6, hi * 1.6, stripe);
  col = mix(vec3(1.0), col, border);
  gl_FragColor = vec4(col, 0.92);
  #include <colorspace_fragment>
}`;
const padVert = /* glsl */ `
attribute float aType;
varying vec2 vUv;
varying float vType;
void main() { vUv = uv; vType = aType; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number; spin: number }

export class Hazards {
  group = new THREE.Group();
  slicks: Slick[] = [];
  pads: Pad[] = [];
  readonly capacity = 160;
  private next = 0;
  private puddles: THREE.InstancedMesh;
  private aType: THREE.InstancedBufferAttribute;
  private aSeed: THREE.InstancedBufferAttribute;
  private puddleMat: THREE.ShaderMaterial;
  private padMesh: THREE.InstancedMesh | null = null;
  private padMat: THREE.ShaderMaterial;
  private parts: THREE.InstancedMesh;
  private pdata: Particle[] = [];
  private pnext = 0;
  private growing: Slick[] = [];
  smashCount = 0;

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1);
    this.aType = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    g.setAttribute('aType', this.aType);
    g.setAttribute('aSeed', this.aSeed);
    this.puddleMat = new THREE.ShaderMaterial({
      vertexShader: puddleVert, fragmentShader: puddleFrag, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
    });
    this.puddles = new THREE.InstancedMesh(g, this.puddleMat, this.capacity);
    this.puddles.frustumCulled = false;
    this.puddles.renderOrder = 1;
    for (let i = 0; i < this.capacity; i++) {
      this.puddles.setMatrixAt(i, ZERO);
      this.slicks.push({ type: 'egg', x: 0, z: 0, r: 0, target: 0, grow: 0, slot: i, active: false, seed: 0 });
    }
    this.group.add(this.puddles);
    this.padMat = new THREE.ShaderMaterial({ vertexShader: padVert, fragmentShader: padFrag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, uniforms: { uTime: { value: 0 } } });

    const pg = new THREE.TetrahedronGeometry(1);
    this.parts = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial(), 500);
    this.parts.frustumCulled = false;
    for (let i = 0; i < 500; i++) { this.parts.setMatrixAt(i, ZERO); this.parts.setColorAt(i, new THREE.Color(1, 1, 1)); this.pdata.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 0, spin: 0 }); }
    this.group.add(this.parts);
  }

  /** Pooled: when full, the oldest puddle is recycled. growTime > 0 makes it spread. */
  addSlick(type: MessType, x: number, z: number, r: number, growTime = 0.6): Slick {
    // merge into an existing nearby slick of the same type instead of stacking decals
    for (const s of this.slicks) if (s.active && s.type === type && (s.x - x) ** 2 + (s.z - z) ** 2 < (s.target * 0.5) ** 2) {
      s.target = Math.min(s.target + r * 0.35, 3.2); s.grow = Math.max(s.grow, 1); this.growing.includes(s) || this.growing.push(s);
      return s;
    }
    const s = this.slicks[this.next];
    this.next = (this.next + 1) % this.capacity;
    s.type = type; s.x = x; s.z = z; s.target = r; s.active = true; s.seed = Math.random();
    s.r = growTime > 0 ? r * 0.15 : r;
    s.grow = growTime > 0 ? (r - s.r) / growTime : 0;
    this.aType.setX(s.slot, MESS_IDX[type]); this.aSeed.setX(s.slot, s.seed);
    this.aType.needsUpdate = this.aSeed.needsUpdate = true;
    if (s.grow > 0 && !this.growing.includes(s)) this.growing.push(s);
    this.writeSlick(s);
    return s;
  }

  private writeSlick(s: Slick) {
    const y = 0.006 + (s.slot % 7) * 0.0012;
    _m.compose(_p.set(s.x, y, s.z), _q.copy(FLAT).premultiply(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.seed * 6.28)), _s.set(s.r * 2, s.r * 2, 1));
    this.puddles.setMatrixAt(s.slot, _m);
    this.puddles.instanceMatrix.needsUpdate = true;
  }

  activeSlicks() { return this.slicks.filter((s) => s.active); }

  addPads(pads: Omit<Pad, 'cos' | 'sin'>[]) {
    const g = new THREE.PlaneGeometry(1, 1);
    const types = new Float32Array(pads.length);
    pads.forEach((p, i) => { types[i] = p.kind === 'promo' ? 0 : 1; });
    g.setAttribute('aType', new THREE.InstancedBufferAttribute(types, 1));
    this.padMesh = new THREE.InstancedMesh(g, this.padMat, Math.max(1, pads.length));
    this.padMesh.frustumCulled = false;
    pads.forEach((p, i) => {
      const yawQ = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      _m.compose(_p.set(p.x, 0.004, p.z), yawQ.multiply(FLAT), _s.set(p.hw * 2, p.hd * 2, 1));
      this.padMesh!.setMatrixAt(i, _m);
      this.pads.push({ ...p, cos: Math.cos(p.yaw), sin: Math.sin(p.yaw) });
    });
    this.group.add(this.padMesh);
  }

  /** Friction/drag modifiers at a floor point (lowest grip wins). */
  surfaceAt(x: number, z: number, out = { grip: 1, drag: 0, spin: 0, type: '' as MessType | '' }) {
    out.grip = 1; out.drag = 0; out.spin = 0; out.type = '';
    for (const s of this.slicks) {
      if (!s.active) continue;
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz > s.r * s.r * 0.72) continue;
      const m = MESS[s.type];
      if (m.grip < out.grip) { out.grip = m.grip; out.spin = m.spin; out.type = s.type; }
      out.drag = Math.max(out.drag, m.drag);
      if (!out.type) out.type = s.type;
    }
    return out;
  }

  padAt(x: number, z: number): Pad | null {
    for (const p of this.pads) {
      const dx = x - p.x, dz = z - p.z;
      // local coords: rotate by -yaw (pad local X = width, local "Y" of plane maps to world -Z then yaw)
      const lx = dx * p.cos - dz * p.sin, lz = dx * p.sin + dz * p.cos;
      if (Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd) return p;
    }
    return null;
  }

  /** Spray pooled particles (shell shards, droplets, sparks). */
  burst(x: number, y: number, z: number, color: number, n: number, speed = 3, size = 0.03) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const p = this.pdata[this.pnext];
      const a = Math.random() * Math.PI * 2, u = Math.random();
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(a) * speed * u; p.vz = Math.sin(a) * speed * u; p.vy = speed * (0.4 + Math.random() * 0.8);
      p.life = 0.8 + Math.random() * 0.9; p.size = size * (0.5 + Math.random()); p.spin = Math.random() * 10;
      this.parts.setColorAt(this.pnext, c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
      this.pnext = (this.pnext + 1) % this.pdata.length;
    }
    this.parts.instanceColor!.needsUpdate = true;
  }

  update(dt: number, time: number, cam: THREE.Vector3) {
    this.puddleMat.uniforms.uTime.value = time;
    this.puddleMat.uniforms.uCam.value.copy(cam);
    this.padMat.uniforms.uTime.value = time;
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const s = this.growing[i];
      s.r = Math.min(s.target, s.r + s.grow * dt);
      this.writeSlick(s);
      if (s.r >= s.target) this.growing.splice(i, 1);
    }
    let any = false;
    for (let i = 0; i < this.pdata.length; i++) {
      const p = this.pdata[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vy -= 9.8 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.01) { p.y = 0.01; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      if (p.life <= 0) { this.parts.setMatrixAt(i, ZERO); continue; }
      p.spin += dt * 8;
      _q.setFromEuler(new THREE.Euler(p.spin, p.spin * 0.7, 0));
      const s = p.size * Math.min(1, p.life * 3);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, s * 0.5, s));
      this.parts.setMatrixAt(i, _m);
    }
    if (any) this.parts.instanceMatrix.needsUpdate = true;
  }
}
