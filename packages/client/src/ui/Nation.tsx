// National character: the power's own unit, strengths and weaknesses; in game also manpower, conscription and unrest.
import { FACTIONS, FORMATION, NATIONS, MANPOWER, buildWorld, poolGrowth } from '@riskrts/shared';
import { monthStr, useSim, useUi } from '../game/store';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';
import { click } from './actions';
import { Modal } from './Modal';
import { menStr } from './format';

/** Unit, strengths and weaknesses of a power (lobby and in game). */
export function NationCard({ f, compact }: { f: number; compact?: boolean }) {
  const N = NATIONS[f], F = FACTIONS[f];
  return (
    <div className={'nation' + (compact ? ' compact' : '')} style={{ '--c': F.color } as React.CSSProperties}>
      <div className="nu"><small>{t('National unit')}{N.from !== undefined ? ` · ${tn('date|from {0}', { raw: monthStr(N.from) })}` : ''}</small><b>{tx(N.unitName)}</b><span>{tx(N.unitDesc)}</span></div>
      <div className="nt">
        <div><small>{t('Strengths')}</small>{N.strengths.map(s => <p key={s.name}><b>{tx(s.name)}.</b> {tx(s.desc)}</p>)}</div>
        <div><small>{t('Weaknesses')}</small>{N.weaknesses.map(s => <p key={s.name} className="weak"><b>{tx(s.name)}.</b> {tx(s.desc)}</p>)}</div>
      </div>
      {!compact && <p className="muted tiny">{N.tankCost > 1 ? tn('Tanks from {0} at {1}% extra cost', { raw: monthStr(N.tankFrom) }, Math.round((N.tankCost - 1) * 100)) : tn('Tanks from {0}', { raw: monthStr(N.tankFrom) })} · {t('unrest at {0} war weariness', N.unrest)}</p>}
    </div>
  );
}

const MOB = ['Peacetime classes', 'Extended conscription', 'Total conscription'];

export function NationSheet() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, f = g.factions[me], N = NATIONS[me], W = buildWorld(), ui = useUi.getState;
  const close = () => { click(); ui().setOverlay(null); };
  const strikes = g.regions.filter(r => r.owner === me && r.strike);
  const grow = poolGrowth(g, me), mob = f.mob ?? 0;
  return (
    <Modal label={t('Nation')} narrow onClose={close}>
      <div className="kicker">{tx(FACTIONS[me].name)} · {t('Ministry of War')}</div><h2>{t('The nation')}</h2>
      <NationCard f={me} compact />
      <div className="nstats">
        <div><small>{t('Manpower pool')}</small><b>{menStr(f.men ?? 0)}</b><span>{tn('+{0} per week', { raw: menStr(grow) })}</span></div>
        <div><small>{t('War weariness')}</small><b className={f.ww >= N.unrest ? 'bad' : ''}>{Math.round(f.ww)}%</b><span>{t('unrest at {0}%', N.unrest)}</span></div>
        <div><small>{t('Battalion')}</small><b>{FORMATION.inf.men}</b><span>{t('men from the pool')}</span></div>
      </div>
      <div className="lbl"><span>{t('Conscription')} · {t(MOB[mob])}</span></div>
      <div className="seg mob" role="group" aria-label={t('Conscription')}>
        {MOB.map((m, i) => <button key={m} aria-pressed={mob === i} onClick={() => { click(); ui().order({ t: 'mobilise', level: i }); }}>{t(['Peacetime', 'Extended', 'Total'][i])}</button>)}
      </div>
      <p className="muted small">{t('Each level adds {0}% to the manpower growth and {1} war weariness per week; under total conscription the weariness no longer fades. Above {2}% for {3} weeks, remote home regions go on strike; {4} points higher they may rise.', Math.round(MANPOWER.mobGrowth * 100), MANPOWER.mobWW, N.unrest, MANPOWER.strikeAfter, MANPOWER.riseAbove)}</p>
      {strikes.length > 0 && <p className="notice">{tn('On strike: {0}. No Production, shells or recruits from there until the weariness eases.', { raw: strikes.map(r => tx(W.regions[r.id].name)).join(', ') })}</p>}
      {f.unrestT > 0 && !strikes.length && <p className="notice">{f.unrestT === 1 ? t('Unrest is brewing: 1 week above the threshold.') : t('Unrest is brewing: {0} weeks above the threshold.', f.unrestT)}</p>}
      <div className="row"><button className="btn primary" onClick={close}>{t('Back to the map')}</button></div>
    </Modal>
  );
}
