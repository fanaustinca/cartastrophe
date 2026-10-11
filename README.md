# 🛒 Cartastrophe

An 8-player, first-person shopping-cart race through destructible parody grocery stores.
Grab everything on your list, then hit the checkout. Shelves tip over, eggs smash into
slippery yolk, and oil slicks spin you out.

**Play:** https://fanaustinca.github.io/cartastrophe/

## Gameplay
- **Quick Race**: you against 7 bots. **Host / Join**: online P2P lobbies of up to 8 players. Share the 5-letter code or the invite link, and empty slots fill with bots.
- Each race gives everyone the same randomized shopping list of 8 kinds. Drive past a listed item to grab it.
- **Finding things:**
  - Each list entry shows a picture of the actual product and where the nearest ones are ("Aisle 4", "Produce", "Pallet display").
  - Big signs hang from the ceiling over every aisle, with product pictures.
  - Floating badges mark where your items are, and you can see them through shelves.
  - An arrow at the top of the screen points to the nearest item.
  - The minimap turns with you (up is the way you're facing); **M** opens the full store map.
- **Products look like products:** every kind has printed packaging. The toilet paper is a pack of rolls in a "SOFT-EE 36 MEGA ROLLS" sleeve, the soup is a red-and-white can, and so on.
- Once your list is complete, drive through any checkout lane to finish. The nitro strips in the lanes are the finish line.
- Collected items weigh your cart down, and a hard hit can knock one out of the basket.
- **Shelves restock themselves.** A minute after a shelf (or pallet, produce bin or dairy case) gets wrecked, staff stand it back up, put every product back (smashed and grabbed ones too) and mop up its puddles. They wait until no cart is in the way.

### The comedy layer
- **Store PA:** a "ding-dong" and an announcement whenever something happens: shelves going down ("{name}, that shelf was load-bearing"), eggs on the floor, spin-outs, restocks, the last 30 seconds, the first checkout, plus idle chatter ("Lost child at customer service. He says his name is Doug and he is forty-one"). Your browser reads them aloud (turn that off in Settings). Every store has its own announcer, with their own voice, jingle and opinions: **Gary** (Cost-Plenty, deep, slow, nineteen years on the warehouse floor), **Brittany** (Bullseye, high-pitched, over-caffeinated), **Juniper** (Whole Farm, soft and mindful), **Unit-7** (Best Buyout, a robot with a modem bleep) and **Hal** (Safely Market, a grocery grandpa with a ding-dong). Each store's announcer picks the closest matching voice your browser has installed.
- **Trash talk:** bots shout in comic speech bubbles when bumped, honked at, spun out or finishing. Each named bot has its own lines (Karen 3000 wants to speak to your manager; BOGO Bob says "bump one, get one free"). In multiplayer the host sends them to everyone.
- **Chaos meter:** everything you break is priced: a $3.49 egg carton, an $899.99 TV, a **$1,299 shelf**, $49.99 of "emotional damage" per shopper you bump. Floating price tags pop up, and chaining damage within 3 s builds a **CHAOS ×N combo** that multiplies it. A toppled shelf's stock is credited to whoever rammed it.
- **Horns (H):** bike bell, clown honk, screaming goat, air horn, sad trombone, La Cucaracha and more. A bot right in front of a honk jumps and yells. Bots honk when you block them.
- **Damage receipt:** the results screen prints an itemised receipt (combo surcharge, an 8.25% chaos tax, "YOU SAVED $0.00"). Your damages pay a chaos bonus of up to 150 coupons. Awards go to the Wrecking Ball, Floor Omelette Chef, Butter Wheels, Road Rage, Human Bowling Pin and others.
- **Daily challenges:** three a day, the same for everyone on that date (e.g. "Flatten 5 shelves", "Hit a ×5 chaos combo"). Progress adds up across races, and each one pays coupons once.
- **Shopper rank:** XP from every race moves you from Bag Boy to Cart Deity, with a coupon bonus at each promotion.

| Key | Action |
|---|---|
| W/S or ↑/↓ | push / brake & reverse |
| A/D or ←/→ | steer |
| Shift | sprint (uses stamina) |
| E | nitro (burns the tank; refills slowly, and from boost tiles) |
| Q | use your add-on (Oil Dropper) |
| H | horn |
| Space | hop on and ride (low grip, so you drift) |
| C | first-person / chase camera |
| R | reset the cart upright |
| M / Tab | full store map |
| Esc | pause (solo only) |
| ` (backtick) | dev console |

Gamepads work too (RT/LT, left stick, A = ride, X = sprint, B/RB = nitro, Y/LB = add-on, D-pad up/R3 = horn).

## The five stores
| Store | Flavor |
|---|---|
| **Cost-Plenty** | Warehouse racks 3 m tall, pallets of toilet paper and dog food, a forklift |
| **Bullseye Store** | Red and white, glossy tile, egg tables, headphones and games |
| **Whole Farm** | Wood shelving, produce bins, kombucha and free-range eggs everywhere |
| **Best Buyout** | Dark carpet, a wall of animated TVs, TV boxes and energy drinks |
| **Safely Market** | Checkerboard floor, classic grocery aisles, dairy wall |

### Dev console
Press **`** (backtick) anywhere and type `help`.

| Command | What it does |
|---|---|
| `coupons [n]` | add coupons (default 10000) |
| `unlock` | own everything in the garage |
| `max` | electric motor plus every upgrade at level 5 |
| `cart <type>` | swap carts mid-race (`standard double triple mini wide limo giant tower`) |
| `nitro` | refill the nitro tank (and dropper charges) |
| `restock` | restock every wrecked shelf right now |
| `reset` | wipe your profile |
| `win` / `finish` | tick off your whole list / check out immediately |
| `time <sec>` | set the time left |
| `tp <item>` / `tp checkout` | teleport to the nearest listed item, or the checkouts |
| `freeze` | pause or unpause the bots |
| `topple` | knock every shelf over |
| `pa [event]` | make the store PA announce something (`shelf`, `egg`, `ambient`, ...) |
| `honk` | honk your horn |
| `say <text>` | every other shopper says it |
| `xp <n>` | add shopper-rank XP |
| `daily` | leave today's challenges one step from done |

## Garage
You earn coupons for each race based on your placing and items collected. Spend them on:
- **Carts**:
  - Standard
  - **Double Decker** and **Triple Stack** (stacked carts that reach the top shelves)
  - **Micro Cart** (ultra small, twitchy, easy to shove)
  - **Ultra-Wide Hauler** (grabs from both sides)
  - **Stretch Limo**
  - **Mega Cart** (ultra big; bulldozes shelves at a jog)
  - **Sky-Scraper 100**: a hundred carts tall, sways in the corners, and reaches every shelf.
- **Wheels**:
  - **Zero-Slip Treads**: no slipping on oil, yolk, milk or mayo.
  - Ice Skates, Bubblegum Rollers (sticky soda can't slow them), knobbies, Mag-Lev, Monster Truck wheels and Rocket Bearings.
- **Front add-ons**:
  - **Mop-Vac 3000** sucks up puddles as you drive.
  - **Oil Dropper**: Q drops a slick behind you.
  - **Nitro Tank**: double nitro.
  - **Item Magnet**: grabs from much further away.
  - **Battering Ram**: sends rivals flying and shrugs off their bumps.
- **Engine & Nitro**:
  - The **Electric Motor** is faster, punchier, and keeps driving while you ride.
  - Upgrade top speed, acceleration and torque, plus nitro power, capacity and recharge (5 levels each).
- **Paint** (20 finishes, including animated lava, galaxy, mall-cop lights and a see-through ghost cart), **trim colors**, **neon underglow** and **squeak sounds** (now including Dolphin, Whoopee Cushion and Baby Laugh).
- **Hats** for your shopper: traffic cone, chef's toque, a propeller beanie that spins faster the faster you go, viking helmet, tinfoil hat, a whole fish, a rubber duck, the Coupon Crown, and a tiny shopping cart.
- **Horns** (see above).

Bots get random carts too. Most are sensible, but now and then one shows up in a triple stack or a Sky-Scraper.

## Tech
- **Three.js** rendering and **Rapier** (WASM) physics, written in TypeScript and bundled with Vite.
- **PeerJS** WebRTC in a host-relayed star topology. The host also runs the bots.

### Physics
Every shelf, display table and item is a real dynamic body: roughly 4–6k items per store.
- Shelves are compound bodies of 200–400 kg.
  - A jogging bump only rocks a shelf: a righting spring stands it back up, like a bolted, bottom-heavy unit.
  - A sprinting or boosted ram (above 7.6 m/s) sends it over.
  - Shelves don't collide with each other, so one crash can't domino through a whole run.
- When a shelf moves, the stock on it is woken. Taking or smashing an item wakes whatever was stacked on top of it. The awake budget only freezes items lying on the floor. Together these mean nothing is ever left asleep in mid-air.
- Fragile items (eggs, milk, oil, soda, mayo, kombucha) listen for contact-force events. They break into a puddle that changes grip or drag under the carts.
- Each cart is a single body (cart plus shopper, about 100 kg) on frictionless wheels. Grip, drive, drift and spin-outs are applied as per-step impulses scaled by the surface under it.

### Performance (target: a stable 60 fps)
- **Sleeping**: the whole store is built awake, stepped twice so the resting contacts exist, then put to sleep. Untouched shelves and items cost nothing. (A body created asleep in Rapier sinks into its support when it wakes.)
- **Awake budget**: when too many items are rolling around, the slowest ones far from the camera are forced to sleep.
- **Instancing**: there is one InstancedMesh pair per item kind. Each kind has its own material with a procedurally drawn label texture (`src/labels.ts`). Transparent parts of the label show the per-instance product color, so the labels add no draw calls. The **hi-LOD** mesh is re-packed every frame with only the items near the camera, so far items use low-poly geometry and cast no shadows. Shelves have their own distance LOD, and carts use `THREE.LOD`.
- **Pooling**: puddle decals (160), particles (500), and removed or spilled items reuse their bodies and instance slots.
- **Batching**: static geometry is merged into a single vertex-colored mesh, and every material is precompiled behind the loading screen.
- **Adaptive resolution**: the pixel ratio drops when fps falls below 50.

### Netcode
- Each peer simulates its own cart, so input feels instant. Remote carts are kinematic bodies, so they still shove shelves and items locally.
- Remote carts render 100 ms behind a synced host clock (ping/pong offset estimation).
- Positions use cubic Hermite interpolation between snapshots, extrapolate for at most 250 ms, and blend corrections in over about 100 ms. This avoids rubber-banding.
- Pickups, smashes, finishes and cart-to-cart bumps are sent as events.

### Bots
- **Choosing items:** each bot looks at the nearest few items still on its list and picks the one with the shortest real route around the shelving (A*). Skilled bots compare more options.
- **Driving:** bots steer toward a point a little way along their route and plan speed for upcoming corners, braking before them instead of drifting into shelves.
- **Avoiding trouble:** bots slow down on spills, brake for anything blocking the way ahead, and only sprint on clear straights.
- **Recovering:** if a bot stops getting closer to its goal, it backs out and replans.

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
- rams a shelf (it tips and items fall); a jogging bump doesn't topple and a sprint ram topples only the shelf hit (no domino); after rams, bot traffic and pulling items out of pallet stacks, no item is left asleep in mid-air;
- checks the labelled products, thumbnails, list pictures and locations, overhead badges, guide arrow and store map, plus the dev console;
- smashes an egg table (yolk puddle with reduced grip), corners on oil (more slip and spin than on clean floor), and hits nitro strips (speed burst);
- tests item pickup, checkout/finish, and full races with results, plus bot navigation;
- checks performance budgets (draw calls, triangles, physics ms/step), pool recycling and LOD;
- buys and equips from the shop, then checks the purchase survives a reload;
- renders every garage tab, buys a cart, an add-on, the motor and upgrades (exact coupon math), and migrates an old-format save;
- drives every cart body (size, weight, stacked levels); checks that nitro, the electric motor (also while riding) and the Nitro Tank do what they say; Zero-Slip Treads don't spin on oil but casters do; the Mop-Vac clears a puddle and the Oil Dropper leaves one;
- wrecks a shelf and checks it restocks after a minute: it waits while a cart is parked next to it, then the shelf is upright and back home, every product is back, its puddles are gone, and everything settles back to sleep;
- renders at medium quality with shadows on and fails on any GL draw error (that's how the empty-shelves bug got through: the suite ran on low quality only);
- flattens a shelf and checks the comedy layer: damages are booked to the rammer, price tags pop, the combo builds, the PA announces it and the HUD shows it; each store has a distinct announcer (name, voice settings, chime and lines), and Best Buyout's robot is the one actually talking; the results show the itemised receipt, awards, daily challenges and XP; challenge and rank bookkeeping; a honk makes the bot in front jump and yell, and a bump is counted once and makes the bot complain; hats and horns can be bought and worn, and bots wear assorted hats;
- runs **two-page multiplayer** over BroadcastChannel: lobby, synced start, identical stores, remote-cart accuracy (the host's view converges to within 35 cm once the client stops), a rubber-banding check, shared pickups, and oil drops / restocks replaying on the other peer;
- fails on **any console error**.

Screenshots land in `tests/screenshots/`. CI runs the suite and deploys `dist/` to GitHub Pages only if it passes.

On linux-arm64 (where Puppeteer has no Chrome build) the harness falls back to a local Chromium; set `CHROME_PATH` to override.
