// Navigation grid + A* for bots. Static obstacles are baked once; toppled shelves and
// slicks are re-stamped periodically as dynamic costs so bots route around fresh messes.
export class NavGrid {
  readonly res = 0.5;
  readonly w: number;
  readonly h: number;
  readonly x0: number;
  readonly z0: number;
  staticBlock: Uint8Array;
  cost: Uint8Array; // 0 free … 254 costly, 255 blocked
  private g: Float32Array;
  private f: Float32Array;
  private from: Int32Array;
  private closed: Uint8Array;
  private stamp = 1;
  private seen: Uint32Array;

  constructor(width: number, depth: number) {
    this.w = Math.ceil(width / this.res);
    this.h = Math.ceil(depth / this.res);
    this.x0 = -width / 2;
    this.z0 = -depth / 2;
    const n = this.w * this.h;
    this.staticBlock = new Uint8Array(n);
    this.cost = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.seen = new Uint32Array(n);
  }

  cx(x: number) { return Math.max(0, Math.min(this.w - 1, Math.floor((x - this.x0) / this.res))); }
  cz(z: number) { return Math.max(0, Math.min(this.h - 1, Math.floor((z - this.z0) / this.res))); }
  wx(i: number) { return this.x0 + (i + 0.5) * this.res; }
  wz(j: number) { return this.z0 + (j + 0.5) * this.res; }

  /** Mark an oriented rectangle (center, half extents, yaw) inflated by `pad`. */
  rect(arr: Uint8Array, x: number, z: number, hw: number, hd: number, yaw: number, pad: number, value: number, maxMode = true) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ex = Math.abs(c) * hw + Math.abs(s) * hd + pad, ez = Math.abs(s) * hw + Math.abs(c) * hd + pad;
    for (let j = this.cz(z - ez); j <= this.cz(z + ez); j++) for (let i = this.cx(x - ex); i <= this.cx(x + ex); i++) {
      const dx = this.wx(i) - x, dz = this.wz(j) - z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= hw + pad && Math.abs(lz) <= hd + pad) {
        const k = j * this.w + i;
        arr[k] = maxMode ? Math.max(arr[k], value) : value;
      }
    }
  }

  circle(arr: Uint8Array, x: number, z: number, r: number, value: number) {
    for (let j = this.cz(z - r); j <= this.cz(z + r); j++) for (let i = this.cx(x - r); i <= this.cx(x + r); i++) {
      if ((this.wx(i) - x) ** 2 + (this.wz(j) - z) ** 2 <= r * r) { const k = j * this.w + i; arr[k] = Math.max(arr[k], value); }
    }
  }

  resetDynamic() { this.cost.set(this.staticBlock); }

  blocked(x: number, z: number) { return this.cost[this.cz(z) * this.w + this.cx(x)] === 255; }

  /** Nearest free cell to (x,z) — targets inside obstacles get nudged out. */
  nearestFree(x: number, z: number): [number, number] {
    const i0 = this.cx(x), j0 = this.cz(z);
    for (let r = 0; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      if (this.cost[j * this.w + i] < 255) return [i, j];
    }
    return [i0, j0];
  }

  /** A* over 8-connected cells; returns world-space waypoints (smoothed), or null. */
  path(sx: number, sz: number, tx: number, tz: number, maxIter = 12000): [number, number][] | null {
    const [si, sj] = this.nearestFree(sx, sz);
    const [ti, tj] = this.nearestFree(tx, tz);
    const W = this.w, start = sj * W + si, goal = tj * W + ti;
    const stamp = ++this.stamp;
    const heap: number[] = [];
    const push = (k: number) => {
      heap.push(k);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (this.f[heap[p]] <= this.f[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
          if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const hcost = (k: number) => { const dx = Math.abs((k % W) - ti), dz = Math.abs(((k / W) | 0) - tj); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    this.seen[start] = stamp; this.g[start] = 0; this.f[start] = hcost(start); this.from[start] = -1; this.closed[start] = 0;
    push(start);
    let iter = 0;
    while (heap.length && iter++ < maxIter) {
      const k = pop();
      if (k === goal) break;
      if (this.closed[k] === 1 && this.seen[k] === stamp) continue;
      this.closed[k] = 1;
      const i = k % W, j = (k / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        const c = this.cost[nk];
        if (c === 255) continue;
        if (di && dj && (this.cost[j * W + ni] === 255 || this.cost[nj * W + i] === 255)) continue; // no corner cutting
        const ng = this.g[k] + (di && dj ? Math.SQRT2 : 1) * (1 + c / 12);
        if (this.seen[nk] !== stamp) { this.seen[nk] = stamp; this.closed[nk] = 0; this.g[nk] = Infinity; }
        if (ng < this.g[nk]) { this.g[nk] = ng; this.f[nk] = ng + hcost(nk); this.from[nk] = k; push(nk); }
      }
    }
    if (this.seen[goal] !== stamp || this.g[goal] === Infinity) return null;
    const cells: number[] = [];
    for (let k = goal; k !== -1; k = this.from[k]) cells.push(k);
    cells.reverse();
    // string-pull: keep only cells where line-of-sight breaks
    const pts: [number, number][] = [];
    let anchor = 0;
    pts.push([this.wx(cells[0] % W), this.wz((cells[0] / W) | 0)]);
    for (let n = 2; n < cells.length; n++) {
      if (!this.los(cells[anchor], cells[n])) { anchor = n - 1; pts.push([this.wx(cells[anchor] % W), this.wz((cells[anchor] / W) | 0)]); }
    }
    pts.push([this.wx(ti), this.wz(tj)]);
    return pts;
  }

  private los(a: number, b: number) {
    const W = this.w;
    let x0 = a % W, y0 = (a / W) | 0;
    const x1 = b % W, y1 = (b / W) | 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (this.cost[y0 * W + x0] > 40) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }
}
