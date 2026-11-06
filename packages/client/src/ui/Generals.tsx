// Generals (design-play §3.1–3.2): who runs each front, the free generals, appointing one, and relieving one. A power has
// only so many generals; the simulation keeps them in FactionState.gen (sim/generals.ts).
import { useState } from 'react';
import {
  FACTIONS, GEN, MANDATES, TICK_SECONDS, TRAITS, buildWorld, frontLevels, isBad, nextGeneral, stars as starsOf,
  type FrontInfo, type GameState, type General, type Hq,
} from '@riskrts/shared';
import { useUi } from '../game/store';
import { click } from './actions';
import { nm } from './format';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';
import { rendererRef } from './refs';
import { MAND, hqName } from './Staff';

const send = (cmd: Parameters<ReturnType<typeof useUi.getState>['order']>[0]) => useUi.getState().order(cmd);

/** The power's fronts with their levels (as cheap as the danger count the left rail works out every render). */
export const frontsOf = (g: GameState, me: number): FrontInfo[] => frontLevels(g, me);

/** A short name for a front: its two biggest regions by hostile borders, or one. */
export function frontName(fr: FrontInfo): string {
  const W = buildWorld(), r = fr.regions.map(id => nm(W.regions[id].name));
  return r.length > 2 ? tn('{0}, {1} and {2} more', { raw: r[0] }, { raw: r[1] }, r.length - 2) : r.join(' · ');
}

/** Weeks until the next general, and why. */
export function nextGeneralText(g: GameState, me: number): string {
  const n = nextGeneral(g, me); if (!n) return '';
  const wk = Math.max(1, Math.ceil((n.at - g.time) / TICK_SECONDS));
  return n.why === 'year' ? tn(wk === 1 ? 'with the new year, in {0} week' : 'with the new year, in {0} weeks', wk)
    : tn(wk === 1 ? 'a replacement, in {0} week' : 'a replacement, in {0} weeks', wk);
}

/** Why no army can be formed right now, or undefined when a general is free. For buttons. */
export function noGeneralText(g: GameState, me: number): string | undefined {
  const G = g.factions[me]?.gen; if (!G || G.pool.length) return undefined;
  return `${t('No general free')} · ${t('next: {0}', nextGeneralText(g, me))}`;
}

/** A small monogram in the power's colour, with his stars below. */
export function Portrait({ x, f }: { x: General; f: number }) {
  const parts = x.name.replace(/^(Gen\.|Gén\.|GdI)\s+/, '').split(/\s+/).filter(w => !/^(von|Bey|Paşa)$/.test(w));
  const ini = ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  return <span className="gport" style={{ '--c': FACTIONS[f].color } as React.CSSProperties} aria-hidden="true"><b>{ini}</b><i>{'★'.repeat(starsOf(x)) || '·'}</i></span>;
}

/** His traits as tags (bad ones marked) and his stars. */
export function GenTags({ x }: { x: General }) {
  const s = starsOf(x);
  return (
    <span className="gtags">
      {x.tr.filter((k, i, a) => a.indexOf(k) === i).map(k => <span key={k} className={'tag' + (isBad(k) ? ' bad' : '')} title={tx(TRAITS[k].desc)}>{tx(TRAITS[k].name)}</span>)}
      <span className="oc-xp" title={t('Stars: three battles won on his front bring one. At three stars he loses a bad trait or gains a new one.')}>{s ? '★'.repeat(s) : t('new to command')}</span>
    </span>
  );
}

/** Pick one of the free generals (only shown when there is a choice). */
export function GenPick({ g, me, value, onChange }: { g: GameState; me: number; value: number | undefined; onChange: (id: number) => void }) {
  const pool = g.factions[me]?.gen?.pool ?? [];
  if (pool.length < 2) return null;
  return (
    <select className="sel" aria-label={t('General')} value={value ?? best(pool)?.id ?? ''} onChange={e => onChange(+e.target.value)}>
      {pool.map(x => <option key={x.id} value={x.id}>{x.name} · {x.tr.map(k => tx(TRAITS[k].name)).join(', ')}{starsOf(x) ? ' ' + '★'.repeat(starsOf(x)) : ''}</option>)}
    </select>
  );
}
const best = (pool: General[]) => [...pool].sort((a, b) => b.xp - a.xp)[0];

const LEVEL: Record<FrontInfo['level'], string> = { cmd: 'Commander', you: 'You', auto: 'Auto' };
const LEVEL_TIP: Record<FrontInfo['level'], string> = {
  cmd: 'An army runs this front: its general shifts corps, digs in and asks you for men and attacks.',
  you: 'You run this front corps by corps. Nothing happens here while you look away.',
  auto: 'The regions run this front by themselves: they refill their border posts, but never attack and react late to massing.',
};

/** One front: its level, and "Appoint a commander" when no army runs it (design-play §3.1). */
export function FrontRow({ g, me, fr }: { g: GameState; me: number; fr: FrontInfo }) {
  const [gen, setGen] = useState<number | undefined>(undefined);
  const ui = useUi.getState, h = fr.hq !== undefined ? (g.hq ?? []).find(x => x.id === fr.hq) : undefined, none = noGeneralText(g, me);
  const go = () => { click(); rendererRef.current?.flyTo(fr.regions[Math.floor(fr.regions.length / 2)], 34); };
  return (
    <div className={'front lv-' + fr.level}>
      <button className="front-h" onClick={go} title={t(LEVEL_TIP[fr.level])}>
        <span className={'flv ' + fr.level}>{t(LEVEL[fr.level])}</span>
        <span className="front-n"><b>{frontName(fr)}</b><small>{t(fr.borders === 1 ? '{0} hostile border' : '{0} hostile borders', fr.borders)}{fr.corps ? ' · ' + t('{0} corps without an army', fr.corps) : ''}</small></span>
      </button>
      {h ? (
        <button className="lnk front-c" onClick={() => { click(); ui().selectArmy(h.id); }}>{hqName(h)} · {h.cmd.name} · {t(MAND[h.mandate])}</button>
      ) : (
        <div className="front-a">
          <GenPick g={g} me={me} value={gen} onChange={setGen} />
          <button className="btn sm" disabled={!!none} title={none ?? t('An army takes over this front with the {0} corps there that are in no army. Its general holds the line and asks you for what he needs.', fr.corps)}
            onClick={() => { click(); if (send({ t: 'army', corps: [], front: fr.regions, gen })) openNewest(me); }}>{t('Appoint a commander')}</button>
        </div>
      )}
    </div>
  );
}

export function openNewest(me: number) { const a = (useUi.getState().session?.state.hq ?? []).filter(x => x.owner === me).slice(-1)[0]; if (a) useUi.getState().selectArmy(a.id); }

/** The fronts list for the Situation panel. */
export function FrontsList({ g, me }: { g: GameState; me: number }) {
  const fr = frontsOf(g, me);
  const G = g.factions[me]?.gen;
  return (
    <>
      <div className="lbl"><span>{t('Fronts')}</span>{G && <small title={t('Every army needs a general. One more comes each new war year and for every 3 battles your armies win.')}>{t('Generals: {0} free of {1}', G.pool.length, G.slots)}</small>}</div>
      {G && !G.pool.length && fr.some(x => x.level !== 'cmd') && <p className="note front-w">{noGeneralText(g, me)}. {t('Relieve or disband an army to free one.')}</p>}
      {fr.length ? fr.map(x => <FrontRow key={x.regions.join(',')} g={g} me={me} fr={x} />) : <p className="note">{t('No front: none of our land borders faces a power at war with us.')}</p>}
    </>
  );
}

/** The generals of the power for the Forces panel: in command, free, and when the next one comes. */
export function GeneralsRoster({ g, me }: { g: GameState; me: number }) {
  const G = g.factions[me]?.gen; if (!G) return null;
  const ui = useUi.getState, mine = (g.hq ?? []).filter(h => h.owner === me);
  return (
    <>
      <div className="lbl"><span>{t('Generals')}</span><small>{t('{0} in command · {1} free · {2} slots', mine.length, G.pool.length, G.slots)}</small></div>
      {mine.map(h => (
        <button key={'g' + h.id} className="oob-c gen" onClick={() => { click(); ui().selectArmy(h.id); }}>
          <Portrait x={h.cmd} f={me} /><span className="oc-n"><b>{h.cmd.name}</b><small>{hqName(h)}</small><GenTags x={h.cmd} /></span>
        </button>
      ))}
      {G.pool.map(x => (
        <div key={'p' + x.id} className="oob-c gen free"><Portrait x={x} f={me} /><span className="oc-n"><b>{x.name}</b><small>{t('free · waiting for an army')}</small><GenTags x={x} /></span></div>
      ))}
      <p className="note">{G.due.length ? t('{0} captured, replacement on the way.', G.due.length) + ' ' : ''}{t('Next general: {0}. Another comes for every 3 battles your armies win ({1} of 3 so far).', nextGeneralText(g, me), G.wins % GEN.wins)}</p>
    </>
  );
}

/** Relieving a general, with what it costs and who takes over (design-play §3.2). */
export function RelieveBox({ g, me, h, onDone }: { g: GameState; me: number; h: Hq; onDone: () => void }) {
  const [gen, setGen] = useState<number | undefined>(undefined);
  const pool = g.factions[me]?.gen?.pool ?? [];
  return (
    <div className="relieve" role="group" aria-label={t('Relieve')}>
      <p>{tn('Relieve {0}?', { raw: h.cmd.name })} {t('War weariness +{0}. His corps lose {1} morale at once, and for {2} weeks their morale stays below {3} % of its ceiling.', GEN.relieveWw, GEN.relieveMor, GEN.shakenWeeks, Math.round(GEN.shakenMor * 100))}</p>
      <div className="lv-row"><span className="lv-l">{t('Successor')}</span>
        <select className="sel" value={gen ?? -1} onChange={e => setGen(+e.target.value < 0 ? undefined : +e.target.value)} aria-label={t('Successor')}>
          <option value={-1}>{t('A new general (traits unknown)')}</option>
          {pool.map(x => <option key={x.id} value={x.id}>{x.name} · {x.tr.map(k => tx(TRAITS[k].name)).join(', ')}{starsOf(x) ? ' ' + '★'.repeat(starsOf(x)) : ''}</option>)}
        </select>
      </div>
      <div className="cc-acts">
        <button className="btn sm danger" onClick={() => { click(); if (send({ t: 'relieve', army: h.id, gen })) onDone(); }}>{t('Relieve')}</button>
        <button className="btn sm" onClick={() => { click(); onDone(); }}>{t('Cancel')}</button>
      </div>
    </div>
  );
}

/** The army's mandate in words, for the map banner. */
export const mandateWord = (h: Hq) => t(MAND[h.mandate] ?? MANDATES[h.mandate]);
