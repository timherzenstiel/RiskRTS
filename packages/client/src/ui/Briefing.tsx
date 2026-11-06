// Staff briefing before an attack: what the enemy is thought to have, what a two-minute heavy barrage costs, rough losses.
import { BARRAGE, SHELLS, UT, buildWorld, guessedUnits, groundUnits, paceOf, unitPower, worksAt, type GameState } from '@riskrts/shared';
import { menStr } from './format';
import { useUi } from '../game/store';
import { t } from '../i18n';
import { tn } from './LangPicker';

/** Shells a two-minute heavy barrage burns for `art` batteries (pace-adjusted fire rate). */
export function barrageCost(g: GameState, art: number, secs = 120) { return Math.round(art * secs / (UT.art.rof * paceOf(g).rof) * BARRAGE.heavy * SHELLS.shot); }

export function Briefing({ g, me, target, from }: { g: GameState; me: number; target: number; from: number[] }) {
  const frac = useUi(s => s.sendFrac);
  const W = buildWorld(), r = g.regions[target];
  const known = (r.vis ?? 3) >= 2, est = r.est;
  const enemy = known ? unitPower(r.units) : unitPower(guessedUnits(r));
  const best = from.map(i => g.regions[i]).filter(x => x.battle < 0).sort((a, b) => unitPower(b.units) - unitPower(a.units))[0];
  if (!best) return null;
  const w = worksAt(r, best.id), defs = r.defs.filter(d => d.f === r.owner && (d.s === best.id || d.s < 0)).length;
  const mine = unitPower({ ...best.units, plane: 0 }) * Math.min(frac, .92), dug = 1 + .3 * w.tr + .15 * defs;
  const ratio = mine / Math.max(.5, enemy * dug);
  const loss = Math.round(Math.min(.9, .55 / Math.max(.4, ratio)) * 100);
  const cost = barrageCost(g, Math.round(best.units.art * Math.min(frac, .92)));
  const shells = Math.floor(g.factions[me].shells ?? 0);
  return (
    <div className="brief" aria-label={t('Staff briefing')}>
      <div className="lbl"><span>{t('Staff briefing · estimate')}</span></div>
      <dl>
        <dt>{t('Enemy')}</dt><dd>{known ? `${t('{0} formations', groundUnits(r.units))}${(r.vis ?? 3) === 2 ? ' ' + t('(old report)') : ''}` : est ? tn('{0}–{1} men', { raw: menStr(est[0]) }, { raw: menStr(est[1]) }) : t('unknown')}{w.tr ? ` · ${t('trench {0}', ['', 'I', 'II', 'III'][w.tr])}` : ''}{w.wire ? ` · ${t('wire')}` : ''}{defs ? ` · ${defs > 1 ? t('{0} defences', defs) : t('1 defence')}` : ''} {t('facing {0}', W.regions[best.id].name)}</dd>
        <dt>{t('Barrage')}</dt><dd>{best.units.art ? t('2 min heavy from {0}: ~{1} shells ({2} in stock)', W.regions[best.id].name, cost, shells) : t('No guns in {0}: the infantry goes in at once', W.regions[best.id].name)}</dd>
        <dt>{t('Odds')}</dt><dd className={ratio >= 1.5 ? 'good' : ratio >= 1 ? '' : 'bad'}>{ratio >= 2 ? t('Favourable') : ratio >= 1.3 ? t('Even to good') : ratio >= .9 ? t('Even') : t('Poor')} · {t('expect to lose ~{0}% of the attackers', loss)}</dd>
      </dl>
    </div>
  );
}
