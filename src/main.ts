// App shell: renderer, menus, garage/shop, lobby flow, main loop, adaptive resolution, test API.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { initPhysics, RAPIER } from './physics';
import { Game, RaceConfig, ResultRow, SLOT_COLORS } from './game';
import { Hud } from './hud';
import { Sfx } from './audio';
import { Session, randomCustom, sanitize } from './session';
import { lobbyCode, LocalTransport } from './net';
import { loadProfile, saveProfile, Profile, CATEGORIES, Category } from './save';
import { STORES, STORE_BY_ID, BOT_NAMES, RACE_TIME, Customization, WHEELS, SKINS, NEONS, ITEM_KINDS, kindName, BODIES, UPGRADES, MAX_LEVEL, upgradePrice, cartStats, TRIMS, HATS, HORNS } from './config';
import { CartModel, NO_INPUT } from './cart';
import { Restock } from './restock';
import { ShelfSystem } from './shelves';
import { logoTexture } from './textures';
import { thumbCanvas, thumbUrl } from './thumbs';
import * as fun from './fun';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const LOCAL_NET = params.get('net') === 'local';
LocalTransport.lag = Number(params.get('lag') ?? 0);
LocalTransport.jitter = Number(params.get('jitter') ?? 0);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

let profile: Profile = loadProfile(params.has('fresh'));
const sfx = new Sfx();
sfx.enabled = !TEST;
sfx.setVolume(profile.volume);
sfx.voice = profile.voice;
const hud = new Hud();

// ---------------- renderer ----------------
const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.quality !== 'low' && !TEST, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in three r18x; asking for it left receivers with a mismatched shadow sampler (nothing drawn)
const maxRatio = Math.min(window.devicePixelRatio || 1, profile.quality === 'high' ? 2 : 1.5);
let pixelRatio = TEST ? 1 : maxRatio;
renderer.setPixelRatio(pixelRatio);
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
hud.thumb = (id) => thumbCanvas(renderer, id);
hud.thumbUrl = (id) => thumbUrl(renderer, id);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const a = window.innerWidth / Math.max(1, window.innerHeight);
  if (game) { game.camera.aspect = a; game.camera.updateProjectionMatrix(); }
  garageCam.aspect = a; garageCam.updateProjectionMatrix();
  garageView($('garage').classList.contains('show'));
}

// ---------------- garage / menu backdrop ----------------
const garageScene = new THREE.Scene();
const garageCam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
garageScene.background = new THREE.Color(0x15171f);
garageScene.environment = envMap;
garageScene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(3, 5, 4); garageScene.add(key);
const turntable = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.08, 48), new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.6, roughness: 0.35 }));
turntable.position.y = -0.04; garageScene.add(turntable);
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: logoTexture(STORES[0]) }));
backdrop.position.set(0, 2.3, -3.5); garageScene.add(backdrop);
let garageCart = new CartModel(profile.custom, { local: false, avatarColor: SLOT_COLORS[0], envMap });
garageCart.setFirstPerson(false);
garageScene.add(garageCart.root);
garageCam.position.set(2.6, 1.7, 3.2); garageCam.lookAt(0, 0.7, 0);
let backdropStore = 0, backdropT = 0;

function refreshGarageCart() {
  garageCart.applyCustom(profile.custom);
  // frame whatever's on the turntable (a 100-storey cart needs a step back)
  const b = BODIES.find((x) => x.id === profile.custom.body) ?? BODIES[0];
  if (b.levels > 4) { garageCam.position.set(6.5, 3.2, 8.2); garageCam.lookAt(0, 3.4, 0); }
  else {
    const k = Math.max(b.sx, b.sz * 0.8, b.sy, 1 + (b.levels - 1) * 0.45);
    garageCam.position.set(2.6 * (0.55 + 0.45 * k), 1.7 * (0.6 + 0.4 * k), 3.2 * (0.55 + 0.45 * k));
    garageCam.lookAt(0, 0.7 * (0.5 + 0.5 * Math.max(b.sy, 1 + (b.levels - 1) * 0.8)), 0);
  }
}
refreshGarageCart();

// ---------------- state ----------------
let game: Game | null = null;
let session: Session | null = null;
let selectedStore = STORES[Math.floor(Math.random() * STORES.length)].id;
let paused = false;
let lastSolo: string | null = null;

function show(id: string | null) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
  garageView(id === 'garage');
}
/** In the garage the shop sits on the right, so slide the turntable into the left part of the frame. */
function garageView(on: boolean) {
  const w = window.innerWidth, h = Math.max(1, window.innerHeight);
  if (on && w > 760) garageCam.setViewOffset(w, h, w * 0.22, 0, w, h); else garageCam.clearViewOffset();
  garageCam.updateProjectionMatrix();
}
function err(msg: string) { $('title-err').textContent = msg; }

// ---------------- menus ----------------
function renderStores(el: HTMLElement, sel: string, onPick: (id: string) => void, enabled = true) {
  el.innerHTML = '';
  for (const s of STORES) {
    const b = document.createElement('button');
    b.className = 'store' + (s.id === sel ? ' sel' : '');
    b.disabled = !enabled;
    b.innerHTML = `<b><span class="sw" style="background:${hex(s.colors.primary)}"></span>${s.name}</b><i>${s.tagline}</i>`;
    b.onclick = () => onPick(s.id);
    el.appendChild(b);
  }
}
function titleScreen() {
  show('title');
  hud.show(false);
  $('coupons').textContent = String(profile.coupons);
  renderRank();
  renderDaily($('daily'), []);
  renderStores($('store-pick'), selectedStore, (id) => { selectedStore = id; titleScreen(); });
  const join = params.get('join');
  if (join && !$<HTMLInputElement>('join-code').value) $<HTMLInputElement>('join-code').value = join;
}

$('btn-quick').onclick = () => { sfx.unlock(); startSolo(selectedStore); };
$('btn-host').onclick = async () => {
  sfx.unlock(); err('');
  try {
    session = await Session.host(lobbyCode(), { name: profile.name, custom: profile.custom }, LOCAL_NET);
    wireSession(session);
    session.setStore(selectedStore);
    lobbyScreen();
  } catch (e) { err('Could not host: ' + (e as Error).message); }
};
$('btn-join').onclick = async () => {
  sfx.unlock(); err('');
  const code = $<HTMLInputElement>('join-code').value.trim().toUpperCase();
  if (code.length !== 5) { err('Enter the 5-letter lobby code'); return; }
  try {
    session = await Session.join(code, { name: profile.name, custom: profile.custom }, LOCAL_NET);
    wireSession(session);
    lobbyScreen();
  } catch (e) { err('Could not join: ' + (e as Error).message); }
};
$('btn-garage').onclick = () => garageScreen('body');
$('btn-settings').onclick = settingsScreen;

function renderRank() {
  const r = fun.rankOf(profile.xp);
  $('rank').innerHTML = `Rank ${r.rank + 1}: <b>${r.name}</b>` + (r.need ? ` · ${r.into}/${r.need} XP<div class="bar"><div style="width:${(r.into / r.need) * 100}%"></div></div>` : ' · max rank!');
}
function renderDaily(el: HTMLElement, fresh: string[]) {
  if (profile.daily.day !== fun.today()) profile.daily = { day: fun.today(), prog: {}, claimed: [] };
  const d = profile.daily;
  el.innerHTML = '<div class="t">📋 TODAY\'S CHALLENGES</div>' + fun.dailyChallenges(d.day).map((c) => {
    const done = d.claimed.includes(c.id), v = Math.min(c.goal, d.prog[c.id] ?? 0);
    const fmt = (n: number) => c.id === 'damage' ? '$' + n.toLocaleString('en-US') : String(n);
    return `<div class="c ${done ? 'done' : ''} ${fresh.includes(c.id) ? 'new' : ''}" data-id="${c.id}"><span>${done ? '✅' : '⬜'} ${c.text}</span><span class="p">${done ? 'done' : `${fmt(v)}/${fmt(c.goal)}`}</span><span>🎟 ${c.reward}</span></div>`;
  }).join('');
}

function lobbyScreen() {
  if (!session) return titleScreen();
  show('lobby');
  $('lobby-code').textContent = session.code;
  $('lobby-status').textContent = session.isHost ? 'You are the host. Share the code — empty slots become bots.' : 'Waiting for the host to start…';
  const slots = $('lobby-players');
  slots.innerHTML = '';
  for (let s = 0; s < 8; s++) {
    const p = session.players.find((q) => q.slot === s);
    const d = document.createElement('div');
    d.className = 'slot' + (p ? '' : ' bot');
    d.innerHTML = `<span class="dot" style="background:${hex(SLOT_COLORS[s])}"></span>${p ? p.name + (p.id === session.t.selfId ? ' (you)' : '') : '🤖 Bot'}`;
    slots.appendChild(d);
  }
  renderStores($('lobby-stores'), session.storeId, (id) => session?.setStore(id), session.isHost);
  $<HTMLButtonElement>('btn-start').style.display = session.isHost ? '' : 'none';
}
$('btn-start').onclick = () => session?.start();
$('btn-leave').onclick = () => { session?.close(); session = null; titleScreen(); };
$('btn-copy').onclick = () => {
  const url = `${location.origin}${location.pathname}?join=${session?.code ?? ''}${LOCAL_NET ? '&net=local' : ''}`;
  void navigator.clipboard?.writeText(url);
  $('btn-copy').textContent = 'Copied!';
};

function wireSession(s: Session) {
  s.onLobby = () => { if (!game) lobbyScreen(); };
  s.onStart = (cfg, slot, startAt) => startRace(cfg, slot, s, startAt);
  s.onClosed = (why) => { endGame(); session?.close(); session = null; titleScreen(); err(why); };
}

// ---------------- garage / shop ----------------
const LABELS: Record<Category, string> = { body: '🛒 Carts', wheel: '🛞 Wheels', addon: '🧲 Add-ons', engine: '⚡ Engine & Nitro', skin: '🎨 Paint', trim: '🎀 Trim', neon: '💡 Neon', squeak: '🔊 Squeaks', hat: '🎩 Hats', horn: '📯 Horns' };
const HAT_ICON: Record<string, string> = { cap: '🧢', none: '👨‍🦲', cone: '🚧', party: '🥳', chef: '👨‍🍳', propeller: '🚁', cowboy: '🤠', tinfoil: '🛸', viking: '⚔️', tophat: '🎩', fish: '🐟', duck: '🦆', crown: '👑', cart: '🛒' };
const HORN_ICON: Record<string, string> = { bell: '🔔', squeaky: '🧸', clown: '🤡', duck: '🦆', goat: '🐐', trombone: '🎺', air: '📢', cucaracha: '🪳', train: '🚂' };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const RAINBOW = 'linear-gradient(90deg,red,orange,yellow,lime,cyan,blue,magenta)';
function swatch(cat: Category, id: string): string {
  if (cat === 'skin') {
    const k = SKINS.find((x) => x.id === id)!;
    const bg = k.anim === 'rainbow' ? RAINBOW : k.anim === 'police' ? 'linear-gradient(90deg,#ff1a1a 50%,#1a3aff 50%)' : k.anim === 'lava' ? 'linear-gradient(90deg,#ff2a00,#ffa020,#ff2a00)' : k.anim === 'galaxy' ? 'linear-gradient(90deg,#2a1060,#6040e0,#c040c0)' : hex(k.color);
    return `<div class="sw" style="background:${bg};opacity:${k.opacity ?? 1}${k.emissive ? `;box-shadow:0 0 12px ${hex(k.color)}` : ''}"></div>`;
  }
  if (cat === 'neon') {
    const n = NEONS.find((x) => x.id === id)!;
    if (n.color === null) return '<div class="sw" style="background:#222"></div>';
    return `<div class="sw" style="background:${n.rainbow ? RAINBOW : n.police ? 'linear-gradient(90deg,#ff1010 50%,#1040ff 50%)' : hex(n.color)};box-shadow:0 0 14px ${hex(n.color)}"></div>`;
  }
  if (cat === 'hat') return `<div class="ic">${HAT_ICON[id] ?? '🎩'}</div>`;
  if (cat === 'horn') return `<div class="ic">${HORN_ICON[id] ?? '📯'}</div>`;
  if (cat === 'trim') return `<div class="sw" style="background:${hex(TRIMS.find((x) => x.id === id)!.color)}"></div>`;
  if (cat === 'wheel') return `<div class="sw" style="background:${hex(WHEELS.find((x) => x.id === id)!.color)}"></div>`;
  return '';
}
function cardStats(cat: Category, id: string): string {
  if (cat === 'wheel') { const w = WHEELS.find((x) => x.id === id)!; return `speed ${pct(w.speed)} · grip ${pct(w.grip)} · slip-proof ${pct(w.slickResist)}`; }
  if (cat === 'body') {
    const b = BODIES.find((x) => x.id === id)!;
    const reach = b.reach > 20 ? 'every shelf' : `${b.reach.toFixed(1)} m`;
    return `speed ${pct(b.speed)} · accel ${pct(b.accel)} · steering ${pct(b.steer)} · weight ${pct(b.mass)} · reach ${reach}${b.levels > 1 ? ` · ${b.levels} levels` : ''}`;
  }
  return '';
}
function garageStats() {
  const S = cartStats(profile.custom);
  $('g-stats').innerHTML = `<b>Your cart</b> · top speed ${pct(S.speed)} · accel ${pct(S.accel)} · steering ${pct(S.steer)} · weight ${pct(S.mass)} · nitro ${S.nitroCap.toFixed(1)} s @ ${pct(S.nitroPower)}${S.motor ? ' · ⚡ motor' : ''}`;
}
function garageScreen(cat: Category) {
  show('garage');
  $('g-coupons').textContent = String(profile.coupons);
  garageStats();
  const tabs = $('g-tabs'); tabs.innerHTML = '';
  for (const c of Object.keys(CATEGORIES) as Category[]) {
    const b = document.createElement('button'); b.textContent = LABELS[c]; b.className = c === cat ? 'on' : '';
    b.dataset.cat = c;
    b.onclick = () => garageScreen(c); tabs.appendChild(b);
  }
  const grid = $('g-items'); grid.innerHTML = '';
  for (const it of CATEGORIES[cat] as readonly { id: string; name: string; price: number; desc?: string }[]) {
    const key = `${cat}:${it.id}`;
    const owned = profile.owned.includes(key);
    const equipped = (profile.custom as unknown as Record<string, string>)[cat] === it.id;
    const card = document.createElement('div');
    card.className = 'card' + (equipped ? ' eq' : '');
    card.dataset.id = key;
    const st = cardStats(cat, it.id);
    card.innerHTML = `<b>${it.name}</b>${swatch(cat, it.id)}<div class="desc">${it.desc ?? ''}</div>${st ? `<div class="desc stat">${st}</div>` : ''}`;
    const b = document.createElement('button');
    b.textContent = equipped ? 'Equipped' : owned ? 'Equip' : `Buy 🎟 ${it.price}`;
    b.disabled = equipped || (!owned && profile.coupons < it.price);
    b.onclick = () => {
      if (!owned) { profile.coupons -= it.price; profile.owned.push(key); sfx.pickup(); }
      (profile.custom as unknown as Record<string, string>)[cat] = it.id;
      if (cat === 'squeak') { sfx.unlock(); sfx.squeak(it.id, 1.5); }
      if (cat === 'horn') { sfx.unlock(); sfx.horn(it.id); }
      saveProfile(profile); refreshGarageCart(); garageScreen(cat);
    };
    if (cat === 'squeak' || cat === 'horn') { const p = document.createElement('button'); p.textContent = '▶ Preview'; p.className = 'small'; p.onclick = () => { sfx.unlock(); if (cat === 'horn') sfx.horn(it.id); else sfx.squeak(it.id, 1.5); }; card.appendChild(p); }
    card.appendChild(b);
    grid.appendChild(card);
  }
  if (cat === 'engine') {
    const h = document.createElement('div'); h.className = 'shop-h'; h.textContent = 'Upgrades (kept forever, stack up to level 5)';
    grid.appendChild(h);
    const hasMotor = profile.owned.includes('engine:electric');
    for (const u of UPGRADES) {
      const lvl = profile.custom.up[u.id] ?? 0, price = upgradePrice(u, lvl);
      const card = document.createElement('div');
      card.className = 'card up';
      card.dataset.id = 'up:' + u.id;
      card.innerHTML = `<b>${u.name}</b><div class="pips">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div><div class="desc">${u.desc}</div>`;
      const b = document.createElement('button');
      const locked = u.motor && !hasMotor;
      b.textContent = lvl >= MAX_LEVEL ? 'MAXED' : locked ? '🔒 Needs the Electric Motor' : `Upgrade to ${lvl + 1} · 🎟 ${price}`;
      b.disabled = lvl >= MAX_LEVEL || !!locked || profile.coupons < price;
      b.onclick = () => { profile.coupons -= price; profile.custom.up[u.id] = lvl + 1; sfx.pickup(); saveProfile(profile); refreshGarageCart(); garageScreen(cat); };
      card.appendChild(b);
      grid.appendChild(card);
    }
  }
}
$('btn-garage-back').onclick = titleScreen;

function settingsScreen() {
  show('settings');
  $<HTMLInputElement>('s-name').value = profile.name;
  $<HTMLSelectElement>('s-quality').value = profile.quality;
  $<HTMLInputElement>('s-volume').value = String(profile.volume);
  $<HTMLInputElement>('s-voice').checked = profile.voice;
}
$('btn-settings-back').onclick = () => {
  profile.name = $<HTMLInputElement>('s-name').value.trim().slice(0, 16) || profile.name;
  const q = $<HTMLSelectElement>('s-quality').value as Profile['quality'];
  const reload = q !== profile.quality;
  profile.quality = q;
  profile.volume = Number($<HTMLInputElement>('s-volume').value);
  sfx.setVolume(profile.volume);
  profile.voice = sfx.voice = $<HTMLInputElement>('s-voice').checked;
  saveProfile(profile);
  if (reload) location.reload(); else titleScreen();
};

// ---------------- races ----------------
function soloConfig(storeId: string, seed?: number, bots = 7): RaceConfig {
  const s = seed ?? ((Math.random() * 2 ** 31) | 0);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const players = [{ slot: 0, id: 'me', name: profile.name, color: SLOT_COLORS[0], custom: sanitize(profile.custom), bot: false }];
  for (let i = 1; i <= bots; i++) players.push({ slot: i, id: 'bot' + i, name: names[i - 1], color: SLOT_COLORS[i], custom: randomCustom(), bot: true });
  return { storeId, seed: s, time: RACE_TIME, list: [], players };
}

async function startSolo(storeId: string, opts: { seed?: number; bots?: number } = {}) {
  lastSolo = storeId;
  return startRace(soloConfig(storeId, opts.seed, opts.bots ?? 7), 0, null, 0);
}

async function startRace(cfg: RaceConfig, slot: number, s: Session | null, startAt: number) {
  endGame();
  show('loading');
  $('loading-text').textContent = `Stocking ${STORE_BY_ID[cfg.storeId].name}…`;
  await new Promise((r) => setTimeout(r, 30)); // let the loading screen paint
  const t0 = performance.now();
  game = new Game(cfg, slot, sfx, { quality: TEST ? 'low' : profile.quality, envMap, net: s ? { event: (e) => s.event(e), isHost: s.isHost, clock: s.clock } : null, aspect: window.innerWidth / Math.max(1, window.innerHeight), thumb: (id) => thumbCanvas(renderer, id) });
  game.startAt = startAt;
  game.onEnd = (r) => setTimeout(() => resultsScreen(r), 1200);
  s?.attach(game);
  hud.reset(game);
  // precompile every material behind the loading screen (no shader hitches mid-race)
  renderer.compile(game.scene, game.camera);
  game.frame(0);
  renderer.render(game.scene, game.camera);
  console.info(`[cartastrophe] ${STORE_BY_ID[cfg.storeId].name}: ${game.world.items.all.length} items, ${game.world.shelves.shelves.length} shelves, built in ${(performance.now() - t0).toFixed(0)} ms`);
  show(null);
  hud.show(true);
  paused = false;
  return game;
}

function endGame() {
  if (game) { session?.attach(null); game.dispose(); game = null; }
  hud.show(false);
}

const REWARD = [150, 110, 90, 70, 55, 45, 35, 25];
function resultsScreen(rows: ResultRow[]) {
  if (!game) return;
  const me = rows.find((r) => r.slot === game!.localSlot)!;
  const g = game, lp = g.local, ch = lp.chaos, store = STORE_BY_ID[g.cfg.storeId];
  const bonus = fun.chaosBonus(ch);
  let earned = REWARD[me.place - 1] + me.items * 5 + bonus;
  profile.races++;
  if (me.done) { const b = profile.best[g.cfg.storeId]; if (!b || me.time < b) profile.best[g.cfg.storeId] = me.time; }
  // daily challenges
  if (profile.daily.day !== fun.today()) profile.daily = { day: fun.today(), prog: {}, claimed: [] };
  const fresh = fun.progressDaily(profile.daily, { chaos: ch, place: me.place, done: me.done, store: g.cfg.storeId, storeName: store.name, players: rows.length });
  for (const c of fresh) earned += c.reward;
  // shopper rank
  const before = fun.rankOf(profile.xp);
  profile.xp += 40 + Math.max(0, 8 - me.place) * 10 + me.items * 3 + Math.min(80, Math.round(ch.style / 60)) + fresh.length * 50;
  const after = fun.rankOf(profile.xp);
  const promoted = after.rank > before.rank;
  if (promoted) for (let r = before.rank + 1; r <= after.rank; r++) earned += fun.rankReward(r);
  profile.coupons += earned;
  saveProfile(profile);
  hud.show(false);
  show('results');
  sfx.hushVoice();
  $('r-receipt').innerHTML = fun.receiptHtml(ch, { name: lp.info.name, store: store.name, place: me.place, time: me.time, done: me.done, bonus });
  const aw = fun.awards(g.players.map((p) => ({ name: p.info.name, chaos: p.chaos, done: p.done })));
  $('r-awards').innerHTML = aw.map((a) => `<div>${a.icon} <b>${a.title}</b> — ${a.who}<br><i>${a.what}</i></div>`).join('');
  renderDaily($('r-daily'), fresh.map((c) => c.id));
  if (fresh.length) sfx.finish();
  $('r-title').textContent = me.place === 1 ? '🏆 Shopper of the Year!' : `You placed ${me.place}${['st', 'nd', 'rd'][me.place - 1] ?? 'th'}`;
  $('r-table').innerHTML = '<tr><th>#</th><th>Shopper</th><th>Time</th><th>Items</th></tr>' + rows.map((r) => `<tr class="${r.slot === me.slot ? 'me' : ''}"><td>${r.place}</td><td><span style="color:${hex(r.color)}">●</span> ${r.name}${r.bot ? ' 🤖' : ''}</td><td>${r.done ? r.time.toFixed(2) + 's' : 'DNF'}</td><td>${r.items}</td></tr>`).join('');
  const best = profile.best[game.cfg.storeId];
  $('r-reward').innerHTML = `+${earned} coupons (🎟 ${profile.coupons})` + (best ? ` · best here: ${best.toFixed(2)}s` : '') + (promoted ? `<br><b style="color:var(--yellow)">⭐ PROMOTED to ${after.name}! +${fun.rankReward(after.rank)} bonus coupons</b>` : ` · ${after.name} ${after.into}/${after.need} XP`);
  $('btn-again').textContent = session ? 'Back to Lobby' : 'Race Again';
}
$('btn-again').onclick = () => {
  if (session) { endGame(); lobbyScreen(); }
  else if (lastSolo) void startSolo(lastSolo);
};
$('btn-menu').onclick = () => { endGame(); session?.close(); session = null; titleScreen(); };
$('btn-resume').onclick = () => { paused = false; show(null); hud.show(true); };
$('btn-quit').onclick = () => { paused = false; endGame(); session?.close(); session = null; titleScreen(); };

// ---------------- dev console (` key) ----------------
const DEV_HELP = `coupons [n]      add coupons (default 10000)
unlock           own everything in the garage
reset            wipe your profile back to a fresh start
win              tick off your whole shopping list (then drive to a checkout)
finish           check out right now
time <sec>       set the race clock's time left
tp <item|checkout>  teleport next to the nearest <item> on your list, or a checkout
nitro            refill your nitro tank
max              every upgrade to level 5 (and the motor)
cart <type>      swap carts mid-race: ${BODIES.map((b) => b.id).join(' ')}
restock          restock every wrecked shelf right now
freeze           pause / unpause the bots
topple           knock every shelf over (chaos)
pa [event]       make the store PA announce something (${Object.keys(fun.PA).join(' ')})
honk             honk your horn
say <text>       every other shopper says <text>
xp <n>           add shopper-rank XP
daily            leave today's challenges one step from done
help             this list`;
function devLog(s: string) { const o = $('dev-out'); o.textContent += s + '\n'; o.scrollTop = o.scrollHeight; }
function devRun(line: string): string {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const g = game;
  const needGame = () => { if (!g) throw new Error('start a race first'); return g; };
  const refresh = () => { saveProfile(profile); refreshGarageCart(); $('coupons').textContent = String(profile.coupons); if ($('garage').classList.contains('show')) garageScreen((document.querySelector('#g-tabs .on') as HTMLElement | null)?.dataset.cat as Category ?? 'body'); };
  switch ((cmd ?? '').toLowerCase()) {
    case '': return '';
    case 'help': case '?': return DEV_HELP;
    case 'coupons': case 'money': case 'cash': {
      const n = Number(args[0] ?? 10000);
      if (!Number.isFinite(n)) throw new Error('usage: coupons 5000');
      profile.coupons = Math.max(0, Math.round(profile.coupons + n)); refresh();
      return `🎟 ${profile.coupons} coupons`;
    }
    case 'unlock': case 'unlockall': {
      for (const [c, list] of Object.entries(CATEGORIES)) for (const it of list) if (!profile.owned.includes(`${c}:${it.id}`)) profile.owned.push(`${c}:${it.id}`);
      refresh(); return `unlocked all ${profile.owned.length} shop items`;
    }
    case 'reset': profile = loadProfile(true); saveProfile(profile); refreshGarageCart(); refresh(); return 'profile reset';
    case 'win': case 'finish': {
      const gg = needGame(), me = gg.local;
      for (const e of gg.cfg.list) { const have = me.collected[e.kind] ?? 0; for (let i = have; i < e.qty; i++) { me.collected[e.kind] = i + 1; me.cargo.push(e.kind); } }
      me.cart.model.setCargo(me.cargo);
      if (cmd.toLowerCase() === 'finish') { if (gg.phase === 'race') gg.finish(me, gg.raceTime); return 'checked out'; }
      return 'list complete — head to a checkout';
    }
    case 'time': { const gg = needGame(), n = Number(args[0]); if (!Number.isFinite(n)) throw new Error('usage: time 60'); gg.raceTime = Math.max(0, gg.cfg.time - n); return `${n}s left`; }
    case 'tp': {
      const gg = needGame(), what = (args.join(' ') || 'checkout').toLowerCase();
      if (what === 'checkout') { const l = gg.world.lanes[Math.floor(gg.world.lanes.length / 2)]; gg.local.cart.reset(l.x, l.z + 2.5, Math.PI); return 'at the checkouts'; }
      gg.guides.refresh();
      const c = gg.guides.clusters.find((x) => x.kind.includes(what) || kindName(x.kind).toLowerCase().includes(what)) ?? (what === 'next' ? gg.guides.nearest : null);
      if (!c) throw new Error(`nothing on your list matches "${what}"`);
      const [i, j] = gg.world.nav.nearestFree(c.x, c.z);
      gg.local.cart.reset(gg.world.nav.wx(i), gg.world.nav.wz(j), gg.local.cart.yaw);
      return `teleported to ${kindName(c.kind)} (${c.where})`;
    }
    case 'nitro': { const c = needGame().local.cart; c.nitro = c.stats.nitroCap; c.charges = 4; return `nitro full (${c.nitro.toFixed(1)} s)`; }
    case 'max': {
      for (const u of UPGRADES) profile.custom.up[u.id] = MAX_LEVEL;
      if (!profile.owned.includes('engine:electric')) profile.owned.push('engine:electric');
      profile.custom.engine = 'electric';
      refresh(); if (g) g.local.cart.setCustom(sanitize(profile.custom));
      return 'electric motor + every upgrade at level 5';
    }
    case 'cart': case 'body': {
      const b = BODIES.find((x) => x.id === (args[0] ?? '').toLowerCase() || x.name.toLowerCase().includes((args.join(' ') || '?').toLowerCase()));
      if (!b) throw new Error('usage: cart ' + BODIES.map((x) => x.id).join('|'));
      profile.custom.body = b.id;
      if (!profile.owned.includes('body:' + b.id)) profile.owned.push('body:' + b.id);
      refresh();
      if (g) { g.local.info.custom = sanitize(profile.custom); g.local.cart.setCustom(g.local.info.custom); g.local.cart.model.setCargo(g.local.cargo); }
      return `now driving: ${b.name}`;
    }
    case 'restock': {
      const gg = needGame(); let n = 0;
      for (const grp of gg.restock.groups) if (grp.since >= 0 || grp.items.some((it) => !it.alive) || grp.shelf?.moved) { gg.doRestock(grp.index, true); n++; }
      return `restocked ${n} shelves / displays`;
    }
    case 'freeze': { const gg = needGame(); gg.botsFrozen = !gg.botsFrozen; return gg.botsFrozen ? 'bots frozen' : 'bots unfrozen'; }
    case 'topple': {
      const gg = needGame();
      for (const sh of gg.world.shelves.shelves) { const t = sh.body.translation(); sh.body.applyImpulseAtPoint({ x: (Math.random() - 0.5) * 900, y: 0, z: (Math.random() - 0.5) * 900 }, { x: t.x, y: t.y + 2, z: t.z }, true); }
      return 'timber!';
    }
    case 'pa': {
      const gg = needGame(), ev = (args[0] ?? 'ambient') as fun.PaEvent;
      if (!fun.PA[ev]) throw new Error('usage: pa ' + Object.keys(fun.PA).join('|'));
      const t = gg.local.cart.body.translation();
      const text = gg.announcer.line(ev, { name: gg.local.info.name, where: gg.world.whereIs(t.x, t.z), store: gg.world.def.name });
      gg.pa = { text, t: 6.5 }; sfx.chime(); sfx.speak(text);
      return '📢 ' + text;
    }
    case 'honk': { const gg = needGame(); gg.local.honkT = -9; gg.honk(gg.local, true); return 'HONK'; }
    case 'say': { const gg = needGame(), t = args.join(' ') || 'I want to speak to your manager!'; for (const p of gg.players) if (p !== gg.local) p.cart.model.speak(t); return `everyone says "${t}"`; }
    case 'xp': { const n = Number(args[0] ?? 500); profile.xp = Math.max(0, profile.xp + (Number.isFinite(n) ? n : 0)); refresh(); renderRank(); const r = fun.rankOf(profile.xp); return `${profile.xp} XP — ${r.name}`; }
    case 'daily': { for (const c of fun.dailyChallenges(profile.daily.day)) if (!profile.daily.claimed.includes(c.id)) profile.daily.prog[c.id] = c.best ? 0 : c.goal - 1; refresh(); return 'today\'s challenges are one step from done'; }
    default: throw new Error(`unknown command "${cmd}" — type help`);
  }
}
function devToggle(on = $('dev').classList.contains('hidden')) {
  $('dev').classList.toggle('hidden', !on);
  // focus right away: the ` keydown was preventDefault'ed, so the character itself isn't typed
  if (on) { keys.clear(); $<HTMLInputElement>('dev-in').focus(); if (!$('dev-out').textContent) devLog('dev console — type help'); }
  else $<HTMLInputElement>('dev-in').blur();
}
$('dev-in').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.code === 'Backquote' || e.code === 'Escape') { e.preventDefault(); devToggle(false); return; }
  if (e.key !== 'Enter') return;
  const inp = $<HTMLInputElement>('dev-in'), line = inp.value; inp.value = '';
  devLog('> ' + line);
  try { const r = devRun(line); if (r) devLog(r); } catch (er) { devLog('✗ ' + (er as Error).message); }
});

// ---------------- input ----------------
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'Backquote') { e.preventDefault(); devToggle(); return; }
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (!game) return;
  if (e.code === 'KeyC') game.setCamMode(game.camMode === 'fp' ? 'chase' : 'fp');
  if (e.code === 'KeyR') game.resetLocal();
  if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); hud.toggleMap(); }
  if (e.code === 'Escape' && game.phase !== 'over') {
    if (session) return; // can't pause a networked race
    paused = !paused; show(paused ? 'pause' : null); hud.show(!paused);
  }
  sfx.unlock();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput() {
  if (!game) return;
  const inp = game.input;
  const k = (...c: string[]) => c.some((x) => keys.has(x));
  inp.throttle = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
  inp.steer = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  inp.sprint = k('ShiftLeft', 'ShiftRight');
  inp.ride = k('Space');
  inp.nitro = k('KeyE');
  inp.action = k('KeyQ');
  inp.honk = k('KeyH');
  const pad = navigator.getGamepads?.()[0];
  if (pad) {
    const ax = pad.axes[0] ?? 0;
    if (Math.abs(ax) > 0.15) inp.steer = ax;
    const rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0;
    if (rt > 0.05 || lt > 0.05) inp.throttle = rt - lt;
    if (pad.buttons[0]?.pressed) inp.ride = true;
    if (pad.buttons[2]?.pressed || pad.buttons[10]?.pressed) inp.sprint = true;
    if (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed) inp.nitro = true;
    if (pad.buttons[3]?.pressed || pad.buttons[4]?.pressed) inp.action = true;
    if (pad.buttons[12]?.pressed || pad.buttons[11]?.pressed) inp.honk = true;
  }
}

// ---------------- loop + adaptive resolution ----------------
let last = performance.now();
let fps = 60, frameAcc = 0, frameN = 0, govT = 0;
let manual = false; // tests can freeze the rAF loop and step deterministically

function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (manual) return;
  frameAcc += dt; frameN++;
  if (frameAcc >= 0.5) { fps = frameN / frameAcc; frameAcc = 0; frameN = 0; }
  if (game) {
    readInput();
    if (!paused || session) game.frame(dt);
    session?.tick(dt);
    hud.update(game, dt, fps);
    renderer.render(game.scene, game.camera);
    // keep 60 fps: trade resolution for frame time
    govT += dt;
    if (govT > 1 && !TEST) {
      govT = 0;
      const target = fps < 50 ? pixelRatio - 0.15 : fps > 58 ? pixelRatio + 0.05 : pixelRatio;
      const nr = Math.max(0.5, Math.min(maxRatio, target));
      if (Math.abs(nr - pixelRatio) > 0.01) { pixelRatio = nr; renderer.setPixelRatio(pixelRatio); resize(); }
    }
  } else {
    session?.tick(dt);
    garageCart.root.rotation.y += dt * 0.4;
    garageCart.animate(dt, now / 1000, 0, 0, false, false);
    turntable.rotation.y = garageCart.root.rotation.y;
    backdropT += dt;
    if (backdropT > 4) { backdropT = 0; backdropStore = (backdropStore + 1) % STORES.length; (backdrop.material as THREE.MeshBasicMaterial).map = logoTexture(STORES[backdropStore]); }
    renderer.render(garageScene, garageCam);
  }
}

// Hidden tabs get no rAF. An online host (or any peer) must keep simulating and relaying,
// so while hidden we tick from a Worker, whose timers aren't throttled like the page's.
let lastHidden = performance.now();
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16);'], { type: 'text/javascript' })));
  w.onmessage = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastHidden) / 1000);
    lastHidden = now;
    if (!document.hidden || manual || !session) return;
    last = now; // keep the rAF clock from seeing a giant gap on return
    if (game) game.frame(dt);
    session.tick(dt);
  };
} catch { /* workers unavailable: hidden tabs just pause */ }

// ---------------- test API (used by tests/e2e.mjs via Puppeteer) ----------------
const api = {
  ready: false,
  version: '1.0.0',
  get game() { return game; },
  get profile() { return profile; },
  set manual(v: boolean) { manual = v; },
  get manual() { return manual; },
  startSolo: async (storeId: string, opts: { seed?: number; bots?: number; skipCountdown?: boolean } = {}) => {
    const g = await startSolo(storeId, opts);
    if (opts.skipCountdown) { g.countdown = 0.01; g.advance(1 / 30); }
    return { items: g.world.items.all.length, shelves: g.world.shelves.shelves.length, list: g.cfg.list };
  },
  /** Run the simulation for `sec` seconds at fixed 60 Hz without rendering. */
  advance: (sec: number) => {
    if (!game) return;
    for (let t = 0; t < sec; t += 1 / 60) { game.advance(1 / 60); session?.tick(1 / 60); }
    game.frame(0);
  },
  render: () => { if (game) { game.frame(0); hud.update(game, 1, fps); renderer.render(game.scene, game.camera); } else renderer.render(garageScene, garageCam); },
  setInput: (inp: { throttle?: number; steer?: number; sprint?: boolean; ride?: boolean; nitro?: boolean; action?: boolean; honk?: boolean } | null) => {
    if (!game) return;
    game.inputOverride = inp ? { ...NO_INPUT, ...inp } : null;
  },
  teleport: (x: number, z: number, yaw: number) => game?.local.cart.reset(x, z, yaw),
  state: () => {
    if (!game) return null;
    const c = game.local.cart, t = c.body.translation(), v = c.body.linvel();
    return { phase: game.phase, raceTime: game.raceTime, x: t.x, y: t.y, z: t.z, yaw: c.yaw, speed: Math.hypot(v.x, v.z), vx: v.x, vz: v.z, w: c.body.angvel().y, surface: c.surface.type, grip: c.surface.grip, boost: c.boost, collected: { ...game.local.collected }, done: game.local.done, list: game.cfg.list };
  },
  stats: () => {
    if (!game) return null;
    const info = renderer.info;
    return { fps, physMs: game.phys.stepMs, ...game.world.items.stats(), shelvesAwake: game.world.shelves.awakeCount(), shelvesMoved: game.world.shelves.shelves.filter((s) => s.moved).length, maxTilt: Math.max(...game.world.shelves.shelves.map((s) => s.tilt)), slicks: game.world.hazards.activeSlicks().length, smashed: game.smashed, calls: info.render.calls, triangles: info.render.triangles, bodies: game.phys.world.bodies.len(), pixelRatio };
  },
  bots: () => game?.players.filter((p) => p.bot).map((p) => { const t = p.cart.body.translation(); return { slot: p.slot, name: p.info.name, x: t.x, z: t.z, speed: p.cart.speed(), items: game!.itemsCollected(p), done: p.done, state: p.bot!.state, pathLen: p.bot!.path.length }; }) ?? [],
  /** Average/variance/unique-color stats of the current frame, read back from a small render target. */
  pixelStats: () => {
    if (!game) return null;
    const w = 160, h = 90;
    const rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
    game.frame(0);
    renderer.setRenderTarget(rt);
    renderer.render(game.scene, game.camera);
    renderer.setRenderTarget(null);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    rt.dispose();
    let sum = 0, sum2 = 0;
    const uniq = new Set<number>();
    for (let i = 0; i < buf.length; i += 4) {
      const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      sum += l; sum2 += l * l;
      uniq.add(((buf[i] >> 3) << 10) | ((buf[i + 1] >> 3) << 5) | (buf[i + 2] >> 3));
    }
    const n = w * h, mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), colors: uniq.size };
  },
  setCam: (m: 'fp' | 'chase') => game?.setCamMode(m),
  view: (v: number[] | null) => { if (game) game.camOverride = v; },
  spawnSlick: (type: 'egg' | 'oil' | 'milk' | 'soda' | 'mayo', x: number, z: number, r: number) => game?.world.hazards.addSlick(type, x, z, r, 0),
  // multiplayer helpers (LocalTransport when ?net=local)
  host: async (storeId: string) => {
    session = await Session.host(lobbyCode(), { name: profile.name, custom: profile.custom }, LOCAL_NET);
    wireSession(session); session.setStore(storeId); lobbyScreen();
    return session.code;
  },
  join: async (code: string) => { session = await Session.join(code, { name: profile.name, custom: profile.custom }, LOCAL_NET); wireSession(session); lobbyScreen(); return session.mySlot; },
  lobby: () => session ? { code: session.code, players: session.players.map((p) => ({ name: p.name, slot: p.slot })), host: session.isHost, rtt: session.clock.rtt } : null,
  startLobby: () => session?.start(),
  remote: (slot: number) => {
    const p = game?.players.find((q) => q.slot === slot);
    if (!p) return null;
    const t = p.cart.body.translation();
    return { x: t.x, z: t.z, simT: game!.simTime, remote: p.remote, buffered: p.interp?.buf.length ?? 0, extrapolating: p.interp?.out.extrapolating ?? false, items: game!.itemsCollected(p) };
  },
  setName: (n: string) => { profile.name = n; },
  equip: (c: Partial<Customization>) => { Object.assign(profile.custom, c); saveProfile(profile); refreshGarageCart(); },
  garage: (cat: Category) => garageScreen(cat),
  garageCart: () => garageCart,
  tuneRestock: Restock,
  reloadProfile: () => { profile = loadProfile(); return profile; },
  catalog: { WHEELS, SKINS, NEONS, BODIES, UPGRADES, CATEGORIES, HATS, HORNS },
  RAPIER,
  dev: (cmd: string) => devRun(cmd),
  tune: { ShelfSystem, Game },
  fun,
  thumbs: () => ITEM_KINDS.map((k) => [k.id, thumbUrl(renderer, k.id)]),
};
(window as unknown as { CART: typeof api }).CART = api;

// ---------------- boot ----------------
(async () => {
  await initPhysics();
  window.addEventListener('resize', resize);
  resize();
  renderer.compile(garageScene, garageCam);
  requestAnimationFrame(loop);
  titleScreen();
  api.ready = true;
  if (params.get('join')) $<HTMLInputElement>('join-code').value = params.get('join')!.toUpperCase();
})();
