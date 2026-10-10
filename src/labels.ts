// Product packaging art, drawn procedurally per item kind.
// Transparent pixels let the per-instance product color show through (so one texture
// serves every color variant); opaque pixels are the printed label.
import * as THREE from 'three';
import type { ItemKind } from './config';

type G = CanvasRenderingContext2D;

/** How the label wraps the product: a flat face (w×h) or a band around a cylinder. */
export interface LabelSpec { kind: 'face' | 'wrap'; aspect: number }

const cache = new Map<string, THREE.CanvasTexture>();

function txt(g: G, s: string, x: number, y: number, size: number, opts: { color?: string; stroke?: string; font?: string; maxW?: number; weight?: number; align?: CanvasTextAlign } = {}) {
  g.font = `${opts.weight ?? 900} ${size}px ${opts.font ?? 'Arial Black, Impact, Arial, sans-serif'}`;
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  if (opts.stroke) { g.lineJoin = 'round'; g.lineWidth = size * 0.18; g.strokeStyle = opts.stroke; g.strokeText(s, x, y, opts.maxW); }
  g.fillStyle = opts.color ?? '#fff';
  g.fillText(s, x, y, opts.maxW);
}
function rrect(g: G, x: number, y: number, w: number, h: number, r: number, fill: string) {
  g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}
function ellipse(g: G, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill();
}
function rng(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

/** Draw `n` repeats of a label around a cylinder band so it reads from any side. */
function around(g: G, W: number, H: number, n: number, draw: (cx: number, w: number) => void) {
  for (let i = 0; i < n; i++) draw((i + 0.5) * (W / n), W / n);
  void H;
}

const DRAW: Record<string, (g: G, W: number, H: number) => void> = {
  cereal(g, W, H) {
    // brand, a bowl of flakes, a "whole grain" banner; box color shows behind
    txt(g, 'FROSTED', W / 2, H * 0.1, W * 0.17, { stroke: '#222', maxW: W * 0.9 });
    txt(g, 'FLAKEZ', W / 2, H * 0.22, W * 0.21, { color: '#ffe23a', stroke: '#222', maxW: W * 0.92 });
    ellipse(g, W / 2, H * 0.58, W * 0.4, H * 0.2, 'rgba(255,255,255,0.25)');
    // bowl
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.ellipse(W / 2, H * 0.6, W * 0.36, H * 0.06, 0, 0, Math.PI); g.lineTo(W * 0.14, H * 0.6);
    g.ellipse(W / 2, H * 0.6, W * 0.36, H * 0.15, 0, Math.PI, 0, true); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(W / 2, H * 0.6, W * 0.36, H * 0.15, 0, 0, Math.PI); g.fill();
    g.strokeStyle = '#3070d0'; g.lineWidth = W * 0.025; g.beginPath(); g.ellipse(W / 2, H * 0.62, W * 0.33, H * 0.11, 0, 0.2, Math.PI - 0.2); g.stroke();
    // flakes heaped in the bowl
    const r = rng(7);
    for (let i = 0; i < 26; i++) ellipse(g, W * (0.2 + r() * 0.6), H * (0.5 + r() * 0.09) + Math.abs(r() - 0.5) * 6, W * 0.06, W * 0.035, r() < 0.5 ? '#f2b83a' : '#e09a28', r() * 3);
    ellipse(g, W * 0.38, H * 0.53, W * 0.05, W * 0.035, '#fff8e8');
    rrect(g, W * 0.08, H * 0.82, W * 0.84, H * 0.12, W * 0.04, '#ffffff');
    txt(g, 'WHOLE GRAIN · 12 OZ', W / 2, H * 0.88, W * 0.08, { color: '#c0302a', maxW: W * 0.8 });
  },
  pasta(g, W, H) {
    rrect(g, W * 0.06, H * 0.03, W * 0.88, H * 0.12, 6, '#fff');
    txt(g, 'PASTA', W / 2, H * 0.09, W * 0.24, { color: '#2050b0', maxW: W * 0.8 });
    // see-through window of dry spaghetti
    rrect(g, W * 0.2, H * 0.2, W * 0.6, H * 0.56, W * 0.12, '#f2d48a');
    g.strokeStyle = '#d8b050'; g.lineWidth = 2;
    for (let x = W * 0.24; x < W * 0.78; x += 5) { g.beginPath(); g.moveTo(x, H * 0.21); g.lineTo(x + 2, H * 0.75); g.stroke(); }
    txt(g, 'SPAGHETTI', W / 2, H * 0.84, W * 0.15, { stroke: '#123', maxW: W * 0.92 });
    txt(g, 'Nº 5', W / 2, H * 0.93, W * 0.14, { color: '#ffe23a', maxW: W * 0.9 });
  },
  tp(g, W, H) {
    // the printed band around a pack of rolls
    g.fillStyle = '#2a62c8'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#4a86e8'; for (let x = -H; x < W; x += H * 0.6) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H * 0.3, 0); g.lineTo(x + H * 0.45, 0); g.lineTo(x + H * 0.15, H); g.fill(); }
    // a cloud with a roll on it
    for (const [dx, dy, r] of [[0, 0, 0.3], [0.22, 0.05, 0.24], [-0.22, 0.06, 0.24]]) ellipse(g, W * 0.17 + dx * H, H * 0.52 + dy * H, r * H, r * H * 0.85, '#fff');
    ellipse(g, W * 0.17, H * 0.45, H * 0.17, H * 0.17, '#f8f8ff'); ellipse(g, W * 0.17, H * 0.45, H * 0.06, H * 0.06, '#c8c0b0');
    txt(g, 'SOFT-EE', W * 0.6, H * 0.34, H * 0.36, { maxW: W * 0.62 });
    txt(g, 'TOILET PAPER · 36 MEGA ROLLS', W * 0.6, H * 0.72, H * 0.17, { color: '#ffe23a', maxW: W * 0.7 });
  },
  tv(g, W, H) {
    // photo of the TV on the box
    g.fillStyle = '#e8eef8'; g.fillRect(0, 0, W, H * 0.16);
    txt(g, 'VIZIONARY', W * 0.25, H * 0.08, H * 0.1, { color: '#1b1b22', maxW: W * 0.45 });
    txt(g, '65" 4K ULTRA HD', W * 0.72, H * 0.08, H * 0.09, { color: '#d02020', maxW: W * 0.5 });
    rrect(g, W * 0.1, H * 0.22, W * 0.8, H * 0.6, 6, '#08080c');
    const gr = g.createLinearGradient(0, H * 0.25, 0, H * 0.78);
    gr.addColorStop(0, '#ff8a3a'); gr.addColorStop(0.45, '#ffd06a'); gr.addColorStop(0.46, '#2a6ab0'); gr.addColorStop(1, '#0a2a5a');
    g.fillStyle = gr; g.fillRect(W * 0.12, H * 0.25, W * 0.76, H * 0.54);
    ellipse(g, W * 0.5, H * 0.5, H * 0.1, H * 0.1, '#fff4c0');
    g.fillStyle = '#333'; g.fillRect(W * 0.46, H * 0.82, W * 0.08, H * 0.04); g.fillRect(W * 0.38, H * 0.86, W * 0.24, H * 0.025);
    txt(g, 'SMART TV · HDR++', W / 2, H * 0.94, H * 0.07, { color: '#fff', maxW: W * 0.8, weight: 700, font: 'Arial, sans-serif' });
  },
  headphones(g, W, H) {
    ellipse(g, W / 2, H * 0.47, W * 0.4, W * 0.4, '#f4f4f4');
    g.strokeStyle = '#222'; g.lineWidth = W * 0.07; g.lineCap = 'round';
    g.beginPath(); g.arc(W / 2, H * 0.5, W * 0.26, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    rrect(g, W * 0.16, H * 0.46, W * 0.17, W * 0.3, W * 0.07, '#222');
    rrect(g, W * 0.67, H * 0.46, W * 0.17, W * 0.3, W * 0.07, '#222');
    rrect(g, W * 0.2, H * 0.49, W * 0.09, W * 0.22, W * 0.04, '#e02050');
    rrect(g, W * 0.71, H * 0.49, W * 0.09, W * 0.22, W * 0.04, '#e02050');
    txt(g, 'BASS BOOM', W / 2, H * 0.1, W * 0.15, { stroke: '#111', maxW: W * 0.9 });
    txt(g, 'WIRELESS', W / 2, H * 0.92, W * 0.1, { color: '#fff', maxW: W * 0.8, weight: 700, font: 'Arial, sans-serif' });
  },
  game(g, W, H) {
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, W, H * 0.12);
    txt(g, 'GAMESTATION 6', W / 2, H * 0.06, H * 0.07, { color: '#2050e0', maxW: W * 0.9 });
    // cover art: a cart racing over hills
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H * 0.12, W, H * 0.88);
    ellipse(g, W * 0.75, H * 0.32, W * 0.12, W * 0.12, '#ffe23a');
    g.fillStyle = '#3ab04a'; g.beginPath(); g.moveTo(0, H * 0.8); g.quadraticCurveTo(W * 0.4, H * 0.5, W, H * 0.72); g.lineTo(W, H); g.lineTo(0, H); g.fill();
    g.strokeStyle = '#ddd'; g.lineWidth = W * 0.03; g.strokeRect(W * 0.3, H * 0.52, W * 0.32, H * 0.13);
    ellipse(g, W * 0.35, H * 0.69, W * 0.04, W * 0.04, '#111'); ellipse(g, W * 0.58, H * 0.69, W * 0.04, W * 0.04, '#111');
    txt(g, 'CART KART', W / 2, H * 0.24, W * 0.18, { stroke: '#111', maxW: W * 0.92 });
  },
  microwave(g, W, H) {
    rrect(g, W * 0.04, H * 0.06, W * 0.92, H * 0.18, 4, '#fff');
    txt(g, 'ZAPMASTER 1000W MICROWAVE', W / 2, H * 0.15, H * 0.1, { color: '#c02020', maxW: W * 0.88 });
    rrect(g, W * 0.06, H * 0.3, W * 0.88, H * 0.64, 8, '#d8d8d8');
    rrect(g, W * 0.1, H * 0.36, W * 0.58, H * 0.52, 6, '#1a1a1e');
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(W * 0.14, H * 0.84); g.lineTo(W * 0.3, H * 0.4); g.lineTo(W * 0.38, H * 0.4); g.lineTo(W * 0.22, H * 0.84); g.fill();
    rrect(g, W * 0.72, H * 0.38, W * 0.18, H * 0.1, 3, '#203a20');
    txt(g, '0:30', W * 0.81, H * 0.43, H * 0.07, { color: '#60ff60', weight: 700, font: 'monospace' });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) rrect(g, W * (0.73 + c * 0.055), H * (0.53 + r * 0.085), W * 0.04, H * 0.06, 2, '#888');
  },
  soup(g, W, H) {
    // classic: colored top half, white bottom half, medallion
    g.fillStyle = '#ffffff'; g.fillRect(0, H * 0.5, W, H * 0.5);
    around(g, W, H, 2, (cx, w) => {
      txt(g, 'SOUP', cx, H * 0.27, H * 0.36, { color: '#fff', stroke: 'rgba(0,0,0,0.35)', maxW: w * 0.8, font: 'Georgia, serif' });
      ellipse(g, cx, H * 0.67, H * 0.13, H * 0.13, '#e0b020');
      txt(g, 'TOMATO', cx, H * 0.88, H * 0.13, { color: '#c8202a', maxW: w * 0.7 });
    });
  },
  energy(g, W, H) {
    around(g, W, H, 2, (cx, w) => {
      g.fillStyle = '#c8ff20'; g.beginPath();
      const s = H * 0.42;
      g.moveTo(cx + s * 0.15, H * 0.08); g.lineTo(cx - s * 0.35, H * 0.55); g.lineTo(cx - s * 0.02, H * 0.55);
      g.lineTo(cx - s * 0.2, H * 0.95); g.lineTo(cx + s * 0.4, H * 0.42); g.lineTo(cx + s * 0.05, H * 0.42); g.closePath(); g.fill();
      txt(g, 'VOLT', cx, H * 0.5, H * 0.3, { color: '#fff', stroke: '#000', maxW: w * 0.7 });
    });
  },
  soda(g, W, H) {
    g.fillStyle = '#d0201a'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#fff'; g.lineWidth = H * 0.06;
    g.beginPath(); for (let x = 0; x <= W; x += 4) g.lineTo(x, H * 0.82 + Math.sin(x / W * Math.PI * 6) * H * 0.07); g.stroke();
    around(g, W, H, 2, (cx, w) => txt(g, 'Fizz Cola', cx, H * 0.42, H * 0.42, { color: '#fff', maxW: w * 0.8, font: 'Georgia, serif', weight: 700 }));
  },
  oil(g, W, H) {
    g.fillStyle = '#f2ead0'; g.fillRect(0, 0, W, H);
    around(g, W, H, 2, (cx, w) => {
      g.strokeStyle = '#4a6a1a'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - w * 0.25, H * 0.3); g.quadraticCurveTo(cx, H * 0.15, cx + w * 0.25, H * 0.3); g.stroke();
      for (const [dx, dy] of [[-0.12, 0.22], [0.05, 0.18], [0.18, 0.25]]) ellipse(g, cx + dx * w, H * dy, w * 0.06, w * 0.035, '#5a7a20', 0.5);
      ellipse(g, cx - w * 0.04, H * 0.33, w * 0.05, w * 0.04, '#2a3a10');
      txt(g, 'OLIVE OIL', cx, H * 0.58, H * 0.16, { color: '#2f4a10', maxW: w * 0.85 });
      txt(g, 'EXTRA VIRGIN', cx, H * 0.78, H * 0.09, { color: '#7a5a20', maxW: w * 0.8, weight: 700, font: 'Arial, sans-serif' });
    });
  },
  kombucha(g, W, H) {
    g.fillStyle = '#c8a878'; g.fillRect(0, 0, W, H);
    around(g, W, H, 2, (cx, w) => {
      ellipse(g, cx, H * 0.3, w * 0.12, H * 0.13, '#3a7a3a', 0.6);
      txt(g, 'KOMBUCHA', cx, H * 0.62, H * 0.17, { color: '#3a2a14', maxW: w * 0.85 });
      txt(g, 'raw · living · weird', cx, H * 0.82, H * 0.09, { color: '#5a4020', maxW: w * 0.8, weight: 600, font: 'Georgia, serif' });
    });
  },
  mayo(g, W, H) {
    g.fillStyle = '#1a4aa8'; g.fillRect(0, H * 0.1, W, H * 0.8);
    around(g, W, H, 2, (cx, w) => {
      ellipse(g, cx - w * 0.28, H * 0.5, H * 0.2, H * 0.2, '#fff'); ellipse(g, cx - w * 0.28, H * 0.5, H * 0.09, H * 0.09, '#ffc020');
      txt(g, 'MEGA', cx + w * 0.08, H * 0.35, H * 0.22, { color: '#ffe23a', maxW: w * 0.5 });
      txt(g, 'MAYO', cx + w * 0.08, H * 0.65, H * 0.24, { color: '#fff', maxW: w * 0.5 });
    });
  },
  eggs(g, W, H) {
    txt(g, 'FARM FRESH EGGS', W * 0.42, H * 0.3, H * 0.28, { color: '#7a4a20', maxW: W * 0.78 });
    for (let i = 0; i < 6; i++) ellipse(g, W * (0.12 + i * 0.12), H * 0.72, H * 0.15, H * 0.2, '#fffaf0');
    rrect(g, W * 0.84, H * 0.1, W * 0.14, H * 0.8, 6, '#ffe23a');
    txt(g, '12', W * 0.91, H * 0.5, H * 0.45, { color: '#c02020' });
  },
  milk(g, W, H) {
    rrect(g, W * 0.06, H * 0.18, W * 0.88, H * 0.7, W * 0.08, '#2a6ad0');
    const r = rng(3);
    for (let i = 0; i < 7; i++) ellipse(g, W * (0.15 + r() * 0.7), H * (0.25 + r() * 0.55), W * (0.04 + r() * 0.06), W * (0.03 + r() * 0.04), 'rgba(255,255,255,0.25)', r() * 3);
    txt(g, 'MILK', W / 2, H * 0.44, W * 0.3, { color: '#fff', maxW: W * 0.8 });
    txt(g, 'WHOLE · 1 GAL', W / 2, H * 0.7, W * 0.11, { color: '#ffe23a', maxW: W * 0.8 });
  },
  detergent(g, W, H) {
    ellipse(g, W / 2, H * 0.45, W * 0.42, H * 0.3, '#fff');
    for (const [x, y, rr] of [[0.2, 0.2, 0.06], [0.8, 0.25, 0.05], [0.75, 0.75, 0.07], [0.25, 0.72, 0.05]]) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(W * x, H * y, W * rr, 0, Math.PI * 2); g.stroke(); }
    txt(g, 'SUDZ', W / 2, H * 0.42, W * 0.26, { color: '#e05010', maxW: W * 0.7 });
    txt(g, 'LAUNDRY', W / 2, H * 0.58, W * 0.11, { color: '#2060c0', maxW: W * 0.7 });
    txt(g, 'ULTRA CLEAN', W / 2, H * 0.88, W * 0.1, { color: '#fff', maxW: W * 0.8 });
  },
  chips(g, W, H) {
    txt(g, 'CRUNCH', W / 2, H * 0.17, W * 0.2, { color: '#fff', stroke: '#222', maxW: W * 0.9 });
    txt(g, 'POTATO CHIPS', W / 2, H * 0.3, W * 0.09, { color: '#ffe23a', stroke: '#222', maxW: W * 0.8 });
    // a pile of chips
    const r = rng(11);
    for (let i = 0; i < 18; i++) ellipse(g, W * (0.22 + r() * 0.56), H * (0.5 + r() * 0.22), W * 0.11, W * 0.07, i % 3 ? '#f4c84a' : '#e8b030', r() * 3);
    rrect(g, W * 0.18, H * 0.82, W * 0.64, H * 0.08, 6, '#fff');
    txt(g, 'SEA SALT', W / 2, H * 0.86, W * 0.08, { color: '#c02020', maxW: W * 0.6 });
  },
  dogfood(g, W, H) {
    txt(g, 'DOG CHOW', W / 2, H * 0.1, W * 0.17, { color: '#fff', stroke: '#222', maxW: W * 0.92 });
    // happy dog face
    const cx = W / 2, cy = H * 0.46, s = W * 0.3;
    ellipse(g, cx - s * 0.8, cy - s * 0.1, s * 0.32, s * 0.6, '#7a4a20', 0.3);
    ellipse(g, cx + s * 0.8, cy - s * 0.1, s * 0.32, s * 0.6, '#7a4a20', -0.3);
    ellipse(g, cx, cy, s * 0.78, s * 0.72, '#d8a060');
    ellipse(g, cx, cy + s * 0.3, s * 0.42, s * 0.3, '#f0d0a0');
    ellipse(g, cx - s * 0.3, cy - s * 0.15, s * 0.1, s * 0.12, '#222'); ellipse(g, cx + s * 0.3, cy - s * 0.15, s * 0.1, s * 0.12, '#222');
    ellipse(g, cx, cy + s * 0.15, s * 0.16, s * 0.11, '#222');
    ellipse(g, cx, cy + s * 0.5, s * 0.12, s * 0.16, '#e05070');
    rrect(g, W * 0.15, H * 0.82, W * 0.7, H * 0.1, 8, '#ffe23a');
    txt(g, '40 LB · BEEF', W / 2, H * 0.87, W * 0.09, { color: '#222', maxW: W * 0.65 });
  },
  bread(g, W, H) {
    // printed bag around the loaf (drawn for a side face, long axis horizontal)
    g.fillStyle = 'rgba(255,255,255,0.0)';
    rrect(g, W * 0.18, H * 0.12, W * 0.64, H * 0.76, H * 0.2, '#ffffff');
    for (let i = 0; i < 3; i++) ellipse(g, W * (0.28 + i * 0.22), H * 0.18, W * 0.06, H * 0.08, ['#e03030', '#30a0e0', '#f0c020'][i]);
    txt(g, 'BREAD', W / 2, H * 0.5, H * 0.3, { color: '#a05a20', maxW: W * 0.58 });
    txt(g, 'SANDWICH WHITE', W / 2, H * 0.74, H * 0.11, { color: '#3060c0', maxW: W * 0.58 });
  },
};

/** Which kinds get a label and how it's applied. */
export function labelSpec(k: ItemKind): LabelSpec | null {
  if (!DRAW[k.id]) return null;
  const [w, h, d] = k.size;
  const r = Math.min(w, d) / 2;
  switch (k.id) {
    case 'soup': case 'energy': return { kind: 'wrap', aspect: (2 * Math.PI * r) / (h * 0.72) };
    case 'soda': case 'oil': case 'kombucha': return { kind: 'wrap', aspect: (2 * Math.PI * r) / (h * 0.25) };
    case 'mayo': return { kind: 'wrap', aspect: (2 * Math.PI * r) / (h * 0.5) };
    case 'tp': return { kind: 'face', aspect: w / (h * 0.38) };
    case 'eggs': return { kind: 'face', aspect: w / (h * 0.55) };
    case 'bread': return { kind: 'face', aspect: w / h };
    case 'milk': case 'detergent': return { kind: 'face', aspect: w / (h * 0.8) };
    default: return { kind: 'face', aspect: w / h };
  }
}

export function labelTexture(k: ItemKind): THREE.CanvasTexture | null {
  const spec = labelSpec(k);
  if (!spec) return null;
  const hit = cache.get(k.id);
  if (hit) return hit;
  // ~256 px on the short side, power-of-two-ish long side for clean mipmaps
  const W = spec.aspect >= 1 ? Math.min(1024, Math.round(256 * spec.aspect)) : 256;
  const H = spec.aspect >= 1 ? 256 : Math.min(1024, Math.round(256 / spec.aspect));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  DRAW[k.id](g, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = 4;
  if (spec.kind === 'wrap') t.wrapS = THREE.RepeatWrapping;
  cache.set(k.id, t);
  return t;
}
