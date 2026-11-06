// What the field radio says. Pure functions over the game state, so they can be tested:
// - dispatchFor(): a call for one game event, from the point of view of power `me`
// - sitrep():      a situation report from the most pressing front (or the home front when all is quiet)
// Text is written the way an officer would say it on the line: corps named by spoken ordinals, numbers rounded.
//
// Languages: every line is an English template run through L(), which looks the German up in the
// dictionary (i18n/de/audio-render.ts) when the interface speaks German. The pieces put into a line
// (corps names, numbers of men, "the Germans", region names) are built in the right language here
// already, so L() inserts them as they are.
import { AS, FACTIONS, FORMATION, SHIP, battleCounts, isDef, world, type Battle, type GameEvent, type GameState, type UnitType, corpsAtPost } from '@riskrts/shared';
import { getLang, missing, tx, type Case } from '../i18n';
import { DE, DECL } from '../i18n/de';
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

const de = () => getLang() === 'de';

/** A line in the current language: the English template (or its German) with the pieces filled in as given. */
function L(en: string, ...a: (string | number)[]): string {
  let tpl = en;
  if (de()) { const g = DE[en]; if (g === undefined) missing.add(en); else tpl = g; }
  return tpl.replace(/\{(\d+)\}/g, (_, i: string) => String(a[+i] ?? ''));
}

type DCase = Exclude<Case, 'acc'>;
const DEMONYM: Record<string, string> = { GB: 'the British', FR: 'the French', RU: 'the Russians', DE: 'the Germans', AH: 'the Austrians', OT: 'the Turks', US: 'the Americans' };
/** German demonyms: nominative, dative, genitive. */
const DEMONYM_DE: Record<string, Record<DCase, string>> = {
  GB: { nom: 'die Briten', dat: 'den Briten', gen: 'der Briten' },
  FR: { nom: 'die Franzosen', dat: 'den Franzosen', gen: 'der Franzosen' },
  RU: { nom: 'die Russen', dat: 'den Russen', gen: 'der Russen' },
  DE: { nom: 'die Deutschen', dat: 'den Deutschen', gen: 'der Deutschen' },
  AH: { nom: 'die Österreicher', dat: 'den Österreichern', gen: 'der Österreicher' },
  OT: { nom: 'die Türken', dat: 'den Türken', gen: 'der Türken' },
  US: { nom: 'die Amerikaner', dat: 'den Amerikanern', gen: 'der Amerikaner' },
};
const FOES_DE: Record<DCase, string> = { nom: 'die Feinde', dat: 'den Feinden', gen: 'der Feinde' };
/** "the Germans" / "die Deutschen" (German in a case). */
function demonym(i: number, c: DCase = 'nom'): string {
  const k = FACTIONS[i]?.key;
  if (de()) return (DEMONYM_DE[k] ?? FOES_DE)[c];
  return DEMONYM[k] ?? FACTIONS[i]?.the ?? 'the enemy';
}
/** A power's name, in German in a case. */
function power(i: number, c: Case = 'nom'): string {
  const n = FACTIONS[i]?.name ?? '';
  return de() ? (DECL[n] ?? DECL[FACTIONS[i]?.the ?? ''])?.[c] ?? tx(n) : n;
}

const ORD = ['zeroth', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth'];
/** German ordinals as they go before "Korps" (neuter, no article): "Siebtes", "Einundzwanzigstes". */
const ORD_DE = ['Nulltes', 'Erstes', 'Zweites', 'Drittes', 'Viertes', 'Fünftes', 'Sechstes', 'Siebtes', 'Achtes', 'Neuntes', 'Zehntes', 'Elftes', 'Zwölftes', 'Dreizehntes', 'Vierzehntes', 'Fünfzehntes', 'Sechzehntes', 'Siebzehntes', 'Achtzehntes', 'Neunzehntes'];
function ordinalDe(n: number): string {
  if (n >= 0 && n < ORD_DE.length) return ORD_DE[n];
  if (n >= 100 || n < 0) return `${n}.`;
  const ones = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  const tens = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
  const w = (n % 10 ? ones[n % 10] + 'und' : '') + tens[Math.floor(n / 10)] + 'stes';
  return w[0].toUpperCase() + w.slice(1);
}
/** "Seventh", "Twenty-third", "41st" (German: "Siebtes", "Dreiundzwanzigstes"). */
export function ordinal(n: number): string {
  if (de()) return ordinalDe(n);
  if (n >= 0 && n < ORD.length) return ORD[n];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'], t = Math.floor(n / 10), u = n % 10;
  if (n < 100) return u ? `${tens[t]}-${ORD[u].toLowerCase()}` : tens[t].replace(/y$/, 'ieth');
  const s = n % 100; return n + (s >= 11 && s <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}
/** How an officer says a number of men: exact when small, rounded and "about" when not. */
export function menSpoken(n: number): string {
  n = Math.max(0, Math.round(n));
  const g = de();
  if (n === 0) return g ? 'kein Mann' : 'no men';
  if (n < 30) return g ? (n === 1 ? 'ein Mann' : `${n} Mann`) : `${n} men`;
  const step = n < 300 ? 10 : n < 2000 ? 50 : n < 10000 ? 100 : 1000, r = Math.round(n / step) * step;
  return g ? `etwa ${r.toLocaleString('de-DE')} Mann` : `about ${r.toLocaleString('en-GB')} men`;
}
/** "3 formations" / "3 Verbände"; German one is written out ("ein Verband"). */
const plural = (n: number, one: string, many: string, deOne: string, deMany: string) =>
  de() ? (n === 1 ? deOne : `${n} ${deMany}`) : `${n} ${n === 1 ? one : many}`;

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const CALL = ['Headquarters', 'Command', 'H Q', 'General Staff'] as const;
const CALL_DE = ['Hauptquartier', 'Kommando', 'Stab', 'Generalstab'] as const;
const OVER = ['Over.', 'Over.', 'Over.', 'Over and out.', ''] as const;
const OVER_DE = ['Kommen.', 'Kommen.', 'Kommen.', 'Ende.', ''] as const;
const call = () => pick(de() ? CALL_DE : CALL);
const overAndOut = () => pick(de() ? OVER_DE : OVER);

/** A region's name in the current language. */
const R = (i: number) => { const n = world().regions[i]?.name; return n ? tx(n) : de() ? 'die Front' : 'the front'; };
/** A sea zone's name in the current language. */
const Z = (z: number) => { const n = world().zones[z]?.name; return n ? tx(n) : de() ? 'offene See' : 'the open sea'; };
/** The sector as a station: "the Flanders front" / "Frontabschnitt Flandern". */
const sector = (region: number) => de() ? `Frontabschnitt ${R(region)}` : `the ${R(region)} front`;

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
  let n = -1;
  if (b.def === me) n = b.cn ?? corpsAtPost(g.regions[b.region], b.from)[0]?.n ?? -1;
  else if (b.from >= 0 && b.from < 1000) n = corpsAtPost(g.regions[b.from], b.region)[0]?.n ?? -1;
  if (n > 0) return { name: `${ordinal(n)} ${de() ? 'Korps' : 'Corps'}, ${R(b.region)}`, voice: n };
  return { name: sector(b.region), voice: b.region + 100 };
}

const myBattle = (g: GameState, region: number, me: number) => g.battles.find(b => b.region === region && !b.ended && b.sides.includes(me));

function moraleWord(m: number) { return L(m >= 75 ? 'Morale is good.' : m >= 50 ? 'The men are steady.' : m >= 30 ? 'The men are shaken.' : 'The men are breaking.'); }

/** Clean up a line for speech and subtitles: capital letter at every sentence start, no stray spaces. */
export function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/(^|[.!?]\s+)([a-zäöü])/g, (_, a: string, c: string) => a + c.toUpperCase());
}

/** "General von Albeck": a commander's rank spoken in full. */
export function rankSpoken(name: string): string { return name.replace(/^Gen\.\s/, 'General ').replace(/^Gén\.\s/, 'Général ').replace(/^GdI\s/, 'General '); }
const surname = (name: string) => { const n = rankSpoken(name); return n.startsWith('General ') || n.startsWith('Général ') ? n.split(' ')[0] + ' ' + n.split(' ').slice(2).join(' ') : n; };

/** A front commander on the line: his requests and the corps he sends back (design-command §2.5). One voice per army. */
export function commanderCall(g: GameState, e: Extract<GameEvent, { k: 'request' | 'release' }>, me: number): Dispatch | null {
  const h = (g.hq ?? []).find(x => x.id === e.army); if (!h) return null;
  const G = de();
  // "Seventh Army" / "Siebte Armee" (Armee is feminine); "Seventh Corps" / "Siebtes Korps"
  const army = G ? `${ordinal(h.n).replace(/s$/, '')} Armee` : `${ordinal(h.n)} Army`;
  const corpsName = (n: number) => `${ordinal(n)} ${G ? 'Korps' : 'Corps'}`;
  const who = surname(h.cmd.name), voice = 200 + h.n, over = overAndOut();
  const head = L('{0}, this is {1}, {2}.', call(), who, army);
  const base = { front: .15, who: 'front' as const, voice, region: e.region };
  if (e.k === 'release') {
    const tpl = e.why === 'peace' ? '{0} Now that the border is at peace, {1} is pulling back to {2} and is at your disposal. {3}'
      : e.why === 'lost' ? '{0} With our front gone, {1} is pulling back to {2} and is at your disposal. {3}'
      : '{0} {1} is pulling back to {2} and is at your disposal. {3}';
    return { say: L(tpl, head, corpsName(e.n), R(e.region), over), pri: 0, ...base, key: 'rel-' + h.id, cool: 20 };
  }
  const q = (g.requests ?? []).find(x => x.id === e.req);
  const land = e.sector >= 0 && e.sector < 1000;
  // the border, in German nominative/accusative or dative ("die Grenze zu Flandern" / "der Grenze zu Flandern")
  const border = (dat = false) => land ? (G ? `${dat ? 'der' : 'die'} Grenze zu ${R(e.sector)}` : `the ${R(e.sector)} border`)
    : (G ? `${dat ? 'der' : 'die'} Küste bei ${R(e.region)}` : `the coast at ${R(e.region)}`);
  const corps = (q?.corps ?? []).map(id => { for (const r of g.regions) { const c = r.cs?.find(x => x.id === id); if (c) return corpsName(c.n); } return null; }).filter(Boolean) as string[];
  const many = corps.length > 1;
  const names = corps.length ? corps.length === 1 ? corps[0] : `${corps.slice(0, -1).join(', ')} ${G ? 'und' : 'and'} ${corps[corps.length - 1]}` : L('the corps');
  const count = (fallback: string) => q?.n !== undefined ? String(q.n) : L(fallback);
  let say: string;
  switch (e.kind) {
    case 'men': say = e.urg === 2
      ? pick([L('{0} Urgent. They are massing against {1}. I need {2} battalions or the line will not hold. {3}', head, border(), count('more'), over),
        L('{0} {1} is too thin. Request reinforcements at once, {2} battalions. {3}', head, border(), count('several'), over)])
      : L('{0} Request reinforcements for {1}, {2} battalions. {3}', head, border(), count('a few'), over); break;
    case 'fort': say = pick([
      L('{0} Request permission to dig in on {1}. {2} {3}', head, border(true), L(q?.fort === 'wire' ? 'We want wire out in front.' : 'The men need a proper trench.'), over),
      L('{0} {1} has no proper works. Request {2}. {3}', head, border(), L(q?.fort === 'wire' ? 'barbed wire' : 'a trench line'), over)]); break;
    case 'recon': {
      const there = R(e.sector);
      say = q?.by === 'spy' ? L('{0} Before we go in, I want an agent inside {1}. Request a spy from the capital. {2}', head, there, over)
        : q?.by === 'recon' ? L('{0} Request a reconnaissance flight over {1}. {2} {3}', head, there, L(q?.for === 'attack' ? 'I will not send the men in blind.' : 'Our picture of it is out of date.'), over)
        : L('{0} Request a cavalry patrol across to {1}. {2} {3}', head, there, L(q?.for === 'attack' ? 'I want to know what is waiting before we attack.' : 'We are blind on that side.'), over);
      break;
    }
    case 'attack': say = pick([
      L(many ? '{0} {1} are ready on {2}. Request permission to {3}. {4}' : '{0} {1} is ready on {2}. Request permission to {3}. {4}', head, names, border(true), L(q?.goal === 2 ? 'invade' : 'take their first line'), over),
      L('{0} We have the advantage facing {1}. Request permission to attack. {2}', head, R(e.sector), over)]); break;
    case 'fallback': say = L('{0} We cannot hold {1}. Request permission to fall back to the centre. {2}', head, border(), over); break;
    case 'release': say = q?.why === 'peace'
      ? L(many ? '{0} With the treaty in force, {1} are not needed on {2}. Shall I send them back to you? {3}' : '{0} With the treaty in force, {1} is not needed on {2}. Shall I send it back to you? {3}', head, names, border(true), over)
      : L(many ? '{0} The front is quiet. I can spare {1}. Shall I send them back? {2}' : '{0} The front is quiet. I can spare {1}. Shall I send it back? {2}', head, names, over); break;
    default: return null;
  }
  return { say, pri: e.urg === 2 ? 2 : e.urg === 1 ? 1 : 0, ...base, front: e.urg === 2 ? .6 : .15, morse: e.urg === 2 ? '..- .-. --.' : undefined, key: `rq-${h.id}-${e.kind}`, cool: e.urg === 2 ? 15 : 45 };
}

/** Decide what (if anything) the radio says about an event, from the point of view of faction `me`. */
export function dispatchFor(g: GameState, e: GameEvent, me: number): Dispatch | null {
  const d = eventCall(g, e, me);
  if (d) d.say = tidy(d.say);
  return d;
}

function eventCall(g: GameState, e: GameEvent, me: number): Dispatch | null {
  const D = demonym;
  const hq = call(), over = overAndOut();
  const at = (region: number) => { const b = myBattle(g, region, me); return b ? station(g, b, me) : { name: sector(region), voice: region + 100 }; };
  const front = (region: number, pri: number, say: string, x: Partial<Dispatch> = {}): Dispatch => { const s = at(region); return { say, pri, front: 1, who: 'front', voice: s.voice, region, ...x }; };
  switch (e.k) {
    case 'request': case 'release': return e.faction === me ? commanderCall(g, e, me) : null;
    case 'start': return { say: L('All stations, all stations. War has been declared. Open your sealed orders and stand by.'), pri: 3, front: 0, who: 'hq', morse: '-.-. --.-', stinger: 'declare' };
    case 'air':
      if (e.faction === me || g.regions[e.to].owner !== me) return null;
      return { say: pick([L('Air raid warning! Enemy aircraft approaching {0}!', R(e.to)), L('{0}, {1} sighted, heading for {2}. Man the guns!', hq, plural(e.units, 'enemy squadron', 'enemy squadrons', 'eine feindliche Staffel', 'feindliche Staffeln'), R(e.to)), L('Aircraft! {0} are flying on {1}!', D(e.faction), R(e.to))]), pri: 2, front: .3, who: 'ops', stinger: 'siren', key: 'air', cool: 25, region: e.to };
    case 'battleStart': {
      const b = myBattle(g, e.region, me), st = b ? strength(b) : null;
      const foe = st ? [...st].filter(([f]) => f !== me).reduce((s, [, v]) => s + v.men, 0) : 0;
      const est = foe > 0 ? ' ' + L('We count {0}.', menSpoken(foe)) : '';
      if (e.attacker === me) {
        const s = b ? station(g, b, me) : at(e.region);
        return { say: pick([L('{0}, this is {1}. The attack on {2} has begun. Our guns are opening up.', hq, s.name, R(e.region)), L('{0} reporting. We are in the jump-off trenches facing {1}. Barrage has started. {2}', s.name, D(e.defender, 'dat'), over), L('{0}, {1}. Battle of {2} is joined.{3} {4}', hq, s.name, R(e.region), est, over)]), pri: 0, front: 1, who: 'front', voice: s.voice, key: 'atk', cool: 14, region: e.region };
      }
      if (e.defender === me) return front(e.region, 2, pick([L('{0}, {0}! {1} are attacking {2}!{3} Request reinforcements!', hq, D(e.attacker), R(e.region), est), L('Stand to! Enemy assault at {0}. {1} are shelling our line.{2}', R(e.region), D(e.attacker), est), L('Urgent from {0}: we are under attack by {1}.{2} {3}', R(e.region), D(e.attacker, 'dat'), est, over)]), { stinger: 'alarm', morse: '..- .-. --.', key: 'def-' + e.region, cool: 10 });
      return null;
    }
    case 'overTop':
      if (e.faction === me) return front(e.region, 1, pick([L('Whistles have blown at {0}. The men are going over the top!', R(e.region)), L('We are over the top at {0}. Advancing into no man\'s land.', R(e.region)), L('Over the top at {0}! God speed them.', R(e.region))]), { stinger: 'over-the-top', key: 'otop-' + e.region, cool: 20 });
      if (g.regions[e.region]?.owner === me || myBattle(g, e.region, me)) return front(e.region, 2, pick([L('They are coming! Enemy infantry leaving their trenches at {0}. All guns, fire!', R(e.region)), L('Stand to at {0}! Enemy is over the top. Machine guns, open fire!', R(e.region))]), { stinger: 'alarm', key: 'eotop-' + e.region, cool: 20 });
      return null;
    case 'firstLine':
      if (e.faction === me) return front(e.region, 1, e.hold ? L('{0}, we hold the enemy\'s first line at {1}. Digging in. Awaiting orders to push on. {2}', hq, R(e.region), over) : L('First line at {0} is taken! Consolidating before we push into the depth. {1}', R(e.region), over), { front: .6 });
      if (e.def === me) return front(e.region, 2, e.from >= 1000 ? L('{0}, the enemy is ashore at {1}. They hold the beach!', hq, R(e.region)) : L('{0}, we have lost the first line at {1}. Falling back on the main army.', hq, R(e.region)), { stinger: 'alarm' });
      return null;
    case 'depth':
      if (e.faction === me) return front(e.region, 1, L('We are pushing into the depth of {0}. Resistance is stiffening. {1}', R(e.region), over));
      if (e.def === me) return front(e.region, 2, L('The enemy is through at {0}. The main army is engaging them in the open.', R(e.region)));
      return null;
    case 'advance': return e.faction === me ? front(e.region, 1, L('Advance from the foothold at {0} has begun. {1}', R(e.region), over)) : null;
    case 'breakthrough':
      if (e.faction === me) return front(e.region, 2, L('Breakthrough at {0}! We are rolling up their line from behind!', R(e.region)), { stinger: 'victory' });
      if (g.regions[e.region]?.owner === me) return front(e.region, 2, L('{0}, the front at {1} has broken! The enemy is behind our lines!', hq, R(e.region)), { stinger: 'alarm' });
      return null;
    case 'fallback':
      if (e.faction === me) return front(e.region, 1, L('We have fallen back to the second line at {0}. Line is steady again.', R(e.region)));
      return null;
    case 'surrender':
      if (e.faction === me) return front(e.region, 2, L('{0}... our men at {1} are throwing down their rifles. {2} surrendered. We cannot stop it.', hq, R(e.region), plural(e.n, 'formation', 'formations', 'ein Verband', 'Verbände')), { key: 'sur-' + e.region, cool: 30 });
      if (myBattle(g, e.region, me) || g.regions[e.region]?.owner === me) return front(e.region, 1, pick([L('Enemy is surrendering at {0}! Prisoners coming in by the hundred.', R(e.region)), L('White flags at {0}. {1} are giving up.', R(e.region), D(e.faction))]), { key: 'esur-' + e.region, cool: 30 });
      return null;
    case 'withdraw':
      if (e.faction === me) return front(e.region, 1, L('Withdrawal from {0} under way. Falling back on {1}. {2}', R(e.region), R(e.to), over), { front: .6 });
      if (myBattle(g, e.region, me) || g.regions[e.region]?.owner === me) return front(e.region, 1, L('The enemy is pulling back at {0}! They are leaving their dead.', R(e.region)));
      return null;
    case 'raid':
      if (e.faction === me) return front(e.region, 0, e.ok ? L('Trench raid at {0} is back. We have prisoners{1}.', R(e.region), e.target >= 0 ? ' ' + L('and a full picture of {0}', R(e.target)) : '') : L('Raiding party at {0} was caught on the wire. Few came back.', R(e.region)), { front: .4 });
      return null;
    case 'battleEnd': {
      const took = e.winner !== null && e.winner !== e.prev;
      if (took && e.winner === me) {
        if (e.capital) return { say: L('{0}, this is the front. We have taken {1}. Their capital has fallen! The enemy is in full retreat.', hq, R(e.region)), pri: 3, front: .5, who: 'front', voice: e.region + 100, morse: '...-', stinger: 'capital-taken', region: e.region };
        const hold = e.holdouts >= 0 ? ' ' + L('Enemy strongpoints are still holding out on one border.') : '';
        return { say: pick([L('{0} is ours! {1} are falling back.{2} {3}', R(e.region), D(e.prev), hold, over), L('{0}, we have captured {1}.{2} {3}', hq, R(e.region), hold, over), L('Victory at {0}. The flag is up.{1}', R(e.region), hold)]), pri: 1, front: .4, who: 'front', voice: e.region + 100, morse: '...-', stinger: 'victory', region: e.region };
      }
      if (took && e.prev === me) {
        if (e.capital) return { say: L('{0}, {0}... the capital has fallen. {1} is in the hands of {2}. God help us.', hq, R(e.region), D(e.winner!, 'gen')), pri: 3, front: 1, who: 'front', voice: e.region + 100, stinger: 'capital-lost', region: e.region };
        const hold = e.holdouts === me ? ' ' + L('Some of our positions are still holding out.') : '';
        return { say: pick([L('{0}, we\'ve lost {1}. {2} have broken through. We are pulling back.{3}', hq, R(e.region), D(e.winner!), hold), L('{0} has fallen. Too many of them, we could not hold.{1} {2}', R(e.region), hold, over), L('This is {0}. The line is broken. {1} have taken the town.{2}', R(e.region), D(e.winner!), hold)]), pri: 2, front: 1, who: 'front', voice: e.region + 100, stinger: 'lost', region: e.region };
      }
      if (!took && e.winner === me && e.prev === me) return { say: pick([L('{0} holds! The attack has been beaten back.', R(e.region)), L('{0}, enemy assault on {1} repulsed. {2}', hq, R(e.region), over), L('They broke against our wire at {0}. The line holds.', R(e.region))]), pri: 1, front: .5, who: 'front', voice: e.region + 100, stinger: 'held', region: e.region };
      if (!took && e.prev !== me && e.sides.includes(me) && e.winner !== me) return { say: pick([L('{0}, the attack on {1} has failed. What is left of us is coming back.', hq, R(e.region)), L('We could not get through at {0}. The attack is over. {1}', R(e.region), over)]), pri: 1, front: .4, who: 'front', voice: e.region + 100, stinger: 'lost', region: e.region };
      if (e.winner === null && (e.prev === me || e.sides.includes(me))) return { say: L('{0}... there is no one left standing. Both sides are spent.', R(e.region)), pri: 1, front: .2, who: 'front', voice: e.region + 100, stinger: 'toll', region: e.region };
      return null;
    }
    case 'cleared': return e.faction === me ? { say: L('The last holdouts in {0} have been silenced. The sector is secure. {1}', R(e.region), over), pri: 1, front: .3, who: 'front', voice: e.region + 100, stinger: 'cleared', region: e.region } : null;
    case 'cut': return e.faction === me ? { say: L('{0}, {1} is cut off. No supply is getting through. The garrison will not last long without a way home.', hq, R(e.region)), pri: 2, front: .3, who: 'ops', key: 'cut-' + e.region, cool: 60, region: e.region } : null;
    case 'massing': return e.owner === me ? { say: L('Observers report {0} massing troops in {1}, facing {2}. An attack is coming.', D(e.faction), R(e.region), R(e.to)), pri: 2, front: .1, who: 'ops', key: 'mass-' + e.to, cool: 45, region: e.to } : null;
    case 'intel':
      if (e.faction !== me) return null;
      return { say: e.by === 'patrol' ? L('Cavalry patrol is back from {0}. Report is in the file.', R(e.region)) : e.by === 'recon' ? L('Reconnaissance flight over {0} has landed. Photographs are being developed.', R(e.region)) : L('Signal from our agent in {0}. He is in position.', R(e.region)), pri: 0, front: 0, who: 'ops', key: 'intel', cool: 20, region: e.region };
    case 'scoutLost': return e.faction === me ? { say: e.by === 'patrol' ? L('Our patrol into {0} has not come back.', R(e.region)) : L('Reconnaissance aircraft over {0} shot down.', R(e.region)), pri: 0, front: 0, who: 'ops', region: e.region } : null;
    case 'spyFound':
      if (e.faction === me) return { say: L('We have lost contact with our agent in {0}. He has been taken.', R(e.region)), pri: 1, front: 0, who: 'ops', region: e.region };
      if (e.owner === me) return { say: L('Counter-intelligence has caught an enemy spy in {0}.', R(e.region)), pri: 0, front: 0, who: 'ops', region: e.region };
      return null;
    case 'bombed':
      if (e.faction === me) return { say: L('Our bombers report hits on the factory at {0}. Fires are burning.', R(e.region)), pri: 1, front: .2, who: 'ops', region: e.region };
      if (e.owner === me) return { say: L('Enemy bombers have hit the factory at {0}. Production is stopped.', R(e.region)), pri: 2, front: .3, who: 'ops', stinger: 'siren', region: e.region };
      return null;
    case 'railCut':
      if (e.faction === me) return { say: e.by === 'air' ? L('Railways at {0} are wrecked. Good work by the bombers.', R(e.region)) : L('Our agent has blown the line at {0}.', R(e.region)), pri: 0, front: 0, who: 'ops', region: e.region };
      if (e.owner === me) return { say: L('The railway at {0} has been cut. Troop trains are held up.', R(e.region)), pri: 1, front: 0, who: 'ops', region: e.region };
      return null;
    case 'strike': return e.faction === me ? { say: e.end ? L('The strikes at {0} are over. The works are running again.', R(e.region)) : L('Strikes at {0}. The workers have downed tools. The home front is tired of the war.', R(e.region)), pri: 1, front: 0, who: 'hq', region: e.region } : null;
    case 'rising':
      if (e.faction === me) return { say: L('{0}... mutiny in {1}. The garrison has gone over to {2}.', hq, R(e.region), D(e.to, 'dat')), pri: 2, front: 0, who: 'hq', stinger: 'lost', region: e.region };
      if (e.to === me) return { say: L('{0} has risen and declared for us!', R(e.region)), pri: 1, front: 0, who: 'hq', stinger: 'victory', region: e.region };
      return null;
    case 'tech': return e.faction === me ? { say: L('New equipment has reached the front. {0}', pick([L('The quartermasters are issuing it now.'), L('Units are being trained on it.')])), pri: 0, front: 0, who: 'hq', key: 'tech', cool: 30 } : null;
    case 'docOffer': return e.faction === me ? { say: L('The General Staff requests your decision on this year\'s doctrine.'), pri: 1, front: 0, who: 'hq', stinger: 'orders' } : null;
    case 'offer': return e.to === me ? { say: L('Diplomatic cable from {0}. They propose an agreement.', power(e.from, 'dat')), pri: 1, front: 0, who: 'ops', morse: '-.-. .- -... .-.. .' } : null;
    case 'treaty': {
      if (e.what === 'broken' && e.by !== me && (e.a === me || e.b === me)) return { say: L('Treachery! {0} has broken the treaty and attacks us!', power(e.by!)), pri: 2, front: 0, who: 'hq', stinger: 'declare' };
      if (e.what === 'signed' && (e.a === me || e.b === me)) return { say: L('Treaty signed with {0}.', power(e.a === me ? e.b : e.a, 'dat')), pri: 0, front: 0, who: 'ops' };
      return null;
    }
    case 'offshore':
      if (e.owner === me) return { say: L('Enemy fleet sighted off {0}! About {1} battalions aboard. Landing expected. Man the coast!', R(e.region), e.est), pri: 2, front: .2, who: 'ops', stinger: 'alarm', key: 'off-' + e.region, cool: 30, region: e.region };
      if (e.faction === me) return { say: L('Assault fleet is off {0}. Boats are being lowered. {1}', R(e.region), over), pri: 0, front: .2, who: 'front', voice: e.region + 100, region: e.region };
      return null;
    case 'landing':
      if (e.faction === me) return front(e.region, 1, e.ok ? L('First wave is ashore at {0}! Heavy fire from the cliffs.', R(e.region)) : L('The landing at {0} has failed. Taking off what survivors we can.', R(e.region)), { stinger: e.ok ? 'over-the-top' : 'lost' });
      if (e.owner === me) return front(e.region, 2, e.ok ? L('The enemy is landing at {0}!', R(e.region)) : L('Landing at {0} thrown back into the sea!', R(e.region)), { stinger: e.ok ? 'alarm' : 'held' });
      return null;
    case 'convoyLost':
      if (e.faction !== me) return null;
      return { say: e.by === 'uboat' ? L('Convoy torpedoed in the {0}. {1} lost{2}.', Z(e.zone), plural(e.ships, 'transport', 'transports', 'ein Transporter', 'Transporter'), e.men ? L(', {0} with them', menSpoken(e.men)) : '') : L('Ships lost in the {0}{1}.', Z(e.zone), e.men ? L(', {0} gone down with them', menSpoken(e.men)) : ''), pri: 2, front: 0, who: 'ops', morse: '... --- ...', key: 'convoy', cool: 20 };
    case 'shipBuilt': return e.faction === me && (e.kind === 'bb' || e.kind === 'carrier') ? { say: e.kind === 'bb' ? L('A new battleship squadron has been commissioned at {0}.', R(e.region)) : L('A new carrier has been commissioned at {0}.', R(e.region)), pri: 0, front: 0, who: 'ops', region: e.region } : null;
    case 'seaBattle': {
      const side = e.sides.findIndex(s => s.includes(me)); if (side < 0) return null;
      if (e.start) return { say: L('Enemy fleet in sight in the {0}! Battle stations! Our ships are engaging.', Z(e.zone)), pri: 2, front: .5, who: 'ops', stinger: 'alarm', key: 'sea-' + e.zone, cool: 30 };
      const n = (i: number) => { const s = e.sunk[i] ?? {}; return (s.dn ?? 0) + (s.cv ?? 0) + (s.dd ?? 0) + (s.tr ?? 0) + (s.lc ?? 0); };
      const res = L(e.winner === side ? 'The enemy has broken off.' : e.winner === 1 - side ? 'Our fleet is withdrawing.' : 'Neither side gave way.');
      return { say: L('Battle of the {0} is over. {1} We lost {2}, the enemy {3}.', Z(e.zone), res, plural(n(side), 'ship', 'ships', 'ein Schiff', 'Schiffe'), n(1 - side)), pri: 2, front: .2, who: 'ops', stinger: e.winner === side ? 'held' : e.winner === 1 - side ? 'lost' : undefined };
    }
    case 'eliminated':
      if (e.faction === me) return { say: L('All stations. The government has capitulated. Lay down your arms.'), pri: 3, front: .2, who: 'hq', stinger: 'toll' };
      return { say: pick([L('Flash message. {0} has capitulated.', power(e.faction)), L('Intercepted signal: {0} has surrendered.', power(e.faction))]), pri: 3, front: 0, who: 'ops', morse: '..-. .-.. .- ... ....', stinger: 'toll' };
    case 'newOrders': return e.faction === me ? { say: L('New orders from the General Staff. Your target has fallen to another power. Hold thirty regions.'), pri: 2, front: 0, who: 'hq', morse: '--- .-. -.. . .-. ...', stinger: 'orders' } : null;
    case 'over':
      if (e.winner === me) return { say: L('All stations. The war is won. Your orders are fulfilled. Ceasefire on all fronts.'), pri: 3, front: 0, who: 'hq', stinger: 'triumph' };
      return { say: L('All stations. The war is lost. Ceasefire on all fronts.'), pri: 3, front: 0, who: 'hq', stinger: 'taps' };
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
  const s = station(g, b, me), st = strength(b), foes = foesOf(b, me);
  const mine = st.get(me) ?? { alive: 0, all: 0, men: 0 };
  const enemy = foes.reduce((a, f) => { const v = st.get(f); return v ? { alive: a.alive + v.alive, all: a.all + v.all, men: a.men + v.men } : a; }, { alive: 0, all: 0, men: 0 });
  const lost = b.lost[me] ?? 0, lostE = sum(b.lost, foes), fresh = lost - (memo[b.id]?.lost ?? 0);
  const mor = b.mor[me] ?? 100, suppMe = b.supp[me] ?? 0, suppE = Math.max(0, ...foes.map(f => b.supp[f] ?? 0));
  const atk = b.attacker === me, parts: string[] = [];

  parts.push(L('{0}, this is {1}. Situation report.', call(), s.name));
  // where the fight stands
  if (b.stage === 3) parts.push(L(atk ? 'We hold a foothold in their first line.' : 'The enemy holds a foothold in our first line.'));
  else if (b.stage === 2) parts.push(atk ? L('We are fighting in the depth of {0}.', R(b.region)) : L('The fight is in the depth of {0}. The first line is gone.', R(b.region)));
  else if (b.stage === 1) parts.push(L(atk ? 'We are consolidating the captured trench.' : 'The enemy is consolidating in our old first line.'));
  else if (atk && !b.go) parts.push(L(b.bar?.[me] === 2 ? 'Our guns are firing a heavy barrage.' : b.bar?.[me] === 0 ? 'Our guns are silent.' : 'Our guns are shelling their line.'));
  else if (atk) parts.push(L('The men are in no man\'s land.'));
  else if (b.go) parts.push(L('The enemy is coming across no man\'s land.'));
  else parts.push(L('The enemy is shelling us and waiting in his trenches.'));

  // strength and losses
  if (mine.men > 0) parts.push(L('We have {0} still fighting{1}.', menSpoken(mine.men), enemy.men > 0 ? L(', against {0}', menSpoken(enemy.men).replace(/ (men|Mann)$/, '')) : ''));
  else if (mine.alive > 0) parts.push(L('{0} of ours still fighting, {1} of theirs.', plural(mine.alive, 'formation', 'formations', 'ein Verband', 'Verbände'), enemy.alive));
  else if (mine.all) parts.push(L('Our line is gone. Only stragglers are left.'));
  const cmp = lostE > lost * 1.3 ? L(', theirs are heavier') : lostE < lost * .6 ? L(', far more than they have') : '';
  if (fresh >= 20) parts.push(memo[b.id] ? L('We have lost {0} since the last report{1}.', menSpoken(fresh), cmp) : L('We have lost {0} since the battle began{1}.', menSpoken(fresh), cmp));
  parts.push(moraleWord(mor));
  if (suppMe > 60) parts.push(L('We are pinned down under heavy fire.'));
  if (atk && !b.go && b.wire0 > 0) parts.push(L(b.wire / b.wire0 > .6 ? 'Their wire is still mostly intact.' : b.wire / b.wire0 > .2 ? 'Their wire is cut in places.' : 'Their wire is cut.'));
  const ammo = b.ammo?.[me];
  if (ammo !== undefined && ammo < 15) parts.push(L(ammo <= 0 ? 'We are out of shells. The guns are rationed.' : 'Shells are running low here.'));

  // the request
  let ask = '';
  if (mor < 30 || (mine.alive > 0 && enemy.alive > mine.alive * 3)) ask = 'We cannot hold much longer. Request permission to withdraw.';
  else if (atk && !b.go && suppE > 60) ask = 'Enemy is pinned down. Ready to go over the top on your order.';
  else if (atk && !b.go && b.wire0 > 0 && b.wire / b.wire0 > .6) ask = 'We need more time with the guns before we go.';
  else if (suppMe > 60) ask = 'Request counter-battery fire.';
  else if (ammo !== undefined && ammo < 15) ask = 'Send shells.';
  else if (enemy.alive > mine.alive * 1.5) ask = 'Request reinforcements.';
  else ask = pick(['Holding.', 'We are holding.', 'Situation in hand.']);
  parts.push(L(ask), de() ? 'Kommen.' : 'Over.');
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
    if (min < 1.5) parts.push(L('The shell stockpile is nearly empty: {0} shells, not two minutes of heavy fire for our {1}.', f.shells, plural(guns, 'battery', 'batteries', 'Batterie', 'Batterien')));
    else if (min < 4) parts.push(L('Shells are getting short: about {0} minutes of heavy barrage left.', Math.round(min)));
  }
  if (f.men < 400) parts.push(f.men < 100 ? L('The depots are empty. No more men to call up.') : L('Manpower is running out: {0} left in the depots.', menSpoken(f.men)));
  if (f.ww >= 60) parts.push(L('War weariness at home is dangerous. There is talk of strikes.'));
  else if (f.ww >= 35) parts.push(L('The casualty lists are weighing on the home front.'));
  if (cut) parts.push(L('{0} cut off from supply.', plural(cut, 'region', 'regions', 'eine Region', 'Regionen')));
  if (!parts.length) return null;
  return { say: tidy(L('General Staff to all commands. {0}', parts.join(' '))), pri: 0, front: 0, who: 'hq', key: 'home', cool: 120 };
}

/** The next situation report: the most pressing front, else the home front. */
export function sitrep(g: GameState, me: number, memo: SitrepMemo): Dispatch | null {
  let best: Battle | null = null, bu = 0;
  for (const b of g.battles) { if (b.ended || !b.sides.includes(me)) continue; const u = urgency(b, me, memo, g.time); if (u > bu) { bu = u; best = b; } }
  if (best) return frontReport(g, best, me, memo);
  return homeReport(g, me);
}
