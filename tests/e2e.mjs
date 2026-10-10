// Headless end-to-end tests (Puppeteer + Chromium/SwiftShader).
// Loads the built game, drives it with real keyboard input and through window.CART,
// and checks rendering (pixel statistics + screenshots), physics interactions,
// bots, networking, the shop, performance budgets and the console.
//
//   npm test                 build + run everything
//   npm run test:e2e         run against an existing dist/
//   ONLY=egg npm run test:e2e   run tests whose name contains "egg"
import { serve, launch, openPage, test, assert, summary, shot } from './harness.mjs';

const srv = await serve();
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const browser = await launch();
const only = process.env.ONLY;
const T = (name, fn) => (!only || name.toLowerCase().includes(only.toLowerCase()) ? test(name, fn) : null);

const { page, errors } = await openPage(browser, BASE + '?test&fresh');
const E = (fn, arg) => page.evaluate(fn, arg);

async function solo(store, seed = 1234, bots = 7) {
  const info = await E(([s, seed, bots]) => CART.startSolo(s, { seed, bots, skipCountdown: true }), [store, seed, bots]);
  await E(() => { CART.manual = true; });
  return info;
}
/** Put the cart at (x,z) heading `yaw` and give it a running start. */
const launchCart = (x, z, yaw, speed) => E(([x, z, yaw, speed]) => {
  CART.teleport(x, z, yaw);
  CART.game.local.cart.body.setLinvel({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed }, true);
}, [x, z, yaw, speed]);

console.log('\nBoot & rendering');
await T('boots to the title screen with no console errors', async () => {
  assert(await E(() => document.getElementById('title').classList.contains('show')), 'title not shown');
  await page.screenshot({ path: 'tests/screenshots/00-title.png' });
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

const STORES = ['costplenty', 'bullseye', 'wholefarm', 'bestbuyout', 'safely'];
for (const id of STORES) {
  await T(`store "${id}" builds, stocks thousands of items and renders`, async () => {
    const info = await solo(id);
    assert(info.items >= 2500, `only ${info.items} items`);
    assert(info.shelves >= 30, `only ${info.shelves} shelves`);
    assert(info.list.length === 8, `list has ${info.list.length} kinds`);
    const stock = await E(() => { const m = {}; for (const it of CART.game.world.items.all) m[it.kind.id] = (m[it.kind.id] || 0) + 1; return m; });
    for (const e of info.list) assert((stock[e.kind] || 0) >= 12, `list item ${e.kind} only stocked ${stock[e.kind] || 0}x`);
    const px = await E(() => CART.pixelStats());
    assert(px.std > 18 && px.colors > 120, `frame looks blank/flat: ${JSON.stringify(px)}`);
    const s = await E(() => CART.stats());
    assert(s.awake === 0 && s.shelvesAwake === 0, `store not asleep at rest: ${s.awake} items, ${s.shelvesAwake} shelves awake`);
    await shot(page, `01-store-${id}.png`);
    await E(() => CART.setCam('chase'));
    await shot(page, `01-store-${id}-chase.png`);
    assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
  });
}

console.log('\nDriving & physics');
await T('keyboard input drives the cart forward (real key events, live rAF loop)', async () => {
  await solo('safely', 99, 0);
  const a = await E(() => CART.state());
  await E(() => { CART.manual = false; });
  await page.keyboard.down('KeyW');
  await page.waitForFunction((z0) => CART.state().z < z0 - 4, { timeout: 60000 }, a.z);
  await page.keyboard.up('KeyW');
  await E(() => { CART.manual = true; });
  const b = await E(() => CART.state());
  assert(b.z < a.z - 4, `cart barely moved: ${a.z.toFixed(2)} → ${b.z.toFixed(2)}`);
});

await T('momentum: sprint beats jogging, and the cart coasts instead of stopping dead', async () => {
  await solo('safely', 99, 0);
  const lane = await E(() => CART.game.world.spawns[3]);
  const run = async (sprint) => {
    await E(([x, z]) => CART.teleport(x, z, Math.PI), [lane.x, lane.z]);
    await E((sp) => CART.setInput({ throttle: 1, sprint: sp }), sprint);
    await E(() => CART.advance(1.6));
    return (await E(() => CART.state())).speed;
  };
  const jog = await run(false), sprint = await run(true);
  assert(sprint > jog + 1, `sprint ${sprint.toFixed(2)} vs jog ${jog.toFixed(2)}`);
  await E(() => CART.setInput({ throttle: 0 }));
  await E(() => CART.advance(0.5));
  const coast = (await E(() => CART.state())).speed;
  assert(coast > 2 && coast < sprint, `coast ${coast.toFixed(2)} after ${sprint.toFixed(2)}`);
  await E(() => CART.setInput(null));
});

await T('ramming a shelf makes it tip and dumps its stock on the floor', async () => {
  await solo('bullseye', 5, 0);
  const t = await E(() => {
    const w = CART.game.world;
    const sh = w.shelves.shelves[Math.floor(w.shelves.shelves.length / 2)];
    const p = sh.body.translation();
    return { x: p.x, z: p.z };
  });
  // aisle runs along Z; come in from the aisle side at full tilt
  await launchCart(t.x - 2.6, t.z, Math.PI / 2, 11);
  await E(() => CART.setInput({ throttle: 1, sprint: true }));
  await E(() => CART.advance(2.5));
  await E(() => CART.setInput(null));
  const s = await E(() => CART.stats());
  assert(s.shelvesMoved >= 1 || s.maxTilt > 0.2, `shelf didn't react: tilt ${s.maxTilt.toFixed(3)}`);
  assert(s.fallen >= 15, `only ${s.fallen} items fell`);
  await E(([x, z]) => CART.view([x - 5, 3, z + 4, x, 0.6, z]), [t.x, t.z]);
  await shot(page, '02-shelf-ram.png');
  await E(() => CART.view(null));
  await E(() => CART.advance(8));
  const after = await E(() => CART.stats());
  assert(after.awake < 120, `items never settled back to sleep: ${after.awake} awake`);
});

await T('eggs crack on impact and leave a slippery yolk puddle', async () => {
  await solo('wholefarm', 11, 0);
  const egg = await E(() => {
    const it = CART.game.world.items.all.find((i) => i.kind.id === 'eggs' && i.shelf === -4);
    const p = it.body.translation();
    return { x: p.x, z: p.z };
  });
  assert(egg, 'no egg table');
  const before = await E(() => CART.stats());
  await launchCart(egg.x - 4, egg.z, Math.PI / 2, 9);
  await E(() => CART.setInput({ throttle: 1 }));
  await E(() => CART.advance(3));
  await E(() => CART.setInput(null));
  const s = await E(() => CART.stats());
  assert(s.smashed > before.smashed, 'no eggs smashed');
  const eggSlick = await E(() => CART.game.world.hazards.activeSlicks().filter((x) => x.type === 'egg').length);
  assert(eggSlick > 0, 'no egg puddle');
  // the puddle actually changes the surface physics
  const sl = await E(([ex, ez]) => {
    const eggs = CART.game.world.hazards.activeSlicks().filter((x) => x.type === 'egg');
    eggs.sort((a, b) => Math.hypot(a.x - ex, a.z - ez) - Math.hypot(b.x - ex, b.z - ez));
    return { x: eggs[0].x, z: eggs[0].z };
  }, [egg.x, egg.z]);
  const grip = await E(([x, z]) => CART.game.world.hazards.surfaceAt(x, z).grip, [sl.x, sl.z]);
  assert(grip < 0.5, `egg grip ${grip}`);
  await E(([x, z]) => CART.view([x - 2.5, 2.2, z + 2.5, x, 0, z]), [sl.x, sl.z]);
  await shot(page, '03-egg-mess.png');
  await E(() => CART.view(null));
});

await T('all five mess types render as visible puddles (pixel diff)', async () => {
  await solo('safely', 1, 0);
  const view = await E(() => { const s = CART.state(); const v = [s.x, 4, s.z + 1, s.x, 0, s.z - 4]; CART.view(v); return s; });
  const before = await E(() => CART.pixelStats());
  await E((s) => ['egg', 'oil', 'milk', 'soda', 'mayo'].forEach((t, i) => CART.spawnSlick(t, s.x - 4 + i * 2, s.z - 4, 0.9)), view);
  const after = await E(() => CART.pixelStats());
  await shot(page, '03-puddles.png');
  await E(() => CART.view(null));
  const diff = Math.abs(after.mean - before.mean) + Math.abs(after.std - before.std) + Math.abs(after.colors - before.colors) / 20;
  assert(diff > 3, `puddles barely changed the frame: ${JSON.stringify({ before, after })}`);
});

await T('oil slicks kill lateral grip and spin the cart out', async () => {
  await solo('safely', 21, 0);
  const lane = await E(() => { const w = CART.game.world; return { x: w.aisleXs[2], z: (w.runs[0][0] + w.runs[0][1]) / 2 }; });
  const corner = async (oil) => {
    await solo('safely', 21, 0);
    if (oil) await E(([x, z]) => CART.spawnSlick('oil', x, z - 3, 3), [lane.x, lane.z]);
    await launchCart(lane.x, lane.z, Math.PI, 8);
    await E(() => CART.setInput({ throttle: 1, steer: 1 }));
    let maxSlip = 0, maxSpin = 0, surface = '';
    for (let i = 0; i < 12; i++) {
      await E(() => CART.advance(0.05));
      const s = await E(() => CART.state());
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      maxSlip = Math.max(maxSlip, Math.abs(s.vx * -fz + s.vz * fx));
      maxSpin = Math.max(maxSpin, Math.abs(s.w));
      if (s.surface) surface = s.surface;
    }
    await E(() => CART.setInput(null));
    return { maxSlip, maxSpin, surface };
  };
  const clean = await corner(false), oily = await corner(true);
  assert(oily.surface === 'oil', 'never detected oil underfoot');
  assert(oily.maxSlip > clean.maxSlip * 2, `slip clean ${clean.maxSlip.toFixed(2)} vs oil ${oily.maxSlip.toFixed(2)}`);
  assert(oily.maxSpin > clean.maxSpin, `spin clean ${clean.maxSpin.toFixed(2)} vs oil ${oily.maxSpin.toFixed(2)}`);
});

await T('promo tiles and checkout nitro strips give a speed burst', async () => {
  await solo('safely', 3, 0);
  const pad = await E(() => { const p = CART.game.world.hazards.pads.find((p) => p.kind === 'nitro'); return { x: p.x, z: p.z }; });
  await launchCart(pad.x, pad.z + 3, Math.PI, 4);
  await E(() => CART.setInput({ throttle: 1 }));
  await E(() => CART.advance(1.2));
  const s = await E(() => CART.state());
  await E(() => CART.setInput(null));
  assert(s.boost > 0, 'no boost');
  assert(s.speed > 8, `boosted speed only ${s.speed.toFixed(2)}`);
});

console.log('\nRace rules & bots');
await T('driving past a listed item grabs it into the basket', async () => {
  await solo('safely', 8, 0);
  const t = await E(() => {
    const g = CART.game, need = g.cfg.list.map((e) => e.kind);
    const it = g.world.items.all.find((i) => i.alive && i.shelf >= 0 && need.includes(i.kind.id) && i.body.translation().y < 1.2);
    const p = it.body.translation(), sh = g.world.shelves.shelves[it.shelf].body.translation();
    return { x: sh.x + Math.sign(p.x - sh.x) * 1.35, z: p.z, kind: it.kind.id };
  });
  await E(([x, z]) => CART.teleport(x, z, Math.PI), [t.x, t.z]);
  await E(() => CART.advance(0.6));
  const s = await E(() => CART.state());
  assert((s.collected[t.kind] || 0) >= 1, `didn't grab ${t.kind}: ${JSON.stringify(s.collected)}`);
});

await T('a full list + checkout lane = finished, and the race ends with results', async () => {
  await solo('bullseye', 4, 7);
  await E(() => { const g = CART.game; for (const e of g.cfg.list) g.local.collected[e.kind] = e.qty; });
  const lane = await E(() => CART.game.world.lanes[3]);
  await launchCart(lane.x, lane.z + 2.5, Math.PI, 3);
  await E(() => CART.advance(1.5));
  const s = await E(() => CART.state());
  assert(s.done, 'not finished after driving through the lane');
  for (let i = 0; i < 20; i++) { await E(() => CART.advance(10)); if ((await E(() => CART.game.phase)) === 'over') break; }
  assert((await E(() => CART.game.phase)) === 'over', 'race never ended');
  await page.waitForFunction(() => document.getElementById('results').classList.contains('show'), { timeout: 20000 });
  const r = await E(() => CART.game.results);
  assert(r[0].done, 'winner not finished');
  const finishedBots = r.filter((x) => x.bot && x.done).length;
  assert(finishedBots >= 4, `only ${finishedBots}/7 bots finished`);
  await page.screenshot({ path: 'tests/screenshots/04-results.png' });
});

await T('bots navigate, collect, and avoid getting permanently stuck', async () => {
  await solo('costplenty', 17, 7);
  const start = await E(() => CART.bots());
  await E(() => CART.advance(40));
  const b = await E(() => CART.bots());
  for (const x of b) assert(Number.isFinite(x.x) && Number.isFinite(x.z), 'NaN bot position');
  const moved = b.filter((x, i) => Math.hypot(x.x - start[i].x, x.z - start[i].z) > 5).length;
  const collecting = b.filter((x) => x.items >= 2).length;
  assert(moved >= 6, `only ${moved}/7 bots moved`);
  assert(collecting >= 5, `only ${collecting}/7 bots have 2+ items: ${b.map((x) => x.items).join(',')}`);
  await E(() => CART.setCam('chase'));
  await shot(page, '05-bots.png');
});

console.log('\nPerformance & pooling');
await T('perf budget: sleeping store, bounded draw calls and triangles, fast physics step', async () => {
  await solo('costplenty', 2, 7);
  await E(() => CART.advance(1));
  await E(() => CART.render());
  const s = await E(() => CART.stats());
  assert(s.calls < 220, `${s.calls} draw calls`);
  assert(s.triangles < 900000, `${s.triangles} triangles`);
  const t = await E(() => { const g = CART.game; const t0 = performance.now(); for (let i = 0; i < 120; i++) g.phys.step(); return (performance.now() - t0) / 120; });
  console.log(`      ${s.total} items · ${s.bodies} bodies · ${s.calls} calls · ${(s.triangles / 1000).toFixed(0)}k tris · physics ${t.toFixed(2)} ms/step`);
  assert(t < 8, `physics step ${t.toFixed(2)} ms`);
});

await T('object pools: puddle decals and spawned items recycle instead of growing', async () => {
  await solo('safely', 6, 0);
  const r = await E(() => {
    const g = CART.game, hz = g.world.hazards;
    for (let i = 0; i < 400; i++) hz.addSlick('egg', (i % 40) - 20, Math.floor(i / 40) * 3 - 15, 0.5, 0);
    const kind = g.world.items.all[0].kind;
    const before = g.world.items.all.length;
    const T3 = g.world.items.all[0].body.translation();
    for (let i = 0; i < 200; i++) { const it = g.world.items.spawn(kind, { x: 0, y: 2, z: 0, clone() { return this; } }, { x: 0, y: 0, z: 0 }); if (it) g.world.items.remove(it); }
    return { slicks: hz.activeSlicks().length, cap: hz.capacity, growth: g.world.items.all.length - before };
  });
  assert(r.slicks <= r.cap, `${r.slicks} slicks > pool ${r.cap}`);
  assert(r.growth <= 1, `item pool grew by ${r.growth}`);
});

await T('distance LOD: only nearby items use the hi-poly mesh', async () => {
  await solo('safely', 6, 0);
  await E(() => { const w = CART.game.world; CART.teleport(w.aisleXs[2], (w.runs[0][0] + w.runs[0][1]) / 2, Math.PI); });
  await E(() => CART.render());
  const r = await E(() => { let hi = 0, total = 0; for (const b of CART.game.world.items.batches) { hi += b.hi.count; total += b.items.length; } return { hi, total }; });
  assert(r.hi > 0 && r.hi < r.total * 0.3, `hi ${r.hi} of ${r.total}`);
});

console.log('\nShop');
await T('garage: buying and equipping wheels persists across reloads', async () => {
  await page.goto(BASE + '?test&fresh', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CART && CART.ready);
  await page.click('#btn-garage');
  await page.waitForSelector('#garage.show');
  const coupons = await E(() => CART.profile.coupons);
  const buy = await page.$$eval('#g-items .card button', (bs) => bs.map((b) => b.textContent));
  const idx = buy.findIndex((t) => t.includes('150'));
  assert(idx >= 0, 'no 150-coupon wheel: ' + buy.join('|'));
  await (await page.$$('#g-items .card button'))[idx].click();
  const p = await E(() => CART.profile);
  assert(p.coupons === coupons - 150, `coupons ${p.coupons}`);
  assert(p.owned.includes('wheel:rubber') && p.custom.wheel === 'rubber', 'not owned/equipped');
  await page.screenshot({ path: 'tests/screenshots/06-garage.png' });
  await page.goto(BASE + '?test', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CART && CART.ready);
  const p2 = await E(() => CART.profile);
  assert(p2.custom.wheel === 'rubber' && p2.coupons === coupons - 150, 'purchase not persisted');
});

console.log('\nMultiplayer (P2P protocol over BroadcastChannel)');
async function mpTest(query, maxErr) {
  const small = { width: 640, height: 360 };
  const host = await openPage(browser, BASE + '?test&fresh&net=local' + query, small);
  const client = await openPage(browser, BASE + '?test&fresh&net=local' + query, small);
  const H = (fn, a) => host.page.evaluate(fn, a), C = (fn, a) => client.page.evaluate(fn, a);
  await H(() => CART.setName('HostHank'));
  await C(() => CART.setName('ClientCleo'));
  const code = await H(() => CART.host('safely'));
  const slot = await C((c) => CART.join(c), code);
  assert(slot === 1, `client got slot ${slot}`);
  await host.page.waitForFunction(() => CART.lobby().players.length === 2, { timeout: 10000, polling: 100 });
  await client.page.waitForFunction(() => CART.lobby().players.length === 2, { timeout: 10000, polling: 100 });
  await H(() => CART.startLobby());
  await host.page.waitForFunction(() => CART.game && CART.game.phase === 'race', { timeout: 60000, polling: 100 });
  await client.page.waitForFunction(() => CART.game && CART.game.phase === 'race', { timeout: 60000, polling: 100 });
  const same = await Promise.all([H(() => CART.game.world.items.all.length), C(() => CART.game.world.items.all.length), H(() => JSON.stringify(CART.game.cfg.list)), C(() => JSON.stringify(CART.game.cfg.list))]);
  assert(same[0] === same[1] && same[2] === same[3], 'peers built different stores/lists');
  // client drives; host watches the remote cart
  await C(() => CART.setInput({ throttle: 1, sprint: true }));
  const samples = [];
  // sample the host's view every 100 ms until the client has covered real ground (slow CI GPUs vary)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const [h, c] = await Promise.all([H(() => CART.remote(1)), C(() => CART.state())]);
    samples.push({ hx: h.x, hz: h.z, cx: c.x, cz: c.z, ex: h.extrapolating, n: h.buffered, t: performance.now() / 1000 });
    if (i >= 20 && Math.hypot(c.x - samples[0].cx, c.z - samples[0].cz) > 8) break;
  }
  await C(() => CART.setInput(null));
  const moved = Math.hypot(samples.at(-1).cx - samples[0].cx, samples.at(-1).cz - samples[0].cz);
  assert(moved > 3, `client only moved ${moved.toFixed(2)}m`);
  const err = Math.hypot(samples.at(-1).hx - samples.at(-1).cx, samples.at(-1).hz - samples.at(-1).cz);
  assert(err < maxErr, `host sees client ${err.toFixed(2)}m away from truth`);
  // rubber-banding check: the host's view must never jump backwards or teleport
  let maxJump = 0, backwards = 0;
  for (let i = 1; i < samples.length; i++) {
    // a jump is "teleporting" if it beats a boosted cart's top speed (16 m/s) over the real gap
    const d = Math.hypot(samples[i].hx - samples[i - 1].hx, samples[i].hz - samples[i - 1].hz);
    maxJump = Math.max(maxJump, d - 16 * (samples[i].t - samples[i - 1].t));
    const dir = Math.sign(samples.at(-1).hz - samples[0].hz);
    if ((samples[i].hz - samples[i - 1].hz) * dir < -0.05) { backwards++; console.log('      backwards at', i, JSON.stringify(samples.slice(Math.max(0, i - 3), i + 2).map((q) => [q.hz.toFixed(2), q.cz.toFixed(2), q.ex, q.n]))); }
  }
  assert(backwards === 0, `remote cart moved backwards ${backwards}x (rubber-banding)`);
  assert(maxJump < 0.5, `remote cart teleported ${maxJump.toFixed(2)}m beyond max speed between samples`);
  // shared pickups: an item collected on the client vanishes on the host
  const id = await C(() => {
    const g = CART.game, need = new Set(g.cfg.list.map((e) => e.kind));
    const it = g.world.items.all.find((i) => i.alive && need.has(i.kind.id));
    if (!it) return { err: `phase ${g.phase}, alive ${g.world.items.all.filter((i) => i.alive).length}, list ${[...need]}` };
    g.collect(g.local, it, true);
    return it.id;
  });
  assert(typeof id === 'number', JSON.stringify(id));
  await host.page.waitForFunction((id) => !CART.game.world.items.all[id].alive, { timeout: 5000, polling: 100 }, id);
  await host.page.screenshot({ path: 'tests/screenshots/07-mp-host' + (query ? '-lag' : '') + '.png' });
  await client.page.screenshot({ path: 'tests/screenshots/07-mp-client' + (query ? '-lag' : '') + '.png' });
  assert(host.errors.length === 0 && client.errors.length === 0, 'console errors: ' + [...host.errors, ...client.errors].join('\n'));
  console.log(`      sync error ${err.toFixed(2)}m · worst over-speed step ${maxJump.toFixed(2)}m · rtt ${(await C(() => CART.lobby().rtt * 1000)).toFixed(1)}ms`);
  await host.page.close(); await client.page.close();
}

await T('host + client: lobby, synced start, smooth interpolated remote carts, shared pickups', () => mpTest('', 3));
await T('same under 80 ms lag + 60 ms jitter (reordered packets): no rubber-banding', () => mpTest('&lag=80&jitter=60', 4));

await T('no console errors anywhere in the run', async () => {
  assert(errors.length === 0, errors.join('\n'));
});

const failed = summary();
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
