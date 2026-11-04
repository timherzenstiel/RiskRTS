// Popover with every power's regions, units and income, plus continent bonuses and who holds them.
import { CONT, CONT_KEYS, FACTIONS, income, ownsCont, totalUnits } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';

export function Scoreboard() {
  const sim = useSim(); const open = useUi(s => s.scoreOpen);
  if (!sim || !open) return null;
  const { g, me } = sim;
  return (
    <div id="score" className="glass" role="dialog" aria-label="Scoreboard">
      <table>
        <thead><tr><th scope="col">Power</th><th scope="col">Regions</th><th scope="col">Units</th><th scope="col">Income</th></tr></thead>
        <tbody>
          {FACTIONS.map((f, i) => {
            const alive = g.factions[i].alive;
            const n = g.regions.filter(r => r.owner === i).length;
            const u = g.regions.reduce((s, r) => s + (r.owner === i ? totalUnits(r.units) : 0), 0) + g.armies.reduce((s, a) => s + (a.owner === i ? totalUnits(a.units) : 0), 0);
            return (
              <tr key={i} className={(i === me ? 'me ' : '') + (alive ? '' : 'dead')}>
                <td><i className="dot" style={{ '--c': f.color } as React.CSSProperties} />{f.name}</td>
                <td>{n}</td><td>{u}</td><td>{alive ? `+${income(g, i)}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <small>Continent bonuses · colour = holder</small>
      <div className="cont">
        {CONT_KEYS.map(k => {
          const holder = FACTIONS.findIndex((_, i) => ownsCont(g, i, k));
          return <span key={k}>{holder >= 0 && <i className="dot" style={{ '--c': FACTIONS[holder].color } as React.CSSProperties} />}{CONT[k].name} <b>+{CONT[k].bonus}</b></span>;
        })}
      </div>
    </div>
  );
}
