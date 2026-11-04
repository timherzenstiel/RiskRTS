// Shown when the camera is zoomed into a fight: both sides, survivors, defender marked.
import { useEffect } from 'react';
import { FACTIONS, battleCounts, buildWorld } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { rendererRef } from './refs';

export function BattleCard() {
  const sim = useSim();
  const id = rendererRef.current?.battleInFocus() ?? null;
  const b = sim && id !== null ? sim.g.battles.find(x => x.id === id) : undefined;
  useEffect(() => { if (b) useUi.getState().advanceTut(4); }, [b]);
  if (!sim || !b) return null;
  const owner = sim.g.regions[b.region].owner;
  const counts = [...battleCounts(b)];
  return (
    <div id="bcard" className="glass" aria-live="polite">
      <div className="bt"><b>Battle of {buildWorld().regions[b.region].name}</b><small>{b.ended ? 'Over' : `${Math.floor(b.age)} s`}</small></div>
      {counts.map(([f, [alive, all]]) => (
        <div className="side" key={f}>
          <span className="nm"><i className="dot" style={{ '--c': FACTIONS[f].color } as React.CSSProperties} />{FACTIONS[f].short}{f === owner ? ' · def.' : ''}</span>
          <span className="sb" style={{ '--c': FACTIONS[f].color } as React.CSSProperties}><i style={{ width: `${all ? alive / all * 100 : 0}%` }} /></span>
          <span className="n">{alive}/{all}</span>
        </div>
      ))}
    </div>
  );
}
