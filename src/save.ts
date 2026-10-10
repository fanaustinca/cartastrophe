// Player profile persisted in localStorage (wrapped: storage can be blocked).
import { Customization, DEFAULT_CUSTOM, WHEELS, SKINS, NEONS, SQUEAKS } from './config';

export interface Profile {
  name: string;
  coupons: number;
  owned: string[]; // "wheel:caster" etc
  custom: Customization;
  best: Record<string, number>; // store id → best finish time
  quality: 'low' | 'medium' | 'high';
  volume: number;
  races: number;
}

const KEY = 'cartastrophe.profile.v1';
const fresh = (): Profile => ({
  name: 'Shopper' + Math.floor(100 + Math.random() * 900),
  coupons: 200,
  owned: ['wheel:caster', 'skin:chrome', 'neon:none', 'squeak:classic'],
  custom: { ...DEFAULT_CUSTOM },
  best: {},
  quality: 'medium',
  volume: 0.7,
  races: 0,
});

export function loadProfile(reset = false): Profile {
  if (reset) { try { localStorage.removeItem(KEY); } catch { /* blocked */ } }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* blocked or corrupt */ }
  return fresh();
}
export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* blocked */ }
}

export const CATEGORIES = {
  wheel: WHEELS,
  skin: SKINS,
  neon: NEONS,
  squeak: SQUEAKS,
} as const;
export type Category = keyof typeof CATEGORIES;
