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
  { id: 'bread', label: 'Bread Loaf', icon: '🍞', shape: 'bag', size: [0.13, 0.13, 0.28], mass: 0.6, colors: [0xd8a060, 0xb87a40] },
  { id: 'detergent', label: 'Laundry Soap', icon: '🧴', shape: 'jug', size: [0.2, 0.3, 0.13], mass: 4.5, colors: [0xf07a10, 0x2080e0, 0x8020c0] },
];
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
export interface WheelDef { id: string; name: string; desc: string; price: number; speed: number; grip: number; rolling: number; slickResist: number; color: number; radius: number }
export interface SkinDef { id: string; name: string; price: number; color: number; metal: number; rough: number; rainbow?: boolean }
export interface NeonDef { id: string; name: string; price: number; color: number | null; rainbow?: boolean }
export interface SqueakDef { id: string; name: string; price: number }

export const WHEELS: WheelDef[] = [
  { id: 'caster', name: 'Standard Casters', desc: 'Balanced. Wobbly. Iconic.', price: 0, speed: 1.0, grip: 1.0, rolling: 1.0, slickResist: 0, color: 0x222222, radius: 0.07 },
  { id: 'rubber', name: 'Grippy Rubber', desc: '+grip in corners, -top speed', price: 150, speed: 0.95, grip: 1.3, rolling: 1.1, slickResist: 0.15, color: 0x3a3a3a, radius: 0.075 },
  { id: 'slicks', name: 'Racing Slicks', desc: '+top speed, drifty', price: 300, speed: 1.12, grip: 0.82, rolling: 0.8, slickResist: 0, color: 0x111111, radius: 0.08 },
  { id: 'knobby', name: 'Off-Road Knobbies', desc: 'Shrugs off oil & yolk', price: 400, speed: 0.98, grip: 1.05, rolling: 1.2, slickResist: 0.55, color: 0x4a3a20, radius: 0.09 },
  { id: 'hover', name: 'Mag-Lev Rollers', desc: 'Near-zero rolling drag. Glides.', price: 650, speed: 1.08, grip: 0.9, rolling: 0.45, slickResist: 0.3, color: 0x20e0ff, radius: 0.07 },
];
export const SKINS: SkinDef[] = [
  { id: 'chrome', name: 'Classic Chrome', price: 0, color: 0xd8dde4, metal: 1, rough: 0.25 },
  { id: 'red', name: 'Bullseye Red', price: 100, color: 0xcc1111, metal: 0.4, rough: 0.4 },
  { id: 'matte', name: 'Midnight Matte', price: 150, color: 0x1a1a20, metal: 0.2, rough: 0.8 },
  { id: 'camo', name: 'Aisle Camo', price: 200, color: 0x4f5a2a, metal: 0.1, rough: 0.9 },
  { id: 'gold', name: 'Gold Member', price: 500, color: 0xffc83a, metal: 1, rough: 0.2 },
  { id: 'rainbow', name: 'Holo Rainbow', price: 800, color: 0xffffff, metal: 0.8, rough: 0.2, rainbow: true },
];
export const NEONS: NeonDef[] = [
  { id: 'none', name: 'No Neon', price: 0, color: null },
  { id: 'pink', name: 'Hot Pink', price: 120, color: 0xff2fb0 },
  { id: 'cyan', name: 'Ice Cyan', price: 120, color: 0x20f0ff },
  { id: 'lime', name: 'Toxic Lime', price: 120, color: 0x80ff20 },
  { id: 'violet', name: 'Ultra Violet', price: 160, color: 0x9a40ff },
  { id: 'rgb', name: 'Gamer RGB', price: 400, color: 0xffffff, rainbow: true },
];
export const SQUEAKS: SqueakDef[] = [
  { id: 'classic', name: 'Classic Squeak', price: 0 },
  { id: 'silent', name: 'Oiled Bearings', price: 80 },
  { id: 'duck', name: 'Rubber Duck', price: 150 },
  { id: 'chicken', name: 'Rubber Chicken', price: 250 },
  { id: 'kazoo', name: 'Kazoo', price: 300 },
];

export interface Customization { wheel: string; skin: string; neon: string; squeak: string }
export const DEFAULT_CUSTOM: Customization = { wheel: 'caster', skin: 'chrome', neon: 'none', squeak: 'classic' };

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
