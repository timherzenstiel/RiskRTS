// Popover with every power's regions, men and income (rivals' strength is hidden by the fog of war), plus continent bonuses.
import { CONT, CONT_KEYS, FACTIONS, income, ownsCont } from '@riskrts/shared';
import { menOf, menStr } from './format';
import { useSim, useUi } from '../game/store';
import { t, tx } from '../i18n';

export function Scoreboard() {
  const sim = useSim(); const open = useUi(s => s.scoreOpen);
  if (!sim || !open) return null;
  const { g, me } = sim;
  return (
    <div id="score" className="glass" role="dialog" aria-label={t('Scoreboard')}>
      <table>
        <thead><tr><th scope="col">{t('Power')}</th><th scope="col">{t('Regions')}</th><th scope="col">{t('Men')}</th><th scope="col">{t('Income')}</th></tr></thead>
        <tbody>
          {FACTIONS.map((f, i) => {
            const alive = g.factions[i].alive;
            const n = g.regions.filter(r => r.owner === i).length;
            const seeAll = i === me || g.over || !g.factions[me].alive;
            const u = g.regions.reduce((s, r) => s + (r.owner === i ? menOf(r.men) : 0), 0) + g.armies.reduce((s, a) => s + (a.owner === i ? menOf(a.men) : 0), 0);
            return (
              <tr key={i} className={(i === me ? 'me ' : '') + (alive ? '' : 'dead')}>
                <td><i className="dot" style={{ '--c': f.color } as React.CSSProperties} />{tx(f.name)}</td>
                <td>{n}</td><td>{seeAll ? menStr(u) : '?'}</td><td>{!alive ? '—' : seeAll ? `+${income(g, i)}` : '?'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <small>{t('Continent bonuses · colour = holder')}</small>
      <div className="cont">
        {CONT_KEYS.map(k => {
          const holder = FACTIONS.findIndex((_, i) => ownsCont(g, i, k));
          return <span key={k}>{holder >= 0 && <i className="dot" style={{ '--c': FACTIONS[holder].color } as React.CSSProperties} />}{tx(CONT[k].name)} <b>+{CONT[k].bonus}</b></span>;
        })}
      </div>
    </div>
  );
}
