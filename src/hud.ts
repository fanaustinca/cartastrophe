// HUD: timer, grocery list (with product pictures + where to find them), guide arrow, standings,
// speed/stamina, messages, a heading-up minimap and a full store map (M). DOM updates are throttled.
import type { Game } from './game';
import { KIND_BY_ID, STORE_BY_ID, kindName } from './config';
import { SHELF_LEN, SHELF_DEPTH } from './shelves';
import type { Cluster } from './guides';

const $ = (id: string) => document.getElementById(id)!;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const ord = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0] ?? 'th');
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/** world → canvas projection: translate, rotate, scale. */
interface Proj { cx: number; cy: number; ox: number; oz: number; s: number; rot: number }
const P = (p: Proj, x: number, z: number): [number, number] => {
  const dx = (x - p.ox) * p.s, dz = (z - p.oz) * p.s, c = Math.cos(p.rot), sn = Math.sin(p.rot);
  return [p.cx + dx * c - dz * sn, p.cy + dx * sn + dz * c];
};

export class Hud {
  thumb: ((id: string) => HTMLCanvasElement) | null = null;
  thumbUrl: ((id: string) => string) | null = null;
  bigMap = false;
  private acc = 0;
  private lastMsgKey = '';
  private lastListKey = '';
  private map = $('h-map') as HTMLCanvasElement;
  private big = $('h-bigmap') as HTMLCanvasElement;

  show(on: boolean) { $('hud').classList.toggle('hidden', !on); }

  toggleMap(on = !this.bigMap) {
    this.bigMap = on;
    $('h-bigwrap').classList.toggle('hidden', !on);
  }

  reset(g: Game) {
    $('h-store').textContent = `${STORE_BY_ID[g.cfg.storeId].name.toUpperCase()} · ${STORE_BY_ID[g.cfg.storeId].tagline}`;
    this.lastMsgKey = '';
    this.lastListKey = '';
    this.toggleMap(false);
  }

  update(g: Game, dt: number, fps: number) {
    // per-frame: countdown + guide arrow + minimap
    const cd = $('h-count');
    if (g.phase === 'countdown') cd.textContent = String(Math.max(1, Math.ceil(g.countdown)));
    else cd.textContent = g.raceTime < 0.8 && g.phase === 'race' ? 'GO!' : '';
    this.guide(g);
    this.acc -= dt;
    if (this.acc > 0) return;
    this.acc = 0.1;
    const left = Math.max(0, g.cfg.time - g.raceTime);
    const tm = $('h-timer');
    tm.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    tm.classList.toggle('low', left < 30);
    const c = g.local.cart;
    $('h-speed').innerHTML = `<b>${Math.round(c.speed() * 3.6)}</b> km/h${c.boost > 0 ? ' 🔥' : ''}${c.riding ? ' · RIDING' : ''}`;
    ($('h-stamina') as HTMLElement).style.width = `${c.stamina * 100}%`;
    const st = c.surface.type;
    $('h-surface').textContent = st ? ({ egg: '🥚 EGG YOLK — slippery!', milk: '🥛 MILK — slippery!', oil: '🛢 OIL — no grip!', soda: '🥤 STICKY SODA — slow!', mayo: '🫙 MAYO — slick!' } as Record<string, string>)[st] ?? '' : '';

    // grocery list: picture, plain name, where the nearest ones are
    const lp = g.local;
    const where = new Map<string, Cluster>();
    for (const cl of g.guides.clusters) if (!where.has(cl.kind)) where.set(cl.kind, cl);
    let html = '<div class="t">SHOPPING LIST</div>';
    for (const e of g.cfg.list) {
      const k = KIND_BY_ID[e.kind], got = Math.min(e.qty, lp.collected[e.kind] ?? 0), done = got >= e.qty;
      const img = this.thumbUrl ? `<img src="${this.thumbUrl(e.kind)}" alt="">` : `<span class="em">${k.icon}</span>`;
      const w = done ? '✓ in cart' : where.get(e.kind)?.where ?? 'all gone?';
      html += `<div class="it ${done ? 'got' : ''}">${img}<div class="nm"><b>${kindName(e.kind)}</b><i>${w}</i></div><span class="q">${got}/${e.qty}</span></div>`;
    }
    if (lp.done) html += `<div class="go">✅ CHECKED OUT ${lp.finishTime.toFixed(2)}s</div>`;
    else if (g.complete(lp)) html += '<div class="go">➡ GO TO ANY CHECKOUT!</div>';
    if (html !== this.lastListKey) { this.lastListKey = html; $('h-list').innerHTML = html; }

    // standings
    const rows = g.standings();
    $('h-standings').innerHTML = rows.map((r) => `<div class="${r.slot === lp.slot ? 'me' : ''}"><span>${ord(r.place)}</span><span class="dot" style="background:${hex(r.color)}"></span><span>${r.name}</span><span style="margin-left:auto">${r.done ? '✅' : `${r.items}/${g.listTotal()}`}</span></div>`).join('');

    // messages
    const key = g.messages.map((m) => m.text).join('|');
    if (key !== this.lastMsgKey) { this.lastMsgKey = key; $('h-msgs').innerHTML = g.messages.map((m) => `<div style="color:${m.color}">${m.text}</div>`).join(''); }
    $('h-fps').textContent = `${fps.toFixed(0)} fps · phys ${g.stats.physMs.toFixed(1)}ms · awake items ${g.world.items.awakeCount} · shelves ${g.world.shelves.awakeCount()}`;
    this.drawMinimap(g);
    if (this.bigMap) this.drawBigMap(g);
  }

  /** Arrow at the top of the screen pointing at the nearest needed item (or the checkouts). */
  private guide(g: Game) {
    const el = $('h-guide');
    const me = g.local, root = me.cart.model.root;
    let tx: number, tz: number, label: string, img = '';
    if (me.done || g.phase === 'over') { el.classList.add('hidden'); return; }
    if (g.guides.checkout) {
      let best = g.world.lanes[0], bd = Infinity;
      for (const l of g.world.lanes) { const d = Math.hypot(l.x - root.position.x, l.z - root.position.z); if (d < bd) { bd = d; best = l; } }
      tx = best.x; tz = best.z; label = 'CHECKOUT';
    } else {
      const n = g.guides.nearest;
      if (!n) { el.classList.add('hidden'); return; }
      tx = n.x; tz = n.z; label = `${kindName(n.kind)} · ${n.where}`;
      if (this.thumbUrl) img = this.thumbUrl(n.kind);
    }
    el.classList.remove('hidden');
    const dx = tx - root.position.x, dz = tz - root.position.z, d = Math.hypot(dx, dz);
    const rel = wrap(Math.atan2(dx, dz) - root.rotation.y);
    const key = `${label}|${img}|${Math.round(d)}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = `<span class="ar">▲</span>${img ? `<img src="${img}" alt="">` : ''}<span>${label} <small>${Math.round(d)} m</small></span>`;
    }
    (el.firstElementChild as HTMLElement).style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
  }

  private drawShelves(ctx: CanvasRenderingContext2D, g: Game, p: Proj) {
    for (const sh of g.world.shelves.shelves) {
      const t = sh.body.translation(), r = sh.body.rotation();
      const [x, y] = P(p, t.x, t.z);
      if (x < -40 || y < -40 || x > ctx.canvas.width + 40 || y > ctx.canvas.height + 40) continue;
      ctx.save(); ctx.translate(x, y);
      ctx.rotate(p.rot - Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)));
      ctx.fillStyle = sh.toppled ? 'rgba(255,120,50,0.9)' : 'rgba(205,215,235,0.6)';
      ctx.fillRect((-SHELF_LEN / 2) * p.s, (-SHELF_DEPTH / 2) * p.s, SHELF_LEN * p.s, SHELF_DEPTH * p.s);
      ctx.restore();
    }
  }

  private drawCommon(ctx: CanvasRenderingContext2D, g: Game, p: Proj, iconPx: number, labels: boolean) {
    const W = g.world.bounds.w, D = g.world.bounds.d;
    // store floor
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    for (const [i, [x, z]] of ([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]] as const).entries()) { const [a, b] = P(p, x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    // checkout lanes
    ctx.fillStyle = g.guides.checkout ? 'rgba(255,210,58,0.85)' : 'rgba(255,90,50,0.6)';
    for (const l of g.world.lanes) {
      const [a, b] = P(p, l.x, l.z);
      ctx.beginPath(); ctx.arc(a, b, Math.max(3, l.hw * p.s * 0.8), 0, Math.PI * 2); ctx.fill();
    }
    this.drawShelves(ctx, g, p);
    // spills
    for (const sl of g.world.hazards.slicks) {
      if (!sl.active) continue;
      const [a, b] = P(p, sl.x, sl.z);
      ctx.fillStyle = sl.type === 'oil' ? 'rgba(20,20,10,0.9)' : sl.type === 'egg' ? 'rgba(255,200,40,0.8)' : 'rgba(240,240,240,0.7)';
      ctx.beginPath(); ctx.arc(a, b, Math.max(1.5, sl.r * p.s), 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (labels) {
      ctx.font = `800 ${Math.max(9, iconPx * 0.42)}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const a of g.world.aisleZones) { const [x, y] = P(p, (a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2); ctx.fillText(a.name.replace('Aisle ', ''), x, y); }
      const [cx, cy] = P(p, 0, g.world.checkoutZ + 1.9);
      ctx.fillStyle = '#ffd23a'; ctx.fillText('CHECKOUT', cx, cy);
    }
  }

  /** Product badges for the needed-item clusters; off-map ones are pinned to the edge. */
  private drawClusters(ctx: CanvasRenderingContext2D, g: Game, p: Proj, px: number, clampR: number | null) {
    const near = g.guides.nearest;
    for (const c of [...g.guides.clusters].reverse()) {
      let [x, y] = P(p, c.x, c.z);
      if (clampR !== null) {
        const dx = x - p.cx, dy = y - p.cy, d = Math.hypot(dx, dy);
        if (d > clampR) { x = p.cx + (dx / d) * clampR; y = p.cy + (dy / d) * clampR; }
      }
      const r = (c === near ? 1.25 : 1) * px / 2;
      ctx.fillStyle = c === near ? '#ffd23a' : '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
      const t = this.thumb?.(c.kind);
      if (t) ctx.drawImage(t, x - r, y - r, r * 2, r * 2);
    }
  }

  private drawPlayers(ctx: CanvasRenderingContext2D, g: Game, p: Proj, size: number) {
    for (const pl of [...g.players].sort((a, b) => (a === g.local ? 1 : b === g.local ? -1 : 0))) {
      const t = pl.cart.model.root.position, yaw = pl.cart.model.root.rotation.y;
      const [x, y] = P(p, t.x, t.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot - yaw);
      const k = pl === g.local ? size * 1.4 : size;
      ctx.fillStyle = hex(pl.info.color);
      ctx.strokeStyle = pl === g.local ? '#fff' : 'rgba(0,0,0,0.6)'; ctx.lineWidth = pl === g.local ? 2.5 : 1;
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(-k * 0.7, -k * 0.7); ctx.lineTo(0, -k * 0.3); ctx.lineTo(k * 0.7, -k * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  /** Heading-up, zoomed-in map centred on the player: "up" is always the way you're facing. */
  private drawMinimap(g: Game) {
    const ctx = this.map.getContext('2d')!;
    const cw = this.map.width, ch = this.map.height;
    const root = g.local.cart.model.root;
    const p: Proj = { cx: cw / 2, cy: ch * 0.58, ox: root.position.x, oz: root.position.z, s: cw / 48, rot: root.rotation.y + Math.PI };
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, 14); ctx.clip();
    ctx.fillStyle = 'rgba(12,14,22,0.82)'; ctx.fillRect(0, 0, cw, ch);
    this.drawCommon(ctx, g, p, 22, true);
    this.drawClusters(ctx, g, p, 22, Math.min(cw, ch) / 2 - 14);
    this.drawPlayers(ctx, g, p, 6);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '700 10px Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('M · store map', cw - 8, ch - 6);
  }

  /** Whole store, front (checkouts) at the bottom. */
  private drawBigMap(g: Game) {
    const r = this.big.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(200, Math.round(r.width * dpr)), ch = Math.max(160, Math.round(r.height * dpr));
    if (this.big.width !== cw || this.big.height !== ch) { this.big.width = cw; this.big.height = ch; }
    const ctx = this.big.getContext('2d')!;
    const W = g.world.bounds.w, D = g.world.bounds.d;
    const s = Math.min(cw / W, ch / D) * 0.94;
    const p: Proj = { cx: cw / 2, cy: ch / 2, ox: 0, oz: 0, s, rot: 0 };
    ctx.clearRect(0, 0, cw, ch);
    this.drawCommon(ctx, g, p, 16 * dpr * 1.6, true);
    ctx.font = `800 ${12 * dpr}px Arial, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const l of g.world.landmarks) if (!l.name.startsWith('Aisle')) { const [x, y] = P(p, l.x, l.z); ctx.fillText(l.name.toUpperCase(), x, y - 14 * dpr); }
    this.drawClusters(ctx, g, p, 26 * dpr, null);
    this.drawPlayers(ctx, g, p, 7 * dpr);
  }
}
