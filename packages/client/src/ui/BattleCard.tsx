// Shown when the camera is zoomed into a fight: both sides, survivors, defender marked.
import { useEffect } from 'react';
import { FACTIONS, battleCounts, buildWorld } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { rendererRef } from './refs';
import { FrontControls } from './FrontCard';

export function BattleCard() {
  const sim = useSim();
  const id = rendererRef.current?.battleInFocus() ?? null;
  const b = sim && id !== null ? sim.g.battles.find(x => x.id === id) : undefined;
  useEffect(() => { if (b) useUi.getState().advanceTut(4); }, [b]);
  if (!sim || !b) return null;
  const owner = sim.g.regions[b.region].owner, W = buildWorld();
  const counts = [...battleCounts(b)];
  const quiet = b.age - (b.lastJoin ?? 0) > 60;
  const works = [b.tr ? `trench ${['', 'I', 'II', 'III'][b.tr]}` : '', b.sand ? 'sandbags' : '', b.wire > 0 ? `wire ${Math.round(b.wire / Math.max(1, b.wire0) * 100)}%` : ''].filter(Boolean).join(' · ');
  return (
    <div id="bcard" className="glass" aria-live="polite">
      <div className="bt"><b>Battle of {W.regions[b.region].name}</b><small>{b.ended ? 'Over' : `${Math.floor(b.age)} s${quiet ? ' · trench warfare' : ''}`}</small></div>
      <div className="bf"><small>{b.from >= 0 ? `${W.regions[b.from].name} border` : 'Inside the region'}{works ? ` · ${works}` : ''}</small></div>
      {counts.map(([f, [alive, all]]) => (
        <div className="side" key={f}>
          <span className="nm"><i className="dot" style={{ '--c': FACTIONS[f].color } as React.CSSProperties} />{FACTIONS[f].short}{f === owner ? ' · def.' : ''}</span>
          <span className="sb" style={{ '--c': FACTIONS[f].color } as React.CSSProperties}><i style={{ width: `${all ? alive / all * 100 : 0}%` }} /></span>
          <span className="n">{alive}/{all}{b.mor?.[f] !== undefined ? <small> · {Math.round(b.mor[f])}%</small> : null}</span>
        </div>
      ))}
      {!b.ended && <FrontControls g={sim.g} me={sim.me} b={b} />}
    </div>
  );
}
