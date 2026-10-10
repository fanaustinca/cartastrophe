// Procedural canvas textures: floors, brand logos, aisle signs, labels. No image assets needed.
import * as THREE from 'three';
import type { StoreDef } from './config';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function tex(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

export function floorTexture(s: StoreDef): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const a = hex(s.colors.floor), b = hex(s.colors.floor2);
  g.fillStyle = a; g.fillRect(0, 0, 512, 512);
  switch (s.floorPattern) {
    case 'checker':
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) { g.fillStyle = b; g.fillRect(x * 128, y * 128, 128, 128); }
      break;
    case 'tile':
      g.strokeStyle = b; g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke(); }
      break;
    case 'concrete':
      for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() < 0.5 ? b : '#a4a4a0'; g.globalAlpha = Math.random() * 0.35; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
      g.globalAlpha = 0.5; g.strokeStyle = '#6a6a66'; g.lineWidth = 2; g.strokeRect(1, 1, 510, 510);
      break;
    case 'wood':
      for (let y = 0; y < 8; y++) {
        const off = (y % 2) * 128;
        for (let x = -1; x < 3; x++) {
          g.fillStyle = (x + y) % 3 === 0 ? b : a; g.fillRect(x * 256 + off, y * 64, 256, 64);
          g.strokeStyle = '#3a2614'; g.lineWidth = 2; g.strokeRect(x * 256 + off, y * 64, 256, 64);
          g.globalAlpha = 0.18; g.strokeStyle = '#2a1a0a';
          for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x * 256 + off, y * 64 + 8 + k * 9 + Math.random() * 4); g.bezierCurveTo(x * 256 + off + 80, y * 64 + k * 9, x * 256 + off + 170, y * 64 + 14 + k * 9, x * 256 + off + 256, y * 64 + 8 + k * 9); g.stroke(); }
          g.globalAlpha = 1;
        }
      }
      break;
    case 'carpet':
      for (let i = 0; i < 14000; i++) { g.fillStyle = Math.random() < 0.5 ? b : '#4a5060'; g.globalAlpha = 0.5; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
      g.globalAlpha = 0.25; g.fillStyle = hex(s.colors.secondary);
      for (let i = 0; i < 40; i++) { g.fillRect(Math.random() * 512, Math.random() * 512, 6, 2); }
      break;
  }
  g.globalAlpha = 1;
  const t = tex(c, true);
  return t;
}

/** Store logo rendered onto a wide canvas. */
export function logoTexture(s: StoreDef, w = 1024, h = 256): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  const P = hex(s.colors.primary), S = hex(s.colors.secondary);
  g.fillStyle = s.id === 'bullseye' ? '#ffffff' : P; g.fillRect(0, 0, w, h);
  g.textBaseline = 'middle';
  const font = (sz: number, f = 'Arial Black, Impact, sans-serif') => `900 ${sz}px ${f}`;
  switch (s.id) {
    case 'costplenty': {
      g.fillStyle = '#ffffff'; g.fillRect(0, h * 0.62, w, h * 0.38);
      g.fillStyle = hex(s.colors.secondary); g.font = font(h * 0.5); g.textAlign = 'center';
      g.fillStyle = '#ffffff'; g.fillText('COST', w * 0.5, h * 0.33);
      g.fillStyle = hex(s.colors.secondary); g.font = font(h * 0.3); g.fillText('PLENTY  WHOLESALE', w * 0.5, h * 0.81);
      break;
    }
    case 'bullseye': {
      const cx = h * 0.6, cy = h / 2;
      for (const [r, col] of [[h * 0.42, P], [h * 0.3, '#fff'], [h * 0.17, P]] as const) { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = P; g.font = font(h * 0.38); g.textAlign = 'left'; g.fillText('BULLSEYE', h * 1.15, h * 0.5);
      break;
    }
    case 'wholefarm': {
      g.fillStyle = S; g.font = `italic 900 ${h * 0.42}px Georgia, serif`; g.textAlign = 'center';
      g.fillText('WHOLE FARM', w / 2, h * 0.42);
      g.font = `600 ${h * 0.16}px Georgia, serif`; g.fillText('~ market ~ est. last tuesday ~', w / 2, h * 0.78);
      g.fillStyle = '#7ac050'; g.beginPath(); g.ellipse(w * 0.06, h * 0.5, h * 0.12, h * 0.28, 0.6, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(w * 0.94, h * 0.5, h * 0.12, h * 0.28, -0.6, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'bestbuyout': {
      g.fillStyle = S; g.beginPath();
      g.moveTo(w * 0.08, h * 0.12); g.lineTo(w * 0.62, h * 0.12); g.lineTo(w * 0.72, h * 0.5); g.lineTo(w * 0.62, h * 0.88); g.lineTo(w * 0.08, h * 0.88); g.closePath(); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.arc(w * 0.62, h * 0.5, h * 0.07, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.font = font(h * 0.3); g.textAlign = 'left'; g.fillText('BEST', w * 0.12, h * 0.33); g.fillText('BUYOUT', w * 0.12, h * 0.68);
      g.fillStyle = '#fff'; g.font = font(h * 0.14); g.fillText('™ NO REFUNDS', w * 0.75, h * 0.5);
      break;
    }
    default: {
      g.fillStyle = '#fff'; g.font = font(h * 0.46); g.textAlign = 'center';
      g.fillText('SAFELY', w * 0.5, h * 0.42);
      g.fillStyle = hex(s.colors.accent); g.fillRect(w * 0.18, h * 0.72, w * 0.64, h * 0.12);
      g.fillStyle = '#fff'; g.font = font(h * 0.14); g.fillText('M A R K E T', w * 0.5, h * 0.785);
    }
  }
  return tex(c);
}

export function signTexture(title: string, sub: string, bg: number, fg = 0xffffff, w = 512, h = 192): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = hex(bg); g.fillRect(0, 0, w, h);
  g.strokeStyle = hex(fg); g.globalAlpha = 0.35; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); g.globalAlpha = 1;
  g.fillStyle = hex(fg); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${h * 0.36}px Arial Black, Impact, sans-serif`;
  g.fillText(title, w / 2, sub ? h * 0.38 : h / 2, w - 30);
  if (sub) { g.font = `700 ${h * 0.17}px Arial, sans-serif`; g.fillText(sub, w / 2, h * 0.74, w - 30); }
  return tex(c);
}

export function nameTagTexture(name: string, color: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 16); g.fill();
  g.fillStyle = hex(color); g.font = '800 28px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 236);
  return tex(c);
}

/** Animated TV-wall screen texture; caller invokes update(t). */
export function tvScreen(): { texture: THREE.CanvasTexture; update: (t: number) => void } {
  const [c, g] = canvas(256, 144);
  const texture = tex(c);
  const update = (t: number) => {
    const h1 = (t * 40) % 360;
    const grd = g.createLinearGradient(0, 0, 256, 144);
    grd.addColorStop(0, `hsl(${h1},80%,50%)`); grd.addColorStop(1, `hsl(${(h1 + 120) % 360},80%,35%)`);
    g.fillStyle = grd; g.fillRect(0, 0, 256, 144);
    g.fillStyle = '#fff'; g.font = '900 30px Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const msgs = ['8K ULTRA', 'DOORBUSTER', 'CART CRASH TV', 'HDR++', 'NO REFUNDS'];
    g.fillText(msgs[Math.floor(t / 2.5) % msgs.length], 128 + Math.sin(t * 2) * 20, 72);
    texture.needsUpdate = true;
  };
  update(0);
  return { texture, update };
}
