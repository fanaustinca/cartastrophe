// Static game data: item catalog, the five parody stores, shop catalog, tuning.

export type MessType = 'egg' | 'milk' | 'oil' | 'soda' | 'mayo';
export type ItemShape = 'box' | 'can' | 'bottle' | 'carton' | 'jug' | 'bag' | 'sphere' | 'jar';

export interface ItemKind {
  id: string;
  label: string;
  icon: string;
  shape: ItemShape;
  size: [number, number, number]; // full extents x (width), y (height), z (depth)
  mass: number;
  colors: number[];
  fragile?: { mess: MessType; threshold: number; radius: number };
}

export const ITEM_KINDS: ItemKind[] = [
  { id: 'cereal', label: 'Frosted Flakez', icon: '🥣', shape: 'box', size: [0.22, 0.32, 0.08], mass: 0.6, colors: [0xe8442e, 0x2f6fd8, 0xf2b81f, 0x3bb36a] },
  { id: 'soup', label: 'Soup Cans', icon: '🥫', shape: 'can', size: [0.09, 0.12, 0.09], mass: 0.4, colors: [0xc8202a, 0xd8d8d0, 0x2a7a3a] },
  { id: 'soda', label: 'Fizz Cola 2L', icon: '🥤', shape: 'bottle', size: [0.11, 0.33, 0.11], mass: 2.0, colors: [0x7a1a12, 0x1f8a3a, 0xe0a020], fragile: { mess: 'soda', threshold: 260, radius: 0.9 } },
  { id: 'eggs', label: 'Dozen Eggs', icon: '🥚', shape: 'carton', size: [0.3, 0.075, 0.12], mass: 0.7, colors: [0xd9c9a8, 0xbfa883], fragile: { mess: 'egg', threshold: 55, radius: 0.85 } },
  { id: 'milk', label: 'Whole Milk', icon: '🥛', shape: 'jug', size: [0.14, 0.26, 0.14], mass: 3.9, colors: [0xf4f4f0], fragile: { mess: 'milk', threshold: 180, radius: 1.1 } },
  { id: 'oil', label: 'Olive Oil', icon: '🫒', shape: 'bottle', size: [0.08, 0.3, 0.08], mass: 1.0, colors: [0x6f7d1c, 0x8a8f22], fragile: { mess: 'oil', threshold: 120, radius: 1.3 } },
  { id: 'chips', label: 'Crunch Chips', icon: '🥔', shape: 'bag', size: [0.24, 0.32, 0.09], mass: 0.25, colors: [0xf5c518, 0xe03030, 0x3060e0, 0x30a050] },
  { id: 'pasta', label: 'Spaghetti', icon: '🍝', shape: 'box', size: [0.08, 0.26, 0.05], mass: 0.5, colors: [0x2050b0, 0xe6e0d0] },
  { id: 'mayo', label: 'Mega Mayo', icon: '🫙', shape: 'jar', size: [0.12, 0.17, 0.12], mass: 1.1, colors: [0xf4efd8], fragile: { mess: 'mayo', threshold: 150, radius: 0.8 } },
  { id: 'tp', label: 'Toilet Paper 36pk', icon: '🧻', shape: 'box', size: [0.42, 0.32, 0.3], mass: 2.2, colors: [0xf0f0f8, 0xd8e8f8] },
  { id: 'dogfood', label: 'Dog Chow 40lb', icon: '🐕', shape: 'bag', size: [0.42, 0.55, 0.14], mass: 9.0, colors: [0xb03a2a, 0x2a6ab0] },
  { id: 'apple', label: 'Apples', icon: '🍎', shape: 'sphere', size: [0.085, 0.085, 0.085], mass: 0.2, colors: [0xc81e1e, 0x8fc23a, 0xe0b020] },
  { id: 'melon', label: 'Watermelon', icon: '🍉', shape: 'sphere', size: [0.3, 0.27, 0.27], mass: 6.0, colors: [0x2f6a26, 0x3d7f2c] },
  { id: 'avocado', label: 'Avocados', icon: '🥑', shape: 'sphere', size: [0.08, 0.11, 0.08], mass: 0.25, colors: [0x2c3a17, 0x3d4a1c] },
  { id: 'kombucha', label: 'Kombucha', icon: '🍹', shape: 'bottle', size: [0.08, 0.24, 0.08], mass: 0.55, colors: [0xd88a30, 0xb04070, 0x60a050], fragile: { mess: 'soda', threshold: 110, radius: 0.7 } },
  { id: 'tv', label: '65" TV', icon: '📺', shape: 'box', size: [0.95, 0.6, 0.13], mass: 9.5, colors: [0x1b1b22, 0x2c3a5a] },
  { id: 'headphones', label: 'Headphones', icon: '🎧', shape: 'box', size: [0.2, 0.24, 0.09], mass: 0.5, colors: [0x101010, 0xe02050, 0x2090e0] },
  { id: 'game', label: 'Video Game', icon: '🎮', shape: 'box', size: [0.14, 0.18, 0.02], mass: 0.15, colors: [0x2050e0, 0x10a040, 0xd02020] },
  { id: 'microwave', label: 'Microwave', icon: '🔲', shape: 'box', size: [0.5, 0.32, 0.38], mass: 7.0, colors: [0xc8b898] },
  { id: 'energy', label: 'Volt Energy', icon: '⚡', shape: 'can', size: [0.066, 0.16, 0.066], mass: 0.5, colors: [0x101010, 0x60e020, 0x2060ff] },
  { id: 'bread', label: 'Bread Loaf', icon: '🍞', shape: 'bag', size: [0.28, 0.13, 0.13], mass: 0.6, colors: [0xd8a060, 0xb87a40] },
  { id: 'detergent', label: 'Laundry Soap', icon: '🧴', shape: 'jug', size: [0.2, 0.3, 0.13], mass: 4.5, colors: [0xf07a10, 0x2080e0, 0x8020c0] },
];
/** Plain product name for signs and the list ("Frosted Flakez" is a brand; "Cereal" is what you look for). */
const PLAIN: Record<string, string> = { cereal: 'Cereal', soup: 'Soup', soda: 'Soda', eggs: 'Eggs', milk: 'Milk', oil: 'Olive Oil', chips: 'Chips', pasta: 'Pasta', mayo: 'Mayo', tp: 'Toilet Paper', dogfood: 'Dog Food', apple: 'Apples', melon: 'Watermelon', avocado: 'Avocados', kombucha: 'Kombucha', tv: 'TVs', headphones: 'Headphones', game: 'Video Games', microwave: 'Microwaves', energy: 'Energy Drinks', bread: 'Bread', detergent: 'Detergent' };
export const kindName = (id: string) => PLAIN[id] ?? id;
export const KIND_BY_ID: Record<string, ItemKind> = Object.fromEntries(ITEM_KINDS.map((k) => [k.id, k]));

export interface StoreDef {
  id: string;
  name: string;
  tagline: string;
  size: [number, number]; // width (x), depth (z)
  aisleLines: number;
  segsPerRun: number;
  shelfHeight: number;
  shelfLevels: number;
  shelfStyle: 'gondola' | 'rack' | 'wood' | 'tech';
  colors: { primary: number; secondary: number; floor: number; floor2: number; wall: number; shelf: number; accent: number; light: number };
  floorPattern: 'tile' | 'checker' | 'concrete' | 'wood' | 'carpet';
  catalog: Record<string, number>; // kind id → weight on shelves
  features: { pallets: number; produce: number; freezers: boolean; eggTables: number; tvWall: boolean; oilDrums: number; boostTiles: number };
  ceiling: number;
  fogColor: number;
}

export const STORES: StoreDef[] = [
  {
    id: 'costplenty', name: 'Cost-Plenty', tagline: 'Wholesale Chaos. Membership Required.',
    size: [74, 58], aisleLines: 9, segsPerRun: 5, shelfHeight: 3.0, shelfLevels: 4, shelfStyle: 'rack',
    colors: { primary: 0xd2202a, secondary: 0x1a4fa0, floor: 0x9a9a96, floor2: 0x8c8c88, wall: 0xc9c6bd, shelf: 0x2a5ec2, accent: 0xf08a1a, light: 0xf2f4ff },
    floorPattern: 'concrete',
    catalog: { tp: 4, dogfood: 2, mayo: 3, oil: 2, cereal: 3, soda: 3, eggs: 2, milk: 2, detergent: 3, chips: 2, microwave: 1, tv: 1, soup: 2 },
    features: { pallets: 10, produce: 2, freezers: true, eggTables: 3, tvWall: false, oilDrums: 3, boostTiles: 8 },
    ceiling: 9, fogColor: 0xb8bcc4,
  },
  {
    id: 'bullseye', name: 'Bullseye Store', tagline: 'Expect More. Crash Harder.',
    size: [64, 50], aisleLines: 8, segsPerRun: 4, shelfHeight: 2.0, shelfLevels: 5, shelfStyle: 'gondola',
    colors: { primary: 0xcc0000, secondary: 0xffffff, floor: 0xe8e6e2, floor2: 0xdedbd5, wall: 0xf4f2ee, shelf: 0xf0f0f0, accent: 0xcc0000, light: 0xffffff },
    floorPattern: 'tile',
    catalog: { cereal: 4, chips: 3, soda: 3, eggs: 3, milk: 2, headphones: 2, game: 2, detergent: 2, pasta: 2, tp: 2, oil: 1, soup: 2, bread: 2 },
    features: { pallets: 2, produce: 2, freezers: true, eggTables: 3, tvWall: false, oilDrums: 2, boostTiles: 10 },
    ceiling: 6.5, fogColor: 0xe9e4e0,
  },
  {
    id: 'wholefarm', name: 'Whole Farm', tagline: 'Organic. Artisanal. Breakable.',
    size: [56, 46], aisleLines: 7, segsPerRun: 4, shelfHeight: 1.7, shelfLevels: 4, shelfStyle: 'wood',
    colors: { primary: 0x2f6b3a, secondary: 0xe8dcc0, floor: 0x7a5534, floor2: 0x6a4a2c, wall: 0xe4dac4, shelf: 0x9a6a3e, accent: 0xe0a030, light: 0xfff0d8 },
    floorPattern: 'wood',
    catalog: { kombucha: 4, eggs: 4, milk: 3, oil: 3, bread: 3, avocado: 2, apple: 2, pasta: 2, mayo: 1, cereal: 2, chips: 1 },
    features: { pallets: 1, produce: 6, freezers: true, eggTables: 4, tvWall: false, oilDrums: 1, boostTiles: 7 },
    ceiling: 6, fogColor: 0xd8ccb4,
  },
  {
    id: 'bestbuyout', name: 'Best Buyout', tagline: 'Tech Deals That Hit Different.',
    size: [62, 48], aisleLines: 8, segsPerRun: 4, shelfHeight: 2.2, shelfLevels: 4, shelfStyle: 'tech',
    colors: { primary: 0x0a3fa8, secondary: 0xffe000, floor: 0x3a3e48, floor2: 0x343842, wall: 0x1c2a4a, shelf: 0x22262e, accent: 0xffe000, light: 0xe8f0ff },
    floorPattern: 'carpet',
    catalog: { tv: 3, headphones: 4, game: 4, microwave: 2, energy: 4, chips: 2, soda: 2, detergent: 1, eggs: 1 },
    features: { pallets: 3, produce: 0, freezers: false, eggTables: 1, tvWall: true, oilDrums: 2, boostTiles: 10 },
    ceiling: 7, fogColor: 0x1a2236,
  },
  {
    id: 'safely', name: 'Safely Market', tagline: 'Ingredients for a Wild Ride.',
    size: [60, 48], aisleLines: 8, segsPerRun: 4, shelfHeight: 2.0, shelfLevels: 5, shelfStyle: 'gondola',
    colors: { primary: 0xd8342c, secondary: 0x2a2a2a, floor: 0xf0ece4, floor2: 0x2c2c30, wall: 0xf3e9d6, shelf: 0xd9d4ca, accent: 0xf08a20, light: 0xfff8ec },
    floorPattern: 'checker',
    catalog: { cereal: 3, soup: 3, pasta: 3, eggs: 3, milk: 3, soda: 3, chips: 2, oil: 2, mayo: 2, bread: 3, detergent: 1, apple: 1, tp: 1 },
    features: { pallets: 3, produce: 4, freezers: true, eggTables: 3, tvWall: false, oilDrums: 2, boostTiles: 9 },
    ceiling: 6, fogColor: 0xe8e0d0,
  },
];
export const STORE_BY_ID: Record<string, StoreDef> = Object.fromEntries(STORES.map((s) => [s.id, s]));

// ---- Shop / customization ----
export interface WheelDef { id: string; name: string; desc: string; price: number; speed: number; grip: number; rolling: number; slickResist: number; dragResist: number; color: number; radius: number; glow?: number }
export interface SkinDef { id: string; name: string; price: number; color: number; metal: number; rough: number; emissive?: number; opacity?: number; anim?: 'rainbow' | 'police' | 'lava' | 'galaxy' | 'pulse' }
export interface NeonDef { id: string; name: string; price: number; color: number | null; rainbow?: boolean; police?: boolean }
export interface SqueakDef { id: string; name: string; price: number }
export interface TrimDef { id: string; name: string; price: number; color: number; metal?: number }
/**
 * Cart bodies. s* scale the cart (not the shopper); levels stacks extra carts on top. The rest are
 * multipliers on the standard cart: speed (top speed), accel, steer, mass (collisions), cargo
 * (how much a full basket slows you), topple (ram speed needed to tip a shelf); grab/reach are
 * the pick-up radius and highest shelf you can reach (m).
 */
export interface BodyDef { id: string; name: string; desc: string; price: number; sx: number; sy: number; sz: number; levels: number; mass: number; speed: number; accel: number; steer: number; cargo: number; topple: number; grab: number; reach: number }
export interface AddonDef { id: string; name: string; desc: string; price: number }
export interface EngineDef { id: string; name: string; desc: string; price: number }
export interface UpgradeDef { id: UpgradeId; name: string; desc: string; price: number; motor?: boolean }
export type UpgradeId = 'mSpeed' | 'mAccel' | 'mTorque' | 'nPower' | 'nCap' | 'nRecharge';
export const MAX_LEVEL = 5;

const B = (o: Partial<BodyDef> & Pick<BodyDef, 'id' | 'name' | 'desc' | 'price'>): BodyDef => ({ sx: 1, sy: 1, sz: 1, levels: 1, mass: 1, speed: 1, accel: 1, steer: 1, cargo: 1, topple: 1, grab: 1.4, reach: 2.45, ...o });
export const BODIES: BodyDef[] = [
  B({ id: 'standard', name: 'Standard Cart', desc: 'The classic. One basket, four wobbly wheels.', price: 0 }),
  B({ id: 'double', name: 'Double Decker', desc: 'Two carts stacked. Reaches the top shelf.', price: 250, levels: 2, mass: 1.15, speed: 0.98, accel: 0.97, steer: 0.95, reach: 3.15 }),
  B({ id: 'triple', name: 'Triple Stack', desc: 'Three tiers of pure shopping ambition.', price: 450, levels: 3, mass: 1.3, speed: 0.96, accel: 0.94, steer: 0.9, reach: 3.8 }),
  B({ id: 'mini', name: 'Micro Cart', desc: 'Ultra small. Twitchy, quick, adorable. Gets shoved around.', price: 350, sx: 0.5, sy: 0.5, sz: 0.5, mass: 0.55, speed: 1.05, accel: 1.25, steer: 1.3, cargo: 2, grab: 1.2, reach: 2.2 }),
  B({ id: 'wide', name: 'Ultra-Wide Hauler', desc: 'Plows the whole aisle and grabs from both sides.', price: 400, sx: 2.3, mass: 1.4, speed: 0.97, accel: 0.92, steer: 0.85, grab: 2.0 }),
  B({ id: 'limo', name: 'Stretch Limo', desc: 'Ultra long, stable and classy. Hates corners.', price: 600, sz: 2.2, mass: 1.5, speed: 1.08, accel: 0.95, steer: 0.7, cargo: 0.5, grab: 1.7 }),
  B({ id: 'giant', name: 'Mega Cart', desc: 'Ultra big. Bulldozes shelves at a jog.', price: 800, sx: 1.75, sy: 1.75, sz: 1.75, mass: 2.4, speed: 1.03, accel: 0.9, steer: 0.8, cargo: 0.6, topple: 0.8, grab: 2.0, reach: 3.2 }),
  B({ id: 'tower', name: 'Sky-Scraper 100', desc: 'One hundred carts tall. Grabs anything. Sways like a palm tree.', price: 2500, levels: 100, mass: 1.6, speed: 0.92, accel: 0.85, steer: 0.78, grab: 1.6, reach: 99 }),
];
export const WHEELS: WheelDef[] = [
  { id: 'caster', name: 'Standard Casters', desc: 'Balanced. Wobbly. Iconic.', price: 0, speed: 1.0, grip: 1.0, rolling: 1.0, slickResist: 0, dragResist: 0, color: 0x222222, radius: 0.07 },
  { id: 'rubber', name: 'Grippy Rubber', desc: '+grip in corners, -top speed', price: 150, speed: 0.95, grip: 1.3, rolling: 1.1, slickResist: 0.15, dragResist: 0, color: 0x3a3a3a, radius: 0.075 },
  { id: 'skates', name: 'Ice Skates', desc: 'Pure drift. Fast and barely steerable.', price: 250, speed: 1.15, grip: 0.45, rolling: 0.4, slickResist: 0, dragResist: 0, color: 0xd8f4ff, radius: 0.06, glow: 0x205070 },
  { id: 'slicks', name: 'Racing Slicks', desc: '+top speed, drifty', price: 300, speed: 1.12, grip: 0.82, rolling: 0.8, slickResist: 0, dragResist: 0, color: 0x111111, radius: 0.08 },
  { id: 'gum', name: 'Bubblegum Rollers', desc: 'Sticky: sticky soda can\'t slow you down', price: 350, speed: 0.96, grip: 1.45, rolling: 1.0, slickResist: 0.4, dragResist: 1, color: 0xff6ab0, radius: 0.075 },
  { id: 'knobby', name: 'Off-Road Knobbies', desc: 'Shrugs off oil & yolk', price: 400, speed: 0.98, grip: 1.05, rolling: 1.2, slickResist: 0.55, dragResist: 0.3, color: 0x4a3a20, radius: 0.09 },
  { id: 'zeroslip', name: 'Zero-Slip Treads', desc: '0 slip. Oil, yolk, milk, mayo: you don\'t even notice.', price: 550, speed: 0.97, grip: 1.1, rolling: 1.05, slickResist: 1, dragResist: 0.5, color: 0x1f7a3a, radius: 0.08 },
  { id: 'hover', name: 'Mag-Lev Rollers', desc: 'Near-zero rolling drag. Glides.', price: 650, speed: 1.08, grip: 0.9, rolling: 0.45, slickResist: 0.3, dragResist: 0, color: 0x20e0ff, radius: 0.07, glow: 0x0a6080 },
  { id: 'monster', name: 'Monster Truck Wheels', desc: 'Huge, bouncy, sits up high over the mess', price: 700, speed: 1.06, grip: 1.0, rolling: 1.0, slickResist: 0.5, dragResist: 0.4, color: 0x151515, radius: 0.17 },
  { id: 'rocket', name: 'Rocket Bearings', desc: 'Top speed for days. Glowing hot.', price: 900, speed: 1.2, grip: 0.92, rolling: 0.55, slickResist: 0.1, dragResist: 0, color: 0xff5a10, radius: 0.075, glow: 0x802000 },
];
export const ADDONS: AddonDef[] = [
  { id: 'none', name: 'Nothing Up Front', desc: 'Aerodynamic. Boring.', price: 0 },
  { id: 'vacuum', name: 'Mop-Vac 3000', desc: 'Sucks up oil, yolk, milk and soda as you drive over it.', price: 450 },
  { id: 'dropper', name: 'Oil Dropper', desc: 'Q: dump an oil slick behind you. 4 charges, refills slowly.', price: 500 },
  { id: 'tank', name: 'Nitro Tank', desc: 'Doubles how much nitro you carry.', price: 400 },
  { id: 'magnet', name: 'Item Magnet', desc: 'Grabs list items from much further away.', price: 600 },
  { id: 'ram', name: 'Battering Ram', desc: 'Sends rivals flying; shrugs off their bumps.', price: 450 },
];
export const ENGINES: EngineDef[] = [
  { id: 'none', name: 'Leg Power', desc: 'You push. You sweat.', price: 0 },
  { id: 'electric', name: 'Electric Motor', desc: 'Faster, punchier, and keeps driving while you ride (Space). Upgradable below.', price: 1200 },
];
export const UPGRADES: UpgradeDef[] = [
  { id: 'mSpeed', name: 'Motor · Top Speed', desc: '+5% top speed per level', price: 220, motor: true },
  { id: 'mAccel', name: 'Motor · Acceleration', desc: 'Gets up to speed faster', price: 200, motor: true },
  { id: 'mTorque', name: 'Motor · Torque', desc: 'Heavy baskets and sticky floors barely slow you', price: 180, motor: true },
  { id: 'nPower', name: 'Nitro · Power', desc: 'Harder kick, higher nitro top speed', price: 200 },
  { id: 'nCap', name: 'Nitro · Capacity', desc: '+0.6 s of nitro per level', price: 160 },
  { id: 'nRecharge', name: 'Nitro · Recharge', desc: 'Nitro refills faster on its own', price: 160 },
];
export const upgradePrice = (u: UpgradeDef, level: number) => Math.round(u.price * (1 + level * 0.75));

export const SKINS: SkinDef[] = [
  { id: 'chrome', name: 'Classic Chrome', price: 0, color: 0xd8dde4, metal: 1, rough: 0.25 },
  { id: 'red', name: 'Bullseye Red', price: 100, color: 0xcc1111, metal: 0.4, rough: 0.4 },
  { id: 'ocean', name: 'Ocean Blue', price: 100, color: 0x1a5fd0, metal: 0.5, rough: 0.35 },
  { id: 'lime', name: 'Lime Zest', price: 100, color: 0x7ad020, metal: 0.4, rough: 0.4 },
  { id: 'orange', name: 'Orange Crush', price: 100, color: 0xff7a10, metal: 0.4, rough: 0.4 },
  { id: 'bubblegum', name: 'Bubblegum', price: 120, color: 0xff7ac0, metal: 0.3, rough: 0.5 },
  { id: 'purple', name: 'Purple Haze', price: 120, color: 0x7a30d0, metal: 0.5, rough: 0.35 },
  { id: 'white', name: 'Showroom White', price: 120, color: 0xf6f6f2, metal: 0.1, rough: 0.3 },
  { id: 'matte', name: 'Midnight Matte', price: 150, color: 0x1a1a20, metal: 0.2, rough: 0.8 },
  { id: 'camo', name: 'Aisle Camo', price: 200, color: 0x4f5a2a, metal: 0.1, rough: 0.9 },
  { id: 'carbon', name: 'Carbon Fiber', price: 250, color: 0x26282c, metal: 0.6, rough: 0.15 },
  { id: 'rosegold', name: 'Rose Gold', price: 400, color: 0xe8a090, metal: 1, rough: 0.2 },
  { id: 'gold', name: 'Gold Member', price: 500, color: 0xffc83a, metal: 1, rough: 0.2 },
  { id: 'diamond', name: 'Diamond', price: 650, color: 0xc8f0ff, metal: 1, rough: 0.05, emissive: 0x204050 },
  { id: 'toxic', name: 'Toxic Glow', price: 450, color: 0x60ff40, metal: 0.2, rough: 0.4, emissive: 0x30c020, anim: 'pulse' },
  { id: 'ghost', name: 'Ghost Cart', price: 500, color: 0xd0f0ff, metal: 0.2, rough: 0.2, emissive: 0x406070, opacity: 0.35 },
  { id: 'lava', name: 'Molten Lava', price: 700, color: 0xff4010, metal: 0.3, rough: 0.5, emissive: 0xc02000, anim: 'lava' },
  { id: 'police', name: 'Mall Cop', price: 700, color: 0x2040ff, metal: 0.5, rough: 0.3, emissive: 0x000000, anim: 'police' },
  { id: 'galaxy', name: 'Galaxy', price: 750, color: 0x5030c0, metal: 0.7, rough: 0.2, emissive: 0x180840, anim: 'galaxy' },
  { id: 'rainbow', name: 'Holo Rainbow', price: 800, color: 0xffffff, metal: 0.8, rough: 0.2, anim: 'rainbow' },
];
export const TRIMS: TrimDef[] = [
  { id: 'red', name: 'Store Red', price: 0, color: 0xd02020 },
  { id: 'blue', name: 'Blue', price: 60, color: 0x2060e0 },
  { id: 'green', name: 'Green', price: 60, color: 0x20a040 },
  { id: 'yellow', name: 'Caution Yellow', price: 60, color: 0xffd020 },
  { id: 'pink', name: 'Hot Pink', price: 60, color: 0xff40a0 },
  { id: 'purple', name: 'Purple', price: 60, color: 0x8030e0 },
  { id: 'black', name: 'Black', price: 80, color: 0x18181c },
  { id: 'white', name: 'White', price: 80, color: 0xf2f2f2 },
  { id: 'wood', name: 'Walnut', price: 150, color: 0x7a4a26 },
  { id: 'gold', name: 'Gold Plated', price: 300, color: 0xffc83a, metal: 1 },
];
export const NEONS: NeonDef[] = [
  { id: 'none', name: 'No Neon', price: 0, color: null },
  { id: 'pink', name: 'Hot Pink', price: 120, color: 0xff2fb0 },
  { id: 'cyan', name: 'Ice Cyan', price: 120, color: 0x20f0ff },
  { id: 'lime', name: 'Toxic Lime', price: 120, color: 0x80ff20 },
  { id: 'orange', name: 'Sunset Orange', price: 120, color: 0xff8a10 },
  { id: 'red', name: 'Brake Light Red', price: 120, color: 0xff1a1a },
  { id: 'white', name: 'Showroom White', price: 140, color: 0xf0f4ff },
  { id: 'violet', name: 'Ultra Violet', price: 160, color: 0x9a40ff },
  { id: 'gold', name: 'Gold Rush', price: 200, color: 0xffc020 },
  { id: 'police', name: 'Mall Cop Lights', price: 350, color: 0xff0000, police: true },
  { id: 'rgb', name: 'Gamer RGB', price: 400, color: 0xffffff, rainbow: true },
];
export const SQUEAKS: SqueakDef[] = [
  { id: 'classic', name: 'Classic Squeak', price: 0 },
  { id: 'silent', name: 'Oiled Bearings', price: 80 },
  { id: 'duck', name: 'Rubber Duck', price: 150 },
  { id: 'chicken', name: 'Rubber Chicken', price: 250 },
  { id: 'kazoo', name: 'Kazoo', price: 300 },
];

export type Upgrades = Record<UpgradeId, number>;
export interface Customization { wheel: string; skin: string; neon: string; squeak: string; trim: string; body: string; addon: string; engine: string; up: Upgrades }
export const NO_UPGRADES: Upgrades = { mSpeed: 0, mAccel: 0, mTorque: 0, nPower: 0, nCap: 0, nRecharge: 0 };
export const DEFAULT_CUSTOM: Customization = { wheel: 'caster', skin: 'chrome', neon: 'none', squeak: 'classic', trim: 'red', body: 'standard', addon: 'none', engine: 'none', up: { ...NO_UPGRADES } };

/** Everything a cart's physics needs from its parts and upgrades. */
export interface CartStats {
  body: BodyDef; wheel: WheelDef; addon: string; motor: boolean;
  speed: number; accel: number; steer: number; torque: number; cargo: number;
  grab: number; reach: number; mass: number; topple: number;
  nitroCap: number; nitroPower: number; nitroRegen: number;
}
export function cartStats(c: Customization): CartStats {
  const body = BODIES.find((b) => b.id === c.body) ?? BODIES[0];
  const wheel = WHEELS.find((w) => w.id === c.wheel) ?? WHEELS[0];
  const up = { ...NO_UPGRADES, ...c.up };
  const motor = c.engine === 'electric';
  return {
    body, wheel, addon: c.addon, motor,
    speed: body.speed * wheel.speed * (motor ? 1.08 + 0.05 * up.mSpeed : 1),
    accel: body.accel * (motor ? 1.2 + 0.12 * up.mAccel : 1),
    steer: body.steer,
    torque: motor ? 1 + up.mTorque : 0,
    cargo: body.cargo * (motor ? 1 - 0.12 * up.mTorque : 1),
    grab: c.addon === 'magnet' ? Math.max(body.grab * 1.8, 2.6) : body.grab,
    reach: c.addon === 'magnet' ? Math.max(body.reach, 2.9) : body.reach,
    mass: body.mass * (c.addon === 'ram' ? 1.25 : 1),
    topple: body.topple * (c.addon === 'ram' ? 0.9 : 1),
    nitroCap: (2.4 + 0.6 * up.nCap) * (c.addon === 'tank' ? 2 : 1),
    nitroPower: 1.45 + 0.07 * up.nPower,
    nitroRegen: 0.05 + 0.035 * up.nRecharge,
  };
}

// ---- tuning ----
export const MAX_PLAYERS = 8;
export const RACE_TIME = 180;
export const LIST_SIZE = 8;
export const PHYS_HZ = 60;
export const NET_HZ = 20;
export const INTERP_DELAY = 0.1; // seconds of render delay for remote carts

export const MESS: Record<MessType, { grip: number; drag: number; color: number; spin: number; life: number }> = {
  egg: { grip: 0.22, drag: 0.0, color: 0xf3c21a, spin: 0.6, life: 999 },
  milk: { grip: 0.35, drag: 0.0, color: 0xfaf8f0, spin: 0.4, life: 999 },
  oil: { grip: 0.05, drag: 0.0, color: 0x3a3510, spin: 1.6, life: 999 },
  soda: { grip: 1.0, drag: 2.2, color: 0x6a2a10, spin: 0, life: 999 }, // sticky: slows you down
  mayo: { grip: 0.3, drag: 0.4, color: 0xf6f0d0, spin: 0.5, life: 999 },
};

export const BOT_NAMES = ['Coupon Carl', 'Karen 3000', 'Aisle Annie', 'Bulk Barry', 'Deli Dave', 'Sample Sally', 'Checkout Chad', 'Organic Olga', 'Rollback Rita', 'Clearance Clem', 'BOGO Bob', 'Express Lane Ed'];
