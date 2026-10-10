// Bot shoppers: pick the best reachable item still on their list, A* through the store
// (routing around toppled shelves and slicks), pure-pursuit steering, sprint on straights,
// ram rivals when they're feeling aggressive, and back out when stuck.
import * as THREE from 'three';
import { RAPIER, Physics, G, groups } from './physics';
import type { Cart, CartInput } from './cart';
import type { StoreWorld } from './store';
import type { Item } from './items';
import type { MessType } from './config';

export interface BotCtx {
  world: StoreWorld;
  phys: Physics;
  needs: () => Map<string, number>;
  complete: () => boolean;
  finished: () => boolean;
  rivals: () => Cart[];
}

const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const RAY_GROUPS = groups(0xffff, G.STATIC | G.SHELF | G.CART | G.REMOTE);

export class Bot {
  path: [number, number][] = [];
  wp = 0;
  target: Item | null = null;
  goal: [number, number] | null = null;
  private think = 0;
  private replan = 0;
  private stuckT = 0;
  private reverseT = 0;
  private reverseSteer = 1;
  private ramT = 0;
  private ramTarget: Cart | null = null;
  private noise = 0;
  private noiseT = 0;
  readonly skill: number;
  readonly aggression: number;
  state = 'shop';
  private dawdle = 0;
  private lastNeed = -1;
  private bestDist = Infinity;
  private progressT = 0;
  private stuckCount = 0;

  /** Point `look` metres ahead along the remaining path. */
  private lookAhead(x: number, z: number, look: number): [number, number] {
    let px = x, pz = z;
    for (let k = this.wp; k < this.path.length; k++) {
      const [cx, cz] = this.path[k], d = Math.hypot(cx - px, cz - pz);
      if (d >= look) return [px + ((cx - px) * look) / d, pz + ((cz - pz) * look) / d];
      look -= d; px = cx; pz = cz;
    }
    return [px, pz];
  }

  constructor(public cart: Cart, private ctx: BotCtx, seed: number) {
    const r = (n: number) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    this.skill = 0.35 + r(1) * 0.6;
    this.aggression = r(2);
  }

  /** Nearest few candidates by straight line, then the winner by actual A* route length. */
  private pickTarget(): void {
    const needs = this.ctx.needs();
    const t = this.cart.body.translation();
    const cand: [number, Item][] = [];
    for (const it of this.ctx.world.items.all) {
      if (!it.alive || !needs.get(it.kind.id)) continue;
      const p = it.body.translation();
      if (p.y > Math.min(9, this.cart.stats.reach) - 0.15) continue;
      let score = Math.hypot(p.x - t.x, p.z - t.z);
      if (it.kind.fragile && p.y < 0.3) score += 3; // fallen fragile stuff is about to smash
      score += p.y > 1.5 ? 1.5 : 0;
      if (this.ctx.world.hazards.surfaceAt(p.x, p.z, this.tmpSurf).spin > 0.5) score += 6; // don't park in oil
      cand.push([score, it]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    let best: Item | null = null, bestScore = Infinity, bestPath: [number, number][] | null = null;
    // dumb shoppers eyeball it; sharp ones compare real routes around the shelving
    const n = Math.min(cand.length, 2 + Math.round(this.skill * 4));
    for (let i = 0; i < n; i++) {
      const [straight, it] = cand[i];
      if (straight - 20 > bestScore) break;
      const p = it.body.translation();
      const path = this.ctx.world.nav.path(t.x, t.z, p.x, p.z);
      if (!path) continue;
      let len = 0; for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
      const score = len + (straight - Math.hypot(p.x - t.x, p.z - t.z));
      if (score < bestScore) { bestScore = score; best = it; bestPath = path; }
    }
    if (!best && cand.length) best = cand[0][1];
    this.target = best;
    if (best) { const p = best.body.translation(); this.setGoal(p.x, p.z, bestPath); }
    else this.goal = null;
  }
  private tmpSurf = { grip: 1, drag: 0, spin: 0, type: '' as MessType | '' };

  private setGoal(x: number, z: number, path: [number, number][] | null = null) {
    this.goal = [x, z];
    const t = this.cart.body.translation();
    this.path = path ?? this.ctx.world.nav.path(t.x, t.z, x, z) ?? [[x, z]];
    this.wp = Math.min(1, this.path.length - 1);
    this.bestDist = Infinity; this.progressT = 0;
  }

  private nearestLane(): [number, number] {
    const t = this.cart.body.translation();
    let best = this.ctx.world.lanes[0], bd = Infinity;
    for (const l of this.ctx.world.lanes) { const d = Math.hypot(l.x - t.x, l.z - t.z); if (d < bd) { bd = d; best = l; } }
    return [best.x, best.z + 0.4];
  }

  /** Called every physics step; writes cart.input. */
  update(dt: number): CartInput {
    const inp = this.cart.input;
    const c = this.cart;
    const t = c.body.translation();
    inp.nitro = false; inp.action = false;
    if (this.ctx.finished()) { inp.throttle = c.fwdSpeed > 0.5 ? -0.4 : 0; inp.steer = 0; inp.sprint = false; inp.ride = false; return inp; }

    this.think -= dt; this.replan -= dt; this.noiseT -= dt; this.ramT -= dt;
    // shoppers stop to check the label after each grab (less skilled ones dither longer)
    const need = [...this.ctx.needs().values()].reduce((a, b) => a + b, 0);
    if (this.lastNeed >= 0 && need < this.lastNeed) this.dawdle = 0.9 + (1 - this.skill) * 2.2 + Math.random() * 0.8;
    this.lastNeed = need;
    if (this.dawdle > 0) {
      this.dawdle -= dt;
      inp.throttle = c.fwdSpeed > 0.5 ? -0.5 : 0; inp.steer = 0; inp.sprint = false; inp.ride = false;
      if (this.dawdle <= 0) this.replan = 0;
      return inp;
    }
    if (this.noiseT <= 0) { this.noiseT = 0.4 + Math.random() * 0.6; this.noise = (Math.random() - 0.5) * (1 - this.skill) * 0.9; }
    if (this.think <= 0) {
      this.think = 0.3;
      if (this.ctx.complete()) {
        if (this.state !== 'checkout' || this.replan <= 0) { this.state = 'checkout'; const [x, z] = this.nearestLane(); this.setGoal(x, z); this.replan = 3; }
      } else {
        this.state = 'shop';
        if (!this.target || !this.target.alive || !this.ctx.needs().get(this.target.kind.id) || this.replan <= 0) { this.pickTarget(); this.replan = 2.5 + Math.random(); }
      }
      // occasional rival ramming
      if (this.ramT <= -4 && this.aggression > 0.6 && !this.ctx.complete()) {
        for (const r of this.ctx.rivals()) {
          if (r === c) continue;
          const rt = r.body.translation();
          const d = Math.hypot(rt.x - t.x, rt.z - t.z);
          const fwd = c.forward();
          if (d < 7 && d > 1.5 && ((rt.x - t.x) * fwd.x + (rt.z - t.z) * fwd.z) / d > 0.85) { this.ramTarget = r; this.ramT = 1.4; break; }
        }
      }
    }

    // stuck / reversing: no progress toward the goal for a while (pinned on a shelf end, wedged
    // between carts) → back out, steering the other way each time, then replan
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = -1; inp.steer = this.reverseSteer; inp.sprint = false; inp.ride = false;
      if (this.reverseT <= 0) this.replan = 0;
      return inp;
    }
    if (this.goal && !(this.ramT > 0)) {
      const gd = Math.hypot(this.goal[0] - t.x, this.goal[1] - t.z);
      if (gd < this.bestDist - 0.4) { this.bestDist = gd; this.progressT = 0; } else this.progressT += dt;
    }
    if (inp.throttle > 0.3 && c.speed() < 0.45) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.8 || this.progressT > 3.2) {
      this.stuckT = 0; this.progressT = 0; this.bestDist = Infinity;
      this.reverseT = 0.6 + Math.random() * 0.4;
      this.reverseSteer = this.stuckCount++ % 2 ? -1 : 1;
      return inp;
    }

    // steering target: a look-ahead point along the path (pure pursuit), or a rival to ram
    let aimX: number, aimZ: number;
    const sp = c.speed();
    if (this.ramTarget && this.ramT > 0) {
      const rt = this.ramTarget.body.translation(); aimX = rt.x; aimZ = rt.z;
    } else {
      if (!this.path.length) { inp.throttle = 0; inp.steer = 0; return inp; }
      while (this.wp < this.path.length - 1 && Math.hypot(this.path[this.wp][0] - t.x, this.path[this.wp][1] - t.z) < 1.1) this.wp++;
      [aimX, aimZ] = this.lookAhead(t.x, t.z, 1.4 + sp * 0.3);
    }
    const dx = aimX - t.x, dz = aimZ - t.z;
    const desired = Math.atan2(dx, dz);
    const err = wrap(desired - c.yaw) + this.noise;
    let steer = THREE.MathUtils.clamp(-err * 2.2, -1, 1);

    // speed planning: how fast can I take the next corners and still stop at the goal?
    let target = 9.5;
    if (!(this.ramT > 0)) {
      let px = t.x, pz = t.z, dist = 0;
      for (let k = this.wp; k < Math.min(this.path.length, this.wp + 4); k++) {
        const [cx, cz] = this.path[k];
        dist += Math.hypot(cx - px, cz - pz);
        if (k + 1 < this.path.length) {
          const [nx, nz] = this.path[k + 1];
          const turn = Math.abs(wrap(Math.atan2(nx - cx, nz - cz) - Math.atan2(cx - px, cz - pz)));
          const vc = THREE.MathUtils.clamp(8.5 - turn * 4.2, 2.4, 9.5);
          target = Math.min(target, Math.sqrt(vc * vc + 2 * 5 * dist));
        } else if (this.state === 'shop') target = Math.min(target, 1.2 + Math.sqrt(2 * 3 * Math.max(0, dist - 0.8)));
        px = cx; pz = cz;
      }
      // can't steer at speed while facing the wrong way
      if (Math.abs(err) > 0.5) target = Math.min(target, Math.max(1.6, 7 - Math.abs(err) * 4));
    }
    target *= 0.82 + 0.18 * this.skill;
    // slippery floor under me: ease off
    const surf = this.ctx.world.hazards.surfaceAt(t.x, t.z, this.tmpSurf);
    if (surf.grip < 0.5) target = Math.min(target, 4.5);

    // whiskers: veer from carts/shelves ahead; brake hard if a shelf is right in front at speed
    const fwd = c.forward();
    let blocked = Infinity;
    for (const side of [-0.38, 0, 0.38]) {
      const dir = { x: Math.sin(c.yaw + side), y: 0, z: Math.cos(c.yaw + side) };
      const ray = new RAPIER.Ray({ x: t.x + fwd.x * 0.6, y: 0.6, z: t.z + fwd.z * 0.6 }, dir);
      const hit = this.ctx.phys.world.castRay(ray, 2.2 + sp * 0.25, true, undefined, RAY_GROUPS, undefined, c.body);
      if (!hit || this.ramT > 0) continue;
      if (side) steer += side > 0 ? 0.55 : -0.55;
      else blocked = hit.timeOfImpact;
    }
    if (blocked < Infinity) target = Math.min(target, 1.5 + blocked * 1.6);

    const finalLeg = this.wp >= this.path.length - 1;
    inp.steer = THREE.MathUtils.clamp(steer, -1, 1);
    if (this.ramT > 0) { inp.throttle = 1; inp.sprint = c.stamina > 0.3; inp.ride = false; return inp; }
    if (sp < target - 0.3) inp.throttle = 1;
    else if (sp > target + 0.6) inp.throttle = -Math.min(1, (sp - target) / 2.5);
    else inp.throttle = 0.35;
    // sprint only when it's actually useful: lined up, clear road, a long way to go
    inp.sprint = inp.throttle > 0 && target > 7 && Math.abs(err) < 0.2 && blocked === Infinity && c.stamina > 1.05 - this.skill * 0.9;
    inp.ride = false;
    // nitro on a long, clear, lined-up straight
    inp.nitro = inp.sprint && target > 8.6 && Math.abs(err) < 0.12 && c.nitro > 0.6 && this.skill > 0.45;
    // oil dropper: leave a present for whoever's tailgating
    if (c.stats.addon === 'dropper' && c.charges >= 1 && Math.random() < 0.02 * this.aggression) {
      for (const r of this.ctx.rivals()) {
        if (r === c) continue;
        const rt = r.body.translation(), dx = rt.x - t.x, dz = rt.z - t.z, d = Math.hypot(dx, dz);
        if (d > 1.5 && d < 7 && (dx * fwd.x + dz * fwd.z) / d < -0.7) { inp.action = true; break; }
      }
    }
    if (Math.abs(err) > 2.4 && finalLeg && Math.hypot(dx, dz) < 3) { inp.throttle = -0.6; inp.steer = -inp.steer; }
    return inp;
  }
}
