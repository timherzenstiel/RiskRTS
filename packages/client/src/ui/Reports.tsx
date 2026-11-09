// After-action reports: what each battle cost both sides, the shells fired, how far the attackers got.
import { FACTIONS, UNIT_TYPES, UT, buildWorld, sectorName, type Report } from '@riskrts/shared';
import { dateStr, useSim, useUi } from '../game/store';
import { click } from './actions';
import { Modal } from './Modal';
import { menStr } from './format';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';
import { PaperArchive } from './Story';

const REACH = ['never left the start line', 'were stopped in no-man\'s-land', 'reached the wire', 'took the trench'];

function Detail({ r, me }: { r: Report; me: number }) {
  const W = buildWorld();
  const win = r.winner === null ? t('No one held the field.') : r.winner === me ? t('We held the field.') : t('{0} held the field.', FACTIONS[r.winner].name);
  const where = r.from < 0 ? '' : r.from >= 1000 ? t('On the {0}', sectorName(W, r.from)) : t('Over the {0} border', W.regions[r.from].name);
  return (
    <div className="aar">
      <p className="lede small">{where ? `${where} · ` : ''}{Math.floor(r.dur / 60)} min {r.dur % 60} s · {t(`the attackers ${REACH[r.reach]}.`)} {win}</p>
      <table>
        <thead><tr><th />{UNIT_TYPES.map(k => <th key={k}>{tx(UT[k].short)}</th>)}<th>{t('Men')}</th><th>{t('Shells')}</th><th>{t('Morale')}</th></tr></thead>
        <tbody>
          {r.sides.map(s => {
            const tot = UNIT_TYPES.reduce((n, k) => n + s.lost[k], 0);
            return (
              <tr key={s.f} className={s.f === me ? 'me' : ''}>
                <th><i className="dot" style={{ '--c': FACTIONS[s.f].color } as React.CSSProperties} />{tx(FACTIONS[s.f].short)}{s.f === r.def ? ' ' + t('(def.)') : ''}</th>
                {UNIT_TYPES.map(k => <td key={k}>{s.lost[k] ? menStr(s.lost[k]) : '–'}</td>)}
                <td><b>{menStr(tot)}</b></td><td>{s.shells || '–'}</td><td>{s.mor0}→{s.mor1}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <small className="muted">{t('Men lost per unit type (killed, wounded and captured).')}</small>
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
    <Modal label={t('After-action reports')} onClose={close}>
      <div className="kicker">{t('General staff')}</div><h2>{t('After-action reports')}</h2>
      <PaperArchive />
      {!list.length ? <p className="lede">{t('No battles fought yet.')}</p> : (
        <div className="aar-wrap">
          <div className="aar-list" role="listbox" aria-label={t('Battles')}>
            {list.map(r => {
              const won = r.winner === me, lost = r.sides.find(s => s.f === me)?.lost, n = lost ? UNIT_TYPES.reduce((s, k) => s + lost[k], 0) : 0;
              return (
                <button key={r.id} role="option" aria-selected={cur?.id === r.id} className={won ? 'good' : 'bad'} onClick={() => { click(); useUi.setState({ reportId: r.id }); }}>
                  <b>{tx(W.regions[r.region].name)}</b><small>{dateStr(r.day)} · {won ? t('won') : r.winner === null ? t('no victor') : t('lost')} · {tn('{0} men', { raw: menStr(n) })}</small>
                </button>
              );
            })}
          </div>
          {cur && <Detail r={cur} me={me} />}
        </div>
      )}
      <div className="row"><button className="btn primary" onClick={close}>{t('Back to the map')}</button></div>
    </Modal>
  );
}
