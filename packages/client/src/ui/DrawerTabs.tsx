// The three order tabs of the region drawer.
import { COST, FACTIONS, MAX_TRENCH, TRENCH_COST, UNIT_TYPES, UT, buildWorld, totalUnits, type RegionState, type UnitType } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { Icon, SupplyIcon } from './icons';
import { garrisonOf } from './garrison';

const UDESC: Record<UnitType, string> = { inf: 'Cheap line troops', mg: 'Pins down attackers', art: 'Outranges everything', tank: 'Shrugs off rifle fire · needs a factory' };

export function RecruitTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const recruit = useUi.getState().recruit;
  if (!sim) return null;
  const supply = sim.g.factions[sim.me].supply;
  return (
    <>
      {UNIT_TYPES.map((k, i) => {
        const locked = k === 'tank' && !region.factory;
        return (
          <div className="it" key={k}>
            <span className="ic"><Icon k={k} /></span>
            <div className="tx"><b>{UT[k].name}<kbd>{i + 1}</kbd></b><small>{UDESC[k]}</small></div>
            <div className="buys">
              <button className="buy" disabled={supply < COST[k] || locked} title={locked ? 'Build a factory here first' : `Recruit one ${UT[k].name.toLowerCase()} (Shift-click buys 5)`}
                aria-label={`Recruit one ${UT[k].name}, costs ${COST[k]}`} onClick={e => recruit(id, k, e.shiftKey ? 5 : 1)}>+1 <SupplyIcon />{COST[k]}</button>
              <button className="buy five" disabled={supply < COST[k] * 5 || locked} aria-label={`Recruit five ${UT[k].name}, costs ${COST[k] * 5}`} onClick={() => recruit(id, k, 5)}>×5</button>
            </div>
          </div>
        );
      })}
      <p className="note">Shift-click buys five. New recruits join a running defence at once.</p>
    </>
  );
}

function BuildRow({ icon, name, desc, pips, label, disabled, onBuy }: { icon: 'trench' | 'factory' | 'barracks'; name: string; desc: string; pips?: string; label: React.ReactNode; disabled: boolean; onBuy: () => void }) {
  return (
    <div className="it">
      <span className="ic"><Icon k={icon} /></span>
      <div className="tx"><b>{name}{pips && <span className="pips" aria-hidden="true">{pips}</span>}</b><small>{desc}</small></div>
      <button className="buy" disabled={disabled} onClick={onBuy}>{label}</button>
    </div>
  );
}

export function BuildTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const build = useUi.getState().build;
  if (!sim) return null;
  const supply = sim.g.factions[sim.me].supply; const full = region.trench >= MAX_TRENCH; const tc = TRENCH_COST[region.trench] ?? 0;
  return (
    <>
      <BuildRow icon="trench" name="Trench" pips={'■'.repeat(region.trench) + '□'.repeat(MAX_TRENCH - region.trench)} desc="Defenders take less damage"
        label={full ? 'Max' : <><SupplyIcon />{tc}</>} disabled={full || supply < tc} onBuy={() => build(id, 'trench')} />
      <BuildRow icon="factory" name="Factory" desc="+2 supply per convoy · unlocks tanks" label={region.factory ? 'Built' : <><SupplyIcon />{COST.factory}</>} disabled={region.factory || supply < COST.factory} onBuy={() => build(id, 'factory')} />
      <BuildRow icon="barracks" name="Barracks" desc="One free infantry per convoy" label={region.barracks ? 'Built' : <><SupplyIcon />{COST.barracks}</>} disabled={region.barracks || supply < COST.barracks} onBuy={() => build(id, 'barracks')} />
    </>
  );
}

const FRACS: [number, string][] = [[.25, '25%'], [.5, '50%'], [.75, '75%'], [1, 'All but 1']];

export function SharePicker() {
  const frac = useUi(s => s.sendFrac);
  return (
    <>
      <div className="lbl"><span>Troops to send</span></div>
      <div className="seg share" role="group" aria-label="Share of troops to send">
        {FRACS.map(([v, l]) => <button key={v} aria-pressed={frac === v} onClick={() => { click(); useUi.getState().setSendFrac(v); }}>{l}</button>)}
      </div>
    </>
  );
}

/** One neighbour line that marches `from` -> `to`; `list` is the region shown on the line (the neighbour of the drawer's region). */
export function NeighbourRow({ from, to, list, label }: { from: number; to: number; list: number; label: string }) {
  const sim = useSim(); const march = useUi.getState().march;
  if (!sim) return null;
  const { g, me } = sim; const W = buildWorld(); const src = g.regions[from]; const shown = g.regions[list]; const F = FACTIONS[shown.owner];
  const units = totalUnits(garrisonOf(g, shown)); const sea = W.seaLane.has(from + '|' + to);
  const disabled = src.battle >= 0 || totalUnits(src.units) < 2;
  const info = list === to ? `${shown.owner === me ? 'Yours' : F.short} · ${units} units` : `${units} available`;
  return (
    <div className="it nb">
      <i className="dot" style={{ '--c': F.color } as React.CSSProperties} />
      <div className="tx"><b>{W.regions[list].name}</b><small>{info}{sea ? ' · by sea' : ''}</small></div>
      <button className={'buy ' + (label === 'Attack' ? 'atk' : 'plain')} disabled={disabled}
        title={src.battle >= 0 ? 'Troops in a battle cannot leave' : totalUnits(src.units) < 2 ? 'Needs at least 2 units' : undefined} onClick={() => march(from, to)}>{label}</button>
    </div>
  );
}

export function MarchTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const orderMode = useUi(s => s.orderMode);
  if (!sim) return null;
  const adj = buildWorld().regions[id].adj; const { g, me } = sim;
  return (
    <>
      <SharePicker />
      <button className="btn sm wide pick-target" aria-pressed={orderMode} disabled={region.battle >= 0 || totalUnits(region.units) < 2}
        onClick={() => { click(); const u = useUi.getState(); if (orderMode) u.cancelOrder(); else u.beginOrder(); }}>
        {orderMode ? 'Cancel · pick a target on the map' : 'Pick a target on the map'}
      </button>
      <div className="lbl"><span>Neighbouring regions</span></div>
      {adj.map(i => <NeighbourRow key={i} from={id} to={i} list={i} label={g.regions[i].owner === me ? 'Reinforce' : 'Attack'} />)}
      <p className="note">Shortcut: right-click a region on the map.</p>
    </>
  );
}
