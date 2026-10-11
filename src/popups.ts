// Floating world-space text: "-$3.49" over a smashed egg, "SHELF! -$1,299" over a flattened
// shelf. Textures are cached per string; sprites are pooled.
import * as THREE from 'three';

interface Pop { s: THREE.Sprite; t: number; life: number; vy: number; size: number; aspect: number }

export class Popups {
  group = new THREE.Group();
  private pool: Pop[] = [];
  private live: Pop[] = [];
  private cache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();

  private texture(text: string, color: string) {
    const key = text + '|' + color;
    let c = this.cache.get(key);
    if (c) return c;
    if (this.cache.size > 80) { for (const v of this.cache.values()) v.tex.dispose(); this.cache.clear(); }
    const cv = document.createElement('canvas'), g = cv.getContext('2d')!;
    const font = '900 54px Arial Black, Arial, sans-serif';
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 24, h = 72;
    cv.width = w; cv.height = h;
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineJoin = 'round';
    g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color; g.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    c = { tex, aspect: w / h };
    this.cache.set(key, c);
    return c;
  }

  spawn(text: string, x: number, y: number, z: number, color = '#ffd23a', size = 0.32, life = 1.4) {
    if (this.live.length > 40) return;
    const { tex, aspect } = this.texture(text, color);
    let p = this.pool.pop();
    if (!p) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false }));
      s.renderOrder = 950;
      p = { s, t: 0, life: 0, vy: 0, size: 0, aspect: 1 };
    }
    (p.s.material as THREE.SpriteMaterial).map = tex;
    (p.s.material as THREE.SpriteMaterial).needsUpdate = true;
    p.s.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    p.t = 0; p.life = life; p.vy = 0.9; p.size = size; p.aspect = aspect;
    p.s.visible = true;
    this.group.add(p.s);
    this.live.push(p);
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.t += dt;
      if (p.t >= p.life) { this.group.remove(p.s); this.live.splice(i, 1); this.pool.push(p); continue; }
      p.s.position.y += p.vy * dt; p.vy *= 1 - dt * 1.5;
      const pop = p.t < 0.12 ? 0.6 + (p.t / 0.12) * 0.6 : Math.max(1, 1.2 - (p.t - 0.12) * 2);
      p.s.scale.set(p.size * p.aspect * pop, p.size * pop, 1);
      (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, (p.life - p.t) * 3);
    }
  }

  dispose() {
    for (const v of this.cache.values()) v.tex.dispose();
    for (const p of [...this.pool, ...this.live]) (p.s.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
