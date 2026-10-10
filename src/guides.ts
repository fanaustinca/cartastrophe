// Wayfinding for the local player: groups the items still on their list into clusters
// ("3 soup cans in aisle 7") and hangs a floating product badge over the nearest clusters of
// each kind. Badges draw on top of everything (no depth test) so they read through shelves.
// The HUD's minimap / store map and the guide arrow reuse the same clusters.
import * as THREE from 'three';
import type { Game } from './game';

export interface Cluster { kind: string; x: number; z: number; n: number; d: number; where: string }

const CELL = 4;
const PER_KIND = 2;

function badgeTexture(thumb: HTMLCanvasElement | null, color: string, text?: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 168;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.beginPath(); g.moveTo(44, 120); g.lineTo(84, 120); g.lineTo(64, 164); g.closePath(); g.fill();
  g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill();
  if (thumb) g.drawImage(thumb, 14, 14, 100, 100);
  if (text) {
    g.fillStyle = '#111'; g.font = '900 30px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 64, 64, 96);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Guides {
  group = new THREE.Group();
  clusters: Cluster[] = [];
  nearest: Cluster | null = null;
  checkout = false;
  sprites: THREE.Sprite[] = [];
  private mats = new Map<string, THREE.SpriteMaterial>();
  private timer = 0;
  private y: number;

  constructor(private game: Game, private thumb: ((id: string) => HTMLCanvasElement) | null) {
    const def = game.world.def;
    this.y = Math.min(def.ceiling - 0.7, def.shelfHeight + 1.15);
    game.scene.add(this.group);
  }

  private mat(key: string, make: () => THREE.CanvasTexture) {
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: make(), depthTest: false, depthWrite: false, fog: false, transparent: true });
      this.mats.set(key, m);
    }
    return m;
  }

  private sprite(i: number) {
    while (this.sprites.length <= i) {
      const s = new THREE.Sprite();
      s.renderOrder = 1000;
      s.center.set(0.5, 0);
      this.group.add(s);
      this.sprites.push(s);
    }
    return this.sprites[i];
  }

  /** Recompute clusters (cheap: a few thousand items, a few times a second). */
  refresh() {
    const g = this.game, me = g.local, t = me.cart.body.translation();
    const needs = g.needs(me), reach = me.cart.stats.reach;
    const buckets = new Map<string, Cluster>();
    for (const it of g.world.items.all) {
      if (!it.alive || !needs.has(it.kind.id)) continue;
      const p = it.body.translation();
      if (p.y > reach) continue; // out of reach
      // bucket by named area (so a marker hangs over the aisle, not over the shelf between two
      // aisles) and by distance along it
      const where = g.world.whereIs(p.x, p.z);
      const key = `${it.kind.id}|${where}|${Math.floor(p.z / CELL)}|${where.startsWith('Aisle') ? 0 : Math.floor(p.x / CELL)}`;
      let c = buckets.get(key);
      if (!c) buckets.set(key, (c = { kind: it.kind.id, x: 0, z: 0, n: 0, d: 0, where }));
      c.x += p.x; c.z += p.z; c.n++;
    }
    const byKind = new Map<string, Cluster[]>();
    for (const c of buckets.values()) {
      c.x /= c.n; c.z /= c.n;
      c.x = g.world.aisleCenter.get(c.where) ?? c.x; // hang aisle markers over the middle of the aisle
      // a lone fallen can far from anything else still counts, but a shelf of them is worth more
      c.d = Math.hypot(c.x - t.x, c.z - t.z) - Math.min(4, c.n * 0.4);
      let a = byKind.get(c.kind); if (!a) byKind.set(c.kind, (a = [])); a.push(c);
    }
    this.clusters = [];
    for (const a of byKind.values()) { a.sort((p, q) => p.d - q.d); this.clusters.push(...a.slice(0, PER_KIND)); }
    this.clusters.sort((p, q) => p.d - q.d);
    this.nearest = this.clusters[0] ?? null;
    this.checkout = !needs.size && !me.done;
  }

  update(dt: number, time: number) {
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.4; this.refresh(); }
    let n = 0;
    const show = this.game.phase !== 'over' && !this.game.local.done;
    if (show && this.checkout) {
      for (const l of this.game.world.lanes) {
        const s = this.sprite(n++);
        s.material = this.mat('checkout', () => badgeTexture(null, '#ffd23a', 'PAY'));
        s.position.set(l.x, 2.2 + Math.sin(time * 3 + l.x) * 0.1, l.z);
        s.scale.set(0.9, 1.18, 1);
        s.visible = true;
      }
    } else if (show) {
      for (const c of this.clusters) {
        const s = this.sprite(n++);
        s.material = this.mat(c.kind, () => badgeTexture(this.thumb ? this.thumb(c.kind) : null, c === this.nearest ? '#ffd23a' : '#ffd23a'));
        const near = c === this.nearest;
        const k = near ? 1.25 + Math.sin(time * 5) * 0.08 : 0.95;
        s.position.set(c.x, this.y + Math.sin(time * 2.2 + c.x * 0.7) * 0.12, c.z);
        s.scale.set(k, k * 1.31, 1);
        s.visible = true;
      }
    }
    for (let i = n; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }

  dispose() {
    for (const m of this.mats.values()) { m.map?.dispose(); m.dispose(); }
    this.group.removeFromParent();
  }
}
