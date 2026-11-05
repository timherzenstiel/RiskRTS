// Battle levers for one front: suppression, wire, shells, barrage level, over the top, stance, reinforcements and retreat.
import { BARRAGES, SHELLS, STANCES, buildWorld, groundUnits, autoGoIn, shellsFor, type Barrage, type Battle, type GameState, type Stance } from '@riskrts/shared';
import { useUi } from '../game/store';
import { click } from './actions';

const SHORT_STANCE = ['Balanced', 'Aggressive', 'Defensive', 'Hold'] as const;
const STANCE_TIP = [
  'As the troops see fit',
  'Counter-attack early · +15% damage dealt, +25% losses',
  'Stay in the trench · −30% losses, never counter-attack (attackers wait for orders)',
  'No surrender, no retreat · morale falls 50% faster',
];

/** Suppression bar 0..100. */
function Supp({ label, v, mine }: { label: string; v: number; mine: boolean }) {
  return (
    <div className={'supp' + (mine ? ' mine' : '')} title={`${label} suppression ${Math.round(v)}%: suppressed troops fire less; above 70% their machine guns fall silent`}>
      <small>{label}</small><span className="sb"><i style={{ width: `${Math.min(100, v)}%` }} /></span><b>{Math.round(v)}%</b>
    </div>
  );
}

/** Own regions next to a front that can send reinforcements. */
export function reinforcers(g: GameState, b: Battle, me: number) {
  return buildWorld().regions[b.region].adj.map(i => g.regions[i]).filter(r => r.owner === me && r.battle < 0 && groundUnits(r.units) >= 2);
}

export function FrontControls({ g, me, b, compact }: { g: GameState; me: number; b: Battle; compact?: boolean }) {
  const ui = useUi.getState, W = buildWorld();
  const att = b.def !== me, fights = b.def === me || b.sides.includes(me);
  const foe = att ? b.def : b.sides.find(f => f !== me && f !== b.def) ?? b.attacker;
  const mySupp = b.supp?.[me] ?? 0, foeSupp = b.supp?.[foe] ?? 0;
  const wire = b.wire0 > 0 ? Math.round(b.wire / b.wire0 * 100) : 0;
  if (!fights) return null;
  const shells = Math.floor(shellsFor(g, b, me)), lvl = (b.bar?.[me] ?? 1) as Barrage, st = (b.st?.[me] ?? 0) as Stance;
  const local = !(b.def === me ? !g.regions[b.region].cut && g.regions[b.region].owner === me : b.from >= 0 && g.regions[b.from].owner === me && !g.regions[b.from].cut);
  const send = (cmd: Parameters<ReturnType<typeof useUi.getState>['order']>[0]) => { click(); ui().order(cmd); };
  const helpers = reinforcers(g, b, me);
  const goIn = Math.ceil(autoGoIn(g, b));
  return (
    <div className={'levers' + (compact ? ' compact' : '')}>
      <div className="supps">
        <Supp label="Enemy" v={foeSupp} mine={false} />
        <Supp label="Ours" v={mySupp} mine />
        <div className="lv-stat" title={b.wire0 > 0 ? 'Barbed wire left on this front' : 'No barbed wire on this front'}><small>Wire</small><b>{b.wire0 > 0 ? `${wire}%` : '–'}</b></div>
        <div className={'lv-stat' + (shells <= 2 ? ' warn' : '')} title={local ? 'Cut off from the stockpile: the guns fire from the local dump' : 'Shells in the national stockpile'}><small>{local ? 'Dump' : 'Shells'}</small><b>{shells}</b></div>
      </div>
      <div className="lv-row">
        <span className="lv-l">Guns</span>
        <div className="seg" role="group" aria-label="Barrage">
          {BARRAGES.map((n, i) => (
            <button key={n} aria-pressed={lvl === i} disabled={i === 2 && shells < SHELLS.shot}
              title={i === 0 ? 'Guns hold fire: saves shells and hides your strength' : i === 1 ? 'Steady fire · about one shell per battery every 10 s' : 'Heavy barrage · 80% more fire and suppression, twice the shells'}
              onClick={() => send({ t: 'barrage', battle: b.id, level: i as Barrage })}>{i === 0 ? 'Off' : n}</button>
          ))}
        </div>
        {att && !b.go && <button className="btn sm primary otop" onClick={() => send({ t: 'charge', battle: b.id })} title="The attackers leave the start line now">Over the top{goIn > 0 ? <small> · auto {goIn}s</small> : null}</button>}
        {att && b.go && <span className="lv-go">Attack under way</span>}
      </div>
      <div className="lv-row">
        <span className="lv-l">Stance</span>
        <div className="seg" role="group" aria-label="Stance">
          {STANCES.map((n, i) => <button key={n} aria-pressed={st === i} title={`${n}: ${STANCE_TIP[i]}`} onClick={() => send({ t: 'stance', region: b.region, s: i as Stance, battle: b.id })}>{SHORT_STANCE[i]}</button>)}
        </div>
      </div>
      <div className="lv-row acts">
        {helpers.slice(0, compact ? 2 : 3).map(r => (
          <button key={r.id} className="btn sm" title={`Send half the troops of ${W.regions[r.id].name} straight into this front`} onClick={() => send({ t: 'reinforce', from: r.id, battle: b.id, frac: .5 })}>Reinforce from {W.regions[r.id].name}</button>
        ))}
        {b.age - (b.lastJoin ?? 0) > 60 && <button className="btn sm" title="Trench raid: a battalion risks 10–40% losses to bring back prisoners, a report on the enemy's rear and −5 enemy morale" disabled={(b.raidT?.[me] ?? -1e9) > b.age - 30} onClick={() => send({ t: 'raid', battle: b.id })}>Raid</button>}
        <button className="btn sm danger" disabled={st === 3} title={st === 3 ? 'Troops holding at all costs do not retreat' : att ? 'Fall back over the border you came from' : 'Give up this front: the survivors fall back to a neighbouring region'} onClick={() => send({ t: 'withdraw', battle: b.id })}>Withdraw</button>
      </div>
    </div>
  );
}
