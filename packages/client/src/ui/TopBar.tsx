// Top strip: sealed orders, radio dispatch ticker, phosphor counters (supply, shells, men, weariness), powers, date, speed, menu.
import { useEffect, useRef, useState } from 'react';
import { FACTIONS, NATIONS, TICK_SECONDS, WEATHER, convoyIn, income, missionFrac, missionText, poolGrowth, shellIncome, weatherAt } from '@riskrts/shared';
import { dateStr, useSim, useUi } from '../game/store';
import { buildWorld } from '@riskrts/shared';
import { GuestSession } from '../game/session';
import { click } from './actions';
import { Sfx } from '../audio/sfx';
import { Scoreboard } from './Scoreboard';
import { rendererRef } from './refs';
import { HandshakeIcon, MenuIcon, PauseIcon } from './icons';

const SPEEDS = [1, 2, 4];

/** Phosphor counter; the value rolls in when it changes. */
function Lcd({ label, value, plus, cls, title, onClick }: { label: string; value: string | number; plus?: string | number; cls?: string; title: string; onClick?: () => void }) {
  const body = <><small>{label}</small><span className="lcd-w"><b key={String(value)}>{value}</b>{plus !== undefined && <i>+{plus}</i>}</span></>;
  return onClick
    ? <button className={'lcd ' + (cls ?? '')} title={title} onClick={onClick}>{body}</button>
    : <div className={'lcd ' + (cls ?? '')} title={title}>{body}</div>;
}

/** War weariness as a needle gauge: 0 % left, 100 % right. */
function Needle({ v, unrest }: { v: number; unrest: number }) {
  const a = -60 + Math.min(100, Math.max(0, v)) * 1.2;
  return (
    <div className={'needle' + (v >= unrest || v >= 60 ? ' hi' : v >= 30 ? ' mid' : '')} title={`War weariness: how tired your nation is of the war. Losses, conscription and broken treaties raise it; quiet times let it fade. It cuts supply income by up to 30% and lowers morale; above 60% the barracks stop sending volunteers, and above ${unrest} strikes and uprisings begin.`} role="img" aria-label={`War weariness ${Math.round(v)}%`}>
      <svg viewBox="0 0 44 26" aria-hidden="true"><path d="M4 24A18 18 0 0 1 40 24" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="3" /><path d="M29 8.4A18 18 0 0 1 40 24" fill="none" stroke="#c8402e" strokeWidth="3" /><line x1="22" y1="24" x2="22" y2="9" stroke="#e8e0c4" strokeWidth="2" strokeLinecap="round" style={{ transform: `rotate(${a}deg)`, transformOrigin: '22px 24px' }} /></svg>
      <span><small>Weariness</small><b>{Math.round(v)}%</b></span>
    </div>
  );
}

/** Radio dispatch ticker: the newest event, typed out. Clicking it opens the event's region or report. */
function Ticker() {
  const last = useUi(s => s.log[0]);
  useEffect(() => { if (last) Sfx.teletype(); }, [last?.id]);
  if (!last) return <div className="ticker"><span className="tk-t">Awaiting dispatches…</span></div>;
  const open = () => {
    if (last.report !== undefined) { useUi.setState({ reportId: last.report }); useUi.getState().setOverlay('reports'); return; }
    if (last.region !== undefined) { rendererRef.current?.flyTo(last.region, 16); useUi.getState().select(last.region); }
  };
  return (
    <button className={'ticker ' + last.cls} onClick={open} title="Latest dispatch · open the menu for earlier ones">
      <time>{last.day}</time><span key={last.id} className="tk-t">{last.text}</span>
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
  const orders = f.mission ? missionText(f.mission)[0] : 'Awaiting orders';
  const speed = session.speed;
  const men = f.men ?? 0;
  const sel = useUi.getState().sel, at = sel >= 0 ? sel : g.regions.find(r => r.capitalOf === me)?.id ?? 0, w = weatherAt(at, g.day);

  return (
    <header id="top" className="strip">
      <button className="mission" aria-label={g.over ? 'Show the result of the war' : 'Show sealed orders'} onClick={() => { click(); ui().setOverlay(g.over ? 'end' : 'orders'); }}>
        <span className="crest" style={{ '--c': F.color } as React.CSSProperties}>{F.key}</span>
        <span className="mtx"><small>Sealed orders</small><b>{orders}</b>
          <span className="mbar"><i style={{ width: `${(f.mission ? missionFrac(g, f) * 100 : 0).toFixed(1)}%` }} /></span></span>
      </button>
      <Ticker />

      <div className="counters">
        <div key={pulse} className={'lcd sup' + (pulse ? ' pulse' : '')} title={`Supply: the money of the war. Recruiting, building, fortifying and scouting all cost supply. +${income(g, me)} arrives with every convoy (the ring counts down to it): more for more regions, factories and whole continents, less with high war weariness. Cut-off or contested regions pay nothing.`}>
          <div className="ring" style={{ '--p': `${(g.supplyT / TICK_SECONDS * 100).toFixed(1)}%` } as React.CSSProperties} role="img" aria-label={`Next convoy in ${convoyIn(g)} seconds`}><span>{Math.max(0, convoyIn(g))}</span></div>
          <small>Supply</small><span className="lcd-w"><b key={f.supply}>{f.supply}</b><i>+{income(g, me)}</i></span>
        </div>
        <Lcd label="Shells" value={Math.floor(f.shells ?? 0)} plus={shellIncome(g, me)} cls="sh" title="Shells: ammunition for artillery and gun emplacements. Every gun shot in a battle uses some; with none left the guns fall silent. Factories and the capital make more each convoy, and the Build tab turns supply into shells." />
        <Lcd label="Men" value={men >= 10000 ? `${Math.round(men / 1000)}k` : Math.floor(men).toLocaleString('en-GB')} plus={poolGrowth(g, me)} cls={'men' + (men < 300 ? ' hi' : '')}
          title={`Men: the manpower pool. Every new formation takes men from it (an infantry battalion needs 100). +${poolGrowth(g, me)} come in each convoy, a new age class from every home region you still hold, so losing home regions or a long war makes recruits scarce. Raise conscription on the nation screen (click) for more, at the cost of war weariness.`} onClick={() => { click(); ui().setOverlay('nation'); }} />
        <Needle v={f.ww} unrest={NATIONS[me].unrest} />
        <div className="pills" role="group" aria-label="Powers">
          {FACTIONS.map((x, i) => (
            <button key={i} className={'pill' + (i === me ? ' me' : '') + (g.factions[i].alive ? '' : ' dead')} style={{ '--c': x.color } as React.CSSProperties}
              title={x.name} aria-label={`${x.name}: ${counts[i]} regions. Open scoreboard`} aria-expanded={scoreOpen} onClick={() => { click(); ui().toggleScore(); }}>
              <i /><span className="k">{x.key}</span> <span className="c">{counts[i]}</span>
            </button>
          ))}
        </div>
        <Scoreboard />
      </div>

      <div className="right">
        <button id="date" className="lcd datebtn" title="War calendar: unlocks, rushes and doctrines" onClick={() => { click(); ui().setOverlay('calendar'); }}><small>Date</small><span className="lcd-w"><b>{dateStr(g.day)}</b></span></button>
        <span className={'wx w' + w} title={`Weather in ${buildWorld().regions[at].name}: ${WEATHER[w]}${w === 1 ? ' · marches and assaults 30% slower, shells sink into the mud' : w === 2 ? ' · marches 40% slower, cut-off troops wear down twice as fast' : w === 3 ? ' · cut-off troops wear down 50% faster' : ''}`}>{WEATHER[w]}</span>
        {session.canControlTime ? (
          <div className="seg speed" role="group" aria-label="Game speed">
            <button aria-label="Pause" aria-pressed={speed === 0} onClick={() => { click(); ui().setSpeed(0); }}><PauseIcon /></button>
            {session.canChangeSpeed
              ? SPEEDS.map(s => <button key={s} aria-pressed={speed === s} onClick={() => { click(); ui().setSpeed(s); }}>{s}×</button>)
              : <button aria-pressed={speed === 1} title="Against other players the war runs at 1×. 2× and 4× are only for games against computers." onClick={() => { click(); ui().setSpeed(1); }}>1×</button>}
          </div>
        ) : (
          <span className="speedro" title={session instanceof GuestSession && session.spectator ? 'Watching with full vision, a little delayed' : 'The host controls the game speed'}>{session instanceof GuestSession && session.spectator ? 'Spectating' : speed === 0 ? 'Paused' : `${speed}×`}{session instanceof GuestSession && session.ranked ? ' · ranked' : ''}</span>
        )}
        <button className="ico" aria-label="Diplomacy" title="Diplomacy: treaties and messages" onClick={() => { click(); ui().setOverlay('diplomacy'); }}><HandshakeIcon /></button>
        <button className="ico" aria-label="Menu" title="Menu" onClick={() => { click(); ui().setOverlay('menu'); }}><MenuIcon /></button>
      </div>
    </header>
  );
}
