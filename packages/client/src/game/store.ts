// UI state (zustand). Game state itself lives in the Session; components read it through useSim() and re-render on `rev`.
import { create } from 'zustand';
import { dateOf, describeEvent, type BuildKind, type Command, type FortKind, type GameEvent, type UnitType } from '@riskrts/shared';
import type { Session } from './session';
import { Sfx } from '../audio/sfx';
import { Radio } from '../audio/radio';
import { Neural, defaultVoiceMode, type VoiceMode } from '../audio/voice';
import { DEFAULT_PIXEL_SCALE, type PixelScale } from '../render/api';
import { getLang, tx } from '../i18n';
import { guiding, unlocked } from '../ui/unlock';

export type Screen = 'title' | 'solo' | 'host' | 'join' | 'lobby' | 'game' | 'server';
/** Tabs of the region card (design-command §5.3): Overview (posts, corps, operations from here), Recruit, Build. */
export type Tab = 'over' | 'rec' | 'build';
/** Map layer: 0 everything, 1 troops (markers and front lines first), 2 industry (buildings, rails, supply). */
export type MapLayer = 0 | 1 | 2;
/** Map mode (design-command §1): 0 political, 1 fronts, 2 forces, 3 supply, 4 intel. Forces and supply drive the old troops / industry layers. */
export type MapMode = 0 | 1 | 2 | 3 | 4;
export const MAP_MODES = [
  { name: 'Political', short: 'Pol', key: 'p', hint: 'Owners, capitals and treaties' },
  { name: 'Fronts', short: 'Fronts', key: 'f', hint: 'Wars and battles, and how strong each of your borders is against the other side' },
  { name: 'Forces', short: 'Forces', key: 't', hint: 'Corps on the borders, front lines, columns on the move' },
  { name: 'Supply', short: 'Supply', key: 'b', hint: 'Supply lines and load against capacity, factories, barracks, airfields, rails' },
  { name: 'Intel', short: 'Intel', key: 'i', hint: 'What you know of each region and how old the report is' },
] as const;
/** Left-hand panels (design-command §5.2). */
export type Panel = null | 'situation' | 'forces' | 'staff' | 'economy' | 'navy' | 'intel';
const layerOf = (m: MapMode): MapLayer => m === 2 ? 1 : m === 3 ? 2 : 0;
/** march / air strike, and the navy: ship troops to an own coast, assault an enemy coast, station warships in a zone, carrier strike. */
export interface TutPoint { key: string; sel: string; region?: number; sector?: number; label?: string }
export type OrderKind = 'march' | 'air' | 'ship' | 'landing' | 'station' | 'cvair' | 'corps';
/** Which tool of the border card is open: send corps, fortify, scout (design-play §1). */
export type BorderTool = '' | 'fort' | 'send' | 'scout';
export type Overlay = null | 'menu' | 'orders' | 'help' | 'end' | 'reports' | 'calendar' | 'doctrine' | 'diplomacy' | 'rules';
/** When the game stops by itself (solo) or calls a pause vote (multiplayer): an urgent decision, our region attacked, a
 *  region lost, a battle won (design-play §2). */
export interface AutoPause { urgent: boolean; attacked: boolean; lost: boolean; won: boolean }
export type PauseWhy = keyof AutoPause;
const AP_DEFAULT: AutoPause = { urgent: true, attacked: true, lost: false, won: false };
export interface FeedItem { id: number; day: string; text: string; cls: '' | 'me' | 'bad' | 'good'; region?: number; report?: number }

interface Ui {
  screen: Screen;
  session: Session | null;
  /** Bumped ~5×/s and after every command so components re-read session.state. */
  rev: number;
  sel: number; hover: number; tab: Tab; sendFrac: number; orderMode: boolean; orderKind: OrderKind;
  /** Navy orders: the fleet or carrier they are for (-1: the warships docked in the selected port), and the kind of warship. */
  orderArg: number; orderSub: 'bb' | 'carrier';
  /** Selected fleet at sea and naval battle (-1 none). */
  fleet: number; seaSel: number;
  /** Goal of new attacks: 1 take the first line, 2 invade. */
  goal: 1 | 2; layer: MapLayer;
  /** Map mode, and whether the player has picked one (the map switches to Fronts on the first battle only until they do). */
  mode: MapMode; modeSet: boolean;
  /** Open left-hand panel. */
  panel: Panel;
  /** Border opened from a balance chip or a list: [own region, sector], shown as the border card above the region file. */
  border: [number, number] | null;
  /** Tool open on the border card. */
  borderTool: BorderTool;
  /** Selected own corps (ids). Right-clicking the map orders them: an own region or border moves them, an enemy region attacks. */
  corps: number[];
  /** Army (Hq id) whose card is open, or -1. */
  armySel: number;
  /** The army whose general the player is about to relieve (the army card shows the costs and a successor), or -1. */
  relieveFor: number;
  openRelieve: (army: number) => void;
  /** Alerts the player dismissed (by key) and until which game time. */
  dismissed: Record<string, number>;
  /** Border sector highlighted on the map while fortifying: [region, sector] (sector -1 = interior). */
  fortMarker: [number, number] | null;
  /** The guided war's pointer (Tutorial.tsx): the objective it belongs to, the buttons to pulse, a pin on the map (a region, or one of its borders). */
  tutPoint: TutPoint | null;
  overlay: Overlay; scoreOpen: boolean;
  /** After-action report shown in the reports sheet. */
  reportId: number;
  toast: { text: string; id: number } | null;
  feed: FeedItem[]; log: FeedItem[];
  tut: number; tips: boolean; quality: PixelScale; sound: boolean;
  /** Radio voice: off, the browser voice, or the neural field-telephone voice (signal cues still play when off). */
  radio: VoiceMode;
  /** The radio line on air now (subtitle), and the neural voice's loading state. */
  onAir: { text: string; region?: number } | null;
  voiceState: { state: 'idle' | 'loading' | 'ready' | 'error'; p: number };
  /** Visual style: 0 = Tiberian (muddy brown/grey), 1 = Red Alert (industrial chrome). */
  look: 0 | 1;
  fatal: string | null;
  /** Inbox (design-play §2): recruits that finished training per region, the item opened from a map pin, the items shown as
   *  toasts (until when, game time; Infinity: until answered), and when the game pauses by itself. */
  trained: Record<number, { n: number; at: number }>;
  inboxFocus: string | null;
  toasts: { key: string; until: number }[];
  autoPause: AutoPause;
  /** War weariness at the last two weekly convoys, for the home-front trend (design-play §4.1). */
  wwWeek: [number, number] | null;

  setScreen(s: Screen): void;
  clearFatal(): void;
  startSession(s: Session): void;
  leaveGame(): void;
  select(id: number): void;
  setHover(id: number): void;
  setTab(t: Tab): void;
  setSendFrac(f: number): void;
  setGoal(g: 1 | 2): void;
  setLayer(l: MapLayer): void;
  setMode(m: MapMode, auto?: boolean): void;
  setPanel(p: Panel): void;
  selectBorder(region: number, sector: number, tool?: BorderTool): void;
  setBorderTool(t: BorderTool): void;
  closeBorder(): void;
  /** Select corps (add with `add`, toggling ones already selected); [] clears. `region` selects their region too. */
  selectCorps(ids: number[], add?: boolean, region?: number): void;
  selectArmy(id: number): void;
  dismiss(key: string, until: number): void;
  beginOrder(kind?: OrderKind, arg?: number, sub?: 'bb' | 'carrier'): void;
  selectFleet(id: number): void;
  selectSea(id: number): void;
  setFortMarker(m: [number, number] | null): void;
  cancelOrder(): void;
  setOverlay(o: Overlay): void;
  /** Section of the Rules' Basics page to scroll to when the Rules open (set by the guided war's "More in the rules"). */
  rulesAt: string | null;
  openRules(at?: string): void;
  toggleScore(): void;
  /** Show a toast. Pass English: the text is translated here (command errors from the simulation or a host, client messages). */
  say(text: string): void;
  setSpeed(s: number): void;
  setQuality(q: PixelScale): void;
  setLook(l: 0 | 1): void;
  setSound(on: boolean): void;
  setRadio(m: VoiceMode): void;
  setTips(on: boolean): void;
  advanceTut(n: number): void;
  /** Convenience actions that send a command and surface errors as toasts. */
  recruit(region: number, unit: UnitType, n?: number, now?: boolean): void;
  build(region: number, kind: BuildKind): void;
  fortify(region: number, kind: FortKind, sector: number): void;
  /** Send any command; errors become toasts (translated by say()). */
  order(cmd: Command): boolean;
  march(from: number, to: number, brk?: boolean): void;
  air(from: number, to: number): void;
  assault(region: number): void;
  /** Called by the game loop ~5×/s: pulls events from the session into the feed and bumps rev. */
  pump(): void;
  bump(): void;
  setAutoPause(p: Partial<AutoPause>): void;
  /** Stop the game for a reason the player picked: pause (solo), or call a pause vote (multiplayer). */
  autoPauseFor(why: PauseWhy): void;
  /** An attack waiting for its goal (design-optimize §3.4): the target, where on screen it was ordered, and what attacks. */
  attackAsk: { target: number; x: number; y: number; from?: number } | null;
  askAttack(a: Ui['attackAsk']): void;
  /** The owner switch of a front (design-play §3.1): one of its regions and where on screen its banner was clicked. */
  frontAsk: { region: number; x: number; y: number } | null;
  askFront(a: Ui['frontAsk']): void;
  /** Why the game paused itself ('' when the player paused it), for the pause banner. */
  pauseWhy: string;
  focusInbox(key: string | null): void;
  /** Leave an Inbox item alone: drop its toast, and for a while the item itself (game seconds). */
  dropInbox(key: string, quiet?: number): void;
}

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
let feedId = 1;

/** Pixel scale from storage; the old three-step setting (f14q: Ultra/High/Chunky) carries over as Ultra/Classic/Retro. */
export function loadPixelScale(get: (k: string) => string | null = lsGet): PixelScale {
  const v = get('f14px');
  if (v !== null && ['0', '1', '2', '3'].includes(v)) return Number(v) as PixelScale;
  const old = get('f14q');
  if (old === '0') return 0;
  if (old === '2') return 3;
  if (old === '1') return 2;
  return DEFAULT_PIXEL_SCALE;
}

/** Radio voice from storage: '0' off, 'b' browser voice, 'n' neural; the old on/off ('1') and no choice yet mean the device default. */
export function loadVoiceMode(get: (k: string) => string | null = lsGet): VoiceMode {
  const v = get('f14radio');
  return v === '0' ? 'off' : v === 'b' ? 'basic' : v === 'n' ? 'neural' : defaultVoiceMode();
}
Sfx.on = lsGet('f14snd') !== '0'; Radio.mode = loadVoiceMode();
function loadAutoPause(): AutoPause { try { const v = JSON.parse(lsGet('f14ap') ?? 'null') as Partial<AutoPause> | null; return { ...AP_DEFAULT, ...(v ?? {}) }; } catch { return { ...AP_DEFAULT }; } }

export const useUi = create<Ui>((set, get) => ({
  screen: 'title', session: null, rev: 0, sel: -1, hover: -1, tab: 'over', sendFrac: .5, goal: 2, layer: 0, mode: 0, modeSet: false, panel: null, dismissed: {}, border: null, borderTool: '', corps: [], armySel: -1, relieveFor: -1, orderMode: false, orderKind: 'march', orderArg: -1, orderSub: 'bb', fleet: -1, seaSel: -1, fortMarker: null, tutPoint: null, overlay: null, scoreOpen: false, reportId: -1,
  trained: {}, inboxFocus: null, toasts: [], autoPause: loadAutoPause(), pauseWhy: '', attackAsk: null, frontAsk: null, wwWeek: null,
  toast: null, feed: [], log: [], tut: 0, tips: lsGet('f14tips') !== '0',
  quality: loadPixelScale(),
  sound: lsGet('f14snd') !== '0', radio: loadVoiceMode(), onAir: null, voiceState: { state: 'idle', p: 0 }, fatal: null, look: lsGet('f14look') === '1' ? 1 : 0,

  setScreen: (screen) => set({ screen }),
  clearFatal: () => set({ fatal: null }),
  startSession: (session) => { get().session?.destroy(); set({ session, screen: 'game', sel: -1, hover: -1, feed: [], log: [], tut: 0, orderMode: false, orderKind: 'march', fleet: -1, seaSel: -1, fortMarker: null, tutPoint: null, overlay: 'orders', tab: 'over', scoreOpen: false, mode: 0, layer: 0, modeSet: false, panel: null, dismissed: {}, border: null, corps: [], armySel: -1, trained: {}, inboxFocus: null, toasts: [], wwWeek: null });
    session.onError = (m) => get().say(m); },
  leaveGame: () => { Radio.reset(); get().session?.destroy(); set({ session: null, screen: 'title', overlay: null, sel: -1, feed: [], log: [] }); },
  select: (id) => { const s = get().session; set({ attackAsk: null, frontAsk: null, sel: id, orderMode: false, fortMarker: null, fleet: -1, seaSel: -1, corps: [], armySel: -1, border: get().border && get().border![0] === id ? get().border : null }); if (id >= 0 && s && s.state.regions[id].owner === s.me && get().tut < 1) set({ tut: 1 }); Sfx.click(); },
  setHover: (hover) => { if (hover !== get().hover) set({ hover }); },
  setTab: (tab) => set({ tab }),
  setSendFrac: (sendFrac) => set({ sendFrac }),
  setGoal: (goal) => set({ goal }),
  setLayer: (layer) => set({ layer, mode: layer === 1 ? 2 : layer === 2 ? 3 : 0, modeSet: true }),
  setMode: (mode, auto) => {
    if (auto && get().modeSet) return; const s = get().session;
    if (!unlocked(s?.state, 'mode:' + mode)) return;
    // the guided war's supply stage asks the player to open this mode
    if (mode === 3 && !auto && guiding(s?.state) && s?.state.tut && !s.state.tut.flags.supply) get().order({ t: 'tut', what: 'supply' });
    set({ mode, layer: layerOf(mode), modeSet: get().modeSet || !auto });
  },
  setPanel: (panel) => { if (panel && !unlocked(get().session?.state, panel)) return; set({ panel }); },
  selectBorder: (region, sector, tool) => set({ sel: region, border: [region, sector], borderTool: tool ?? (get().border?.[0] === region && get().border?.[1] === sector ? get().borderTool : ''), fortMarker: [region, sector], orderMode: false, fleet: -1, seaSel: -1, corps: [], armySel: -1 }),
  selectCorps: (ids, add, region) => {
    const cur = get().corps, next = !add ? ids : [...cur.filter(i => !ids.includes(i)), ...ids.filter(i => !cur.includes(i))];
    set({ corps: next, armySel: -1, orderMode: false, fleet: -1, seaSel: -1, border: null, ...(region !== undefined && region >= 0 ? { sel: region } : {}) }); Sfx.click();
  },
  selectArmy: (armySel) => { set({ armySel, corps: [], border: null, relieveFor: -1 }); Sfx.click(); },
  openRelieve: (army) => { set({ armySel: army, corps: [], border: null, relieveFor: army }); },
  closeBorder: () => set({ border: null, fortMarker: null, borderTool: '' }),
  setBorderTool: (borderTool) => set({ borderTool }),
  dismiss: (key, until) => set(st => ({ dismissed: { ...st.dismissed, [key]: until } })),
  beginOrder: (orderKind = 'march', orderArg = -1, orderSub = 'bb') => set({ orderMode: true, orderKind, orderArg, orderSub }),
  selectFleet: (fleet) => { set({ fleet, seaSel: -1, orderMode: false }); Sfx.click(); },
  selectSea: (seaSel) => { set({ seaSel, fleet: -1 }); Sfx.click(); },
  setFortMarker: (fortMarker) => set({ fortMarker }),
  cancelOrder: () => set({ orderMode: false }),
  rulesAt: null,
  openRules: (at) => { set({ rulesAt: at ?? null }); get().setOverlay('rules'); },
  setOverlay: (overlay) => { const s = get().session; if (s?.kind === 'local' && s.canControlTime) { if (overlay) s.speed = 0; else if (s.speed === 0) s.speed = 1; } set({ overlay }); },
  toggleScore: () => set(st => ({ scoreOpen: !st.scoreOpen })),
  say: (text) => set({ toast: { text: tx(text), id: ++feedId } }),
  askAttack: (attackAsk) => set({ attackAsk }),
  askFront: (frontAsk) => set({ frontAsk }),
  setSpeed: (n) => { const s = get().session; if (s?.canControlTime && (n <= 1 || s.canChangeSpeed)) { s.speed = n; set({ pauseWhy: '' }); get().bump(); } },
  setQuality: (quality) => { lsSet('f14px', String(quality)); set({ quality }); },
  setLook: (look) => { lsSet('f14look', String(look)); set({ look }); },
  setSound: (sound) => { lsSet('f14snd', sound ? '1' : '0'); Sfx.on = sound; if (!sound) Radio.reset(); set({ sound }); },
  setRadio: (radio) => { lsSet('f14radio', radio === 'off' ? '0' : radio === 'basic' ? 'b' : 'n'); Radio.setMode(radio); set({ radio }); },
  setTips: (tips) => { lsSet('f14tips', tips ? '1' : '0'); set({ tips }); },
  advanceTut: (n) => { if (n > get().tut) set({ tut: n }); },

  recruit: (region, unit, n = 1, now = false) => {
    const s = get().session; if (!s) return; const err = s.send({ t: 'recruit', region, unit, n, now: now || undefined } as Command);
    if (err) { get().say(err); Sfx.deny(); } else { get().advanceTut(2); Sfx.click(); } get().bump();
  },
  build: (region, kind) => { const s = get().session; if (!s) return; const err = s.send({ t: 'build', region, kind }); if (err) { get().say(err); Sfx.deny(); } else Sfx.click(); get().bump(); },
  fortify: (region, kind, sector) => { const s = get().session; if (!s) return; const err = s.send({ t: 'fortify', region, kind, sector }); if (err) { get().say(err); Sfx.deny(); } else Sfx.click(); get().bump(); },
  air: (from, to) => {
    const s = get().session; if (!s) return; const err = s.send({ t: 'air', from, to, frac: get().sendFrac });
    if (err) { get().say(err); Sfx.deny(); } else Sfx.order(); set({ orderMode: false, orderKind: 'march' }); get().bump();
  },
  order: (cmd) => { const s = get().session; if (!s) return false; const err = s.send(cmd); if (err) { get().say(err); Sfx.deny(); } else Sfx.order(); if (get().orderMode && get().orderKind !== 'march' && get().orderKind !== 'air') set({ orderMode: false, orderKind: 'march' }); get().bump(); return !err; },
  assault: (region) => { const s = get().session; if (!s) return; const err = s.send({ t: 'assault', region }); if (err) { get().say(err); Sfx.deny(); } else Sfx.order(); get().bump(); },
  march: (from, to, brk) => {
    const s = get().session; if (!s) return; const err = s.send({ t: 'march', from, to, frac: get().sendFrac, brk, goal: get().goal });
    if (err) { get().say(err); Sfx.deny(); } else { get().advanceTut(3); Sfx.order(); } set({ orderMode: false }); get().bump();
  },

  pump: () => {
    const s = get().session; if (!s) return;
    const evs: GameEvent[] = s.drainEvents(); const items: FeedItem[] = [];
    for (const e of evs) {
      if (e.k === 'supply') { Sfx.supply(); const ww = s.state.factions[s.me]?.ww ?? 0; set({ wwWeek: [get().wwWeek?.[1] ?? ww, ww] }); continue; }
      Radio.event(s.state, e, s.me);
      for (const tap of eventTaps) tap(s.state, e, s.me);
      if (e.k === 'over') { set({ overlay: 'end' }); continue; }
      if (e.k === 'battleStart' && (e.attacker === s.me || e.defender === s.me)) get().setMode(1, true);
      if (e.k === 'trained' && e.faction === s.me) { const tr = get().trained, old = tr[e.region]; set({ trained: { ...tr, [e.region]: { n: (old && s.state.time - old.at < 60 ? old.n : 0) + e.n, at: s.state.time } } }); }
      if (e.k === 'battleStart' && e.defender === s.me && e.attacker !== s.me) get().autoPauseFor('attacked');
      if (e.k === 'battleEnd' && e.prev === s.me && e.winner !== null && e.winner !== s.me) get().autoPauseFor('lost');
      if (e.k === 'battleEnd' && e.winner === s.me && e.sides.includes(s.me) && e.prev !== s.me) get().autoPauseFor('won');
      const d = describeEvent(s.state, e, s.me); if (!d) continue;
      items.push({ id: ++feedId, day: dateStr(s.state.day), text: d.text, cls: d.cls, region: d.region, report: d.report });
    }
    Radio.tick(s.state, s.me);
    set(st => ({ rev: st.rev + 1, feed: items.length ? [...st.feed, ...items].slice(-4) : st.feed, log: items.length ? [...items.reverse(), ...st.log].slice(0, 60) : st.log }));
    if (items.length) for (const it of items) setTimeout(() => set(st => ({ feed: st.feed.filter(f => f.id !== it.id) })), 10000);
  },
  bump: () => set(st => ({ rev: st.rev + 1 })),
  setAutoPause: (p) => { const autoPause = { ...get().autoPause, ...p }; lsSet('f14ap', JSON.stringify(autoPause)); set({ autoPause }); },
  autoPauseFor: (why) => {
    const s = get().session; if (!s || !get().autoPause[why] || s.state.over) return;
    const g = s.state, humans = g.factions.filter(f => f.alive && !f.ai).length;
    const msg = { urgent: 'Paused: a decision is waiting in the Inbox.', attacked: 'Paused: one of our regions is under attack.', lost: 'Paused: we lost a region.', won: 'Paused: we won a battle.' }[why];
    if (s.canControlTime && humans <= 1) { if (s.speed > 0) { s.speed = 0; set({ pauseWhy: msg }); get().say(msg); get().bump(); } return; }
    // multiplayer: ask the others, at most once in half a minute and never over an open vote
    if (g.vote || g.cfg.vote === false || performance.now() - lastCall < 30000) return;
    lastCall = performance.now(); s.send({ t: 'pauseCall' });
  },
  focusInbox: (inboxFocus) => set({ inboxFocus }),
  dropInbox: (key, quiet) => {
    const s = get().session, now = s?.state.time ?? 0;
    set(st => ({ toasts: st.toasts.filter(x => x.key !== key), inboxFocus: st.inboxFocus === key ? null : st.inboxFocus, ...(quiet ? { dismissed: { ...st.dismissed, ['ib:' + key]: now + quiet } } : {}) }));
  },
}));
let lastCall = -1e9;
/** Modules that react to game events as they come in (the story cards of design-play §5.3). */
export const eventTaps: ((g: Session['state'], e: GameEvent, me: number) => void)[] = [];

Radio.onAir = (d) => useUi.setState({ onAir: d ? { text: d.say, region: d.region } : null });
Neural.onState = () => useUi.setState({ voiceState: { state: Neural.state, p: Neural.progress } });

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
/** "1 Aug 1914" (German: "1. Aug 1914"), in the interface language. */
export function dateStr(day: number) { const d = new Date(Date.UTC(1914, 7, 1) + day * 864e5); return getLang() === 'de' ? `${d.getUTCDate()}. ${MON_DE[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
/** "Sep 1916" in the interface language (the shared monthStr is English only). */
export function monthStr(day: number) { const { y, m } = dateOf(day); return `${(getLang() === 'de' ? MON_DE : MON)[m - 1]} ${y}`; }

/** Read the live session. Re-renders whenever the store's rev changes. */
export function useSim() {
  const session = useUi(s => s.session); useUi(s => s.rev);
  return session ? { g: session.state, me: session.me, session } : null;
}
