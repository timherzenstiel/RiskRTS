// What the field radio says. Pure functions over the game state, so they can be tested:
// - dispatchFor(): a call for one game event, from the point of view of power `me`
// - sitrep():      a situation report from the most pressing front (or the home front when all is quiet)
// Text is written the way an officer would say it on the line: corps named by spoken ordinals, numbers rounded.
import { AS, FACTIONS, FORMATION, SHIP, battleCounts, isDef, world, type Battle, type GameEvent, type GameState, type UnitType, corpsAtPost } from '@riskrts/shared';
import type { Stinger } from './sfx';
import type { Speaker } from './voice';

export interface Dispatch {
  /** What the voice says (also shown as the subtitle). */
  say: string;
  /** Higher plays first and survives a full queue. 3 = critical (capital, elimination, game over), 2 urgent, 1 news, 0 chatter. */
  pri: number;
  /** 0..1: how loud the battle is behind the speaker. */
  front: number;
  /** Who speaks: the General Staff, an officer at the front, or the signals operator. `voice` picks a front officer's voice (corps number). */
  who: Speaker; voice?: number;
  /** Morse heard before the voice, e.g. '...-' (V for victory). */
  morse?: string;
  stinger?: Stinger;
  /** Repeat-suppression key and cooldown in seconds. */
  key?: string; cool?: number;
  /** Region it is about (the subtitle can fly there). */
  region?: number;
}

const DEMONYM: Record<string, string> = { GB: 'the British', FR: 'the French', RU: 'the Russians', DE: 'the Germans', AH: 'the Austrians', OT: 'the Turks', US: 'the Americans' };
const ORD = ['zeroth', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
/** "Seventh", "Twenty-third", "41st". */
export function ordinal(n: number): string {
  if (n >= 0 && n < ORD.length) return ORD[n];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'], t = Math.floor(n / 10), u = n % 10;
  if (n < 100) return u ? `${tens[t]}-${ORD[u].toLowerCase()}` : tens[t].replace(/y$/, 'ieth');
  const s = n % 100; return n + (s >= 11 && s <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}
/** How an officer says a number of men: exact when small, rounded and "about" when not. */
export function menSpoken(n: number): string {
  n = Math.max(0, Math.round(n));
  if (n === 0) return 'no men';
  if (n < 30) return `${n} men`;
  const step = n < 300 ? 10 : n < 2000 ? 50 : n < 10000 ? 100 : 1000;
  return `about ${(Math.round(n / step) * step).toLocaleString('en-GB')} men`;
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const CALL = ['Headquarters', 'Command', 'H Q', 'General Staff'] as const;
const OVER = ['Over.', 'Over.', 'Over.', 'Over and out.', ''] as const;

/** Men still fighting and formations alive per faction in a battle (formations only for network mirrors). */
export function strength(b: Battle): Map<number, { alive: number; all: number; men: number }> {
  const out = new Map<number, { alive: number; all: number; men: number }>();
  for (const [f, [alive, all]] of battleCounts(b)) out.set(f, { alive, all, men: 0 });
  for (const a of b.agents) {
    if (a.dead || a.out || isDef(a.type) || a.type === 'plane') continue;
    const s = out.get(a.f); if (!s) continue;
    s.men += (a.men ?? FORMATION[a.type as UnitType].men) * Math.max(0, Math.min(1, a.hp / AS(a.type).hp));
  }
  return out;
}

const foesOf = (b: Battle, me: number) => b.sides.filter(f => f !== me);
const sum = (r: Record<number, number> | undefined, fs: number[]) => fs.reduce((s, f) => s + (r?.[f] ?? 0), 0);

/** Who is speaking for `me` at battle `b`: the corps on that border if known ("Seventh Corps, Flanders"), else the sector. */
export function station(g: GameState, b: Battle, me: number): { name: string; voice: number } {
  const R = (i: number) => world().regions[i]?.name ?? 'the front';
  let n = -1;
  if (b.def === me) n = b.cn ?? corpsAtPost(g.regions[b.region], b.from)[0]?.n ?? -1;
  else if (b.from >= 0 && b.from < 1000) n = corpsAtPost(g.regions[b.from], b.region)[0]?.n ?? -1;
  if (n > 0) return { name: `${ordinal(n)} Corps, ${R(b.region)}`, voice: n };
  return { name: `the ${R(b.region)} front`, voice: b.region + 100 };
}

const myBattle = (g: GameState, region: number, me: number) => g.battles.find(b => b.region === region && !b.ended && b.sides.includes(me));

function moraleWord(m: number) { return m >= 75 ? 'Morale is good.' : m >= 50 ? 'The men are steady.' : m >= 30 ? 'The men are shaken.' : 'The men are breaking.'; }

/** Clean up a line for speech and subtitles: capital letter at every sentence start, no stray spaces. */
export function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/(^|[.!?]\s+)([a-z])/g, (_, a: string, c: string) => a + c.toUpperCase());
}

/** Decide what (if anything) the radio says about an event, from the point of view of faction `me`. */
export function dispatchFor(g: GameState, e: GameEvent, me: number): Dispatch | null {
  const d = eventCall(g, e, me);
  if (d) d.say = tidy(d.say);
  return d;
}

function eventCall(g: GameState, e: GameEvent, me: number): Dispatch | null {
  const W = world(), R = (i: number) => W.regions[i]?.name ?? 'the front', D = (i: number) => DEMONYM[FACTIONS[i]?.key] ?? FACTIONS[i]?.the ?? 'the enemy';
  const Z = (z: number) => W.zones[z]?.name ?? 'the open sea';
  const hq = pick(CALL), over = pick(OVER);
  const at = (region: number) => { const b = myBattle(g, region, me); return b ? station(g, b, me) : { name: `the ${R(region)} front`, voice: region + 100 }; };
  const front = (region: number, pri: number, say: string, x: Partial<Dispatch> = {}): Dispatch => { const s = at(region); return { say, pri, front: 1, who: 'front', voice: s.voice, region, ...x }; };
  switch (e.k) {
    case 'start': return { say: 'All stations, all stations. War has been declared. Open your sealed orders and stand by.', pri: 3, front: 0, who: 'hq', morse: '-.-. --.-', stinger: 'declare' };
    case 'air':
      if (e.faction === me || g.regions[e.to].owner !== me) return null;
      return { say: pick([`Air raid warning! Enemy aircraft approaching ${R(e.to)}!`, `${hq}, ${plural(e.units, 'enemy squadron')} sighted, heading for ${R(e.to)}. Man the guns!`, `Aircraft! ${D(e.faction)} are flying on ${R(e.to)}!`]), pri: 2, front: .3, who: 'ops', stinger: 'siren', key: 'air', cool: 25, region: e.to };
    case 'battleStart': {
      const b = myBattle(g, e.region, me), st = b ? strength(b) : null;
      const foe = st ? [...st].filter(([f]) => f !== me).reduce((s, [, v]) => s + v.men, 0) : 0;
      const est = foe > 0 ? ` We count ${menSpoken(foe)}.` : '';
      if (e.attacker === me) {
        const s = b ? station(g, b, me) : at(e.region);
        return { say: pick([`${hq}, this is ${s.name}. The attack on ${R(e.region)} has begun. Our guns are opening up.`, `${s.name} reporting. We are in the jump-off trenches facing ${D(e.defender)}. Barrage has started. ${over}`, `${hq}, ${s.name}. Battle of ${R(e.region)} is joined.${est} ${over}`]), pri: 0, front: 1, who: 'front', voice: s.voice, key: 'atk', cool: 14, region: e.region };
      }
      if (e.defender === me) return front(e.region, 2, pick([`${hq}, ${hq}! ${D(e.attacker)} are attacking ${R(e.region)}!${est} Request reinforcements!`, `Stand to! Enemy assault at ${R(e.region)}. ${D(e.attacker)} are shelling our line.${est}`, `Urgent from ${R(e.region)}: we are under attack by ${D(e.attacker)}.${est} ${over}`]), { stinger: 'alarm', morse: '..- .-. --.', key: 'def-' + e.region, cool: 10 });
      return null;
    }
    case 'overTop':
      if (e.faction === me) return front(e.region, 1, pick([`Whistles have blown at ${R(e.region)}. The men are going over the top!`, `We are over the top at ${R(e.region)}. Advancing into no man's land.`, `Over the top at ${R(e.region)}! God speed them.`]), { stinger: 'over-the-top', key: 'otop-' + e.region, cool: 20 });
      if (g.regions[e.region]?.owner === me || myBattle(g, e.region, me)) return front(e.region, 2, pick([`They are coming! Enemy infantry leaving their trenches at ${R(e.region)}. All guns, fire!`, `Stand to at ${R(e.region)}! Enemy is over the top. Machine guns, open fire!`]), { stinger: 'alarm', key: 'eotop-' + e.region, cool: 20 });
      return null;
    case 'firstLine':
      if (e.faction === me) return front(e.region, 1, e.hold ? `${hq}, we hold the enemy's first line at ${R(e.region)}. Digging in. Awaiting orders to push on. ${over}` : `First line at ${R(e.region)} is taken! Consolidating before we push into the depth. ${over}`, { front: .6 });
      if (e.def === me) return front(e.region, 2, e.from >= 1000 ? `${hq}, the enemy is ashore at ${R(e.region)}. They hold the beach!` : `${hq}, we have lost the first line at ${R(e.region)}. Falling back on the main army.`, { stinger: 'alarm' });
      return null;
    case 'depth':
      if (e.faction === me) return front(e.region, 1, `We are pushing into the depth of ${R(e.region)}. Resistance is stiffening. ${over}`);
      if (e.def === me) return front(e.region, 2, `The enemy is through at ${R(e.region)}. The main army is engaging them in the open.`);
      return null;
    case 'advance': return e.faction === me ? front(e.region, 1, `Advance from the foothold at ${R(e.region)} has begun. ${over}`) : null;
    case 'breakthrough':
      if (e.faction === me) return front(e.region, 2, `Breakthrough at ${R(e.region)}! We are rolling up their line from behind!`, { stinger: 'victory' });
      if (g.regions[e.region]?.owner === me) return front(e.region, 2, `${hq}, the front at ${R(e.region)} has broken! The enemy is behind our lines!`, { stinger: 'alarm' });
      return null;
    case 'fallback':
      if (e.faction === me) return front(e.region, 1, `We have fallen back to the second line at ${R(e.region)}. Line is steady again.`);
      return null;
    case 'surrender':
      if (e.faction === me) return front(e.region, 2, `${hq}... our men at ${R(e.region)} are throwing down their rifles. ${plural(e.n, 'formation')} surrendered. We cannot stop it.`, { key: 'sur-' + e.region, cool: 30 });
      if (myBattle(g, e.region, me) || g.regions[e.region]?.owner === me) return front(e.region, 1, pick([`Enemy is surrendering at ${R(e.region)}! Prisoners coming in by the hundred.`, `White flags at ${R(e.region)}. ${D(e.faction)} are giving up.`]), { key: 'esur-' + e.region, cool: 30 });
      return null;
    case 'withdraw':
      if (e.faction === me) return front(e.region, 1, `Withdrawal from ${R(e.region)} under way. Falling back on ${R(e.to)}. ${over}`, { front: .6 });
      if (myBattle(g, e.region, me) || g.regions[e.region]?.owner === me) return front(e.region, 1, `The enemy is pulling back at ${R(e.region)}! They are leaving their dead.`);
      return null;
    case 'raid':
      if (e.faction === me) return front(e.region, 0, e.ok ? `Trench raid at ${R(e.region)} is back. We have prisoners${e.target >= 0 ? ` and a full picture of ${R(e.target)}` : ''}.` : `Raiding party at ${R(e.region)} was caught on the wire. Few came back.`, { front: .4 });
      return null;
    case 'battleEnd': {
      const took = e.winner !== null && e.winner !== e.prev;
      if (took && e.winner === me) {
        if (e.capital) return { say: `${hq}, this is the front. We have taken ${R(e.region)}. Their capital has fallen! The enemy is in full retreat.`, pri: 3, front: .5, who: 'front', voice: e.region + 100, morse: '...-', stinger: 'capital-taken', region: e.region };
        const hold = e.holdouts >= 0 ? ' Enemy strongpoints are still holding out on one border.' : '';
        return { say: pick([`${R(e.region)} is ours! ${D(e.prev)} are falling back.${hold} ${over}`, `${hq}, we have captured ${R(e.region)}.${hold} ${over}`, `Victory at ${R(e.region)}. The flag is up.${hold}`]), pri: 1, front: .4, who: 'front', voice: e.region + 100, morse: '...-', stinger: 'victory', region: e.region };
      }
      if (took && e.prev === me) {
        if (e.capital) return { say: `${hq}, ${hq}... the capital has fallen. ${R(e.region)} is in the hands of ${D(e.winner!)}. God help us.`, pri: 3, front: 1, who: 'front', voice: e.region + 100, stinger: 'capital-lost', region: e.region };
        const hold = e.holdouts === me ? ' Some of our positions are still holding out.' : '';
        return { say: pick([`${hq}, we've lost ${R(e.region)}. ${D(e.winner!)} have broken through. We are pulling back.${hold}`, `${R(e.region)} has fallen. Too many of them, we could not hold.${hold} ${over}`, `This is ${R(e.region)}. The line is broken. ${D(e.winner!)} have taken the town.${hold}`]), pri: 2, front: 1, who: 'front', voice: e.region + 100, stinger: 'lost', region: e.region };
      }
      if (!took && e.winner === me && e.prev === me) return { say: pick([`${R(e.region)} holds! The attack has been beaten back.`, `${hq}, enemy assault on ${R(e.region)} repulsed. ${over}`, `They broke against our wire at ${R(e.region)}. The line holds.`]), pri: 1, front: .5, who: 'front', voice: e.region + 100, stinger: 'held', region: e.region };
      if (!took && e.prev !== me && e.sides.includes(me) && e.winner !== me) return { say: pick([`${hq}, the attack on ${R(e.region)} has failed. What is left of us is coming back.`, `We could not get through at ${R(e.region)}. The attack is over. ${over}`]), pri: 1, front: .4, who: 'front', voice: e.region + 100, stinger: 'lost', region: e.region };
      if (e.winner === null && (e.prev === me || e.sides.includes(me))) return { say: `${R(e.region)}... there is no one left standing. Both sides are spent.`, pri: 1, front: .2, who: 'front', voice: e.region + 100, stinger: 'toll', region: e.region };
      return null;
    }
    case 'cleared': return e.faction === me ? { say: `The last holdouts in ${R(e.region)} have been silenced. The sector is secure. ${over}`, pri: 1, front: .3, who: 'front', voice: e.region + 100, stinger: 'cleared', region: e.region } : null;
    case 'cut': return e.faction === me ? { say: `${hq}, ${R(e.region)} is cut off. No supply is getting through. The garrison will not last long without a way home.`, pri: 2, front: .3, who: 'ops', key: 'cut-' + e.region, cool: 60, region: e.region } : null;
    case 'massing': return e.owner === me ? { say: `Observers report ${D(e.faction)} massing troops in ${R(e.region)}, facing ${R(e.to)}. An attack is coming.`, pri: 2, front: .1, who: 'ops', key: 'mass-' + e.to, cool: 45, region: e.to } : null;
    case 'intel':
      if (e.faction !== me) return null;
      return { say: e.by === 'patrol' ? `Cavalry patrol is back from ${R(e.region)}. Report is in the file.` : e.by === 'recon' ? `Reconnaissance flight over ${R(e.region)} has landed. Photographs are being developed.` : `Signal from our agent in ${R(e.region)}. He is in position.`, pri: 0, front: 0, who: 'ops', key: 'intel', cool: 20, region: e.region };
    case 'scoutLost': return e.faction === me ? { say: e.by === 'patrol' ? `Our patrol into ${R(e.region)} has not come back.` : `Reconnaissance aircraft over ${R(e.region)} shot down.`, pri: 0, front: 0, who: 'ops', region: e.region } : null;
    case 'spyFound':
      if (e.faction === me) return { say: `We have lost contact with our agent in ${R(e.region)}. He has been taken.`, pri: 1, front: 0, who: 'ops', region: e.region };
      if (e.owner === me) return { say: `Counter-intelligence has caught an enemy spy in ${R(e.region)}.`, pri: 0, front: 0, who: 'ops', region: e.region };
      return null;
    case 'bombed':
      if (e.faction === me) return { say: `Our bombers report hits on the factory at ${R(e.region)}. Fires are burning.`, pri: 1, front: .2, who: 'ops', region: e.region };
      if (e.owner === me) return { say: `Enemy bombers have hit the factory at ${R(e.region)}. Production is stopped.`, pri: 2, front: .3, who: 'ops', stinger: 'siren', region: e.region };
      return null;
    case 'railCut':
      if (e.faction === me) return { say: e.by === 'air' ? `Railways at ${R(e.region)} are wrecked. Good work by the bombers.` : `Our agent has blown the line at ${R(e.region)}.`, pri: 0, front: 0, who: 'ops', region: e.region };
      if (e.owner === me) return { say: `The railway at ${R(e.region)} has been cut. Troop trains are held up.`, pri: 1, front: 0, who: 'ops', region: e.region };
      return null;
    case 'strike': return e.faction === me ? { say: e.end ? `The strikes at ${R(e.region)} are over. The works are running again.` : `Strikes at ${R(e.region)}. The workers have downed tools. The home front is tired of the war.`, pri: 1, front: 0, who: 'hq', region: e.region } : null;
    case 'rising':
      if (e.faction === me) return { say: `${hq}... mutiny in ${R(e.region)}. The garrison has gone over to ${D(e.to)}.`, pri: 2, front: 0, who: 'hq', stinger: 'lost', region: e.region };
      if (e.to === me) return { say: `${R(e.region)} has risen and declared for us!`, pri: 1, front: 0, who: 'hq', stinger: 'victory', region: e.region };
      return null;
    case 'tech': return e.faction === me ? { say: `New equipment has reached the front. ${pick(['The quartermasters are issuing it now.', 'Units are being trained on it.'])}`, pri: 0, front: 0, who: 'hq', key: 'tech', cool: 30 } : null;
    case 'docOffer': return e.faction === me ? { say: `The General Staff requests your decision on this year's doctrine.`, pri: 1, front: 0, who: 'hq', stinger: 'orders' } : null;
    case 'offer': return e.to === me ? { say: `Diplomatic cable from ${FACTIONS[e.from].name}. They propose an agreement.`, pri: 1, front: 0, who: 'ops', morse: '-.-. .- -... .-.. .' } : null;
    case 'treaty': {
      if (e.what === 'broken' && e.by !== me && (e.a === me || e.b === me)) return { say: `Treachery! ${FACTIONS[e.by!].name} has broken the treaty and attacks us!`, pri: 2, front: 0, who: 'hq', stinger: 'declare' };
      if (e.what === 'signed' && (e.a === me || e.b === me)) return { say: `Treaty signed with ${FACTIONS[e.a === me ? e.b : e.a].name}.`, pri: 0, front: 0, who: 'ops' };
      return null;
    }
    case 'offshore':
      if (e.owner === me) return { say: `Enemy fleet sighted off ${R(e.region)}! About ${e.est} battalions aboard. Landing expected. Man the coast!`, pri: 2, front: .2, who: 'ops', stinger: 'alarm', key: 'off-' + e.region, cool: 30, region: e.region };
      if (e.faction === me) return { say: `Assault fleet is off ${R(e.region)}. Boats are being lowered. ${over}`, pri: 0, front: .2, who: 'front', voice: e.region + 100, region: e.region };
      return null;
    case 'landing':
      if (e.faction === me) return front(e.region, 1, e.ok ? `First wave is ashore at ${R(e.region)}! Heavy fire from the cliffs.` : `The landing at ${R(e.region)} has failed. Taking off what survivors we can.`, { stinger: e.ok ? 'over-the-top' : 'lost' });
      if (e.owner === me) return front(e.region, 2, e.ok ? `The enemy is landing at ${R(e.region)}!` : `Landing at ${R(e.region)} thrown back into the sea!`, { stinger: e.ok ? 'alarm' : 'held' });
      return null;
    case 'convoyLost':
      if (e.faction !== me) return null;
      return { say: e.by === 'uboat' ? `Convoy torpedoed in the ${Z(e.zone)}. ${plural(e.ships, 'transport')} lost${e.men ? `, ${menSpoken(e.men)} with them` : ''}.` : `Ships lost in the ${Z(e.zone)}${e.men ? `, ${menSpoken(e.men)} gone down with them` : ''}.`, pri: 2, front: 0, who: 'ops', morse: '... --- ...', key: 'convoy', cool: 20 };
    case 'shipBuilt': return e.faction === me && (e.kind === 'bb' || e.kind === 'carrier') ? { say: `A new ${SHIP[e.kind].one} has been commissioned at ${R(e.region)}.`, pri: 0, front: 0, who: 'ops', region: e.region } : null;
    case 'seaBattle': {
      const side = e.sides.findIndex(s => s.includes(me)); if (side < 0) return null;
      if (e.start) return { say: `Enemy fleet in sight in the ${Z(e.zone)}! Battle stations! Our ships are engaging.`, pri: 2, front: .5, who: 'ops', stinger: 'alarm', key: 'sea-' + e.zone, cool: 30 };
      const n = (i: number) => { const s = e.sunk[i] ?? {}; return (s.dn ?? 0) + (s.cv ?? 0) + (s.dd ?? 0) + (s.tr ?? 0) + (s.lc ?? 0); };
      const res = e.winner === side ? 'The enemy has broken off.' : e.winner === 1 - side ? 'Our fleet is withdrawing.' : 'Neither side gave way.';
      return { say: `Battle of the ${Z(e.zone)} is over. ${res} We lost ${plural(n(side), 'ship')}, the enemy ${n(1 - side)}.`, pri: 2, front: .2, who: 'ops', stinger: e.winner === side ? 'held' : e.winner === 1 - side ? 'lost' : undefined };
    }
    case 'eliminated':
      if (e.faction === me) return { say: 'All stations. The government has capitulated. Lay down your arms.', pri: 3, front: .2, who: 'hq', stinger: 'toll' };
      return { say: pick([`Flash message. ${FACTIONS[e.faction].name} has capitulated.`, `Intercepted signal: ${FACTIONS[e.faction].name} has surrendered.`]), pri: 3, front: 0, who: 'ops', morse: '..-. .-.. .- ... ....', stinger: 'toll' };
    case 'newOrders': return e.faction === me ? { say: 'New orders from the General Staff. Your target has fallen to another power. Hold thirty regions.', pri: 2, front: 0, who: 'hq', morse: '--- .-. -.. . .-. ...', stinger: 'orders' } : null;
    case 'over':
      if (e.winner === me) return { say: 'All stations. The war is won. Your orders are fulfilled. Ceasefire on all fronts.', pri: 3, front: 0, who: 'hq', stinger: 'triumph' };
      return { say: 'All stations. The war is lost. Ceasefire on all fronts.', pri: 3, front: 0, who: 'hq', stinger: 'taps' };
    default: return null;
  }
}

// ---------------------------------------------------------------- situation reports

/** What the radio last reported per battle: game time and our losses then. */
export type SitrepMemo = Record<number, { t: number; lost: number }>;

/** How pressing a front is for `me` right now (higher = report it first). */
export function urgency(b: Battle, me: number, memo: SitrepMemo, now: number): number {
  const m = memo[b.id], foes = foesOf(b, me);
  const fresh = (b.lost[me] ?? 0) - (m?.lost ?? 0);
  let u = 10 + Math.min(40, fresh / 15);
  const mor = b.mor[me] ?? 100; if (mor < 40) u += 25; else if (mor < 60) u += 10;
  if ((b.supp[me] ?? 0) > 60) u += 15;
  if (b.def === me && b.go) u += 15;
  if (b.attacker === me && !b.go) u += 8 + Math.max(0, ...foes.map(f => b.supp[f] ?? 0)) / 10;
  if (b.ammo?.[me] !== undefined && b.ammo[me] < 15) u += 15;
  if (m && now - m.t < 60) u -= 60;
  return u;
}

/** A situation report from front `b`, closing with a request that fits the state of the fight. */
export function frontReport(g: GameState, b: Battle, me: number, memo: SitrepMemo): Dispatch {
  const R = (i: number) => world().regions[i]?.name ?? 'the front';
  const s = station(g, b, me), st = strength(b), foes = foesOf(b, me);
  const mine = st.get(me) ?? { alive: 0, all: 0, men: 0 };
  const enemy = foes.reduce((a, f) => { const v = st.get(f); return v ? { alive: a.alive + v.alive, all: a.all + v.all, men: a.men + v.men } : a; }, { alive: 0, all: 0, men: 0 });
  const lost = b.lost[me] ?? 0, lostE = sum(b.lost, foes), fresh = lost - (memo[b.id]?.lost ?? 0);
  const mor = b.mor[me] ?? 100, suppMe = b.supp[me] ?? 0, suppE = Math.max(0, ...foes.map(f => b.supp[f] ?? 0));
  const atk = b.attacker === me, parts: string[] = [];

  parts.push(`${pick(CALL)}, this is ${s.name}. Situation report.`);
  // where the fight stands
  if (b.stage === 3) parts.push(atk ? `We hold a foothold in their first line.` : `The enemy holds a foothold in our first line.`);
  else if (b.stage === 2) parts.push(atk ? `We are fighting in the depth of ${R(b.region)}.` : `The fight is in the depth of ${R(b.region)}. The first line is gone.`);
  else if (b.stage === 1) parts.push(atk ? `We are consolidating the captured trench.` : `The enemy is consolidating in our old first line.`);
  else if (atk && !b.go) parts.push(b.bar?.[me] === 2 ? `Our guns are firing a heavy barrage.` : b.bar?.[me] === 0 ? `Our guns are silent.` : `Our guns are shelling their line.`);
  else if (atk) parts.push(`The men are in no man's land.`);
  else if (b.go) parts.push(`The enemy is coming across no man's land.`);
  else parts.push(`The enemy is shelling us and waiting in his trenches.`);

  // strength and losses
  if (mine.men > 0) parts.push(`We have ${menSpoken(mine.men)} still fighting${enemy.men > 0 ? `, against ${menSpoken(enemy.men).replace(/ men$/, '')}` : ''}.`);
  else if (mine.alive > 0) parts.push(`${plural(mine.alive, 'formation')} of ours still fighting, ${enemy.alive} of theirs.`);
  else if (mine.all) parts.push(`Our line is gone. Only stragglers are left.`);
  const cmp = lostE > lost * 1.3 ? ', theirs are heavier' : lostE < lost * .6 ? ', far more than they have' : '';
  if (fresh >= 20) parts.push(memo[b.id] ? `We have lost ${menSpoken(fresh)} since the last report${cmp}.` : `We have lost ${menSpoken(fresh)} since the battle began${cmp}.`);
  parts.push(moraleWord(mor));
  if (suppMe > 60) parts.push(`We are pinned down under heavy fire.`);
  if (atk && !b.go && b.wire0 > 0) parts.push(b.wire / b.wire0 > .6 ? `Their wire is still mostly intact.` : b.wire / b.wire0 > .2 ? `Their wire is cut in places.` : `Their wire is cut.`);
  const ammo = b.ammo?.[me];
  if (ammo !== undefined && ammo < 15) parts.push(ammo <= 0 ? `We are out of shells. The guns are rationed.` : `Shells are running low here.`);

  // the request
  let ask = '';
  if (mor < 30 || (mine.alive > 0 && enemy.alive > mine.alive * 3)) ask = `We cannot hold much longer. Request permission to withdraw.`;
  else if (atk && !b.go && suppE > 60) ask = `Enemy is pinned down. Ready to go over the top on your order.`;
  else if (atk && !b.go && b.wire0 > 0 && b.wire / b.wire0 > .6) ask = `We need more time with the guns before we go.`;
  else if (suppMe > 60) ask = `Request counter-battery fire.`;
  else if (ammo !== undefined && ammo < 15) ask = `Send shells.`;
  else if (enemy.alive > mine.alive * 1.5) ask = `Request reinforcements.`;
  else ask = pick(['Holding.', 'We are holding.', 'Situation in hand.']);
  parts.push(ask, 'Over.');
  memo[b.id] = { t: g.time, lost };
  const pri = mor < 30 || suppMe > 70 ? 1 : 0;
  return { say: tidy(parts.join(' ')), pri, front: Math.min(1, .5 + (b.go ? .4 : .1) + suppMe / 200), who: 'front', voice: s.voice, region: b.region, key: 'sit-' + b.id, cool: 45 };
}

/** The home front: shells, manpower, weariness, cut-off regions. Null when nothing is worth saying. */
export function homeReport(g: GameState, me: number): Dispatch | null {
  const f = g.factions[me]; if (!f) return null;
  const mine = g.regions.filter(r => r.owner === me);
  let guns = mine.reduce((s, r) => s + (r.units?.art ?? 0), 0);
  for (const b of g.battles) if (!b.ended) for (const a of b.agents) if (a.f === me && a.type === 'art' && !a.dead) guns++;
  const cut = mine.filter(r => r.cut).length;
  const parts: string[] = [];
  if (guns > 0) {
    const min = f.shells / Math.max(1, guns * 12); // heavy barrage: 2 shells per battery per 10 s
    if (min < 1.5) parts.push(`The shell stockpile is nearly empty: ${f.shells} shells, not two minutes of heavy fire for our ${plural(guns, 'battery', 'batteries')}.`);
    else if (min < 4) parts.push(`Shells are getting short: about ${Math.round(min)} minutes of heavy barrage left.`);
  }
  if (f.men < 400) parts.push(f.men < 100 ? `The depots are empty. No more men to call up.` : `Manpower is running out: ${menSpoken(f.men)} left in the depots.`);
  if (f.ww >= 60) parts.push(`War weariness at home is dangerous. There is talk of strikes.`);
  else if (f.ww >= 35) parts.push(`The casualty lists are weighing on the home front.`);
  if (cut) parts.push(`${plural(cut, 'region')} cut off from supply.`);
  if (!parts.length) return null;
  return { say: tidy(`General Staff to all commands. ${parts.join(' ')}`), pri: 0, front: 0, who: 'hq', key: 'home', cool: 120 };
}

/** The next situation report: the most pressing front, else the home front. */
export function sitrep(g: GameState, me: number, memo: SitrepMemo): Dispatch | null {
  let best: Battle | null = null, bu = 0;
  for (const b of g.battles) { if (b.ended || !b.sides.includes(me)) continue; const u = urgency(b, me, memo, g.time); if (u > bu) { bu = u; best = b; } }
  if (best) return frontReport(g, best, me, memo);
  return homeReport(g, me);
}
