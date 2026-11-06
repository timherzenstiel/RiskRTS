// UI state (zustand). Game state itself lives in the Session; components read it through useSim() and re-render on `rev`.
import { create } from 'zustand';
import { describeEvent, type BuildKind, type Command, type FortKind, type GameEvent, type UnitType } from '@riskrts/shared';
import type { Session } from './session';
import { Sfx } from '../audio/sfx';
import { Radio } from '../audio/radio';
import { Neural, defaultVoiceMode, type VoiceMode } from '../audio/voice';
import { DEFAULT_PIXEL_SCALE, type PixelScale } from '../render/api';

export type Screen = 'title' | 'solo' | 'host' | 'join' | 'lobby' | 'game' | 'server';
export type Tab = 'rec' | 'build' | 'fort' | 'deploy' | 'march' | 'navy';
/** Map layer: 0 everything, 1 troops (markers and front lines first), 2 industry (buildings, rails, supply). */
export type MapLayer = 0 | 1 | 2;
/** Map mode (design-command §1): 0 political, 1 fronts, 2 forces, 3 supply, 4 intel. Forces and supply drive the old troops / industry layers. */
export type MapMode = 0 | 1 | 2 | 3 | 4;
export const MAP_MODES = [
  { name: 'Political', short: 'Pol', key: 'p', hint: 'Owners, capitals and treaties' },
  { name: 'Fronts', short: 'Fronts', key: 'f', hint: 'Wars and battles, and how strong each of your borders is against the other side' },
  { name: 'Forces', short: 'Forces', key: 't', hint: 'Corps on the borders, front lines, columns on the move' },
  { name: 'Supply', short: 'Supply', key: 'b', hint: 'Factories, barracks, airfields, rails and supply lines' },
  { name: 'Intel', short: 'Intel', key: 'i', hint: 'What you know of each region and how old the report is' },
] as const;
/** Left-hand panels (design-command §5.2). */
export type Panel = null | 'situation' | 'forces';
const layerOf = (m: MapMode): MapLayer => m === 2 ? 1 : m === 3 ? 2 : 0;
/** march / air strike, and the navy: ship troops to an own coast, assault an enemy coast, station warships in a zone, carrier strike. */
export type OrderKind = 'march' | 'air' | 'ship' | 'landing' | 'station' | 'cvair';
export type Overlay = null | 'menu' | 'orders' | 'help' | 'end' | 'reports' | 'nation' | 'calendar' | 'doctrine' | 'diplomacy';
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
  /** Selected own corps (ids). Right-clicking the map orders them: an own region or border moves them, an enemy region attacks. */
  corps: number[];
  /** Alerts the player dismissed (by key) and until which game time. */
  dismissed: Record<string, number>;
  /** Border sector highlighted on the map while fortifying: [region, sector] (sector -1 = interior). */
  fortMarker: [number, number] | null;
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
  selectBorder(region: number, sector: number): void;
  closeBorder(): void;
  /** Select corps (add with `add`, toggling ones already selected); [] clears. `region` selects their region too. */
  selectCorps(ids: number[], add?: boolean, region?: number): void;
  dismiss(key: string, until: number): void;
  beginOrder(kind?: OrderKind, arg?: number, sub?: 'bb' | 'carrier'): void;
  selectFleet(id: number): void;
  selectSea(id: number): void;
  setFortMarker(m: [number, number] | null): void;
  cancelOrder(): void;
  setOverlay(o: Overlay): void;
  toggleScore(): void;
  say(text: string): void;
  setSpeed(s: number): void;
  setQuality(q: PixelScale): void;
  setLook(l: 0 | 1): void;
  setSound(on: boolean): void;
  setRadio(m: VoiceMode): void;
  setTips(on: boolean): void;
  advanceTut(n: number): void;
  /** Convenience actions that send a command and surface errors as toasts. */
  recruit(region: number, unit: UnitType, n?: number): void;
  build(region: number, kind: BuildKind): void;
  fortify(region: number, kind: FortKind, sector: number): void;
  /** Send any command; errors become toasts. */
  order(cmd: Command): boolean;
  march(from: number, to: number, brk?: boolean): void;
  air(from: number, to: number): void;
  assault(region: number): void;
  /** Called by the game loop ~5×/s: pulls events from the session into the feed and bumps rev. */
  pump(): void;
  bump(): void;
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

export const useUi = create<Ui>((set, get) => ({
  screen: 'title', session: null, rev: 0, sel: -1, hover: -1, tab: 'rec', sendFrac: .5, goal: 2, layer: 0, mode: 0, modeSet: false, panel: null, dismissed: {}, border: null, corps: [], orderMode: false, orderKind: 'march', orderArg: -1, orderSub: 'bb', fleet: -1, seaSel: -1, fortMarker: null, overlay: null, scoreOpen: false, reportId: -1,
  toast: null, feed: [], log: [], tut: 0, tips: lsGet('f14tips') !== '0',
  quality: loadPixelScale(),
  sound: lsGet('f14snd') !== '0', radio: loadVoiceMode(), onAir: null, voiceState: { state: 'idle', p: 0 }, fatal: null, look: lsGet('f14look') === '1' ? 1 : 0,

  setScreen: (screen) => set({ screen }),
  clearFatal: () => set({ fatal: null }),
  startSession: (session) => { get().session?.destroy(); set({ session, screen: 'game', sel: -1, hover: -1, feed: [], log: [], tut: 0, orderMode: false, orderKind: 'march', fleet: -1, seaSel: -1, fortMarker: null, overlay: 'orders', tab: 'rec', scoreOpen: false, mode: 0, layer: 0, modeSet: false, panel: null, dismissed: {}, border: null, corps: [] });
    session.onError = (m) => get().say(m); },
  leaveGame: () => { Radio.reset(); get().session?.destroy(); set({ session: null, screen: 'title', overlay: null, sel: -1, feed: [], log: [] }); },
  select: (id) => { const s = get().session; set({ sel: id, orderMode: false, fortMarker: null, fleet: -1, seaSel: -1, corps: [], border: get().border && get().border![0] === id ? get().border : null }); if (id >= 0 && s && s.state.regions[id].owner === s.me && get().tut < 1) set({ tut: 1 }); Sfx.click(); },
  setHover: (hover) => { if (hover !== get().hover) set({ hover }); },
  setTab: (tab) => set({ tab, fortMarker: tab === 'fort' ? get().fortMarker : null }),
  setSendFrac: (sendFrac) => set({ sendFrac }),
  setGoal: (goal) => set({ goal }),
  setLayer: (layer) => set({ layer, mode: layer === 1 ? 2 : layer === 2 ? 3 : 0, modeSet: true }),
  setMode: (mode, auto) => { if (auto && get().modeSet) return; set({ mode, layer: layerOf(mode), modeSet: get().modeSet || !auto }); },
  setPanel: (panel) => set({ panel }),
  selectBorder: (region, sector) => set({ sel: region, border: [region, sector], orderMode: false, fleet: -1, seaSel: -1, corps: [] }),
  selectCorps: (ids, add, region) => {
    const cur = get().corps, next = !add ? ids : [...cur.filter(i => !ids.includes(i)), ...ids.filter(i => !cur.includes(i))];
    set({ corps: next, orderMode: false, fleet: -1, seaSel: -1, border: null, ...(region !== undefined && region >= 0 ? { sel: region } : {}) }); Sfx.click();
  },
  closeBorder: () => set({ border: null }),
  dismiss: (key, until) => set(st => ({ dismissed: { ...st.dismissed, [key]: until } })),
  beginOrder: (orderKind = 'march', orderArg = -1, orderSub = 'bb') => set({ orderMode: true, orderKind, orderArg, orderSub }),
  selectFleet: (fleet) => { set({ fleet, seaSel: -1, orderMode: false }); Sfx.click(); },
  selectSea: (seaSel) => { set({ seaSel, fleet: -1 }); Sfx.click(); },
  setFortMarker: (fortMarker) => set({ fortMarker }),
  cancelOrder: () => set({ orderMode: false }),
  setOverlay: (overlay) => { const s = get().session; if (s?.kind === 'local' && s.canControlTime) { if (overlay) s.speed = 0; else if (s.speed === 0) s.speed = 1; } set({ overlay }); },
  toggleScore: () => set(st => ({ scoreOpen: !st.scoreOpen })),
  say: (text) => set({ toast: { text, id: ++feedId } }),
  setSpeed: (n) => { const s = get().session; if (s?.canControlTime && (n <= 1 || s.canChangeSpeed)) { s.speed = n; get().bump(); } },
  setQuality: (quality) => { lsSet('f14px', String(quality)); set({ quality }); },
  setLook: (look) => { lsSet('f14look', String(look)); set({ look }); },
  setSound: (sound) => { lsSet('f14snd', sound ? '1' : '0'); Sfx.on = sound; if (!sound) Radio.reset(); set({ sound }); },
  setRadio: (radio) => { lsSet('f14radio', radio === 'off' ? '0' : radio === 'basic' ? 'b' : 'n'); Radio.setMode(radio); set({ radio }); },
  setTips: (tips) => { lsSet('f14tips', tips ? '1' : '0'); set({ tips }); },
  advanceTut: (n) => { if (n > get().tut) set({ tut: n }); },

  recruit: (region, unit, n = 1) => {
    const s = get().session; if (!s) return; const err = s.send({ t: 'recruit', region, unit, n } as Command);
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
      if (e.k === 'supply') { Sfx.supply(); continue; }
      Radio.event(s.state, e, s.me);
      if (e.k === 'over') { set({ overlay: 'end' }); continue; }
      if (e.k === 'battleStart' && (e.attacker === s.me || e.defender === s.me)) get().setMode(1, true);
      const d = describeEvent(s.state, e, s.me); if (!d) continue;
      items.push({ id: ++feedId, day: dateStr(s.state.day), text: d.text, cls: d.cls, region: d.region, report: d.report });
    }
    Radio.tick(s.state, s.me);
    set(st => ({ rev: st.rev + 1, feed: items.length ? [...st.feed, ...items].slice(-4) : st.feed, log: items.length ? [...items.reverse(), ...st.log].slice(0, 60) : st.log }));
    if (items.length) for (const it of items) setTimeout(() => set(st => ({ feed: st.feed.filter(f => f.id !== it.id) })), 10000);
  },
  bump: () => set(st => ({ rev: st.rev + 1 })),
}));

Radio.onAir = (d) => useUi.setState({ onAir: d ? { text: d.say, region: d.region } : null });
Neural.onState = () => useUi.setState({ voiceState: { state: Neural.state, p: Neural.progress } });

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateStr(day: number) { const d = new Date(Date.UTC(1914, 7, 1) + day * 864e5); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }

/** Read the live session. Re-renders whenever the store's rev changes. */
export function useSim() {
  const session = useUi(s => s.session); useUi(s => s.rev);
  return session ? { g: session.state, me: session.me, session } : null;
}
