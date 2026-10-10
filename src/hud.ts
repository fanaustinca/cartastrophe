// HUD: timer, grocery list, standings, speed/stamina, messages, minimap. DOM updates are throttled.
import type { Game } from './game';
import { KIND_BY_ID, STORE_BY_ID } from './config';
import { SHELF_LEN, SHELF_DEPTH } from './shelves';

const $ = (id: string) => document.getElementById(id)!;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const ord = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0] ?? 'th');

export class Hud {
  private acc = 0;
  private mapBg: HTMLCanvasElement | null = null;
  private lastMsgKey = '';
  private map = $('h-map') as HTMLCanvasElement;

  show(on: boolean) { $('hud').classList.toggle('hidden', !on); }

  reset(g: Game) {
    this.mapBg = null;
    $('h-store').textContent = `${STORE_BY_ID[g.cfg.storeId].name.toUpperCase()} · ${STORE_BY_ID[g.cfg.storeId].tagline}`;
    this.lastMsgKey = '';
  }

  update(g: Game, dt: number, fps: number) {
    // per-frame: countdown + speed
    const cd = $('h-count');
    if (g.phase === 'countdown') cd.textContent = String(Math.max(1, Math.ceil(g.countdown)));
    else cd.textContent = g.raceTime < 0.8 && g.phase === 'race' ? 'GO!' : '';
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

    // grocery list
    const lp = g.local;
    let html = '<div class="t">SHOPPING LIST</div>';
    for (const e of g.cfg.list) {
      const k = KIND_BY_ID[e.kind], got = Math.min(e.qty, lp.collected[e.kind] ?? 0);
      html += `<div class="it ${got >= e.qty ? 'got' : ''}"><span>${k.icon} ${k.label}</span><span>${got}/${e.qty}</span></div>`;
    }
    if (lp.done) html += `<div class="go">✅ CHECKED OUT ${lp.finishTime.toFixed(2)}s</div>`;
    else if (g.complete(lp)) html += '<div class="go">➡ GO TO ANY CHECKOUT!</div>';
    $('h-list').innerHTML = html;

    // standings
    const rows = g.standings();
    $('h-standings').innerHTML = rows.map((r) => `<div class="${r.slot === lp.slot ? 'me' : ''}"><span>${ord(r.place)}</span><span class="dot" style="background:${hex(r.color)}"></span><span>${r.name}</span><span style="margin-left:auto">${r.done ? '✅' : `${r.items}/${g.listTotal()}`}</span></div>`).join('');

    // messages
    const key = g.messages.map((m) => m.text).join('|');
    if (key !== this.lastMsgKey) { this.lastMsgKey = key; $('h-msgs').innerHTML = g.messages.map((m) => `<div style="color:${m.color}">${m.text}</div>`).join(''); }
    $('h-fps').textContent = `${fps.toFixed(0)} fps · phys ${g.stats.physMs.toFixed(1)}ms · awake items ${g.world.items.awakeCount} · shelves ${g.world.shelves.awakeCount()}`;
    this.drawMap(g);
  }

  private drawMap(g: Game) {
    const W = g.world.bounds.w, D = g.world.bounds.d;
    const cw = this.map.width, ch = this.map.height;
    const s = Math.min(cw / W, ch / D) * 0.94;
    const ox = cw / 2, oz = ch / 2;
    const tx = (x: number) => ox + x * s, tz = (z: number) => oz + z * s;
    if (!this.mapBg) {
      const bg = document.createElement('canvas'); bg.width = cw; bg.height = ch;
      const b = bg.getContext('2d')!;
      b.fillStyle = 'rgba(255,255,255,0.06)'; b.fillRect(tx(-W / 2), tz(-D / 2), W * s, D * s);
      for (const l of g.world.lanes) { b.fillStyle = 'rgba(255,80,40,0.55)'; b.fillRect(tx(l.x - l.hw), tz(l.z - l.hd), l.hw * 2 * s, l.hd * 2 * s); }
      this.mapBg = bg;
    }
    const ctx = this.map.getContext('2d')!;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(this.mapBg, 0, 0);
    // shelves (live: toppled ones show where they fell)
    ctx.fillStyle = 'rgba(200,210,230,0.55)';
    for (const sh of g.world.shelves.shelves) {
      const t = sh.body.translation();
      ctx.save(); ctx.translate(tx(t.x), tz(t.z));
      const r = sh.body.rotation();
      ctx.rotate(-Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)));
      ctx.fillStyle = sh.moved ? 'rgba(255,140,60,0.8)' : 'rgba(200,210,230,0.55)';
      ctx.fillRect((-SHELF_LEN / 2) * s, (-SHELF_DEPTH / 2) * s, SHELF_LEN * s, SHELF_DEPTH * s);
      ctx.restore();
    }
    for (const sl of g.world.hazards.slicks) {
      if (!sl.active) continue;
      ctx.fillStyle = sl.type === 'oil' ? 'rgba(20,20,10,0.9)' : sl.type === 'egg' ? 'rgba(255,200,40,0.8)' : 'rgba(240,240,240,0.7)';
      ctx.beginPath(); ctx.arc(tx(sl.x), tz(sl.z), Math.max(1.5, sl.r * s), 0, Math.PI * 2); ctx.fill();
    }
    // needed items (small yellow ticks)
    const needs = g.needs(g.local);
    if (needs.size) {
      ctx.fillStyle = '#ffd23a';
      for (const it of g.world.items.all) {
        if (!it.alive || !needs.has(it.kind.id)) continue;
        const t = it.body.translation();
        ctx.fillRect(tx(t.x) - 1, tz(t.z) - 1, 2, 2);
      }
    }
    for (const p of g.players) {
      const t = p.cart.model.root.position, yaw = p.cart.model.root.rotation.y;
      ctx.save(); ctx.translate(tx(t.x), tz(t.z)); ctx.rotate(-yaw);
      ctx.fillStyle = hex(p.info.color);
      ctx.strokeStyle = p === g.local ? '#fff' : 'rgba(0,0,0,0.6)'; ctx.lineWidth = p === g.local ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(-4, -4); ctx.lineTo(4, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}
