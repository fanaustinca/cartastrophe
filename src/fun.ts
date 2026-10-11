// The comedy layer: store PA announcements, shopper trash talk, the chaos meter and the
// itemised damage receipt, end-of-race awards, daily challenges and shopper ranks.
// Pure data + helpers; Game, the HUD and the menus wire them in.
import { KIND_BY_ID, kindName } from './config';

// ---------------- chaos ----------------
/** What every item costs when it ends up on the floor. */
export const PRICE: Record<string, number> = {
  cereal: 5.49, soup: 1.99, soda: 2.79, eggs: 3.49, milk: 4.29, oil: 12.99, chips: 4.99, pasta: 1.89, mayo: 5.79, tp: 24.99,
  dogfood: 39.99, apple: 0.89, melon: 6.99, avocado: 1.49, kombucha: 6.49, tv: 899.99, headphones: 249.99, game: 69.99,
  microwave: 129.99, energy: 3.29, bread: 3.99, detergent: 17.99,
};
export const SHELF_PRICE = 1299.0;
export const BUMP_PRICE = 49.99;
export const DROP_PRICE = 12.99;
/** Seconds between chaos events that keeps a combo alive. */
export const COMBO_WINDOW = 3;

export interface Chaos {
  smashed: Record<string, number>;
  shelves: number; bumps: number; bumped: number; spins: number; drops: number; honks: number; flung: number;
  topSpeed: number; damage: number; style: number; combo: number; bestCombo: number; comboT: number;
}
export const newChaos = (): Chaos => ({ smashed: {}, shelves: 0, bumps: 0, bumped: 0, spins: 0, drops: 0, honks: 0, flung: 0, topSpeed: 0, damage: 0, style: 0, combo: 0, bestCombo: 0, comboT: -99 });
export const comboMult = (combo: number) => Math.min(5, 1 + Math.max(0, combo - 1) * 0.5);

/** Book some damage. Chained within COMBO_WINDOW it grows the combo, which multiplies style. */
export function addChaos(c: Chaos, dollars: number, now: number): number {
  c.combo = now - c.comboT < COMBO_WINDOW ? c.combo + 1 : 1;
  c.comboT = now;
  c.bestCombo = Math.max(c.bestCombo, c.combo);
  const m = comboMult(c.combo);
  c.damage += dollars;
  c.style += dollars * m;
  return m;
}
export const smashedCount = (c: Chaos) => Object.values(c.smashed).reduce((a, b) => a + b, 0);
export const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Coupons the chaos is worth at the end of a race. */
export const chaosBonus = (c: Chaos) => Math.min(150, Math.round(c.style / 60));

// ---------------- the receipt ----------------
const FOOTERS = [
  'THANK YOU FOR SHOPPING. PLEASE NEVER RETURN.',
  'RETURNS ACCEPTED: NEVER',
  'YOUR CASHIER TODAY WAS: A MOP',
  'SURVEY: HOW WAS YOUR RAMPAGE? 1-800-SORRY',
  'THIS RECEIPT HAS BEEN FORWARDED TO OUR LAWYERS',
  'MEMBER SINCE: TODAY. BANNED SINCE: TODAY.',
  'YOU ARE NOW ON A LIST. NOT THE SHOPPING KIND.',
];
export interface ReceiptLine { label: string; qty: number; amount: number }
export function receiptLines(c: Chaos): ReceiptLine[] {
  const L: ReceiptLine[] = [];
  for (const [k, n] of Object.entries(c.smashed).sort((a, b) => PRICE[b[0]] * b[1] - PRICE[a[0]] * a[1])) {
    const label = (KIND_BY_ID[k]?.label ?? kindName(k)).toUpperCase();
    L.push({ label: `${label} (FLOOR)`, qty: n, amount: n * (PRICE[k] ?? 2) });
  }
  if (c.shelves) L.push({ label: 'SHELVING UNIT (STRUCTURAL)', qty: c.shelves, amount: c.shelves * SHELF_PRICE });
  if (c.bumps) L.push({ label: 'EMOTIONAL DAMAGE TO SHOPPERS', qty: c.bumps, amount: c.bumps * BUMP_PRICE });
  if (c.drops) L.push({ label: 'OLIVE OIL, DEPLOYED TACTICALLY', qty: c.drops, amount: c.drops * DROP_PRICE });
  if (c.flung) L.push({ label: 'GROCERIES YEETED FROM OWN CART', qty: c.flung, amount: 0 });
  if (c.spins) L.push({ label: 'DIGNITY (LOST IN SPIN-OUTS)', qty: c.spins, amount: 0 });
  if (c.honks >= 5) L.push({ label: 'NOISE COMPLAINTS', qty: c.honks, amount: c.honks * 0.25 });
  return L;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);
export function receiptHtml(c: Chaos, o: { name: string; store: string; place: number; time: number; done: boolean; bonus: number }): string {
  const L = receiptLines(c);
  const row = (a: string, b: string, cls = '') => `<div class="rr ${cls}"><span>${a}</span><span>${b}</span></div>`;
  let h = `<div class="rc-h">${esc(o.store.toUpperCase())}</div><div class="rc-s">DAMAGE RECEIPT · SHOPPER: ${esc(o.name.toUpperCase())}</div><div class="rc-d"></div>`;
  if (!L.length) {
    h += `<div class="rc-n">NO DAMAGES.<br>SUSPICIOUSLY WELL-BEHAVED.<br>SECURITY HAS BEEN NOTIFIED.</div>`;
  } else {
    for (const l of L) h += row(`${l.qty > 1 ? l.qty + ' × ' : ''}${esc(l.label)}`, l.amount ? money(l.amount) : 'PRICELESS');
    const sur = c.style - c.damage, tax = c.damage * 0.0825;
    h += '<div class="rc-d"></div>' + row('SUBTOTAL', money(c.damage));
    if (sur > 0.005) h += row(`COMBO SURCHARGE (BEST ×${c.bestCombo})`, money(sur));
    h += row('CHAOS TAX 8.25%', money(tax));
    h += row('TOTAL DAMAGES', money(c.style + tax), 'tot');
  }
  h += row('YOU SAVED', '$0.00');
  h += row('TIME IN STORE', o.done ? o.time.toFixed(2) + 's' : 'STILL LOST');
  if (c.topSpeed > 0) h += row('TOP SPEED', `${Math.round(c.topSpeed * 3.6)} KM/H`);
  if (o.bonus) h += row('CHAOS BONUS', `🎟 +${o.bonus}`, 'tot');
  h += `<div class="rc-d"></div><div class="rc-f">${FOOTERS[Math.floor(Math.random() * FOOTERS.length)]}</div><div class="rc-bar"></div>`;
  return h;
}

// ---------------- awards ----------------
export interface Award { icon: string; title: string; who: string; what: string }
export function awards(players: { name: string; chaos: Chaos; done: boolean }[]): Award[] {
  const A: Award[] = [];
  const top = (f: (c: Chaos) => number, min: number) => {
    let best: (typeof players)[number] | null = null, v = min - 1;
    for (const p of players) { const x = f(p.chaos); if (x > v) { v = x; best = p; } }
    return best && v >= min ? { p: best, v } : null;
  };
  const add = (r: ReturnType<typeof top>, icon: string, title: string, what: (v: number) => string) => { if (r) A.push({ icon, title, who: r.p.name, what: what(r.v) }); };
  add(top((c) => c.style, 1), '💸', 'Most Expensive Shopper', (v) => money(v) + ' in damages');
  add(top((c) => c.shelves, 1), '🏚', 'Wrecking Ball', (v) => `${v} shel${v === 1 ? 'f' : 'ves'} flattened`);
  add(top((c) => c.smashed.eggs ?? 0, 1), '🍳', 'Floor Omelette Chef', (v) => `${v} egg carton${v === 1 ? '' : 's'}`);
  add(top((c) => c.bumps, 3), '🥊', 'Road Rage', (v) => `${v} shoppers bumped`);
  add(top((c) => c.bumped, 4), '🎯', 'Human Bowling Pin', (v) => `got bumped ${v} times`);
  add(top((c) => c.spins, 2), '🧈', 'Butter Wheels', (v) => `${v} spin-outs`);
  add(top((c) => c.honks, 6), '📯', 'Noise Complaint', (v) => `${v} honks`);
  add(top((c) => c.drops, 2), '😈', 'Oil Baron', (v) => `${v} oil slicks dropped`);
  add(top((c) => c.bestCombo, 4), '🔥', 'Combo Maniac', (v) => `×${v} chaos combo`);
  const saint = players.find((p) => p.done && p.chaos.damage === 0 && p.chaos.bumps === 0);
  if (saint) A.push({ icon: '😇', title: 'Model Citizen', who: saint.name, what: 'zero damages (suspicious)' });
  return A;
}

// ---------------- store PA ----------------
export type PaEvent = 'start' | 'tower' | 'shelf' | 'egg' | 'oil' | 'milk' | 'soda' | 'mayo' | 'spin' | 'bump' | 'drop' | 'restock' | 'last30' | 'firstFinish' | 'combo' | 'ambient' | 'honk' | 'flung';
export const PA: Record<PaEvent, string[]> = {
  start: [
    'Welcome to {store}. Today\'s special: chaos. Shop responsibly. Or don\'t.',
    'Attention shoppers: the floors have been freshly waxed. Good luck.',
    'Welcome to {store}, where every aisle is a racetrack and every egg is a hazard.',
    'Reminder: shopping carts are not rated for these speeds. Anyway. Go.',
    'Welcome, shoppers. Our insurance company has asked us to remind you that they are crying.',
  ],
  tower: [
    'Will the owner of the hundred-storey cart please mind the ceiling fans.',
    'Store management has been informed there is a skyscraper in the building. Inside the building.',
    'Whoever brought the hundred-level cart: we do not have a permit for that.',
  ],
  shelf: [
    'Clean-up in {where}. Bring the big mop. And a forklift.',
    '{name}, that shelf was load-bearing.',
    'A shelf in {where} has decided to lie down. {name} helped.',
    'Attention: {where} is now a ground-floor-only aisle. Thank you, {name}.',
    'Shelving units are not speed bumps, {name}.',
    'Timber! In {where}. Courtesy of {name}.',
    '{name} is redecorating {where}. Horizontally.',
  ],
  egg: [
    'Eggs are now on sale as a floor treatment in {where}.',
    'Attention shoppers: omelettes are being prepared on the floor of {where}.',
    'Somebody tell the eggs in {where} they had a good run.',
    'The eggs in {where} have been scrambled. Not by the deli.',
  ],
  oil: [
    'Free olive oil in {where}. Bring your own bread.',
    '{where} is now a slip-and-slide. No lifeguard on duty.',
    'Extra virgin olive oil. Extra slippery floor. {where}.',
  ],
  milk: ['Got milk? {where} does. All over it.', 'Please do not cry over the spilled milk in {where}. Do drive around it.'],
  soda: ['{where} is now sticky. Your wheels live there now.', 'Fizz Cola has exploded in {where}. It\'s fine. It\'s fizzy.'],
  mayo: ['There is mayonnaise on the floor of {where}. We are as upset as you are.'],
  spin: [
    '{name} has found the oil. The oil has found {name}.',
    '{name} is doing donuts in {where}. Not the bakery kind.',
    'Look at {name} go. Round and round.',
    '{name}, the floor is not a dance floor. Lovely spin though.',
  ],
  bump: ['Please keep your carts to yourselves, {name}.', 'Bumper cars are in aisle zero, which does not exist, {name}.', '{name} would like everyone to know they have right of way.'],
  drop: ['Somebody is pouring oil on the floor on purpose. We see you, {name}.', '{name}, that is not how olive oil works.'],
  restock: [
    'Staff have restocked {where}. Staff would like you to stop.',
    '{where} has been put back together with tape and hope.',
    'Restock complete in {where}. Please knock it over again. The staff need the hours.',
  ],
  last30: [
    'The store will close in thirty seconds. Please panic in an orderly fashion.',
    'Thirty seconds left. Abandon your dignity. Keep your cart.',
    'We close in thirty seconds. Anyone still inside will be stocked on a shelf.',
  ],
  firstFinish: [
    '{name} has checked out first. Everyone else: try harder.',
    'Congratulations {name}. You have won groceries.',
    '{name} is through checkout. Coupons were clipped. Lives were changed.',
  ],
  combo: [
    'Whoever is causing all this, the manager would like a word. And an autograph.',
    'Code red. Code red. Somebody stop {name}.',
    'Our insurance company has been notified about {name}.',
    '{name}, this is a grocery store, not a demolition derby. Keep going though.',
  ],
  honk: ['Please stop honking in the store, {name}. The produce is sensitive.', '{name}. The horn. Please.'],
  flung: ['Something just flew out of {name}\'s cart. It\'s free real estate now.'],
  ambient: [
    'Price check on dignity, aisle four.',
    'Lost child at customer service. He says his name is Doug and he is forty-one.',
    'Today\'s employee of the month: the mop.',
    'Reminder: the deli samples are not a meal. We are looking at you.',
    'Attention shoppers: the floor is lava. Not literally. Mostly not.',
    'Our self-checkout machines are feeling emotional today. Please be gentle.',
    'Remember: if you can\'t find it, it\'s probably on the floor.',
    'Coupons expire never. Shelves expire constantly.',
    'Please do not ride the carts. We see you. Riding the carts.',
    'Unexpected item in the bagging area. It\'s a shopper.',
    'The store music has been replaced with the screaming of carts. You\'re welcome.',
    'Customer satisfaction is our number two priority.',
  ],
};
const PRIORITY: Partial<Record<PaEvent, number>> = { start: 3, firstFinish: 3, last30: 3, tower: 2, shelf: 2, combo: 2 };

/** Picks lines without repeating, rate-limits the PA, and hands each line to `out`. */
export class Announcer {
  private last = -99;
  private used = new Set<string>();
  private ambientT = 40;
  constructor(private out: (text: string) => void, private rand = Math.random) {}

  line(ev: PaEvent, ctx: { name?: string; where?: string; store?: string } = {}): string {
    const pool = PA[ev];
    let fresh = pool.filter((l) => !this.used.has(l));
    if (!fresh.length) { for (const l of pool) this.used.delete(l); fresh = pool; }
    const l = fresh[Math.floor(this.rand() * fresh.length)];
    this.used.add(l);
    return l.replace(/\{name\}/g, ctx.name ?? 'somebody').replace(/\{where\}/g, ctx.where ?? 'the store').replace(/\{store\}/g, ctx.store ?? 'the store');
  }

  /** Announce if the PA isn't busy (big events cut in sooner). chance: skip some routine ones. */
  say(ev: PaEvent, now: number, ctx: { name?: string; where?: string; store?: string } = {}, chance = 1): boolean {
    const pr = PRIORITY[ev] ?? 1;
    const gap = pr >= 2 ? 2.5 : 9;
    if (now - this.last < gap || this.rand() > chance) return false;
    this.last = now;
    this.ambientT = 35 + this.rand() * 25;
    this.out(this.line(ev, ctx));
    return true;
  }

  /** Something to say when nothing's happening. */
  tick(dt: number, now: number) {
    this.ambientT -= dt;
    if (this.ambientT <= 0) { this.ambientT = 35 + this.rand() * 25; this.say('ambient', now); }
  }
}

// ---------------- trash talk ----------------
export type TalkEvent = 'bump' | 'bumped' | 'spin' | 'finish' | 'grab' | 'honked' | 'flung';
const GENERIC: Record<TalkEvent, string[]> = {
  bump: ['Coming through!', 'Sorry not sorry!', 'Beep beep!', 'Outta my aisle!', 'Clean-up on YOU!', 'Move it!'],
  bumped: ['HEY!', 'Watch it!', 'My eggs!', 'Rude!', 'OW!', 'I was here first!', 'Seriously?!'],
  spin: ['WHOA-OA-OA', 'Weeeee!', 'Not again!', 'My ankles!', 'Who put OIL here?!', 'I meant to do that'],
  finish: ['Paper or plastic? NEITHER!', 'Checked out! Later!', 'Smell ya later!', 'Receipt? Keep it!'],
  grab: ['MINE!', 'Yoink!', 'Last one!', 'Called it!'],
  honked: ['AAH!', 'Jeez!', 'My heart!', 'RUDE!!', 'I\'m MOVING!'],
  flung: ['My groceries!', 'NOOO my snacks!', 'Come back!'],
};
const PERSONAL: Record<string, Partial<Record<TalkEvent, string[]>>> = {
  'Karen 3000': { bumped: ['I want to speak to your MANAGER!', 'Do you know who I AM?!', 'One star. ONE STAR.'], bump: ['Excuse ME.', 'Move. I have coupons.'], spin: ['This floor is a LAWSUIT!'], finish: ['Took them long enough.'], honked: ['Did you just HONK at me?!'] },
  'Coupon Carl': { bump: ['That\'s 15 cents off YOU!'], bumped: ['My coupons!!'], finish: ['Saved forty cents!'], grab: ['Is there a coupon for this?'] },
  'BOGO Bob': { bump: ['Bump one, get one free!'], bumped: ['Buy one get one... OW'], grab: ['Got one! Where\'s my free one?'] },
  'Sample Sally': { bumped: ['My toothpick samples!'], grab: ['Is this a free sample?'], spin: ['Free spin sample!'] },
  'Bulk Barry': { bump: ['BULK!!'], grab: ['I\'ll take forty.'], finish: ['Need a bigger cart.'] },
  'Checkout Chad': { bump: ['Sorry bro, gotta go fast'], finish: ['Ez checkout, bro'], bumped: ['Bro.'], spin: ['Bro. BRO.'] },
  'Organic Olga': { bumped: ['You bruised my kombucha\'s aura!'], spin: ['This floor is NOT gluten-free!'], grab: ['Is it locally sourced?'] },
  'Rollback Rita': { bump: ['Rolling BACK!'], spin: ['Rollback! Rollback!'] },
  'Clearance Clem': { bump: ['Everything must go! Including you!'], finish: ['Clearance! Everything out!'] },
  'Deli Dave': { bumped: ['Number 47! Who has 47?!'], grab: ['Sliced thin, please.'] },
  'Aisle Annie': { bump: ['Aisle be seeing you!'], finish: ['Aisle be back!'] },
  'Express Lane Ed': { bump: ['TEN ITEMS OR LESS!'], finish: ['Express lane, baby!'] },
};
export function talk(name: string, ev: TalkEvent, rand = Math.random): string {
  const own = PERSONAL[name]?.[ev];
  const pool = own && rand() < 0.65 ? own : GENERIC[ev];
  return pool[Math.floor(rand() * pool.length)];
}

// ---------------- daily challenges ----------------
export interface RaceSummary { chaos: Chaos; place: number; done: boolean; store: string; storeName: string; players: number }
export interface ChallengeDef { id: string; text: string; goal: number; reward: number; best?: boolean; stat: (r: RaceSummary) => number; store?: string }
const C = (id: string, text: string, goal: number, reward: number, stat: ChallengeDef['stat'], best = false): ChallengeDef => ({ id, text, goal, reward, stat, best });
export const CHALLENGES: ChallengeDef[] = [
  C('shelves', 'Flatten 5 shelves', 5, 200, (r) => r.chaos.shelves),
  C('eggs', 'Smash 12 egg cartons', 12, 150, (r) => r.chaos.smashed.eggs ?? 0),
  C('bumps', 'Bump rivals 15 times', 15, 150, (r) => r.chaos.bumps),
  C('win', 'Win a race', 1, 200, (r) => (r.place === 1 && r.done ? 1 : 0)),
  C('podium', 'Finish top 3 three times', 3, 200, (r) => (r.place <= 3 && r.done ? 1 : 0)),
  C('honk', 'Honk 40 times', 40, 100, (r) => r.chaos.honks),
  C('combo', 'Hit a ×5 chaos combo', 5, 200, (r) => r.chaos.bestCombo, true),
  C('clean', 'Finish a race with zero spin-outs', 1, 150, (r) => (r.done && r.chaos.spins === 0 ? 1 : 0)),
  C('damage', 'Cause $25,000 in damages', 25000, 250, (r) => Math.round(r.chaos.style)),
  C('speed', 'Hit 45 km/h', 45, 120, (r) => Math.round(r.chaos.topSpeed * 3.6), true),
  C('spins', 'Spin out 6 times (it\'s a skill)', 6, 100, (r) => r.chaos.spins),
  C('tv', 'Break 3 TVs, microwaves or headphones', 3, 180, (r) => (r.chaos.smashed.tv ?? 0) + (r.chaos.smashed.microwave ?? 0) + (r.chaos.smashed.headphones ?? 0)),
  C('races', 'Finish 4 races', 4, 150, (r) => (r.done ? 1 : 0)),
  C('oil', 'Drop 8 oil slicks (Oil Dropper)', 8, 150, (r) => r.chaos.drops),
];
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Three challenges per day, the same for everyone on that date. */
export function dailyChallenges(day: string): ChallengeDef[] {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pool = CHALLENGES.filter((c) => c.id !== 'tv' || h % 3 === 0);
  const out: ChallengeDef[] = [];
  while (out.length < 3) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; const c = pool[h % pool.length]; if (!out.includes(c)) out.push(c); }
  return out;
}
export interface DailyState { day: string; prog: Record<string, number>; claimed: string[] }
/** Fold a race into today's progress; returns the challenges completed by it. */
export function progressDaily(d: DailyState, r: RaceSummary): ChallengeDef[] {
  const done: ChallengeDef[] = [];
  for (const c of dailyChallenges(d.day)) {
    if (d.claimed.includes(c.id)) continue;
    const v = c.stat(r);
    d.prog[c.id] = c.best ? Math.max(d.prog[c.id] ?? 0, v) : (d.prog[c.id] ?? 0) + v;
    if (d.prog[c.id] >= c.goal) { d.claimed.push(c.id); done.push(c); }
  }
  return done;
}

// ---------------- shopper ranks ----------------
export const RANKS = ['Bag Boy', 'Cart Wrangler', 'Shelf Stacker', 'Cashier', 'Shift Lead', 'Assistant Manager', 'Store Manager', 'Regional Manager', 'Coupon Baron', 'Supermarket Sweeper', 'CEO of Groceries', 'Cart Deity'];
/** XP needed to go from rank i to i+1. */
export const rankCost = (i: number) => 200 + i * 150;
export function rankOf(xp: number): { rank: number; name: string; into: number; need: number } {
  let r = 0, x = xp;
  while (r < RANKS.length - 1 && x >= rankCost(r)) { x -= rankCost(r); r++; }
  return { rank: r, name: RANKS[r], into: x, need: r < RANKS.length - 1 ? rankCost(r) : 0 };
}
export const rankReward = (rank: number) => 100 + rank * 50;
