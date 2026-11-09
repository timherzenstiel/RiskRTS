// Goals and story inside a war (design-play §5): war aims and the war score in the Situation panel, aims to choose and peace
// terms in the Inbox, the weekly newspaper (our own slanted paper and a dry wire service), and moments – short full-screen
// cards with a sound for the turning points of a war.
import { useEffect } from 'react';
import { create } from 'zustand';
import { FACTIONS, WAR, cap, buildWorld, warBetween, warScore, type GameState, type NewsItem, type War, type WarAim } from '@riskrts/shared';
import { dateStr, eventTaps, useSim, useUi } from '../game/store';
import { Sfx, type Stinger } from '../audio/sfx';
import { click } from './actions';
import { CloseIcon } from './icons';
import { nm } from './format';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';
import { lsGet, lsSet } from './storage';
import { rendererRef } from './refs';
import type { InboxItem, Opt } from './Inbox';

const W = () => buildWorld();
const R = (id: number) => W().regions[id]?.name ?? '?';
/** A power in a sentence ("the French Republic"), and at its start. */
const F = (f: number) => FACTIONS[f]?.the ?? '?';
const Fc = (f: number) => cap(F(f));
const sideOf = (w: War, me: number) => (w.a === me ? 0 : 1);

// ---------------------------------------------------------------- aims

/** "Take Lorraine by 1 Dec 1914" and the like. */
export function aimText(aim: WarAim, foe: number): string {
  if (aim.k === 'take') return tn('Take {0} by {1}', R(aim.region!), { raw: dateStr(aim.until) });
  if (aim.k === 'hold') return tn('Lose no region to {0} until {1}', F(foe), { raw: dateStr(aim.until) });
  return tn('Raise the war score against {0} to +{1} by {2}', F(foe), aim.need ?? WAR.offerAt, { raw: dateStr(aim.until) });
}
/** What reaching it pays. */
export function aimReward(aim: WarAim): string {
  if (aim.k === 'take') return t('+{0} Production', WAR.takeProd);
  if (aim.k === 'hold') return t('−{0} war weariness', WAR.holdWW);
  return t('+{0} Production, −{1} war weariness', WAR.winProd, WAR.winWW);
}
const AIM_SHORT = { take: 'Take {0}', hold: 'Hold every border', win: 'Gain the upper hand' } as const;
const aimShort = (a: WarAim) => (a.k === 'take' ? t(AIM_SHORT.take, R(a.region!)) : t(AIM_SHORT[a.k]));

/** The war score as a bar from −100 (theirs) to +100 (ours). */
export function ScoreBar({ s }: { s: number }) {
  const w = Math.min(50, Math.abs(s) / 2);
  return (
    <span className="wscore" title={t('War score: regions taken, men lost against men killed, war aims reached. At ±{0} peace terms come up.', WAR.offerAt)}>
      <span className="wsb"><i className={s >= 0 ? 'up' : 'dn'} style={{ left: s >= 0 ? '50%' : `${50 - w}%`, width: `${w}%` }} /><em style={{ left: `${50 + WAR.offerAt / 2}%` }} /><em style={{ left: `${50 - WAR.offerAt / 2}%` }} /></span>
      <b className={s > 0 ? 'good' : s < 0 ? 'bad' : ''}>{s > 0 ? '+' : ''}{s}</b>
    </span>
  );
}

/** Score, aims and terms of our war with `foe`, under its row in the Situation panel. */
export function WarStory({ g, me, foe }: { g: GameState; me: number; foe: number }) {
  const w = warBetween(g, me, foe), ui = useUi.getState;
  if (!w) return <p className="war-aim muted">{t('No battle fought yet: the war has not really begun.')}</p>;
  const i = sideOf(w, me), mine = w.aims[i], theirs = w.aims[1 - i];
  return (
    <div className="war-story">
      <div className="war-sc"><small>{tn('War score · since {0}', { raw: dateStr(w.day0) })}</small><ScoreBar s={warScore(w, me)} /></div>
      <p className="war-aim">
        <small>{t('Our aim')}</small>{w.opts[i] ? <button className="lnk" onClick={() => { click(); ui().setPanel('staff'); }}>{t('Choose a war aim in the Inbox')}</button>
          : mine ? <span className={mine.res === 1 ? 'good' : mine.res === -1 ? 'bad' : ''}>{aimText(mine, foe)} · {aimReward(mine)}</span> : '–'}
      </p>
      <p className="war-aim"><small>{t('Their aim')}</small>{theirs ? <span>{aimText(theirs, me)}</span> : <span className="muted">{t('Unknown. An agent of ours in their land would find out.')}</span>}</p>
      {w.offer && <p className="war-aim"><small>{t('Peace')}</small><button className="lnk" onClick={() => { click(); ui().setPanel('staff'); }}>{t('Terms are on the table: see the Inbox')}</button></p>}
    </div>
  );
}

// ---------------------------------------------------------------- inbox

/** Aims waiting to be chosen and peace terms waiting for our answer, as Inbox items. */
export function storyInbox(g: GameState, me: number, send: (c: Parameters<ReturnType<typeof useUi.getState>['order']>[0]) => boolean): InboxItem[] {
  const out: InboxItem[] = [];
  for (const w of g.wars ?? []) {
    if (w.end || (w.a !== me && w.b !== me)) continue;
    const i = sideOf(w, me), foe = i === 0 ? w.b : w.a, opts = w.opts[i];
    if (opts && w.due !== undefined) out.push({
      key: 'aim' + w.id + '-' + w.won?.[i] + '-' + opts.length + '-' + opts[0].until, src: 'war', urg: 1, at: w.due - WAR.choose, exp: w.due, from: w.due - WAR.choose,
      title: t('War with {0}: choose a war aim', F(foe)),
      why: t('Reached, an aim pays out and counts for the war score; missed, it costs {0} war weariness. Unchosen, the War Office picks the first.', WAR.missWW),
      region: opts[0].region,
      rows: opts.map(o => [aimShort(o), `${aimText(o, foe)} · ${aimReward(o)}`] as [string, string]),
      opts: opts.map((o, k) => ({ label: aimShort(o), primary: k === 0, run: () => send({ t: 'aim', war: w.id, k }) })), y: 0,
    });
    const o = w.offer;
    if (o) {
      const won = o.win === me, said = o.yes.includes(me), they = o.yes.includes(foe), s = warScore(w, me);
      const yes: Opt = { label: won ? t('Offer these terms') : t('Accept the terms'), primary: true, off: said, run: () => send({ t: 'peace', war: w.id, yes: true }) };
      const no: Opt = { label: t('Fight on'), danger: true, run: () => send({ t: 'peace', war: w.id, yes: false }), title: t('+{0} war weariness', won ? WAR.refuseWinner : WAR.refuseLoser) };
      out.push({
        key: 'peace' + o.id + (said ? 'y' : ''), src: 'war', urg: 1, at: o.exp - WAR.answer, exp: o.exp, from: o.exp - WAR.answer, region: o.region,
        title: won ? t('Peace within reach: {0} is beaten', F(foe)) : t('{0} offers peace terms', Fc(foe)),
        why: said ? t('We have said yes. Waiting for {0}.', F(foe)) : won ? t('Both sides must agree. Peace is never forced, but fighting on costs {0} war weariness.', WAR.refuseWinner)
          : t('Both sides must agree. Peace is never forced, but refusing costs {0} war weariness.', WAR.refuseLoser),
        rows: [
          [t('War score'), `${s > 0 ? '+' : ''}${s}`],
          [t('Region ceded'), o.region !== undefined ? `${nm(R(o.region))} → ${tx(FACTIONS[o.win].short)}` : '–'],
          [t('Production paid'), o.pay ? `${o.pay} → ${tx(FACTIONS[o.win].short)}` : '–'],
          [tx(FACTIONS[foe].short), they ? t('agrees') : t('has not answered')],
        ],
        opts: said ? [no] : [yes, no], y: said ? undefined : 0, n: said ? 0 : 1,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- story settings, moments, the paper

interface Moment { title: string; text: string; tone: 'good' | 'bad' | 'me'; report?: number; region?: number }
interface Story {
  paper: boolean; moments: boolean;
  /** Day of the paper on screen, the last week seen. */
  open: number | null; seen: number;
  moment: Moment | null; at: number;
  set(p: Partial<Pick<Story, 'paper' | 'moments'>>): void;
}
const saved = (() => { try { return JSON.parse(lsGet('f14story') ?? '{}') as Partial<Story>; } catch { return {}; } })();
export const useStory = create<Story>((set, get) => ({
  paper: saved.paper ?? true, moments: saved.moments ?? true, open: null, seen: -1, moment: null, at: -1e9,
  set: (p) => { set(p); lsSet('f14story', JSON.stringify({ paper: get().paper, moments: get().moments })); },
}));

/** Show a moment, at most one a week of game time. */
function moment(g: GameState, m: Moment, sound: Stinger) {
  const s = useStory.getState(); if (!s.moments || g.time - s.at < 20 || useUi.getState().overlay) return;
  useStory.setState({ moment: m, at: g.time }); Sfx.stinger(sound);
}

eventTaps.push((g, e, me) => {
  if (e.k === 'war' && (e.a === me || e.b === me)) {
    const foe = e.a === me ? e.b : e.a;
    if (e.what === 'begins') moment(g, { title: t('War with {0}', F(foe)), text: t('The first battle of the war has begun. Choose a war aim in the Inbox.'), tone: 'me' }, 'declare');
    if (e.what === 'peace') moment(g, e.win === me ? { title: t('Peace with {0}', F(foe)), text: t('They accept our terms.'), tone: 'good', region: e.region } : { title: t('Peace with {0}', F(foe)), text: t('We accept their terms. The guns fall silent on that front.'), tone: 'bad', region: e.region }, e.win === me ? 'triumph' : 'taps');
  }
  if (e.k === 'battleStart' && g.regions[e.region]?.capitalOf >= 0 && (e.defender === me || e.attacker === me)) {
    const cap = g.regions[e.region].capitalOf;
    if (cap === me && e.defender === me) moment(g, { title: t('{0} is threatened', R(e.region)), text: t('{0} attacks our capital.', Fc(e.attacker)), tone: 'bad', region: e.region }, 'siren');
    else if (e.attacker === me && cap !== me) moment(g, { title: t('Before the gates of {0}', R(e.region)), text: t('Our troops attack the capital of {0}.', F(cap)), tone: 'me', region: e.region }, 'declare');
  }
  if (e.k === 'battleEnd' && e.winner !== null && e.winner !== e.prev && (e.winner === me || e.prev === me)) {
    const rep = [...(g.reports ?? [])].reverse().find(r => r.region === e.region);
    if (rep && rep.dur >= WAR.siege) {
      const weeks = Math.round(rep.dur / 20);
      moment(g, e.winner === me ? { title: t('{0} is ours', R(e.region)), text: t('Taken after {0} weeks of fighting.', weeks), tone: 'good', report: rep.id, region: e.region }
        : { title: t('{0} has fallen', R(e.region)), text: t('Lost after {0} weeks of fighting.', weeks), tone: 'bad', report: rep.id, region: e.region }, e.winner === me ? 'triumph' : 'lost');
    }
  }
  if (e.k === 'general' && e.kind === 'star' && e.faction === me) moment(g, { title: t('{0}: the third star', e.name), text: t('Our general has won his third star and a new trait.'), tone: 'good' }, 'victory');
});

const openReports = (id?: number) => { click(); if (id !== undefined) useUi.setState({ reportId: id }); useUi.getState().setOverlay('reports'); };

function MomentCard({ m }: { m: Moment }) {
  const close = () => useStory.setState({ moment: null });
  useEffect(() => { const k = setTimeout(close, 7000); return () => clearTimeout(k); }, [m]);
  return (
    <div className={'moment ' + m.tone} role="alert" onClick={close}>
      <div className="mo-card plate" onClick={e => e.stopPropagation()}>
        <h2>{m.title}</h2><p>{m.text}</p>
        <div className="row">
          {m.region !== undefined && <button className="btn sm" onClick={() => { click(); useUi.getState().select(m.region!); rendererRef.current?.flyTo(m.region!, 22); close(); }}>{t('Show')}</button>}
          {m.report !== undefined && <button className="btn sm" onClick={() => { openReports(m.report); close(); }}>{t('Report')}</button>}
          <button className="btn sm primary" onClick={() => { click(); close(); }}>{t('Continue')}</button>
        </div>
      </div>
    </div>
  );
}

// the paper: each power's own paper is named after its nation; other wars come from the wire
const PAPER = ['The Imperial Herald', 'Le Petit Républicain', 'The Petrograd Courier', 'Berliner Reichsbote', 'Wiener Kaiserblatt', 'The Constantinople Crescent', 'The Liberty Ledger'];
const WIRE = 'International Wire Service';
interface Line { h: string; s?: string; rank: number; region?: number }

/** Headlines for our own paper: victories are big, defeats become orderly withdrawals. */
function ownLine(n: NewsItem, me: number): Line | null {
  const foe = n.a === me ? n.b ?? -1 : n.a, at = n.region;
  switch (n.k) {
    case 'took': return n.a === me ? { h: t('Victory at {0}!', R(at!)), s: n.n ? t('{0} driven out after {1} weeks of siege', Fc(foe), n.n) : t('{0} driven out', Fc(foe)), rank: n.n ? 8 : 6, region: at }
      : { h: t('Orderly withdrawal from {0}', R(at!)), s: t('Our lines shortened to stronger positions'), rank: 5, region: at };
    case 'held': return n.a === me ? { h: t('{0} stands firm', R(at!)), s: t('Attack by {0} beaten back with heavy losses', F(foe)), rank: 3, region: at } : { h: t('Fighting continues before {0}', R(at!)), rank: 2, region: at };
    case 'war': return { h: t('War with {0}!', F(foe)), s: t('The nation stands united'), rank: 9 };
    case 'peace': return n.b === undefined || n.n === undefined ? { h: t('The guns fall silent: truce with {0}', F(foe)), rank: 8 }
      : n.a === me ? { h: t('{0} sues for peace!', Fc(foe)), s: at !== undefined ? t('{0} comes to us', R(at)) : undefined, rank: 10, region: at } : { h: t('Honourable peace concluded with {0}', F(foe)), rank: 9 };
    case 'aim': return n.ok ? { h: t('Campaign against {0} crowned with success', F(foe)), rank: 7, region: at } : null;
    case 'relieved': return { h: t('General {0} retires from command', n.name ?? ''), rank: 2 };
    case 'star': return { h: t('General {0} decorated', n.name ?? ''), rank: 4 };
    case 'strike': return { h: t('Labour dispute in {0}', R(at!)), rank: 1, region: at };
    case 'rising': return n.b === me ? { h: t('{0} declares for us', R(at!)), rank: 6, region: at } : { h: t('Disturbances in {0}', R(at!)), rank: 3, region: at };
    case 'op': return n.ok ? { h: t('Operation {0} crowned with success at {1}', n.name ?? '', R(at!)), rank: 7, region: at } : { h: t('Operation {0}: heavy fighting at {1}', n.name ?? '', R(at!)), rank: 3, region: at };
    default: return null;
  }
}
/** The wire service: other powers' wars, dry. */
function wireLine(n: NewsItem): Line | null {
  const at = n.region;
  switch (n.k) {
    case 'took': return { h: n.n ? t('{0} takes {1} from {2} after a {3}-week siege', Fc(n.a), R(at!), F(n.b!), n.n) : t('{0} takes {1} from {2}', Fc(n.a), R(at!), F(n.b!)), rank: n.n ? 7 : 5, region: at };
    case 'held': return { h: t('{0} repulses an attack by {1} at {2}', Fc(n.a), F(n.b!), R(at!)), rank: 2, region: at };
    case 'war': return { h: t('Fighting breaks out between {0} and {1}', F(n.a), F(n.b!)), rank: 6 };
    case 'peace': return { h: n.n === undefined ? t('{0} and {1} agree to stop fighting', Fc(n.a), F(n.b!)) : at !== undefined ? t('{0} and {1} sign peace; {2} ceded', Fc(n.a), F(n.b!), R(at)) : t('{0} and {1} sign peace', Fc(n.a), F(n.b!)), rank: 8 };
    case 'strike': return { h: t('Strikes reported in {0}', R(at!)), rank: 1, region: at };
    case 'rising': return { h: t('{0} breaks away from {1}', R(at!), F(n.a)), rank: 4, region: at };
    case 'elim': return { h: t('{0} has ceased to exist as a power', Fc(n.a)), rank: 10 };
    default: return null;
  }
}
export function paperOf(items: NewsItem[], me: number): { own: Line[]; wire: Line[] } {
  const own: Line[] = [], wire: Line[] = [];
  for (const n of items) {
    const l = n.a === me || n.b === me ? ownLine(n, me) : wireLine(n);
    if (l) (n.a === me || n.b === me ? own : wire).push(l);
  }
  const top = (x: Line[], k: number) => x.sort((a, b) => b.rank - a.rank).slice(0, k);
  return { own: top(own, 5), wire: top(wire, 4) };
}

export function Paper({ day, items, me, onClose }: { day: number; items: NewsItem[]; me: number; onClose?: () => void }) {
  const { own, wire } = paperOf(items, me), [lead, ...rest] = own;
  const go = (r?: number) => { if (r === undefined) return; click(); useUi.getState().select(r); rendererRef.current?.flyTo(r, 22); };
  return (
    <div className="paper">
      <div className="pp-mast"><b>{PAPER[me] ?? PAPER[0]}</b><small>{dateStr(day)}</small>{onClose && <button className="x" aria-label={t('Close')} onClick={onClose}><CloseIcon /></button>}</div>
      {lead ? <button className="pp-lead" onClick={() => go(lead.region)}><b>{lead.h}</b>{lead.s && <small>{lead.s}</small>}</button> : <p className="pp-quiet">{t('A quiet week on our fronts.')}</p>}
      {rest.map((l, k) => <button key={k} className="pp-it" onClick={() => go(l.region)}><b>{l.h}</b>{l.s && <small> – {l.s}</small>}</button>)}
      {wire.length > 0 && <div className="pp-wire"><small>{t(WIRE)}</small>{wire.map((l, k) => <button key={k} className="pp-it wire" onClick={() => go(l.region)}>{l.h}.</button>)}</div>}
    </div>
  );
}

let lastSession: unknown = null;
/** The paper when a new week comes in, and moments. */
export function StoryWatcher() {
  const sim = useSim(); const st = useStory(); const overlay = useUi(s => s.overlay);
  const last = sim?.g.news?.at(-1);
  useEffect(() => {
    if (!sim) return;
    // what was already in the news when the game was loaded comes without a paper
    if (sim.session !== lastSession) { lastSession = sim.session; useStory.setState({ seen: last?.day ?? sim.g.day, open: null, moment: null, at: -1e9 }); return; }
    if (st.seen < 0) { useStory.setState({ seen: last?.day ?? sim.g.day }); return; }
    if (!last || last.day <= st.seen) return;
    const { own, wire } = paperOf(last.items, sim.me);
    useStory.setState({ seen: last.day, open: st.paper && (own.length || wire.length) ? last.day : st.open });
  });
  if (!sim) return null;
  const week = st.open !== null ? sim.g.news?.find(n => n.day === st.open) : undefined;
  return <>
    {week && !overlay && (
      <div id="paper-card" className="plate">
        <Paper day={week.day} items={week.items} me={sim.me} onClose={() => { click(); useStory.setState({ open: null }); }} />
        <div className="row pp-acts">
          <button className="btn sm" onClick={() => { useStory.setState({ open: null }); openReports(); }}>{t('Reports')}</button>
          <label className="pp-off"><input type="checkbox" checked={st.paper} onChange={e => st.set({ paper: e.target.checked })} /> {t('Every week')}</label>
        </div>
      </div>
    )}
    {st.moment && !overlay && <MomentCard m={st.moment} />}
  </>;
}

/** The last weeks' papers and the story settings, at the top of the Reports sheet. */
export function PaperArchive() {
  const sim = useSim(); const st = useStory();
  if (!sim) return null;
  const weeks = [...(sim.g.news ?? [])].reverse().filter(w => w.items.length);
  return (
    <div className="pp-arch">
      <div className="row pp-set">
        <label><input type="checkbox" checked={st.paper} onChange={e => st.set({ paper: e.target.checked })} /> {t('Newspaper every week')}</label>
        <label><input type="checkbox" checked={st.moments} onChange={e => st.set({ moments: e.target.checked })} /> {t('Cards for the big moments')}</label>
      </div>
      {weeks.length ? <div className="pp-list">{weeks.slice(0, 2).map(w => <Paper key={w.day} day={w.day} items={w.items} me={sim.me} />)}</div> : <p className="note">{t('No news yet.')}</p>}
    </div>
  );
}
