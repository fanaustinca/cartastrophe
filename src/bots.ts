// Bot shoppers: pick the best reachable item still on their list, A* through the store
// (routing around toppled shelves and slicks), pure-pursuit steering, sprint on straights,
// ram rivals when they're feeling aggressive, and back out when stuck.
import * as THREE from 'three';
import { RAPIER, Physics, G, groups } from './physics';
import type { Cart, CartInput } from './cart';
import type { StoreWorld } from './store';
import type { Item } from './items';

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

  constructor(public cart: Cart, private ctx: BotCtx, seed: number) {
    const r = (n: number) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    this.skill = 0.35 + r(1) * 0.6;
    this.aggression = r(2);
  }

  private pickTarget(): void {
    const needs = this.ctx.needs();
    const t = this.cart.body.translation();
    let best: Item | null = null, bestScore = Infinity;
    for (const it of this.ctx.world.items.all) {
      if (!it.alive || !needs.get(it.kind.id)) continue;
      const p = it.body.translation();
      if (p.y > 2.3) continue;
      let score = Math.hypot(p.x - t.x, p.z - t.z);
      if (it.kind.fragile && p.y < 0.3) score += 3; // fallen fragile stuff is about to smash
      score += p.y > 1.5 ? 2 : 0;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    this.target = best;
    if (best) { const p = best.body.translation(); this.setGoal(p.x, p.z); }
    else this.goal = null;
  }

  private setGoal(x: number, z: number) {
    this.goal = [x, z];
    const t = this.cart.body.translation();
    this.path = this.ctx.world.nav.path(t.x, t.z, x, z) ?? [[x, z]];
    this.wp = Math.min(1, this.path.length - 1);
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

    // stuck / reversing
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = -1; inp.steer = this.reverseSteer; inp.sprint = false; inp.ride = false;
      if (this.reverseT <= 0) this.replan = 0;
      return inp;
    }
    if (inp.throttle > 0.5 && c.speed() < 0.45) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 1.0) { this.stuckT = 0; this.reverseT = 0.7 + Math.random() * 0.5; this.reverseSteer = Math.random() < 0.5 ? -1 : 1; return inp; }

    // choose the point to steer at
    let aimX: number, aimZ: number;
    if (this.ramTarget && this.ramT > 0) {
      const rt = this.ramTarget.body.translation(); aimX = rt.x; aimZ = rt.z;
    } else {
      if (!this.path.length) { inp.throttle = 0; inp.steer = 0; return inp; }
      while (this.wp < this.path.length - 1 && Math.hypot(this.path[this.wp][0] - t.x, this.path[this.wp][1] - t.z) < 1.3) this.wp++;
      [aimX, aimZ] = this.path[this.wp];
    }
    const dx = aimX - t.x, dz = aimZ - t.z, dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    const err = wrap(desired - c.yaw) + this.noise;
    let steer = THREE.MathUtils.clamp(-err * 2.4, -1, 1);

    // whisker raycasts: veer away from carts / shelves straight ahead
    const fwd = c.forward();
    for (const side of [-0.35, 0.35]) {
      const dir = { x: Math.sin(c.yaw + side), y: 0, z: Math.cos(c.yaw + side) };
      const ray = new RAPIER.Ray({ x: t.x + fwd.x * 0.6, y: 0.6, z: t.z + fwd.z * 0.6 }, dir);
      const hit = this.ctx.phys.world.castRay(ray, 1.8, true, undefined, RAY_GROUPS, undefined, c.body);
      if (hit && hit.timeOfImpact < 1.6 && !(this.ramT > 0)) steer += side > 0 ? 0.6 : -0.6;
    }
    const finalLeg = this.wp >= this.path.length - 1;
    const turnSlow = Math.abs(err) > 1.3 ? 0.25 : Math.abs(err) > 0.6 ? 0.65 : 1;
    const arriveSlow = finalLeg && this.state === 'shop' ? THREE.MathUtils.clamp(dist / 4, 0.35, 1) : 1;
    inp.throttle = turnSlow * arriveSlow * (0.7 + 0.3 * this.skill);
    inp.steer = THREE.MathUtils.clamp(steer, -1, 1);
    inp.sprint = Math.abs(err) < 0.3 && dist > 6 && c.stamina > 1.1 - this.skill;
    inp.ride = false;
    if (Math.abs(err) > 2.6 && dist < 3) { inp.throttle = -0.6; inp.steer = -inp.steer; }
    return inp;
  }
}
