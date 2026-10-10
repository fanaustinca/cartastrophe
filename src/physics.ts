// Rapier world wrapper: fixed-step world, collision groups, contact-force event routing.
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };
export let ready = false;
export async function initPhysics() {
  if (!ready) { await RAPIER.init(); ready = true; }
}

// collision group membership bits
export const G = { STATIC: 1, SHELF: 2, ITEM: 4, CART: 8, REMOTE: 16 } as const;
export const groups = (member: number, filter: number) => (member << 16) | filter;
export const ALL = 0xffff;

export type ForceHandler = (otherHandle: number, force: number, dir: { x: number; y: number; z: number }) => void;

export class Physics {
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  private handlers = new Map<number, ForceHandler>();
  stepMs = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = 4;
    this.events = new RAPIER.EventQueue(true);
  }

  onForce(colliderHandle: number, h: ForceHandler) { this.handlers.set(colliderHandle, h); }
  offForce(colliderHandle: number) { this.handlers.delete(colliderHandle); }

  step() {
    const t0 = performance.now();
    this.world.step(this.events);
    this.events.drainContactForceEvents((e) => {
      const a = e.collider1(), b = e.collider2();
      const f = e.totalForceMagnitude();
      const d = e.maxForceDirection();
      const ha = this.handlers.get(a), hb = this.handlers.get(b);
      if (ha) ha(b, f, d);
      if (hb) hb(a, f, { x: -d.x, y: -d.y, z: -d.z });
    });
    this.events.clear();
    this.stepMs = performance.now() - t0;
  }

  free() { this.world.free(); this.events.free(); }
}
