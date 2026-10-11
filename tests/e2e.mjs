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

await T('shadows on (medium quality): every draw is valid, so shelves are visibly stocked', async () => {
  // regression: an unsupported shadow-map type left every shadow-receiving mesh with a mismatched
  // sampler, the GPU skipped those draws, and the shelves rendered empty
  const p2 = await browser.newPage();
  await p2.evaluateOnNewDocument(() => {
    localStorage.setItem('cartastrophe.profile.v1', JSON.stringify({ quality: 'medium' }));
    window.__glErr = 0;
    const P = WebGL2RenderingContext.prototype;
    for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const f = P[k];
      P[k] = function (...a) { const r = f.apply(this, a); if (this.getError()) window.__glErr++; return r; };
    }
  });
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.CART && window.CART.ready, { polling: 100 });
  const r = await p2.evaluate(async () => {
    CART.manual = true;
    await CART.startSolo('bullseye', { seed: 7, skipCountdown: true });
    CART.view([-8.4, 1.4, -12.5, -11, 1.0, -12.5]);
    CART.render();
    return { err: window.__glErr, shadows: CART.game.world.items.batches[0].hi.castShadow, px: CART.pixelStats() };
  });
  await p2.close();
  assert(r.shadows, 'medium quality should have shadows on');
  assert(r.err === 0, `${r.err} draw calls failed with GL errors`);
  assert(r.px.colors > 150, `shelf close-up looks empty: ${JSON.stringify(r.px)}`);
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

await T('shelves are sturdy: a jogging bump only rocks one, a sprint ram topples it without a domino', async () => {
  const run = (sp) => E((sp) => {
    const w = CART.game.world, sh = w.shelves.shelves[Math.floor(w.shelves.shelves.length / 2)], p = sh.body.translation();
    CART.teleport(p.x - 1.75, p.z, Math.PI / 2);
    CART.game.local.cart.body.setLinvel({ x: sp, y: 0, z: 0 }, true);
    CART.setInput({ throttle: 1, sprint: sp > 7 });
    let mx = 0;
    for (let i = 0; i < 240; i++) { if (i === 30) CART.setInput({ throttle: -1 }); if (i === 60) CART.setInput(null); CART.advance(1 / 60); mx = Math.max(mx, sh.tilt); }
    return { mx, toppled: w.shelves.shelves.filter((s) => s.toppled).length, tilted: w.shelves.shelves.filter((s) => s.tilt > 0.2).length };
  }, sp);
  await solo('bullseye', 5, 0);
  const jog = await run(6.4);
  assert(jog.toppled === 0 && jog.mx < 0.3, `jogging bump toppled a shelf: ${JSON.stringify(jog)}`);
  await solo('bullseye', 5, 0);
  const ram = await run(9.4);
  assert(ram.toppled === 1, `sprint ram should topple exactly the shelf hit: ${JSON.stringify(ram)}`);
  assert(ram.tilted <= 1, `neighbouring shelves went over too (domino): ${JSON.stringify(ram)}`);
  await solo('bullseye', 5, 0);
  const fast = await run(7.6); // a quick run-up (not a full sprint) is enough these days
  assert(fast.toppled === 1, `a 7.6 m/s ram should tip it: ${JSON.stringify(fast)}`);
});

await T('nothing is left hovering: stock falls when its shelf tips or the item under it is taken', async () => {
  await solo('costplenty', 5, 7);
  // sprint into a few shelves, let the bots shop a while, and grab items out of pallet stacks
  for (const k of [0.3, 0.5, 0.7]) {
    await E((k) => {
      const w = CART.game.world, sh = w.shelves.shelves[Math.floor(w.shelves.shelves.length * k)], p = sh.body.translation();
      CART.teleport(p.x - 1.75, p.z, Math.PI / 2);
      CART.game.local.cart.body.setLinvel({ x: 10, y: 0, z: 0 }, true);
      CART.setInput({ throttle: 1, sprint: true }); CART.advance(0.8); CART.setInput(null);
    }, k);
  }
  await E(() => {
    const g = CART.game;
    for (const it of g.world.items.all.filter((i) => i.shelf === -5 && i.alive).slice(0, 12)) if (it.home.y < 0.5) g.world.items.remove(it); // bottom layer of pallets
    CART.advance(20);
  });
  const r = await E(() => {
    const g = CART.game, ys = [];
    for (const it of g.world.items.all) if (it.alive && it.body.isSleeping() && it.body.translation().y > 0.25) { ys.push([it, it.body.translation().y]); it.body.wakeUp(); }
    CART.advance(1.5);
    const fell = ys.filter(([it, y]) => it.alive && it.kind.shape !== 'sphere' && y - it.body.translation().y > 0.1);
    return { checked: ys.length, fell: fell.length, ex: fell.slice(0, 4).map(([it, y]) => `${it.kind.id}@${y.toFixed(2)} sh${it.shelf} home${it.home.y.toFixed(2)} d${Math.hypot(it.home.x - it.body.translation().x, it.home.z - it.body.translation().z).toFixed(2)}${it.shelf >= 0 ? " tilt" + g.world.shelves.shelves[it.shelf].tilt.toFixed(2) : ""}`) };
  });
  assert(r.fell === 0, `${r.fell} items were asleep in mid-air: ${r.ex.join(', ')}`);
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

console.log('\nItems & wayfinding');
await T('products have printed labels and recognisable thumbnails', async () => {
  await solo('costplenty', 9, 0);
  const r = await E(() => {
    const labelled = CART.game.world.items.batches.filter((b) => b.hi.material.userData.label).map((b) => b.kind.id);
    const thumbs = CART.thumbs();
    // a thumbnail is a real picture: lots of opaque, varied pixels
    const img = new Image(); img.src = thumbs.find(([id]) => id === 'tp')[1];
    return new Promise((res) => { img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data; let op = 0; const cols = new Set();
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { op++; cols.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4); }
      res({ labelled, n: thumbs.length, op, cols: cols.size });
    }; });
  });
  assert(r.labelled.includes('tp') && r.labelled.includes('cereal') && r.labelled.length >= 10, `labelled kinds: ${r.labelled}`);
  assert(r.n === 22 && r.op > 600 && r.cols > 25, `toilet paper thumbnail looks empty: ${JSON.stringify(r)}`);
  const sh = await E(() => { const w = CART.game.world, it = w.items.all.find((i) => i.kind.id === 'tp' && i.shelf >= 0); const p = it.body.translation(); return [p.x, p.y, p.z]; });
  await E(([x, y, z]) => CART.view([x - 1.6, y + 0.4, z + 0.5, x, y, z]), sh);
  await shot(page, '08-labels-tp.png');
  await E(() => CART.view(null));
});

await T('wayfinding: list shows pictures + aisle, overhead badges, guide arrow, minimap and store map', async () => {
  await solo('safely', 7, 7);
  await E(() => CART.render());
  const r = await E(() => {
    const g = CART.game;
    const rows = [...document.querySelectorAll('#h-list .it')];
    return {
      list: g.cfg.list.length, rows: rows.length, imgs: document.querySelectorAll('#h-list .it img').length,
      where: rows.map((r) => r.querySelector('i').textContent),
      badges: g.guides.sprites.filter((s) => s.visible).length,
      clusters: g.guides.clusters.length,
      guide: !document.getElementById('h-guide').classList.contains('hidden') && document.getElementById('h-guide').textContent,
      aisles: g.world.aisleZones.length,
    };
  });
  assert(r.rows === r.list && r.imgs === r.list, `list rows/images ${r.rows}/${r.imgs} for ${r.list} items`);
  assert(r.where.every((w) => w && w !== 'all gone?'), `missing locations: ${r.where}`);
  assert(r.where.some((w) => /^Aisle \d+$/.test(w)), `no aisle hints: ${r.where}`);
  assert(r.badges >= Math.min(4, r.clusters) && r.badges > 0, `badges ${r.badges} / clusters ${r.clusters}`);
  assert(r.guide && /\d+ m/.test(r.guide), `guide arrow: ${r.guide}`);
  await shot(page, '09-wayfinding.png');
  // the needed items' badge sits above where those items actually are
  const ok = await E(() => {
    const g = CART.game, c = g.guides.clusters[0];
    const near = g.world.items.near(c.x, c.z, 3.5, [], (it) => it.kind.id === c.kind && it.alive);
    return near.length;
  });
  assert(ok > 0, 'badge is not over any matching item');
  await page.keyboard.press('KeyM');
  await E(() => CART.render());
  assert(await E(() => !document.getElementById('h-bigwrap').classList.contains('hidden')), 'store map did not open');
  await shot(page, '10-store-map.png');
  await page.keyboard.press('KeyM');
  // ticking off the list switches the guides to the checkouts
  await E(() => { CART.dev('win'); CART.game.guides.refresh(); CART.advance(0.5); CART.render(); });
  assert(await E(() => CART.game.guides.checkout && document.getElementById('h-guide').textContent.includes('CHECKOUT')), 'guide did not switch to checkout');
});

console.log('\nShop');
await T('garage: buying and equipping wheels persists across reloads', async () => {
  await page.goto(BASE + '?test&fresh', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CART && CART.ready);
  await page.click('#btn-garage');
  await page.waitForSelector('#garage.show');
  await page.click('#g-tabs button[data-cat="wheel"]');
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

await T('dev console: ` opens it, coupons / unlock / tp / win commands work', async () => {
  await page.goto(BASE + '?test&fresh', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CART && CART.ready);
  const c0 = await E(() => CART.profile.coupons);
  await page.keyboard.press('Backquote');
  assert(await E(() => !document.getElementById('dev').classList.contains('hidden') && document.activeElement.id === 'dev-in'), 'console did not open/focus');
  await page.keyboard.type('coupons 5000');
  await page.keyboard.press('Enter');
  await page.keyboard.type('unlock');
  await page.keyboard.press('Enter');
  const p = await E(() => ({ c: CART.profile.coupons, owned: CART.profile.owned.length, out: document.getElementById('dev-out').textContent, shown: document.getElementById('coupons').textContent }));
  assert(p.c === c0 + 5000 && p.shown === String(c0 + 5000), `coupons ${p.c} shown ${p.shown}`);
  assert(p.owned >= 22, `owned ${p.owned}: ${p.out}`);
  await page.keyboard.press('Backquote');
  assert(await E(() => document.getElementById('dev').classList.contains('hidden')), 'console did not close');
  await solo('bullseye', 3, 0);
  const t = await E(() => { const k = CART.game.cfg.list[0].kind; const m = CART.dev('tp ' + k); const s = CART.state(); return { m, near: CART.game.world.items.near(s.x, s.z, 4, [], (i) => i.alive && i.kind.id === k).length }; });
  assert(t.near > 0, `tp didn't land near the item: ${JSON.stringify(t)}`);
  await E(() => { CART.dev('finish'); CART.advance(0.2); });
  assert(await E(() => CART.game.local.done), 'finish command did not check out');
  let bad = ''; try { await E(() => CART.dev('nonsense')); } catch (e) { bad = e.message; }
  assert(/unknown command/.test(bad), 'unknown command not reported: ' + bad);
});

console.log('\nGarage: carts, add-ons, engine, nitro');
await T('garage: every tab renders, carts / add-ons / upgrades can be bought, and old saves migrate', async () => {
  await page.goto(BASE + '?test&fresh', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CART && CART.ready);
  await E(() => CART.dev('coupons 5000'));
  const tabs = await E(() => Object.keys(CART.catalog.CATEGORIES));
  for (const c of tabs) {
    await E((c) => CART.garage(c), c);
    const n = await E(() => document.querySelectorAll('#g-items .card').length);
    const want = await E((c) => CART.catalog.CATEGORIES[c].length + (c === 'engine' ? CART.catalog.UPGRADES.length : 0), c);
    assert(n === want, `tab ${c}: ${n} cards, expected ${want}`);
  }
  const buy = async (id) => { await E(() => 0); await page.click(`#g-items .card[data-id="${id}"] button:last-child`); };
  const c0 = await E(() => CART.profile.coupons);
  await E(() => CART.garage('body')); await buy('body:double');
  await E(() => CART.garage('addon')); await buy('addon:vacuum');
  await E(() => CART.garage('engine'));
  assert(await E(() => document.querySelector('#g-items .card[data-id="up:mSpeed"] button').disabled), 'motor upgrades should be locked without a motor');
  await buy('engine:electric'); await buy('up:mSpeed'); await buy('up:mSpeed'); await buy('up:nCap');
  const p = await E(() => CART.profile);
  assert(p.custom.body === 'double' && p.custom.addon === 'vacuum' && p.custom.engine === 'electric', 'not equipped: ' + JSON.stringify(p.custom));
  assert(p.custom.up.mSpeed === 2 && p.custom.up.nCap === 1, 'upgrade levels: ' + JSON.stringify(p.custom.up));
  const spent = 250 + 450 + 1200 + 220 + Math.round(220 * 1.75) + 160;
  assert(p.coupons === c0 - spent, `coupons ${p.coupons}, expected ${c0 - spent}`);
  assert(await E(() => document.getElementById('g-stats').textContent.includes('motor')), 'stats line did not update');
  await page.screenshot({ path: 'tests/screenshots/11-garage-engine.png' });
  // a profile saved before this update (no body / add-on / engine / upgrades) still loads
  const old = await E(() => {
    localStorage.setItem('cartastrophe.profile.v1', JSON.stringify({ name: 'Oldie', coupons: 77, owned: ['wheel:caster', 'skin:chrome', 'neon:none', 'squeak:classic', 'wheel:slicks'], custom: { wheel: 'slicks', skin: 'chrome', neon: 'none', squeak: 'classic' }, best: {}, quality: 'low', volume: 0.5, races: 3 }));
    return CART.reloadProfile();
  });
  assert(old.custom.wheel === 'slicks' && old.custom.body === 'standard' && old.custom.addon === 'none' && old.custom.up.nPower === 0, 'migration: ' + JSON.stringify(old.custom));
  assert(old.owned.includes('wheel:slicks') && old.owned.includes('body:standard') && old.coupons === 77, 'migration owned: ' + old.owned);
  await E(() => CART.dev('reset'));
});

/** Drive straight down the open lane in front of the spawn for `sec`, return the end state. */
async function dragRace(custom, input, sec = 1.6) {
  await E((c) => CART.equip({ wheel: 'caster', body: 'standard', addon: 'none', engine: 'none', up: { mSpeed: 0, mAccel: 0, mTorque: 0, nPower: 0, nCap: 0, nRecharge: 0 }, ...c }), custom);
  await solo('safely', 99, 0);
  const lane = await E(() => CART.game.world.spawns[3]);
  await E(([x, z]) => CART.teleport(x, z - CART.game.local.cart.model.half, Math.PI), [lane.x, lane.z]); // long carts: tail clear of the wall
  await E((i) => { CART.setInput({ throttle: 1, sprint: true, ...i }); }, input);
  await E((sec) => CART.advance(sec), sec);
  const st = await E(() => ({ ...CART.state(), nitro: CART.game.local.cart.nitro, nitroOn: CART.game.local.cart.nitroOn, cap: CART.game.local.cart.stats.nitroCap, mass: CART.game.local.cart.body.mass() }));
  await E(() => CART.setInput(null));
  return st;
}

await T('cart bodies: every one builds, drives, and has its size / weight / levels', async () => {
  const out = {};
  for (const b of await E(() => CART.catalog.BODIES.map((b) => b.id))) {
    const st = await dragRace({ body: b }, {}, 1.2);
    const extra = await E(() => { const m = CART.game.local.cart.model; return { tower: m.tower ? m.tower.count : 0, levels: m.levels.length, cols: CART.game.local.cart.colliders.length }; });
    out[b] = { speed: st.speed, mass: st.mass, y: st.y, ...extra };
    assert(st.speed > 4, `${b} barely moved: ${st.speed.toFixed(2)}`);
    assert(Math.abs(st.y) < 0.1, `${b} not sitting on the floor: y=${st.y.toFixed(3)}`);
  }
  assert(out.giant.mass > out.standard.mass * 2 && out.mini.mass < out.standard.mass * 0.7, 'masses: ' + JSON.stringify(out));
  assert(out.double.levels === 1 && out.triple.levels === 2 && out.tower.levels === 3 && out.tower.tower === 96, 'levels: ' + JSON.stringify(out));
  await E(() => CART.setCam('chase'));
  await shot(page, '12-tower-cart.png');
  await E(() => CART.setCam('fp'));
});

await T('custom cart models: wide / limo are built (not stretched), the Ground-Scraper nests 100 carts, the Choo-Choo tows 9 that follow your path', async () => {
  const m = await E(() => {
    const out = {};
    for (const b of ['wide', 'limo', 'giant', 'groundscraper', 'train']) {
      CART.equip({ body: b }); const g = CART.garageCart(), s = g.chassis.scale;
      const inst = g.root.children.flatMap((o) => o.children ?? []).filter((o) => o.isInstancedMesh).map((o) => o.count);
      out[b] = { uniform: Math.abs(s.x - s.y) < 1e-6 && Math.abs(s.z - s.y) < 1e-6, wheels: g.wheels.length, inst };
    }
    CART.equip({ body: 'standard' });
    return out;
  });
  for (const b of ['wide', 'limo', 'giant']) assert(m[b].uniform, `${b} is stretched: ` + JSON.stringify(m[b]));
  assert(m.wide.wheels === 6 && m.limo.wheels === 6, 'wide / limo should get extra wheels: ' + JSON.stringify(m));
  assert(m.groundscraper.inst.includes(99) && m.groundscraper.inst.includes(396), 'nested carts / wheels: ' + JSON.stringify(m.groundscraper));
  assert(m.train.inst.includes(9) && m.train.inst.includes(36), 'towed carts: ' + JSON.stringify(m.train));
  // drive the train round a corner: every towed cart sits on (near) the leader's own path, a cart-gap apart
  await E(() => CART.equip({ body: 'train', engine: 'none' }));
  await solo('safely', 99, 0);
  const r = await E(() => {
    const c = CART.game.local.cart, path = [];
    CART.setInput({ throttle: 1, sprint: true });
    for (let i = 0; i < 240; i++) {
      if (i === 70) CART.setInput({ throttle: 1, steer: 0.7 });
      if (i === 120) CART.setInput({ throttle: 1 });
      CART.advance(1 / 60);
      const t = c.body.translation(); path.push([t.x, t.z]);
    }
    CART.setInput(null);
    const cars = c.trail.cars, near = (q) => Math.min(...path.map(([x, z]) => Math.hypot(x - q.x, z - q.z)));
    const gaps = cars.slice(1).map((q, i) => Math.hypot(q.x - cars[i].x, q.z - cars[i].z));
    const t = c.body.translation();
    return { n: cars.length, off: Math.max(...cars.slice(0, 3).map(near)), gaps, lead: Math.hypot(cars[0].x - t.x, cars[0].z - t.z), bodies: c.towBodies.length, moved: Math.hypot(t.x - path[0][0], t.z - path[0][1]) };
  });
  assert(r.n === 9 && r.bodies === 9, 'nine towed carts with physics: ' + JSON.stringify(r));
  assert(r.moved > 8, 'the train should drive: ' + JSON.stringify(r));
  assert(r.off < 0.3, 'the first carts should follow the leader\'s path: ' + JSON.stringify(r));
  assert(r.lead > 1.2 && r.lead < 2.6, 'first cart should be just behind the shopper: ' + JSON.stringify(r));
  await E(() => CART.setCam('chase')); await E(() => CART.render());
  await shot(page, '16-choo-choo.png');
  await E(() => CART.setCam('fp'));
});

await T('engines: legs < lawnmower < electric < rocket, and the rocket drives you while you ride', async () => {
  const sp = {};
  for (const e of ['none', 'gas', 'electric', 'rocket']) { await dragRace({ engine: e }, {}, 0.05); sp[e] = await E(() => { const s = CART.game.local.cart.stats; return s.speed * s.accel; }); }
  assert(sp.none < sp.gas && sp.gas < sp.electric && sp.electric < sp.rocket, 'engine order: ' + JSON.stringify(sp));
  const ride = await dragRace({ engine: 'rocket' }, { sprint: false, ride: true }, 1.2);
  assert(ride.speed > 4, 'the rocket should drive you while you ride: ' + ride.speed);
});

await T('nitro (E) and the electric motor make you faster; the Nitro Tank holds twice as much', async () => {
  const base = await dragRace({}, {});
  const nitro = await dragRace({}, { nitro: true });
  assert(nitro.speed > base.speed + 1.5, `nitro ${nitro.speed.toFixed(2)} vs ${base.speed.toFixed(2)}`);
  assert(nitro.nitroOn && !base.nitroOn, `nitro should be firing only while E is held: ${nitro.nitroOn}/${base.nitroOn}`);
  const motor = await dragRace({ engine: 'electric', up: { mSpeed: 5, mAccel: 5, mTorque: 0, nPower: 0, nCap: 0, nRecharge: 0 } }, {}, 1.0);
  const base2 = await dragRace({}, {}, 1.0);
  assert(motor.speed > base2.speed * 1.15, `motor ${motor.speed.toFixed(2)} vs legs ${base2.speed.toFixed(2)}`);
  // riding (Space) normally coasts; with a motor it keeps accelerating
  const rideLegs = await dragRace({}, { sprint: false, ride: true }, 1.2);
  const rideMotor = await dragRace({ engine: 'electric' }, { sprint: false, ride: true }, 1.2);
  assert(rideMotor.speed > rideLegs.speed + 1.5, `riding with motor ${rideMotor.speed.toFixed(2)} vs legs ${rideLegs.speed.toFixed(2)}`);
  const tank = await dragRace({ addon: 'tank' }, {}, 0.1);
  assert(Math.abs(tank.cap - base.cap * 2) < 0.01, `tank ${tank.cap} vs ${base.cap}`);
  console.log(`      legs ${base.speed.toFixed(1)} · nitro ${nitro.speed.toFixed(1)} · motor(max) ${motor.speed.toFixed(1)} vs ${base2.speed.toFixed(1)} m/s`);
});

await T('Zero-Slip Treads cross an oil slick without spinning out (casters spin)', async () => {
  const run = async (wheel) => {
    await E((w) => CART.equip({ wheel: w, body: 'standard', addon: 'none', engine: 'none' }), wheel);
    await solo('safely', 99, 0);
    return E(() => {
      const lane = CART.game.world.spawns[3], c = CART.game.local.cart;
      CART.teleport(lane.x, lane.z, Math.PI);
      CART.spawnSlick('oil', lane.x, lane.z - 6, 2);
      c.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
      CART.setInput({ throttle: 1, steer: 0.3 });
      let spins = 0; c.onSpin = () => spins++;
      CART.advance(1.5);
      CART.setInput(null);
      return spins;
    });
  };
  const caster = await run('caster'), zero = await run('zeroslip');
  assert(caster >= 1, 'casters should spin out on oil');
  assert(zero === 0, `zero-slip spun out ${zero}x`);
});

await T('Mop-Vac sucks up a puddle; the Oil Dropper (Q) leaves one behind', async () => {
  await E(() => CART.equip({ wheel: 'caster', body: 'standard', addon: 'vacuum', engine: 'none' }));
  await solo('safely', 99, 0);
  const vac = await E(() => {
    const lane = CART.game.world.spawns[3];
    CART.teleport(lane.x, lane.z, Math.PI);
    const s = CART.spawnSlick('egg', lane.x, lane.z - 3, 1.2);
    CART.setInput({ throttle: 0.5 });
    CART.advance(2.5);
    CART.setInput(null);
    return { active: s.active, r: s.r };
  });
  assert(!vac.active || vac.r < 0.6, `puddle survived the vacuum: ${JSON.stringify(vac)}`);
  await E(() => CART.equip({ addon: 'dropper' }));
  await solo('safely', 99, 0);
  const drop = await E(() => {
    const n0 = CART.game.world.hazards.activeSlicks().length, c = CART.game.local.cart, t = c.body.translation();
    CART.setInput({ action: true }); CART.advance(0.1); CART.setInput({ action: true }); CART.advance(0.1); // held: one drop
    CART.setInput(null); CART.advance(0.1);
    const s = CART.game.world.hazards.activeSlicks().filter((s) => s.type === 'oil').map((s) => Math.hypot(s.x - t.x, s.z - t.z));
    return { added: CART.game.world.hazards.activeSlicks().length - n0, charges: c.charges, nearest: Math.min(...s) };
  });
  assert(drop.added === 1 && drop.charges === 3, `dropper: ${JSON.stringify(drop)}`);
  assert(drop.nearest > 1 && drop.nearest < 3, `oil should land just behind the shopper: ${JSON.stringify(drop)}`);
  await E(() => CART.equip({ addon: 'none' }));
});

await T('a wrecked shelf restocks itself after a minute: upright, products back, mess mopped up', async () => {
  await E(() => CART.equip({ wheel: 'caster', body: 'standard', addon: 'none', engine: 'none' }));
  await solo('safely', 5, 0);
  const r = await E(() => {
    const g = CART.game, w = g.world, sh = w.shelves.shelves[Math.floor(w.shelves.shelves.length / 2)], p = sh.body.translation();
    const grp = g.restock.groups.find((x) => x.shelf === sh);
    // knock it over hard, and smash a fragile product off it so there's a puddle
    sh.body.applyImpulseAtPoint({ x: sh.body.mass() * 6, y: 0, z: 0 }, { x: p.x, y: p.y + 1.8, z: p.z }, true);
    CART.advance(3);
    const victim = grp.items.find((it) => it.alive && it.kind.fragile) ?? grp.items.find((it) => it.alive);
    if (victim.kind.fragile) g.smash(victim, 999, false); else w.items.remove(victim);
    if (!w.hazards.activeSlicks().some((s) => s.group === grp.index)) w.hazards.addSlick('oil', p.x + 1, p.z, 1, 0, grp.index);
    const before = { toppled: sh.toppled, tilt: sh.tilt, gone: grp.items.filter((it) => !it.alive).length, off: grp.items.filter((it) => it.alive && it.body.translation().y < it.home.y - 0.2).length };
    // parked right next to it: staff wait for you to move
    CART.teleport(p.x - 1.9, p.z, 0);
    CART.advance(63);
    const blocked = grp.items.some((it) => !it.alive);
    CART.teleport(p.x - 12, p.z, 0);
    CART.advance(1.2);
    const t = sh.body.translation();
    const after = {
      tilt: sh.tilt, dx: Math.hypot(t.x - sh.home.x, t.z - sh.home.z),
      dead: grp.items.filter((it) => !it.alive).length,
      displaced: grp.items.filter((it) => { const q = it.body.translation(); return Math.abs(q.y - it.home.y) > 0.06 || Math.hypot(q.x - it.home.x, q.z - it.home.z) > 0.08; }).length,
      slicks: w.hazards.activeSlicks().filter((s) => s.group === grp.index).length,
      count: g.restock.count,
    };
    CART.advance(3);
    return { before, blocked, after, awake: CART.stats().awake, items: grp.items.length };
  });
  assert(r.before.gone >= 1 && (r.before.toppled || r.before.off > 10), 'setup did not wreck the shelf: ' + JSON.stringify(r));
  assert(r.blocked, 'restocked while a cart was parked against it: ' + JSON.stringify(r));
  assert(r.after.count >= 1 && r.after.tilt < 0.02 && r.after.dx < 0.02, 'shelf not stood back up: ' + JSON.stringify(r));
  assert(r.after.dead === 0 && r.after.displaced <= 1, 'products not back: ' + JSON.stringify(r));
  assert(r.after.slicks === 0, 'mess not mopped up: ' + JSON.stringify(r));
  assert(r.awake < 60, 'restocked stock did not settle back to sleep: ' + JSON.stringify(r));
  await E(([x, z]) => CART.view([x - 4, 2.4, z + 3, x, 1, z]), await E(() => { const sh = CART.game.world.shelves.shelves[Math.floor(CART.game.world.shelves.shelves.length / 2)]; return [sh.home.x, sh.home.z]; }));
  await shot(page, '13-restocked.png');
  await E(() => CART.view(null));
});

console.log('\nComedy: chaos, store PA, trash talk, horns, receipt, challenges');
/** Ram the middle shelf of the store at sprint speed (same setup as the topple test). */
const ramShelf = () => E(() => {
  const w = CART.game.world, sh = w.shelves.shelves[Math.floor(w.shelves.shelves.length / 2)], p = sh.body.translation();
  CART.teleport(p.x - 1.75, p.z, Math.PI / 2);
  CART.game.local.cart.body.setLinvel({ x: 9.4, y: 0, z: 0 }, true);
  CART.setInput({ throttle: 1, sprint: true });
  for (let i = 0; i < 200; i++) { if (i === 30) CART.setInput({ throttle: -1 }); if (i === 60) CART.setInput(null); CART.advance(1 / 60); }
  return [p.x, p.z];
});

await T('chaos: flattening a shelf books the damages, pops price tags, builds a combo and the PA calls it out', async () => {
  await solo('bullseye', 5, 0);
  await E(() => { CART.advance(3); CART.game.announcer.rand = () => 0; }); // past the opening announcement; no dice
  const [x, z] = await ramShelf();
  const r = await E(() => {
    CART.render();
    const c = CART.game.local.chaos;
    return { shelves: c.shelves, damage: c.damage, style: c.style, best: c.bestCombo, eggs: c.smashed.eggs ?? 0, pa: CART.game.pa?.text ?? '', popups: CART.game.popups.group.children.length,
      hud: document.getElementById('h-combo').classList.contains('hidden') ? '' : document.getElementById('h-combo').textContent, paHud: document.querySelector('#h-pa span').textContent };
  });
  assert(r.shelves === 1, 'shelf not credited: ' + JSON.stringify(r));
  assert(r.damage >= 1299 && r.style >= r.damage, 'damages not booked: ' + JSON.stringify(r));
  assert(r.popups > 0, 'no floating price tags');
  assert(r.best >= 2, 'falling stock should chain a combo: ' + JSON.stringify(r));
  assert(r.pa.length > 10 && r.paHud === r.pa, 'the PA did not announce the wreck: ' + JSON.stringify(r));
  assert(r.hud.includes('damages'), 'HUD chaos meter missing: ' + r.hud);
  assert((await E(() => document.querySelector('#h-pa b').textContent)).includes('BRITTANY'), 'the PA banner should name the store announcer');
  await E(([x, z]) => CART.view([x - 5, 3, z + 4, x, 0.8, z]), [x, z]);
  await shot(page, '14-chaos.png');
  await E(() => CART.view(null));
});

await T('PA: every store has its own announcer, voice, chime and lines', async () => {
  const r = await E(() => {
    const H = CART.fun.PA_HOSTS, ids = ['costplenty', 'bullseye', 'wholefarm', 'bestbuyout', 'safely'];
    const voices = new Set(ids.map((id) => `${H[id]?.pitch}/${H[id]?.rate}/${H[id]?.chime}`));
    const own = ids.every((id) => CART.fun.STORE_PA[id]?.start?.length && CART.fun.STORE_PA[id]?.ambient?.length);
    return { ids: ids.length, voices: voices.size, names: new Set(ids.map((id) => H[id]?.name)).size, own };
  });
  assert(r.voices === r.ids && r.names === r.ids && r.own, 'stores should each have a distinct announcer: ' + JSON.stringify(r));
  await solo('bestbuyout', 1, 0);
  const u = await E(() => {
    const said = [];
    const s = window.speechSynthesis;
    if (s) { s.speak = (x) => said.push(x); }
    CART.game.sfx.voice = true; CART.game.sfx.enabled = true;
    CART.game.announcer.rand = () => 0;
    CART.game.announcer.say('ambient', 999);
    return new Promise((ok) => setTimeout(() => ok({ text: CART.game.pa?.text ?? '', own: CART.fun.STORE_PA.bestbuyout.ambient.includes(CART.game.pa?.text), banner: (CART.render(), document.querySelector('#h-pa b').textContent), said: said.map((x) => ({ pitch: x.pitch, rate: x.rate })), speech: !!s }), 1100));
  });
  assert(u.own && u.banner.includes('UNIT-7'), 'Best Buyout should use Unit-7 lines: ' + JSON.stringify(u));
  if (u.speech && u.said.length) assert(Math.abs(u.said[0].pitch - 0.05) < 0.01 && Math.abs(u.said[0].rate - 1.22) < 0.01, 'robot voice settings not applied: ' + JSON.stringify(u.said));
});

await T('results: an itemised damage receipt, awards, daily challenges and a shopper rank', async () => {
  await solo('bullseye', 5, 0);
  await ramShelf();
  const xp0 = await E(() => CART.profile.xp);
  await E(() => { CART.dev('finish'); CART.dev('time 0'); CART.advance(1); });
  await page.waitForFunction(() => document.getElementById('results').classList.contains('show'), { timeout: 20000 });
  const r = await E(() => ({ receipt: document.getElementById('r-receipt').textContent, awards: document.getElementById('r-awards').textContent, daily: document.querySelectorAll('#r-daily .c').length, xp: CART.profile.xp, day: CART.profile.daily.day }));
  assert(r.receipt.includes('SHELVING UNIT') && r.receipt.includes('TOTAL DAMAGES') && r.receipt.includes('CHAOS BONUS'), 'receipt: ' + r.receipt);
  assert(r.awards.includes('Wrecking Ball'), 'awards: ' + r.awards);
  assert(r.daily === 3, `daily challenges shown: ${r.daily}`);
  assert(r.xp > xp0, 'no XP for the race');
  await page.screenshot({ path: 'tests/screenshots/15-receipt.png' });
  // challenge bookkeeping: progress adds up across races, "best" ones take the max, each pays once
  const d = await E(() => {
    const F = CART.fun, st = { day: '2026-01-01', prog: {}, claimed: [] }, ch = F.dailyChallenges(st.day);
    const big = { ...F.newChaos(), shelves: 9, bumps: 30, honks: 50, bestCombo: 9, spins: 9, drops: 9, style: 99999, topSpeed: 20, smashed: { eggs: 20, tv: 5 } };
    const a = F.progressDaily(st, { chaos: big, place: 1, done: true, store: 'x', storeName: 'x', players: 8 }).length;
    const b = F.progressDaily(st, { chaos: big, place: 1, done: true, store: 'x', storeName: 'x', players: 8 }).length;
    return { n: ch.length, ids: ch.map((c) => c.id), again: F.dailyChallenges('2026-01-01').map((c) => c.id), a, b, claimed: st.claimed.length };
  });
  assert(d.n === 3 && new Set(d.ids).size === 3 && JSON.stringify(d.ids) === JSON.stringify(d.again), 'daily set: ' + JSON.stringify(d));
  // a maxed-out race completes everything except "N races" ones (which need several races), and never pays twice
  assert(d.claimed >= 1 && d.b <= 3 - d.a && d.claimed === d.a + d.b, 'daily progress: ' + JSON.stringify(d));
  const ranks = await E(() => [0, 199, 200, 99999].map((x) => CART.fun.rankOf(x).rank).concat(CART.fun.RANKS.length - 1));
  assert(ranks[0] === 0 && ranks[1] === 0 && ranks[2] === 1 && ranks[3] === ranks[4], 'ranks: ' + ranks);
});

await T('horns: a honk startles the bot in front (it jumps and yells); bumping a bot makes it complain', async () => {
  await solo('safely', 99, 1);
  const r = await E(() => {
    const g = CART.game, bot = g.players[1], me = g.local;
    g.botsFrozen = true;
    const b = bot.cart.body.translation(), yaw = bot.cart.yaw;
    CART.teleport(b.x - Math.sin(yaw) * 3, b.z - Math.cos(yaw) * 3, yaw);
    CART.advance(0.5);
    const rnd = Math.random; Math.random = () => 0.1;
    let y0 = bot.cart.body.translation().y, maxY = y0;
    CART.setInput({ honk: true });
    for (let i = 0; i < 30; i++) { CART.advance(1 / 60); maxY = Math.max(maxY, bot.cart.body.translation().y); }
    CART.setInput(null);
    const said = bot.cart.model.bubbleText;
    Math.random = rnd;
    return { hop: maxY - y0, said, honks: me.chaos.honks };
  });
  assert(r.honks === 1, 'honk not counted: ' + JSON.stringify(r));
  assert(r.hop > 0.08, 'bot did not jump: ' + JSON.stringify(r));
  assert(r.said.length > 0, 'bot said nothing: ' + JSON.stringify(r));
  await solo('safely', 99, 1);
  const b = await E(() => {
    const g = CART.game, bot = g.players[1], me = g.local;
    g.botsFrozen = true;
    const p = bot.cart.body.translation(), yaw = bot.cart.yaw;
    CART.teleport(p.x - Math.sin(yaw) * 2.6, p.z - Math.cos(yaw) * 2.6, yaw);
    me.cart.body.setLinvel({ x: Math.sin(yaw) * 6, y: 0, z: Math.cos(yaw) * 6 }, true);
    const rnd = Math.random; Math.random = () => 0.1;
    CART.setInput({ throttle: 1 });
    let said = '';
    for (let i = 0; i < 60; i++) { CART.advance(1 / 60); said ||= bot.cart.model.bubbleText; }
    CART.setInput(null);
    Math.random = rnd;
    return { bumps: me.chaos.bumps, bumped: bot.chaos.bumped, said };
  });
  assert(b.bumps === 1 && b.bumped === 1, 'bump not counted once: ' + JSON.stringify(b));
  assert(b.said.length > 0, 'bumped bot said nothing: ' + JSON.stringify(b));
  await E(() => { const bot = CART.game.players[1], t = bot.cart.body.translation(); CART.view([t.x + 2.5, 2.6, t.z + 2.5, t.x, 1.7, t.z]); });
  await shot(page, '16-trash-talk.png');
  await E(() => CART.view(null));
});

await T('hats and horns: buy, equip, the shopper wears it, and bots dress up too', async () => {
  await E(() => { CART.dev('coupons 3000'); CART.garage('hat'); });
  await page.click('#g-items .card[data-id="hat:crown"] button:last-child');
  await E(() => CART.garage('horn'));
  await page.click('#g-items .card[data-id="horn:goat"] button:last-child');
  const r = await E(() => ({ c: CART.profile.custom, hat: CART.garageCart().hatId, owned: CART.profile.owned.filter((o) => o.startsWith('hat:') || o.startsWith('horn:')) }));
  assert(r.c.hat === 'crown' && r.c.horn === 'goat' && r.hat === 'crown', 'not equipped: ' + JSON.stringify(r));
  await solo('safely', 7, 7);
  const bots = await E(() => CART.game.players.filter((p) => p.bot).map((p) => p.info.custom.hat));
  assert(bots.every((h) => typeof h === 'string') && new Set(bots).size >= 2, 'bots should wear assorted hats: ' + bots);
  await E(() => CART.equip({ hat: 'cap', horn: 'bell' }));
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
  const same = await Promise.all([H(() => CART.game.world.items.all.filter((i) => !i.spawned).length), C(() => CART.game.world.items.all.filter((i) => !i.spawned).length), H(() => JSON.stringify(CART.game.cfg.list)), C(() => JSON.stringify(CART.game.cfg.list))]);
  assert(same[0] === same[1] && same[2] === same[3], 'peers built different stores/lists: ' + JSON.stringify(same));
  // bots now carry oil droppers and battering rams: park them so they can't skew the netcode measurement
  await H(() => CART.dev('freeze'));
  // client drives; host watches the remote cart
  await C(() => CART.setInput({ throttle: 1, sprint: true }));
  const samples = [];
  // sample the host's view every 100 ms until the client has covered real ground (slow CI GPUs vary)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const [h, c] = await Promise.all([H(() => CART.remote(1)), C(() => CART.state())]);
    samples.push({ hx: h.x, hz: h.z, cx: c.x, cz: c.z, ex: h.extrapolating, n: h.buffered, t: h.simT });
    if (i >= 20 && Math.hypot(c.x - samples[0].cx, c.z - samples[0].cz) > 8) break;
  }
  const moved = Math.hypot(samples.at(-1).cx - samples[0].cx, samples.at(-1).cz - samples[0].cz);
  assert(moved > 3, `client only moved ${moved.toFixed(2)}m`);
  // in motion the host shows the cart ~(render delay + latency) behind; that lag is by design
  const lagErr = Math.hypot(samples.at(-1).hx - samples.at(-1).cx, samples.at(-1).hz - samples.at(-1).cz);
  assert(lagErr < maxErr * 1.6, `host sees moving client ${lagErr.toFixed(2)}m away from truth`);
  // once the client stops, the host's view must converge onto the true position
  await C(() => CART.setInput({ throttle: -1 }));
  await new Promise((r) => setTimeout(r, 1500));
  await C(() => CART.setInput(null));
  await client.page.waitForFunction(() => CART.state().speed < 0.05, { timeout: 5000, polling: 100 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  const [hs, cs] = await Promise.all([H(() => CART.remote(1)), C(() => CART.state())]);
  const err = Math.hypot(hs.x - cs.x, hs.z - cs.z);
  assert(err < 0.35, `stopped client: host still sees it ${err.toFixed(2)}m off (speed ${cs.speed.toFixed(2)})`);
  // rubber-banding check: the host's view must never jump backwards or teleport
  let maxJump = 0, backwards = 0;
  for (let i = 1; i < samples.length; i++) {
    // a jump is "teleporting" if it beats a boosted cart's top speed (16 m/s) over the host's own
    // simulated time between the samples (wall time would count a stalled host frame as a jump)
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
  await host.page.waitForFunction((id) => !CART.game.world.items.all[id].alive, { timeout: 20000, polling: 100 }, id);
  // an oil drop on the client, and a restock decided by the host, happen on both peers
  const at = await C(() => { const s = CART.state(); CART.game.dropOil(s.x, s.z + 2, CART.game.local, true); return [s.x, s.z + 2]; });
  // (a drop next to an existing oil puddle merges into it, so look for oil covering the spot)
  await host.page.waitForFunction(([x, z]) => CART.game.world.hazards.activeSlicks().some((s) => s.type === 'oil' && Math.hypot(s.x - x, s.z - z) < s.r), { timeout: 20000, polling: 100 }, at);
  const grp = await H(() => { const g = CART.game.restock.groups.find((x) => x.shelf); CART.game.world.items.remove(g.items[0]); CART.game.doRestock(g.index, true); return { i: g.index, id: g.items[0].id }; });
  await client.page.waitForFunction((g) => CART.game.restock.count >= 1 && CART.game.world.items.all[g.id].alive, { timeout: 20000, polling: 100 }, grp);
  await host.page.screenshot({ path: 'tests/screenshots/07-mp-host' + (query ? '-lag' : '') + '.png' });
  await client.page.screenshot({ path: 'tests/screenshots/07-mp-client' + (query ? '-lag' : '') + '.png' });
  assert(host.errors.length === 0 && client.errors.length === 0, 'console errors: ' + [...host.errors, ...client.errors].join('\n'));
  console.log(`      in-motion offset ${lagErr.toFixed(2)}m · settled error ${err.toFixed(2)}m · worst over-speed step ${maxJump.toFixed(2)}m · rtt ${(await C(() => CART.lobby().rtt * 1000)).toFixed(1)}ms`);
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
