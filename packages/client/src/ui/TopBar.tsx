// Top strip: sealed orders, radio dispatch ticker, gauges with forecasts (Production, shells, men, home front; design-play
// §4.1), powers, date, speed, menu.
import { useEffect, useRef, useState } from 'react';
import { ECON, FACTIONS, NATIONS, TICK_SECONDS, WEATHER, barrageWeeks, convoyIn, econOf, REPL, WOUNDED, income, incomeTerms, missionFrac, missionText, poolGrowth, poolNet, poolTerms, poolWeeks, shellIncome, shellTerms, unrestIn, weatherAt, wwTrend, type GameState, type Term } from '@riskrts/shared';

/** A breakdown for a tooltip: one line per term, then the total. */
const why = (terms: Term[], unit: string) => '\n\n' + [...terms.map(x => `${x.v >= 0 ? '+' : '−'}${t('{0}', Math.abs(Math.round(x.v * 10) / 10))}  ${tx(x.label)}${x.note ? ` (${tx(x.note)})` : ''}`), `= ${Math.round(terms.reduce((a, x) => a + x.v, 0))} ${unit}`].join('\n');
import { dateStr, useSim, useUi } from '../game/store';
import { buildWorld } from '@riskrts/shared';
import { GuestSession } from '../game/session';
import { click } from './actions';
import { Sfx } from '../audio/sfx';
import { Scoreboard } from './Scoreboard';
import { rendererRef } from './refs';
import { HandshakeIcon, MenuIcon, PauseIcon } from './icons';
import { PauseCall } from './Vote';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';
import { menStr } from './format';

const SPEEDS = [1, 2, 4];

/** Phosphor counter; the value rolls in when it changes. */
function Lcd({ label, value, plus, cls, title, onClick }: { label: string; value: string | number; plus?: string | number; cls?: string; title: string; onClick?: () => void }) {
  const body = <><small>{label}</small><span className="lcd-w"><b key={String(value)}>{value}</b>{plus !== undefined && <i>+{plus}</i>}</span></>;
  return onClick
    ? <button className={'lcd ' + (cls ?? '')} title={title} onClick={onClick}>{body}</button>
    : <div className={'lcd ' + (cls ?? '')} title={title}>{body}</div>;
}

/** One decimal in the interface language. */
const d1 = (x: number) => t('{0}', Math.round(x * 10) / 10);
/** "~3 wk", or "" when it is not coming. */
const weeks = (w: number) => !isFinite(w) ? '' : w < 1 ? t('< 1 wk') : t('~{0} wk', w < 10 ? Math.round(w * 10) / 10 : Math.round(w));

/** The home front (design-play §4.1): war weariness as a bar with the nation's unrest threshold marked, last week's change,
 *  and when unrest comes at the present rate of conscription. */
function HomeFront({ g, me }: { g: GameState; me: number }) {
  const f = g.factions[me], thr = NATIONS[me].unrest, ww = f.ww, week = useUi(s => s.wwWeek);
  const trend = wwTrend(g, me), soon = unrestIn(g, me, Math.max(trend, week ? week[1] - week[0] : trend)), last = week ? week[1] - week[0] : null;
  const cls = ww >= thr ? ' hi' : ww >= thr - 10 ? ' wn' : '';
  const sub = ww >= thr ? t('unrest') : isFinite(soon) ? tn('unrest {0}', { raw: weeks(soon) }) : (last ?? trend) < -.05 ? t('easing') : t('steady');
  const title = [
    t('Home front: how tired your nation is of the war. Losses, conscription and broken treaties raise it; quiet times let it fade. It cuts Production by up to 30% and lowers morale; above 60% the barracks stop sending volunteers, and at {0}% strikes and uprisings begin.', thr),
    '',
    last !== null ? t('Last week: {0}{1} points', last >= 0 ? '+' : '−', d1(Math.abs(last))) : '',
    t('Conscription and doctrine: {0}{1} points a week, before casualties', trend >= 0 ? '+' : '−', d1(Math.abs(trend))),
    isFinite(soon) && ww < thr ? t('At this rate unrest begins in about {0} weeks.', Math.max(1, Math.round(soon))) : '',
  ].filter(Boolean).join('\n');
  return (
    <button className={'lcd home' + cls} title={title} onClick={() => { click(); useUi.getState().setPanel('economy'); }}>
      <small>{t('Home front')}</small>
      <span className="lcd-w"><b>{Math.round(ww)}%</b><i>{last !== null && Math.abs(last) >= .1 ? (last > 0 ? '▲ ' : '▼ ') : ''}{sub}</i></span>
      <span className="hf-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, ww)}%` }} /><em style={{ left: `${thr}%` }} /></span>
    </button>
  );
}

/** Radio dispatch ticker: the newest event, typed out. Clicking it opens the event's region or report. */
function Ticker() {
  const last = useUi(s => s.log[0]);
  useEffect(() => { if (last) Sfx.teletype(); }, [last?.id]);
  if (!last) return <div className="ticker"><span className="tk-t">{t('Awaiting dispatches…')}</span></div>;
  const open = () => {
    if (last.report !== undefined) { useUi.setState({ reportId: last.report }); useUi.getState().setOverlay('reports'); return; }
    if (last.region !== undefined) { rendererRef.current?.flyTo(last.region, 16); useUi.getState().select(last.region); }
  };
  return (
    <button className={'ticker ' + last.cls} onClick={open} title={t('Latest dispatch · open the menu for earlier ones')}>
      <time>{(last.day)}</time><span key={last.id} className="tk-t">{tx(last.text)}</span>
    </button>
  );
}

export function TopBar() {
  const sim = useSim(); const scoreOpen = useUi(s => s.scoreOpen);
  const [pulse, setPulse] = useState(0); const prevT = useRef(0);
  const supplyT = sim?.g.supplyT ?? 0;
  useEffect(() => { if (supplyT < prevT.current - 1) setPulse(p => p + 1); prevT.current = supplyT; }, [supplyT]);
  if (!sim) return null;
  const { g, me, session } = sim; const f = g.factions[me]; const F = FACTIONS[me];
  const counts = FACTIONS.map((_, i) => g.regions.filter(r => r.owner === i).length);
  const ui = useUi.getState;
  const orders = f.mission ? tx(missionText(f.mission)[0]) : t('Awaiting orders');
  const speed = session.speed;
  const men = f.men ?? 0, inc = income(g, me), idle = f.supply > Math.max(30, inc * 4), pw = poolWeeks(g, me), pn = poolNet(g, me);
  const sel = useUi.getState().sel, at = sel >= 0 ? sel : g.regions.find(r => r.capitalOf === me)?.id ?? 0, w = weatherAt(at, g.day);

  return (
    <header id="top" className="strip">
      <button className="mission" aria-label={g.over ? t('Show the result of the war') : t('Show sealed orders')} onClick={() => { click(); ui().setOverlay(g.over ? 'end' : 'orders'); }}>
        <span className="crest" style={{ '--c': F.color } as React.CSSProperties}>{F.key}</span>
        <span className="mtx"><small>{t('Sealed orders')}</small><b>{orders}</b>
          <span className="mbar"><i style={{ width: `${(f.mission ? missionFrac(g, f) * 100 : 0).toFixed(1)}%` }} /></span></span>
      </button>
      <Ticker />

      <div className="counters">
        <div key={pulse} className={'lcd sup' + (pulse ? ' pulse' : '') + (idle ? ' wn' : '')} title={t('Production: what the war runs on. Recruiting, building, fortifying and scouting all cost Production. +{0} comes in every week (the ring counts down to the next): more for more regions, factories and whole continents, less with high war weariness. Cut-off or contested regions pay nothing.', income(g, me)) + (idle ? '\n\n' + t('More than four weeks of income lie unspent: recruit, fortify or build.') : '') + why(incomeTerms(g, me), t('per week'))}>
          <div className="ring" style={{ '--p': `${(g.supplyT / TICK_SECONDS * 100).toFixed(1)}%` } as React.CSSProperties} role="img" aria-label={t('Next week in {0} seconds', convoyIn(g))}><span>{Math.max(0, convoyIn(g))}</span></div>
          <small>{t('Production')}</small><span className="lcd-w"><b key={f.supply}>{f.supply}</b><i>+{income(g, me)}</i></span>
        </div>
        {(() => { const wk = barrageWeeks(g, me), wn = isFinite(wk) ? (wk < 10 ? Math.round(wk * 10) / 10 : Math.round(wk)) : null; return (
          <Lcd label={wn !== null ? t('Shells · ~{0} wk', wn) : t('Shells')} value={Math.floor(f.shells ?? 0)} plus={shellIncome(g, me)} cls={'sh' + (isFinite(wk) && wk < 2 ? ' hi' : '')}
            title={t('Shells: ammunition for artillery and gun emplacements. Every gun shot in a battle uses some; with none left the guns fall silent.') + ' ' + (wn !== null ? t('The stock lasts about {0} weeks of light barrage from every battery.', wn) + ' ' : '') + t("The war economy lever (Economy panel, now {0}) decides how much of the factories' output goes to shells.", ECON[econOf(f)].name) + why(shellTerms(g, me), t('shells per week'))} />
        ); })()}
        <Lcd label={isFinite(pw) ? t('Men · {0}', weeks(pw)) : t('Men')} value={men >= 10000 ? `${Math.round(men / 1000)}k` : menStr(Math.floor(men))} plus={poolGrowth(g, me)} cls={'men' + (men < 300 || pw < 5 ? ' hi' : '')}
          title={t('Men: the manpower pool. New formations take men from it (an infantry battalion needs 100) and train for a week; replacements for under-strength corps (up to {0} % a week) come from it too, and {1} % of the casualties return to it after {2} weeks. +{3} come in each week, a new age class from every home region you still hold. Raise conscription in the Economy panel (click) for more, at the cost of war weariness.', Math.round(REPL.share * 100), Math.round(WOUNDED.share * 100), WOUNDED.days / 7, poolGrowth(g, me)) + '\n\n' + t('Next week: +{0} age class, +{1} wounded back, −{2} replacements = {3}', pn.growth, pn.back, pn.repl, (pn.net >= 0 ? '+' : '−') + Math.abs(pn.net)) + (isFinite(pw) ? '\n' + t('At this drain the pool lasts about {0} weeks (recruiting comes on top).', Math.max(1, Math.round(pw))) : '') + why(poolTerms(g, me), t('men per week'))} onClick={() => { click(); ui().setPanel('economy'); }} />
        <HomeFront g={g} me={me} />
        <div className="pills" role="group" aria-label={t('Powers')}>
          {FACTIONS.map((x, i) => (
            <button key={i} className={'pill' + (i === me ? ' me' : '') + (g.factions[i].alive ? '' : ' dead')} style={{ '--c': x.color } as React.CSSProperties}
              title={tx(x.name)} aria-label={t('{0}: {1} regions. Open scoreboard', x.name, counts[i])} aria-expanded={scoreOpen} onClick={() => { click(); ui().toggleScore(); }}>
              <i /><span className="k">{x.key}</span> <span className="c">{counts[i]}</span>
            </button>
          ))}
        </div>
        <Scoreboard />
      </div>

      <div className="right">
        <button id="date" className="lcd datebtn" title={t('War calendar: unlocks, rushes and doctrines')} onClick={() => { click(); ui().setOverlay('calendar'); }}><small>{t('Date')}</small><span className="lcd-w"><b>{(dateStr(g.day))}</b></span></button>
        <span className={'wx w' + w} title={t('Weather in {0}: {1}', buildWorld().regions[at].name, WEATHER[w]) + (w === 1 ? ' · ' + t('marches and assaults 30% slower, shells sink into the mud') : w === 2 ? ' · ' + t('marches 40% slower, cut-off troops wear down twice as fast') : w === 3 ? ' · ' + t('cut-off troops wear down 50% faster') : '')}>{tx(WEATHER[w])}</span>
        {session.canControlTime ? (
          <div className="seg speed" role="group" aria-label={t('Game speed')}>
            <button aria-label={t('Pause')} aria-pressed={speed === 0} onClick={() => { click(); ui().setSpeed(0); }}><PauseIcon /></button>
            {session.canChangeSpeed
              ? SPEEDS.map(s => <button key={s} aria-pressed={speed === s} onClick={() => { click(); ui().setSpeed(s); }}>{s}×</button>)
              : <button aria-pressed={speed === 1} title={t('Against other players the war runs at 1×. 2× and 4× are only for games against computers.')} onClick={() => { click(); ui().setSpeed(1); }}>1×</button>}
          </div>
        ) : (
          <span className="speedro" title={session instanceof GuestSession && session.spectator ? t('Watching with full vision, a little delayed') : t('The host controls the game speed')}>{session instanceof GuestSession && session.spectator ? t('Spectating') : speed === 0 ? t('Paused') : `${speed}×`}{session instanceof GuestSession && session.ranked ? ' · ' + t('ranked') : ''}</span>
        )}
        <PauseCall />
        <button className="ico" aria-label={t('Diplomacy')} title={t('Diplomacy: treaties and messages')} onClick={() => { click(); ui().setOverlay('diplomacy'); }}><HandshakeIcon /></button>
        <button className="ico" aria-label={t('Menu')} title={t('Menu')} onClick={() => { click(); ui().setOverlay('menu'); }}><MenuIcon /></button>
      </div>
    </header>
  );
}
