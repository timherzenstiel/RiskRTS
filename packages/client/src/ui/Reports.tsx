// After-action reports: what each battle cost both sides, the shells fired, how far the attackers got.
import { FACTIONS, UNIT_TYPES, UT, buildWorld, type Report } from '@riskrts/shared';
import { dateStr, useSim, useUi } from '../game/store';
import { click } from './actions';
import { Modal } from './Modal';
import { menStr } from './format';

const REACH = ['never left the start line', 'were stopped in no-man\'s-land', 'reached the wire', 'took the trench'];

function Detail({ r, me }: { r: Report; me: number }) {
  const W = buildWorld();
  const win = r.winner === null ? 'No one held the field.' : r.winner === me ? 'We held the field.' : `${FACTIONS[r.winner].name} held the field.`;
  return (
    <div className="aar">
      <p className="lede small">{r.from >= 0 ? `Over the ${W.regions[r.from].name} border · ` : ''}{Math.floor(r.dur / 60)} min {r.dur % 60} s · the attackers {REACH[r.reach]}. {win}</p>
      <table>
        <thead><tr><th />{UNIT_TYPES.map(k => <th key={k}>{UT[k].short}</th>)}<th>Men</th><th>Shells</th><th>Morale</th></tr></thead>
        <tbody>
          {r.sides.map(s => {
            const tot = UNIT_TYPES.reduce((n, k) => n + s.lost[k], 0);
            return (
              <tr key={s.f} className={s.f === me ? 'me' : ''}>
                <th><i className="dot" style={{ '--c': FACTIONS[s.f].color } as React.CSSProperties} />{FACTIONS[s.f].short}{s.f === r.def ? ' (def.)' : ''}</th>
                {UNIT_TYPES.map(k => <td key={k}>{s.lost[k] ? menStr(s.lost[k]) : '–'}</td>)}
                <td><b>{menStr(tot)}</b></td><td>{s.shells || '–'}</td><td>{s.mor0}→{s.mor1}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <small className="muted">Men lost per unit type (killed, wounded and captured).</small>
    </div>
  );
}

export function ReportsSheet() {
  const sim = useSim(); const pick = useUi(s => s.reportId);
  if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const list = [...(g.reports ?? [])].reverse();
  const cur = list.find(r => r.id === pick) ?? list[0];
  const close = () => { click(); ui().setOverlay(null); };
  return (
    <Modal label="After-action reports" onClose={close}>
      <div className="kicker">General staff</div><h2>After-action reports</h2>
      {!list.length ? <p className="lede">No battles fought yet.</p> : (
        <div className="aar-wrap">
          <div className="aar-list" role="listbox" aria-label="Battles">
            {list.map(r => {
              const won = r.winner === me, lost = r.sides.find(s => s.f === me)?.lost, n = lost ? UNIT_TYPES.reduce((s, k) => s + lost[k], 0) : 0;
              return (
                <button key={r.id} role="option" aria-selected={cur?.id === r.id} className={won ? 'good' : 'bad'} onClick={() => { click(); useUi.setState({ reportId: r.id }); }}>
                  <b>{W.regions[r.region].name}</b><small>{dateStr(r.day)} · {won ? 'won' : r.winner === null ? 'no victor' : 'lost'} · {menStr(n)} men</small>
                </button>
              );
            })}
          </div>
          {cur && <Detail r={cur} me={me} />}
        </div>
      )}
      <div className="row"><button className="btn primary" onClick={close}>Back to the map</button></div>
    </Modal>
  );
}
