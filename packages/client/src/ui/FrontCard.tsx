// Battle levers for one front: suppression, wire, shells, barrage level, over the top, stance, reinforcements and retreat.
import { BARRAGES, SHELLS, STANCES, buildWorld, groundUnits, autoGoIn, moveK, shellsFor, sideSupplied, type Barrage, type Battle, type GameState, type Stance } from '@riskrts/shared';
import { useUi } from '../game/store';
import { click } from './actions';
import { Sfx } from '../audio/sfx';
import { t, tx } from '../i18n';

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
    <div className={'supp' + (mine ? ' mine' : '')} title={t('{0} suppression {1}%: suppressed troops fire less; above 70% their machine guns fall silent', label, Math.round(v))}>
      <small>{t(label)}</small><span className="sb"><i style={{ width: `${Math.min(100, v)}%` }} /></span><b>{Math.round(v)}%</b>
    </div>
  );
}

/** Own regions next to a front that can send reinforcements. */
export function reinforcers(g: GameState, b: Battle, me: number) {
  return buildWorld().regions[b.region].land.map(i => g.regions[i]).filter(r => r.owner === me && r.battle < 0 && groundUnits(r.units) >= 2);
}

const STAGES = ['First line', 'Consolidating', 'Depth', 'Foothold'];
/** Where a phased offensive stands, and the order to carry a foothold into the depth. */
function StageRow({ g, me, b, att }: { g: GameState; me: number; b: Battle; att: boolean }) {
  const st = b.stage ?? 0, W = buildWorld();
  const left = st === 1 ? Math.max(0, Math.ceil(30 * moveK(g) - (b.age - (b.stT ?? 0)))) : 0;
  const tip = st === 0 ? (att ? t('Break into the enemy trench on this border') : t('Our corps on this border holds the trench; the main army waits in the depth'))
    : st === 1 ? (att ? t('The captured trench is turned around before the push into the depth') : t('The enemy holds our first line and gets ready to push on'))
      : st === 2 ? (att ? t('Fighting the main army in the open behind the line') : t('Our main army meets the enemy behind the line'))
        : (att ? t('Our troops hold the enemy\'s first line and dig in') : t('The enemy holds a foothold in our first line'));
  return (
    <div className="lv-row lv-stage" title={tip}>
      <span className="lv-l">{t('Stage')}</span>
      <ol className="stages" aria-label={t('Stages of the offensive')}>
        {(b.goal === 1 && st !== 1 && st !== 2 ? [0, 3] : [0, 1, 2]).map(k => <li key={k} className={k === st ? 'on' : (k < st && st !== 3) || (k === 0 && st === 3) ? 'done' : ''}>{t(STAGES[k])}{k === 1 && st === 1 ? ` · ${left}s` : ''}</li>)}
      </ol>
      {att && st === 3 && b.from >= 0 && b.from < 1000 && g.regions[b.from]?.owner === me && <button className="btn sm primary" title={t('Carry the attack on into the depth of the region')} onClick={() => { click(); useUi.getState().order({ t: 'order', region: b.from, post: b.region, k: 2 }); }}>{t('Invade {0}', W.regions[b.region].name)}</button>}
    </div>
  );
}

export function FrontControls({ g, me, b, compact }: { g: GameState; me: number; b: Battle; compact?: boolean }) {
  const ui = useUi.getState, W = buildWorld();
  const att = b.def !== me, fights = b.def === me || b.sides.includes(me);
  const foe = att ? b.def : b.sides.find(f => f !== me && f !== b.def) ?? b.attacker;
  const mySupp = b.supp?.[me] ?? 0, foeSupp = b.supp?.[foe] ?? 0;
  const wire = b.wire0 > 0 ? Math.round(b.wire / b.wire0 * 100) : 0;
  if (!fights) return null;
  const shells = Math.floor(shellsFor(g, b, me)), lvl = (b.bar?.[me] ?? 1) as Barrage, st = (b.st?.[me] ?? 0) as Stance;
  const local = !sideSupplied(g, b, me);
  const send = (cmd: Parameters<ReturnType<typeof useUi.getState>['order']>[0]) => { click(); ui().order(cmd); };
  const helpers = reinforcers(g, b, me);
  const goIn = Math.ceil(autoGoIn(g, b));
  return (
    <div className={'levers' + (compact ? ' compact' : '')}>
      {b.goal !== undefined && <StageRow g={g} me={me} b={b} att={att} />}
      <div className="supps">
        <Supp label="Enemy" v={foeSupp} mine={false} />
        <Supp label="Ours" v={mySupp} mine />
        <div className="lv-stat" title={b.wire0 > 0 ? t('Barbed wire left on this front') : t('No barbed wire on this front')}><small>{t('Wire')}</small><b>{b.wire0 > 0 ? `${wire}%` : '–'}</b></div>
        <div className={'lv-stat' + (shells <= 2 ? ' warn' : '')} title={local ? t('Cut off from the stockpile: the guns fire from the local dump') : t('Shells in the national stockpile')}><small>{local ? t('Dump') : t('Shells')}</small><b>{shells}</b></div>
      </div>
      <div className="lv-row">
        <span className="lv-l">{t('Guns')}</span>
        <div className="seg lever" role="group" aria-label={t('Barrage')}>
          {BARRAGES.map((n, i) => (
            <button key={n} aria-pressed={lvl === i} disabled={i === 2 && shells < SHELLS.shot}
              title={i === 0 ? t('Guns hold fire: saves shells and hides your strength') : i === 1 ? t('Steady fire · about one shell per battery every 10 s') : t('Heavy barrage · 80% more fire and suppression, twice the shells')}
              onClick={() => { Sfx.ratchet(); useUi.getState().order({ t: 'barrage', battle: b.id, level: i as Barrage }); }}>{i === 0 ? t('Off') : tx(n)}</button>
          ))}
        </div>
        {att && !b.go && <button className="btn sm primary otop" onClick={() => send({ t: 'charge', battle: b.id })} title={t('The attackers leave the start line now')}><span className="cover" aria-hidden="true" /><span className="otop-l">{t('Over the top')}</span>{goIn > 0 ? <small> · {t('auto {0}s', goIn)}</small> : null}</button>}
        {att && b.go && <span className="lv-go">{t('Attack under way')}</span>}
      </div>
      <div className="lv-row">
        <span className="lv-l">{t('Stance')}</span>
        <div className="seg" role="group" aria-label={t('Stance')}>
          {STANCES.map((n, i) => <button key={n} aria-pressed={st === i} title={`${tx(n)}: ${t(STANCE_TIP[i])}`} onClick={() => send({ t: 'stance', region: b.region, s: i as Stance, battle: b.id })}>{t(SHORT_STANCE[i])}</button>)}
        </div>
      </div>
      <div className="lv-row acts">
        {helpers.slice(0, compact ? 2 : 3).map(r => (
          <button key={r.id} className="btn sm" title={t('Send half the troops of {0} straight into this front', W.regions[r.id].name)} onClick={() => send({ t: 'reinforce', from: r.id, battle: b.id, frac: .5 })}>{t('Reinforce from {0}', W.regions[r.id].name)}</button>
        ))}
        {b.age - (b.lastJoin ?? 0) > 60 && <button className="btn sm" title={t("Trench raid: a battalion risks 10–40% losses to bring back prisoners, a report on the enemy's rear and −5 enemy morale")} disabled={(b.raidT?.[me] ?? -1e9) > b.age - 30} onClick={() => send({ t: 'raid', battle: b.id })}>{t('Raid')}</button>}
        <button className="btn sm danger" disabled={st === 3} title={st === 3 ? t('Troops holding at all costs do not retreat') : att ? t('Fall back over the border you came from') : b.goal && (b.stage ?? 0) === 0 ? t('Give up the first line: the survivors fall back to the main army in the middle') : t('Give up this front: the survivors fall back to a neighbouring region')} onClick={() => send({ t: 'withdraw', battle: b.id })}>{t('Withdraw')}</button>
      </div>
    </div>
  );
}
