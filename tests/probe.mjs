import { serve, launch, openPage, shot } from './harness.mjs';
const srv = await serve(); const port = srv.address().port;
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${port}/?test&fresh`);
const E = (f, a) => page.evaluate(f, a);
await E(() => { CART.dev('coupons 99999'); CART.dev('unlock'); });
for (const [cat, eq] of [['body', { body: 'giant', skin: 'lava', neon: 'police', addon: 'vacuum', trim: 'gold' }], ['engine', { body: 'tower', addon: 'ram', engine: 'electric' }], ['skin', { body: 'triple', skin: 'galaxy', addon: 'tank', wheel: 'monster' }]]) {
  await E(([c, e]) => { CART.equip(e); CART.garage(c); }, [cat, eq]);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: `tests/screenshots/probe-garage-${cat}.png` });
}
for (const body of ['tower', 'giant', 'wide', 'mini', 'limo', 'double']) {
  await E((body) => CART.equip({ body, addon: ['vacuum','dropper','tank','magnet','ram'][Math.floor(Math.random()*5)] }), body);
  await E(() => CART.startSolo('safely', { seed: 3, skipCountdown: true }));
  await E(() => { CART.manual = true; CART.setInput({ throttle: 1, nitro: true }); CART.advance(1.5); CART.setInput(null); });
  const st = await E(() => CART.state());
  await E(() => CART.setCam('chase'));
  await shot(page, `probe-race-${body}.png`);
  console.log(body, st.speed.toFixed(2), st.y.toFixed(3), JSON.stringify(await E(() => CART.stats())).slice(0, 120));
}
console.log('errors', errors.slice(0, 5));
await b.close(); srv.close();
