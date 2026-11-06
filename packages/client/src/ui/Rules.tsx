// War rules chosen before the game: how many attacks each power may run at once, how long battles take, and (multiplayer)
// whether players may stop the war by a vote.
import { ATTACK_CAPS, PACES, type GameSettings } from '@riskrts/shared';
import { click } from './actions';
import { t, tx } from '../i18n';

const capName = (c: number) => (c ? String(c) : t('No limit'));

export function RulesPicker({ value, onChange, multi }: { value: GameSettings; onChange?: (p: Partial<GameSettings>) => void; multi?: boolean }) {
  const ro = !onChange;
  return (
    <div className="row spread rules">
      <div><div className="lbl"><span>{t('Attacks at once per power')} · {value.attackCap ? t('up to {0}', value.attackCap) : t('unlimited')}</span></div>
        <div className="seg" role="group" aria-label={t('Simultaneous attacks per power')}>
          {ATTACK_CAPS.map(c => <button key={c} disabled={ro && value.attackCap !== c} aria-pressed={value.attackCap === c} onClick={() => { if (ro) return; click(); onChange({ attackCap: c }); }}>{capName(c)}</button>)}
        </div></div>
      <div><div className="lbl"><span>{t('Battle pace')} · {tx(PACES[value.pace]?.desc)}</span></div>
        <div className="seg" role="group" aria-label={t('Battle pace')}>
          {PACES.map((p, i) => <button key={p.name} disabled={ro && value.pace !== i} aria-pressed={value.pace === i} onClick={() => { if (ro) return; click(); onChange({ pace: i }); }}>{tx(p.name)}</button>)}
        </div></div>
      {multi && <div><div className="lbl"><span>{t('Pause votes')} · {value.vote === false ? t('only the host pauses') : t('a majority of the players may stop the war for a minute')}</span></div>
        <div className="seg" role="group" aria-label={t('Pause votes')}>
          <button disabled={ro && value.vote === false} aria-pressed={value.vote !== false} onClick={() => { if (ro) return; click(); onChange({ vote: true }); }}>{t('On')}</button>
          <button disabled={ro && value.vote !== false} aria-pressed={value.vote === false} onClick={() => { if (ro) return; click(); onChange({ vote: false }); }}>{t('Off')}</button>
        </div></div>}
    </div>
  );
}
