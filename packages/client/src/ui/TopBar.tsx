// Top zone: sealed-orders chip, supply ring + powers pills, clock / speed / menu.
import { useEffect, useRef, useState } from 'react';
import { FACTIONS, NATIONS, TICK_SECONDS, WEATHER, convoyIn, income, missionFrac, missionText, poolGrowth, shellIncome, weatherAt } from '@riskrts/shared';
import { dateStr, useSim, useUi } from '../game/store';
import { buildWorld } from '@riskrts/shared';
import { GuestSession } from '../game/session';
import { click } from './actions';
import { Scoreboard } from './Scoreboard';
import { HandshakeIcon, MenuIcon, PauseIcon } from './icons';

const SPEEDS = [1, 2, 4];

/** Map layer: everything, troops first (markers, front lines), or industry (buildings, rails, supply). */
function LayerPicker() {
  const layer = useUi(s => s.layer), set = useUi.getState().setLayer;
  return (
    <div className="seg layer-seg" role="group" aria-label="Map layer">
      <button aria-pressed={layer === 0} title="Show everything" onClick={() => { click(); set(0); }}>Map</button>
      <button aria-pressed={layer === 1} title="Troops first: corps on the borders, front lines, columns on the move (T)" onClick={() => { click(); set(layer === 1 ? 0 : 1); }}>Troops</button>
      <button aria-pressed={layer === 2} title="Industry: factories, barracks, airfields, rails and supply (B)" onClick={() => { click(); set(layer === 2 ? 0 : 2); }}>Industry</button>
    </div>
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

  return (
    <header id="top">
      <button className="glass mission" aria-label={g.over ? 'Show the result of the war' : 'Show sealed orders'} onClick={() => { click(); ui().setOverlay(g.over ? 'end' : 'orders'); }}>
        <span className="crest" style={{ '--c': F.color } as React.CSSProperties}>{F.key}</span>
        <span className="mtx"><small>Sealed orders</small><b>{orders}</b>
          <span className="mbar"><i style={{ width: `${(f.mission ? missionFrac(g, f) * 100 : 0).toFixed(1)}%` }} /></span></span>
      </button>

      <div className="center">
        <div key={pulse} className={'glass res' + (pulse ? ' pulse' : '')} title="Supply arrives for every power at the same moment">
          <div className="ring" style={{ '--p': `${(g.supplyT / TICK_SECONDS * 100).toFixed(1)}%` } as React.CSSProperties} role="img" aria-label={`Next convoy in ${convoyIn(g)} seconds`}><span>{Math.max(0, convoyIn(g))}</span></div>
          <div className="rv"><small>Supply</small><b>{f.supply}</b></div>
          <div className="ri"><span>+{income(g, me)}</span><small>per convoy</small></div>
          <div className="ww sh" title="Artillery shells in the national stockpile, and what factories and the capital make per convoy. Buy more in the Build tab.">
            <small>Shells</small><b>{Math.floor(f.shells ?? 0)}<i>+{shellIncome(g, me)}</i></b></div>
          <button className={'ww men' + ((f.men ?? 0) < 300 ? ' hi' : '')} title="Manpower pool: men for new formations, and the new age class per convoy. Open the nation screen for conscription." onClick={() => { click(); ui().setOverlay('nation'); }}>
            <small>Men</small><b>{(f.men ?? 0) >= 10000 ? `${Math.round((f.men ?? 0) / 1000)}k` : Math.floor(f.men ?? 0).toLocaleString('en-GB')}<i>+{poolGrowth(g, me)}</i></b></button>
          <div className={'ww' + (f.ww >= NATIONS[me].unrest ? ' hi' : f.ww >= 60 ? ' hi' : f.ww >= 30 ? ' mid' : '')} title="War weariness: casualties wear down the nation. It cuts income by up to 30%, lowers morale and, above 60%, stops volunteers. It fades in quiet times.">
            <small>Weariness</small><b>{Math.round(f.ww)}%</b></div>
        </div>
        <div className="glass pills" role="group" aria-label="Powers">
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
        <div className="glass clock">
          <button id="date" className="datebtn" title="War calendar: unlocks, rushes and doctrines" onClick={() => { click(); ui().setOverlay('calendar'); }}>{dateStr(g.day)}</button>
          {(() => { const sel = useUi.getState().sel, at = sel >= 0 ? sel : g.regions.find(r => r.capitalOf === me)?.id ?? 0, w = weatherAt(at, g.day);
            return <span className={'wx w' + w} title={`Weather in ${buildWorld().regions[at].name}: ${WEATHER[w]}${w === 1 ? ' · marches and assaults 30% slower, shells sink into the mud' : w === 2 ? ' · marches 40% slower, cut-off troops wear down twice as fast' : w === 3 ? ' · cut-off troops wear down 50% faster' : ''}`}>{WEATHER[w]}</span>; })()}
          {session.canControlTime ? (
            <div className="seg" role="group" aria-label="Game speed">
              <button aria-label="Pause" aria-pressed={speed === 0} onClick={() => { click(); ui().setSpeed(0); }}><PauseIcon /></button>
              {SPEEDS.map(s => <button key={s} aria-pressed={speed === s} onClick={() => { click(); ui().setSpeed(s); }}>{s}×</button>)}
            </div>
          ) : (
            <span className="speedro" title={session instanceof GuestSession && session.spectator ? 'Watching with full vision, a little delayed' : 'The host controls the game speed'}>{session instanceof GuestSession && session.spectator ? 'Spectating' : speed === 0 ? 'Paused' : `${speed}×`}{session instanceof GuestSession && session.ranked ? ' · ranked' : ''}</span>
          )}
          <button className="ico" aria-label="Diplomacy" title="Diplomacy: treaties and messages" onClick={() => { click(); ui().setOverlay('diplomacy'); }}><HandshakeIcon /></button>
          <button className="ico" aria-label="Menu" onClick={() => { click(); ui().setOverlay('menu'); }}><MenuIcon /></button>
        </div>
        <div className="glass layers"><LayerPicker /></div>
      </div>
    </header>
  );
}
