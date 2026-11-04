// War rules chosen before the game: how many attacks each power may run at once, and how long battles take.
import { ATTACK_CAPS, PACES, type GameSettings } from '@riskrts/shared';
import { click } from './actions';

const capName = (c: number) => (c ? String(c) : 'No limit');

export function RulesPicker({ value, onChange }: { value: GameSettings; onChange?: (p: Partial<GameSettings>) => void }) {
  const ro = !onChange;
  return (
    <div className="row spread rules">
      <div><div className="lbl"><span>Attacks at once per power · {value.attackCap ? `up to ${value.attackCap}` : 'unlimited'}</span></div>
        <div className="seg" role="group" aria-label="Simultaneous attacks per power">
          {ATTACK_CAPS.map(c => <button key={c} disabled={ro && value.attackCap !== c} aria-pressed={value.attackCap === c} onClick={() => { if (ro) return; click(); onChange({ attackCap: c }); }}>{capName(c)}</button>)}
        </div></div>
      <div><div className="lbl"><span>Battle pace · {PACES[value.pace]?.desc}</span></div>
        <div className="seg" role="group" aria-label="Battle pace">
          {PACES.map((p, i) => <button key={p.name} disabled={ro && value.pace !== i} aria-pressed={value.pace === i} onClick={() => { if (ro) return; click(); onChange({ pace: i }); }}>{p.name}</button>)}
        </div></div>
    </div>
  );
}
