// National character: the power's own unit, strengths and weaknesses (lobby, and the Economy panel in game).
import { FACTIONS, NATIONS } from '@riskrts/shared';
import { monthStr } from '../game/store';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';

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
