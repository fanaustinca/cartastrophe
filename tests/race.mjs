import { serve, launch, openPage, shot } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&fresh`);
const store = process.argv[2] || 'safely';
await page.evaluate((s) => CART.startSolo(s, { seed: 7, skipCountdown: true }), store);
await page.evaluate(() => { CART.manual = true; });
for (let t = 0; t < 180; t += 15) {
  const t0 = Date.now();
  await page.evaluate(() => CART.advance(15));
  const r = await page.evaluate(() => ({ phase: CART.game.phase, t: CART.game.raceTime.toFixed(0), bots: CART.bots().map(b => `${b.items}${b.done ? '✓' : ''}${b.state[0]}`).join(' '), s: CART.stats() }));
  console.log(`t=${r.t} ${r.phase} [${r.bots}] awake=${r.s.awake} shelvesMoved=${r.s.shelvesMoved} smashed=${r.s.smashed} slicks=${r.s.slicks} fallen=${r.s.fallen} phys=${r.s.physMs.toFixed(1)}ms (${Date.now() - t0}ms wall)`);
  if (r.phase === 'over') break;
}
await page.evaluate(() => CART.setCam('chase'));
await shot(page, `race-${store}-end.png`);
console.log(JSON.stringify(await page.evaluate(() => CART.game.results?.map(r => [r.place, r.name, r.done, r.time?.toFixed?.(1), r.items]))));
console.log('ERRORS', errors);
await browser.close(); srv.close();
