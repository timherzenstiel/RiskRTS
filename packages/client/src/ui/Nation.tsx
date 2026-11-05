// National character: the power's own unit, strengths and weaknesses; in game also manpower, mobilisation and unrest.
import { FACTIONS, FORMATION, NATIONS, MANPOWER, buildWorld, monthStr, poolGrowth } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { Modal } from './Modal';
import { menStr } from './format';

/** Unit, strengths and weaknesses of a power (lobby and in game). */
export function NationCard({ f, compact }: { f: number; compact?: boolean }) {
  const N = NATIONS[f], F = FACTIONS[f];
  return (
    <div className={'nation' + (compact ? ' compact' : '')} style={{ '--c': F.color } as React.CSSProperties}>
      <div className="nu"><small>National unit{N.from !== undefined ? ` · from ${monthStr(N.from)}` : ''}</small><b>{N.unitName}</b><span>{N.unitDesc}</span></div>
      <div className="nt">
        <div><small>Strengths</small>{N.strengths.map(t => <p key={t.name}><b>{t.name}.</b> {t.desc}</p>)}</div>
        <div><small>Weaknesses</small>{N.weaknesses.map(t => <p key={t.name} className="weak"><b>{t.name}.</b> {t.desc}</p>)}</div>
      </div>
      {!compact && <p className="muted tiny">Tanks from {monthStr(N.tankFrom)}{N.tankCost > 1 ? ` at ${Math.round((N.tankCost - 1) * 100)}% extra cost` : ''} · unrest at {N.unrest} war weariness</p>}
    </div>
  );
}

const MOB = ['Peacetime classes', 'Partial mobilisation', 'General mobilisation'];

export function NationSheet() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, f = g.factions[me], N = NATIONS[me], W = buildWorld(), ui = useUi.getState;
  const close = () => { click(); ui().setOverlay(null); };
  const strikes = g.regions.filter(r => r.owner === me && r.strike);
  const grow = poolGrowth(g, me), mob = f.mob ?? 0;
  return (
    <Modal label="Nation" narrow onClose={close}>
      <div className="kicker">{FACTIONS[me].name} · Ministry of War</div><h2>The nation</h2>
      <NationCard f={me} compact />
      <div className="nstats">
        <div><small>Manpower pool</small><b>{menStr(f.men ?? 0)}</b><span>+{menStr(grow)} per convoy</span></div>
        <div><small>War weariness</small><b className={f.ww >= N.unrest ? 'bad' : ''}>{Math.round(f.ww)}%</b><span>unrest at {N.unrest}%</span></div>
        <div><small>Battalion</small><b>{FORMATION.inf.men}</b><span>men from the pool</span></div>
      </div>
      <div className="lbl"><span>Mobilisation · {MOB[mob]}</span></div>
      <div className="seg mob" role="group" aria-label="Mobilisation">
        {MOB.map((m, i) => <button key={m} aria-pressed={mob === i} onClick={() => { click(); ui().order({ t: 'mobilise', level: i }); }}>{['None', 'Partial', 'General'][i]}</button>)}
      </div>
      <p className="muted small">Each level adds {Math.round(MANPOWER.mobGrowth * 100)}% to the manpower growth and {MANPOWER.mobWW} war weariness per convoy; under general mobilisation the weariness no longer fades. Above {N.unrest}% for {MANPOWER.strikeAfter} convoys, remote home regions go on strike; {MANPOWER.riseAbove} points higher they may rise.</p>
      {strikes.length > 0 && <p className="notice">On strike: {strikes.map(r => W.regions[r.id].name).join(', ')}. No supply, shells or recruits from there until the weariness eases.</p>}
      {f.unrestT > 0 && !strikes.length && <p className="notice">Unrest is brewing: {f.unrestT} convoy{f.unrestT === 1 ? '' : 's'} above the threshold.</p>}
      <div className="row"><button className="btn primary" onClick={close}>Back to the map</button></div>
    </Modal>
  );
}
