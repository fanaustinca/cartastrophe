// Restocking: a minute after a shelf (or a pallet / produce bin / dairy case) gets knocked about,
// store staff "fix" it: the shelf stands back up where it was, every product that came off it
// (smashed and collected ones too) is put back, and the mess it made is mopped up.
// Waits for carts to clear out of the way first, so nothing is ever spawned inside a shopper.
//
// Solo / host decide when; clients replay the host's "restock" events so all stores match.
import * as THREE from 'three';
import type { StoreWorld } from './store';
import { SHELF_LEN, SHELF_DEPTH, type Shelf } from './shelves';
import type { Item } from './items';
import type { RAPIER } from './physics';

export interface RestockGroup { index: number; shelf: Shelf | null; items: Item[]; x: number; z: number; r: number; since: number }

const CELL = 3; // loose displays (pallets, bins, cases) are grouped by home position
const _q = new THREE.Quaternion();

export class Restock {
  /** Seconds a display stays wrecked before it's restocked. */
  static DELAY = 60;
  groups: RestockGroup[] = [];
  count = 0;
  private scanT = 0;
  /** Bodies put back this step: kept awake for a couple of steps to make contacts, then slept. */
  private settling: { bodies: RAPIER.RigidBody[]; steps: number }[] = [];
  private tmp: Item[] = [];

  constructor(private world: StoreWorld) {
    const byKey = new Map<string, RestockGroup>();
    const sh = world.shelves.shelves;
    for (const it of world.items.all) {
      if (it.spawned) continue;
      const key = it.shelf >= 0 ? 's' + it.shelf : `c${Math.floor(it.home.x / CELL)},${Math.floor(it.home.z / CELL)}`;
      let g = byKey.get(key);
      if (!g) {
        g = { index: this.groups.length, shelf: it.shelf >= 0 ? sh[it.shelf] : null, items: [], x: 0, z: 0, r: 0, since: -1 };
        byKey.set(key, g); this.groups.push(g);
      }
      g.items.push(it);
      it.group = g.index;
    }
    for (const g of this.groups) {
      if (g.shelf) { g.x = g.shelf.home.x; g.z = g.shelf.home.z; g.r = 1.45; continue; }
      for (const it of g.items) { g.x += it.home.x; g.z += it.home.z; }
      g.x /= g.items.length; g.z /= g.items.length;
      for (const it of g.items) g.r = Math.max(g.r, Math.hypot(it.home.x - g.x, it.home.z - g.z) + 0.3);
    }
  }

  private disturbed(g: RestockGroup): boolean {
    const s = g.shelf;
    if (s && !s.body.isSleeping()) return true;
    if (s && (s.moved || s.toppled || s.tilt > 0.05)) return true;
    if (s) { const t = s.body.translation(); if (Math.hypot(t.x - s.home.x, t.z - s.home.z) > 0.08) return true; }
    for (const it of g.items) {
      if (!it.touched) continue;
      if (!it.alive) return true;
      const t = it.body.translation();
      if (Math.abs(t.y - it.home.y) > 0.06 || Math.hypot(t.x - it.home.x, t.z - it.home.z) > 0.12) return true;
    }
    return false;
  }

  /** Twice a second: track wrecked groups; returns the groups due for restocking now (authority only). */
  scan(dt: number, now: number, carts: { x: number; z: number }[]): RestockGroup[] {
    this.scanT -= dt;
    if (this.scanT > 0) return [];
    this.scanT = 0.5;
    const due: RestockGroup[] = [];
    for (const g of this.groups) {
      if (!this.disturbed(g)) { g.since = -1; continue; }
      if (g.since < 0) g.since = now;
      if (now - g.since < Restock.DELAY) continue;
      const clear = carts.every((c) => Math.hypot(c.x - g.x, c.z - g.z) > g.r + 1.6);
      if (clear) due.push(g);
    }
    return due;
  }

  /** Put the group back exactly as it was built. */
  restock(g: RestockGroup) {
    const w = this.world, bodies: RAPIER.RigidBody[] = [];
    const mine = new Set(g.items);
    // anything else lying where the shelf / display goes is swept up (its own group brings it back)
    for (const o of w.items.near(g.x, g.z, g.r + 0.2, this.tmp)) {
      if (mine.has(o) || !o.alive) continue;
      const t = o.body.translation();
      if (g.shelf) { // only the shelf's own footprint, not the neighbours' ends
        const dx = t.x - g.x, dz = t.z - g.z, c = Math.cos(g.shelf.yaw), sn = Math.sin(g.shelf.yaw);
        if (Math.abs(dx * c - dz * sn) > SHELF_LEN / 2 + 0.1 || Math.abs(dx * sn + dz * c) > SHELF_DEPTH / 2 + 0.1) continue;
      }
      if (Math.hypot(t.x - o.home.x, t.z - o.home.z) < 0.05 && Math.abs(t.y - o.home.y) < 0.05) continue; // it's in its own spot
      w.items.remove(o);
    }
    const s = g.shelf;
    if (s) {
      const b = s.body;
      b.setTranslation({ x: s.home.x, y: 0.001, z: s.home.z }, true);
      b.setRotation(_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw), true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      s.toppled = false; s.moved = false; s.tilt = 0; s.wasAwake = true;
      s.wokeAt = { x: s.home.x, y: 0.001, z: s.home.z, tilt: 0 };
      bodies.push(b);
    }
    for (const it of g.items) { w.items.restore(it); bodies.push(it.body); }
    w.hazards.clearGroup(g.index);
    // sparkle so it's obvious what happened
    w.hazards.burst(g.x, 1.2, g.z, 0x7affb0, 18, 2.2, 0.035);
    w.hazards.burst(g.x, 1.2, g.z, 0xffffff, 12, 2.6, 0.025);
    g.since = -1;
    this.count++;
    // Rapier gotcha (see StoreWorld.settle): a body put to sleep before it has contacts sinks
    // when woken. Step a couple of times awake, then sleep the lot.
    this.settling.push({ bodies, steps: 2 });
  }

  /** After each physics step. */
  afterStep() {
    for (let i = this.settling.length - 1; i >= 0; i--) {
      const s = this.settling[i];
      if (--s.steps > 0) continue;
      for (const b of s.bodies) {
        if (!b.isEnabled()) continue;
        b.setLinvel({ x: 0, y: 0, z: 0 }, false);
        b.setAngvel({ x: 0, y: 0, z: 0 }, false);
        b.sleep();
      }
      this.settling.splice(i, 1);
    }
  }
}
