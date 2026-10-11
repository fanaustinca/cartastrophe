// Player profile persisted in localStorage (wrapped: storage can be blocked).
import { today, type DailyState } from './fun';
import { Customization, DEFAULT_CUSTOM, NO_UPGRADES, WHEELS, SKINS, NEONS, SQUEAKS, BODIES, ADDONS, ENGINES, TRIMS, HATS, HORNS } from './config';

export interface Profile {
  name: string;
  coupons: number;
  owned: string[]; // "wheel:caster" etc
  custom: Customization;
  best: Record<string, number>; // store id → best finish time
  quality: 'low' | 'medium' | 'high';
  volume: number;
  races: number;
  xp: number;
  daily: DailyState;
  voice: boolean;
}

const KEY = 'cartastrophe.profile.v1';
const STARTER = ['wheel:caster', 'skin:chrome', 'neon:none', 'squeak:classic', 'body:standard', 'addon:none', 'engine:none', 'trim:red', 'hat:cap', 'hat:none', 'horn:bell'];
const fresh = (): Profile => ({
  name: 'Shopper' + Math.floor(100 + Math.random() * 900),
  coupons: 200,
  owned: [...STARTER],
  custom: { ...DEFAULT_CUSTOM, up: { ...NO_UPGRADES } },
  best: {},
  quality: 'medium',
  volume: 0.7,
  races: 0,
  xp: 0,
  daily: { day: today(), prog: {}, claimed: [] },
  voice: true,
});

export function loadProfile(reset = false): Profile {
  if (reset) { try { localStorage.removeItem(KEY); } catch { /* blocked */ } }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // older saves predate bodies / add-ons / engines / upgrades: fill in the new fields
      const old = JSON.parse(raw) as Partial<Profile>;
      const p = { ...fresh(), ...old };
      p.custom = { ...DEFAULT_CUSTOM, ...old.custom, up: { ...NO_UPGRADES, ...old.custom?.up } };
      p.owned = [...new Set([...STARTER, ...(old.owned ?? [])])];
      if (p.daily?.day !== today()) p.daily = { day: today(), prog: {}, claimed: [] };
      return p;
    }
  } catch { /* blocked or corrupt */ }
  return fresh();
}
export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* blocked */ }
}

export const CATEGORIES = {
  body: BODIES,
  wheel: WHEELS,
  addon: ADDONS,
  engine: ENGINES,
  skin: SKINS,
  trim: TRIMS,
  neon: NEONS,
  squeak: SQUEAKS,
  hat: HATS,
  horn: HORNS,
} as const;
export type Category = keyof typeof CATEGORIES;
