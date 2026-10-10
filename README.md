# 🛒 Cartastrophe

An 8-player, first-person shopping-cart race through destructible parody grocery stores.
Grab everything on your list, then hit the checkout. Shelves tip over, eggs smash into
slippery yolk, and oil slicks spin you out.

**Play:** https://fanaustinca.github.io/cartastrophe/

## Gameplay
- **Quick Race**: you against 7 bots. **Host / Join**: online P2P lobbies of up to 8 players. Share the 5-letter code or the invite link, and empty slots fill with bots.
- Each race gives everyone the same randomized shopping list of 8 kinds. Aisles are themed and the hanging signs tell you what's in each one. Drive past a listed item to grab it.
- Once your list is complete, drive through any checkout lane to finish. The nitro strips in the lanes are the finish line.
- Collected items weigh your cart down, and a hard hit can knock one out of the basket.

| Key | Action |
|---|---|
| W/S or ↑/↓ | push / brake & reverse |
| A/D or ←/→ | steer |
| Shift | sprint (uses stamina) |
| Space | hop on and ride (low grip, so you drift) |
| C | first-person / chase camera |
| R | reset the cart upright |
| Esc | pause (solo only) |

Gamepads work too (RT/LT, left stick, A = ride, X = sprint).

## The five stores
| Store | Flavor |
|---|---|
| **Cost-Plenty** | Warehouse racks 3 m tall, pallets of toilet paper and dog food, a forklift |
| **Bullseye Store** | Red and white, glossy tile, egg tables, headphones and games |
| **Whole Farm** | Wood shelving, produce bins, kombucha and free-range eggs everywhere |
| **Best Buyout** | Dark carpet, a wall of animated TVs, TV boxes and energy drinks |
| **Safely Market** | Checkerboard floor, classic grocery aisles, dairy wall |

## Garage
You earn coupons for each race based on your placing and items collected. Spend them on:
- **Wheels**, each with different speed, grip and slick resistance (knobbies shrug off oil).
- **Skins**, including chrome, gold and holo rainbow.
- **Neon underglow**.
- **Squeak sounds**: duck, rubber chicken and kazoo.

## Tech
- **Three.js** rendering and **Rapier** (WASM) physics, written in TypeScript and bundled with Vite.
- **PeerJS** WebRTC in a host-relayed star topology. The host also runs the bots.

### Physics
Every shelf, display table and item is a real dynamic body: roughly 4–6k items per store.
- Shelves are compound bodies about 150 kg each. They wobble, tip and dump their stock.
- Fragile items (eggs, milk, oil, soda, mayo, kombucha) listen for contact-force events. They break into a puddle that changes grip or drag under the carts.
- Each cart is a single body (cart plus shopper, about 100 kg) on frictionless wheels. Grip, drive, drift and spin-outs are applied as per-step impulses scaled by the surface under it.

### Performance (target: a stable 60 fps)
- **Sleeping**: the whole store is built awake, stepped twice so the resting contacts exist, then put to sleep. Untouched shelves and items cost nothing. (A body created asleep in Rapier sinks into its support when it wakes.)
- **Awake budget**: when too many items are rolling around, the slowest ones far from the camera are forced to sleep.
- **Instancing**: there is one InstancedMesh pair per item kind. The **hi-LOD** mesh is re-packed every frame with only the items near the camera, so far items use low-poly geometry and cast no shadows. Shelves have their own distance LOD, and carts use `THREE.LOD`.
- **Pooling**: puddle decals (160), particles (500), and removed or spilled items reuse their bodies and instance slots.
- **Batching**: static geometry is merged into a single vertex-colored mesh, and every material is precompiled behind the loading screen.
- **Adaptive resolution**: the pixel ratio drops when fps falls below 50.

### Netcode
- Each peer simulates its own cart, so input feels instant. Remote carts are kinematic bodies, so they still shove shelves and items locally.
- Remote carts render 100 ms behind a synced host clock (ping/pong offset estimation).
- Positions use cubic Hermite interpolation between snapshots, extrapolate for at most 250 ms, and blend corrections in over about 100 ms. This avoids rubber-banding.
- Pickups, smashes, finishes and cart-to-cart bumps are sent as events.

## Development
```bash
npm install
npm run dev          # http://localhost:8932  (add ?net=local to test multiplayer across tabs without WebRTC)
npm test             # typecheck + build + Puppeteer suite
npm run sim -- safely   # headless bot race for balance tuning
```

### Automated tests (`tests/e2e.mjs`)
Puppeteer loads the built game in headless Chromium (SwiftShader WebGL) and:
- checks every store builds, stocks thousands of items, is fully asleep at rest, and renders a non-flat frame (pixel statistics read back from a render target);
- drives with **real keyboard events**, and checks sprint vs jog speed and momentum/coasting;
- rams a shelf (it tips and items fall), smashes an egg table (yolk puddle with reduced grip), corners on oil (more slip and spin than on clean floor), and hits nitro strips (speed burst);
- tests item pickup, checkout/finish, and full races with results, plus bot navigation;
- checks performance budgets (draw calls, triangles, physics ms/step), pool recycling and LOD;
- buys and equips from the shop, then checks the purchase survives a reload;
- runs **two-page multiplayer** over BroadcastChannel: lobby, synced start, identical stores, remote-cart accuracy, a rubber-banding check, and shared pickups;
- fails on **any console error**.

Screenshots land in `tests/screenshots/`. CI runs the suite and deploys `dist/` to GitHub Pages only if it passes.

On linux-arm64 (where Puppeteer has no Chrome build) the harness falls back to a local Chromium; set `CHROME_PATH` to override.
