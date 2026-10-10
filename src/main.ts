// App shell: renderer, menus, garage/shop, lobby flow, main loop, adaptive resolution, test API.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { initPhysics } from './physics';
import { Game, RaceConfig, ResultRow, SLOT_COLORS } from './game';
import { Hud } from './hud';
import { Sfx } from './audio';
import { Session, randomCustom } from './session';
import { lobbyCode, LocalTransport } from './net';
import { loadProfile, saveProfile, Profile, CATEGORIES, Category } from './save';
import { STORES, STORE_BY_ID, BOT_NAMES, RACE_TIME, Customization, WHEELS, SKINS, NEONS } from './config';
import { CartModel } from './cart';
import { logoTexture } from './textures';

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
const hud = new Hud();

// ---------------- renderer ----------------
const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.quality !== 'low' && !TEST, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxRatio = Math.min(window.devicePixelRatio || 1, profile.quality === 'high' ? 2 : 1.5);
let pixelRatio = TEST ? 1 : maxRatio;
renderer.setPixelRatio(pixelRatio);
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const a = window.innerWidth / Math.max(1, window.innerHeight);
  if (game) { game.camera.aspect = a; game.camera.updateProjectionMatrix(); }
  garageCam.aspect = a; garageCam.updateProjectionMatrix();
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

function refreshGarageCart() { garageCart.applyCustom(profile.custom); }

// ---------------- state ----------------
let game: Game | null = null;
let session: Session | null = null;
let selectedStore = STORES[Math.floor(Math.random() * STORES.length)].id;
let paused = false;
let lastSolo: string | null = null;

function show(id: string | null) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
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
$('btn-garage').onclick = () => garageScreen('wheel');
$('btn-settings').onclick = settingsScreen;

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
const LABELS: Record<Category, string> = { wheel: '🛞 Wheels', skin: '🎨 Skins', neon: '💡 Neon', squeak: '🔊 Squeaks' };
function garageScreen(cat: Category) {
  show('garage');
  $('g-coupons').textContent = String(profile.coupons);
  const tabs = $('g-tabs'); tabs.innerHTML = '';
  for (const c of Object.keys(CATEGORIES) as Category[]) {
    const b = document.createElement('button'); b.textContent = LABELS[c]; b.className = c === cat ? 'on' : '';
    b.onclick = () => garageScreen(c); tabs.appendChild(b);
  }
  const grid = $('g-items'); grid.innerHTML = '';
  for (const it of CATEGORIES[cat] as readonly { id: string; name: string; price: number; desc?: string; color?: number | null }[]) {
    const key = `${cat}:${it.id}`;
    const owned = profile.owned.includes(key);
    const equipped = profile.custom[cat as keyof Customization] === it.id;
    const card = document.createElement('div');
    card.className = 'card' + (equipped ? ' eq' : '');
    const sw = it.color != null ? `<div class="sw" style="background:${it.id === 'rainbow' || it.id === 'rgb' ? 'linear-gradient(90deg,red,orange,yellow,lime,cyan,blue,magenta)' : hex(it.color)}"></div>` : '';
    const stats = cat === 'wheel' ? (() => { const w = WHEELS.find((x) => x.id === it.id)!; return `speed ${Math.round(w.speed * 100)}% · grip ${Math.round(w.grip * 100)}% · slick-proof ${Math.round(w.slickResist * 100)}%`; })() : '';
    card.innerHTML = `<b>${it.name}</b>${sw}<div class="desc">${it.desc ?? stats}</div><div class="desc">${cat === 'wheel' ? stats : ''}</div>`;
    const b = document.createElement('button');
    b.textContent = equipped ? 'Equipped' : owned ? 'Equip' : `Buy 🎟 ${it.price}`;
    b.disabled = equipped || (!owned && profile.coupons < it.price);
    b.onclick = () => {
      if (!owned) { profile.coupons -= it.price; profile.owned.push(key); sfx.pickup(); }
      (profile.custom as unknown as Record<string, string>)[cat] = it.id;
      if (cat === 'squeak') { sfx.unlock(); sfx.squeak(it.id, 1.5); }
      saveProfile(profile); refreshGarageCart(); garageScreen(cat);
    };
    if (cat === 'squeak') { const p = document.createElement('button'); p.textContent = '▶ Preview'; p.className = 'small'; p.onclick = () => { sfx.unlock(); sfx.squeak(it.id, 1.5); }; card.appendChild(p); }
    card.appendChild(b);
    grid.appendChild(card);
  }
}
$('btn-garage-back').onclick = titleScreen;

function settingsScreen() {
  show('settings');
  $<HTMLInputElement>('s-name').value = profile.name;
  $<HTMLSelectElement>('s-quality').value = profile.quality;
  $<HTMLInputElement>('s-volume').value = String(profile.volume);
}
$('btn-settings-back').onclick = () => {
  profile.name = $<HTMLInputElement>('s-name').value.trim().slice(0, 16) || profile.name;
  const q = $<HTMLSelectElement>('s-quality').value as Profile['quality'];
  const reload = q !== profile.quality;
  profile.quality = q;
  profile.volume = Number($<HTMLInputElement>('s-volume').value);
  sfx.setVolume(profile.volume);
  saveProfile(profile);
  if (reload) location.reload(); else titleScreen();
};

// ---------------- races ----------------
function soloConfig(storeId: string, seed?: number, bots = 7): RaceConfig {
  const s = seed ?? ((Math.random() * 2 ** 31) | 0);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const players = [{ slot: 0, id: 'me', name: profile.name, color: SLOT_COLORS[0], custom: profile.custom, bot: false }];
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
  game = new Game(cfg, slot, sfx, { quality: TEST ? 'low' : profile.quality, envMap, net: s ? { event: (e) => s.event(e), isHost: s.isHost, clock: s.clock } : null, aspect: window.innerWidth / Math.max(1, window.innerHeight) });
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
  const earned = REWARD[me.place - 1] + me.items * 5;
  profile.coupons += earned;
  profile.races++;
  if (me.done) { const b = profile.best[game.cfg.storeId]; if (!b || me.time < b) profile.best[game.cfg.storeId] = me.time; }
  saveProfile(profile);
  hud.show(false);
  show('results');
  $('r-title').textContent = me.place === 1 ? '🏆 Shopper of the Year!' : `You placed ${me.place}${['st', 'nd', 'rd'][me.place - 1] ?? 'th'}`;
  $('r-table').innerHTML = '<tr><th>#</th><th>Shopper</th><th>Time</th><th>Items</th></tr>' + rows.map((r) => `<tr class="${r.slot === me.slot ? 'me' : ''}"><td>${r.place}</td><td><span style="color:${hex(r.color)}">●</span> ${r.name}${r.bot ? ' 🤖' : ''}</td><td>${r.done ? r.time.toFixed(2) + 's' : 'DNF'}</td><td>${r.items}</td></tr>`).join('');
  const best = profile.best[game.cfg.storeId];
  $('r-reward').textContent = `+${earned} coupons (🎟 ${profile.coupons})` + (best ? ` · best here: ${best.toFixed(2)}s` : '');
  $('btn-again').textContent = session ? 'Back to Lobby' : 'Race Again';
}
$('btn-again').onclick = () => {
  if (session) { endGame(); lobbyScreen(); }
  else if (lastSolo) void startSolo(lastSolo);
};
$('btn-menu').onclick = () => { endGame(); session?.close(); session = null; titleScreen(); };
$('btn-resume').onclick = () => { paused = false; show(null); hud.show(true); };
$('btn-quit').onclick = () => { paused = false; endGame(); session?.close(); session = null; titleScreen(); };

// ---------------- input ----------------
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (!game) return;
  if (e.code === 'KeyC') game.setCamMode(game.camMode === 'fp' ? 'chase' : 'fp');
  if (e.code === 'KeyR') game.resetLocal();
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
  const pad = navigator.getGamepads?.()[0];
  if (pad) {
    const ax = pad.axes[0] ?? 0;
    if (Math.abs(ax) > 0.15) inp.steer = ax;
    const rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0;
    if (rt > 0.05 || lt > 0.05) inp.throttle = rt - lt;
    if (pad.buttons[0]?.pressed) inp.ride = true;
    if (pad.buttons[2]?.pressed || pad.buttons[10]?.pressed) inp.sprint = true;
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
  setInput: (inp: { throttle?: number; steer?: number; sprint?: boolean; ride?: boolean } | null) => {
    if (!game) return;
    game.inputOverride = inp ? { throttle: 0, steer: 0, sprint: false, ride: false, ...inp } : null;
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
    return { x: t.x, z: t.z, remote: p.remote, buffered: p.interp?.buf.length ?? 0, extrapolating: p.interp?.out.extrapolating ?? false, items: game!.itemsCollected(p) };
  },
  setName: (n: string) => { profile.name = n; },
  equip: (c: Partial<Customization>) => { Object.assign(profile.custom, c); saveProfile(profile); refreshGarageCart(); },
  reloadProfile: () => { profile = loadProfile(); return profile; },
  catalog: { WHEELS, SKINS, NEONS },
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
