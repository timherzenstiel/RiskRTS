// UI state (zustand). Game state itself lives in the Session; components read it through useSim() and re-render on `rev`.
import { create } from 'zustand';
import { dateOf, describeEvent, type BuildKind, type Command, type FortKind, type GameEvent, type UnitType } from '@riskrts/shared';
import type { Session } from './session';
import { Sfx } from '../audio/sfx';
import { Radio } from '../audio/radio';
import { Neural, defaultVoiceMode, type VoiceMode } from '../audio/voice';
import { DEFAULT_PIXEL_SCALE, type PixelScale } from '../render/api';
import { getLang, tx } from '../i18n';

export type Screen = 'title' | 'solo' | 'host' | 'join' | 'lobby' | 'game' | 'server';
export type Tab = 'rec' | 'build' | 'fort' | 'deploy' | 'march' | 'navy';
/** Map layer: 0 everything, 1 troops (markers and front lines first), 2 industry (buildings, rails, supply). */
export type MapLayer = 0 | 1 | 2;
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
  beginOrder(kind?: OrderKind, arg?: number, sub?: 'bb' | 'carrier'): void;
  selectFleet(id: number): void;
  selectSea(id: number): void;
  setFortMarker(m: [number, number] | null): void;
  cancelOrder(): void;
  setOverlay(o: Overlay): void;
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
  recruit(region: number, unit: UnitType, n?: number): void;
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
  screen: 'title', session: null, rev: 0, sel: -1, hover: -1, tab: 'rec', sendFrac: .5, goal: 2, layer: 0, orderMode: false, orderKind: 'march', orderArg: -1, orderSub: 'bb', fleet: -1, seaSel: -1, fortMarker: null, overlay: null, scoreOpen: false, reportId: -1,
  toast: null, feed: [], log: [], tut: 0, tips: lsGet('f14tips') !== '0',
  quality: loadPixelScale(),
  sound: lsGet('f14snd') !== '0', radio: loadVoiceMode(), onAir: null, voiceState: { state: 'idle', p: 0 }, fatal: null, look: lsGet('f14look') === '1' ? 1 : 0,

  setScreen: (screen) => set({ screen }),
  clearFatal: () => set({ fatal: null }),
  startSession: (session) => { get().session?.destroy(); set({ session, screen: 'game', sel: -1, hover: -1, feed: [], log: [], tut: 0, orderMode: false, orderKind: 'march', fleet: -1, seaSel: -1, fortMarker: null, overlay: 'orders', tab: 'rec', scoreOpen: false });
    session.onError = (m) => get().say(m); },
  leaveGame: () => { Radio.reset(); get().session?.destroy(); set({ session: null, screen: 'title', overlay: null, sel: -1, feed: [], log: [] }); },
  select: (id) => { const s = get().session; set({ sel: id, orderMode: false, fortMarker: null, fleet: -1, seaSel: -1 }); if (id >= 0 && s && s.state.regions[id].owner === s.me && get().tut < 1) set({ tut: 1 }); Sfx.click(); },
  setHover: (hover) => { if (hover !== get().hover) set({ hover }); },
  setTab: (tab) => set({ tab, fortMarker: tab === 'fort' ? get().fortMarker : null }),
  setSendFrac: (sendFrac) => set({ sendFrac }),
  setGoal: (goal) => set({ goal }),
  setLayer: (layer) => set({ layer }),
  beginOrder: (orderKind = 'march', orderArg = -1, orderSub = 'bb') => set({ orderMode: true, orderKind, orderArg, orderSub }),
  selectFleet: (fleet) => { set({ fleet, seaSel: -1, orderMode: false }); Sfx.click(); },
  selectSea: (seaSel) => { set({ seaSel, fleet: -1 }); Sfx.click(); },
  setFortMarker: (fortMarker) => set({ fortMarker }),
  cancelOrder: () => set({ orderMode: false }),
  setOverlay: (overlay) => { const s = get().session; if (s?.kind === 'local' && s.canControlTime) { if (overlay) s.speed = 0; else if (s.speed === 0) s.speed = 1; } set({ overlay }); },
  toggleScore: () => set(st => ({ scoreOpen: !st.scoreOpen })),
  say: (text) => set({ toast: { text: tx(text), id: ++feedId } }),
  setSpeed: (n) => { const s = get().session; if (s?.canControlTime) { s.speed = n; get().bump(); } },
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
