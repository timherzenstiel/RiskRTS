// Front command bar: docked along the bottom of the map when the camera is on a fight. Both sides with crests and
// strength bars, then the levers (suppression, wire, shells, barrage lever, over the top, stance, reinforce, withdraw).
import { useEffect } from 'react';
import { FACTIONS, battleCounts, borderLabel, buildWorld } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { rendererRef } from './refs';
import { FrontControls } from './FrontCard';
import { t, tx } from '../i18n';

export function BattleCard() {
  const sim = useSim();
  const id = rendererRef.current?.battleInFocus() ?? null;
  const b = sim && id !== null ? sim.g.battles.find(x => x.id === id) : undefined;
  useEffect(() => { if (b) useUi.getState().advanceTut(4); }, [b]);
  if (!sim || !b) return null;
  const owner = sim.g.regions[b.region].owner, W = buildWorld();
  const counts = [...battleCounts(b)];
  const quiet = b.age - (b.lastJoin ?? 0) > 60;
  const works = [b.tr ? t('trench {0}', ['', 'I', 'II', 'III'][b.tr]) : '', b.sand ? t('sandbags') : '', b.wire > 0 ? t('wire {0}%', Math.round(b.wire / Math.max(1, b.wire0) * 100)) : ''].filter(Boolean).join(' · ');
  return (
    <div id="bcard" className="plate cmdbar" aria-live="polite">
      <div className="cb-sides">
        <div className="bt"><b>{t('Battle of {0}', W.regions[b.region].name)}</b><small className="lcd-t">{b.ended ? t('Over') : `${Math.floor(b.age)} s${quiet ? ' · ' + t('trench warfare') : ''}`}</small></div>
        <div className="bf"><small>{tx(borderLabel(W, b.from))}{b.amph !== undefined && (b.stage ?? 0) === 0 ? ' · ' + t('landing') : ''}{works ? ` · ${works}` : ''}</small></div>
        {counts.map(([f, [alive, all]]) => (
          <div className="side" key={f} style={{ '--c': FACTIONS[f].color } as React.CSSProperties}>
            <span className="nm"><span className="crest sm">{FACTIONS[f].key}</span>{tx(FACTIONS[f].short)}{f === owner ? ' · ' + t('def.') : ''}</span>
            <span className="sb"><i style={{ width: `${all ? alive / all * 100 : 0}%` }} /></span>
            <span className="n">{alive}/{all}{b.mor?.[f] !== undefined ? <small> · {Math.round(b.mor[f])}%</small> : null}</span>
          </div>
        ))}
      </div>
      {!b.ended && <FrontControls g={sim.g} me={sim.me} b={b} />}
    </div>
  );
}
