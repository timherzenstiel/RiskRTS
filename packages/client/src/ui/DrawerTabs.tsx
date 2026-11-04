// The order tabs of the region drawer: Recruit, Build, Fortify, March (with air strikes).
import {
  AIR_RANGE, COST, DEF_KINDS, DT, FACTIONS, MAX_DEF_INTERIOR, MAX_DEF_SECTOR, MAX_TRENCH, TRENCH_COST, UNIT_TYPES, UT, buildWorld, groundUnits, hops, offensives,
  type DefKind, type RegionState, type UnitType,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { Icon, SupplyIcon } from './icons';
import { garrisonOf } from './garrison';

const UDESC: Record<UnitType, string> = { inf: 'Cheap line troops', mg: 'Pins down attackers', art: 'Outranges everything', tank: 'Shrugs off rifle fire · needs a factory', plane: 'Strikes 2 borders away · needs an airfield' };

export function RecruitTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const recruit = useUi.getState().recruit;
  if (!sim) return null;
  const supply = sim.g.factions[sim.me].supply;
  return (
    <>
      {UNIT_TYPES.map((k, i) => {
        const locked = (k === 'tank' && !region.factory) || (k === 'plane' && !region.airfield);
        return (
          <div className="it" key={k}>
            <span className="ic"><Icon k={k} /></span>
            <div className="tx"><b>{UT[k].name}<kbd>{i + 1}</kbd></b><small>{UDESC[k]}</small></div>
            <div className="buys">
              <button className="buy" disabled={supply < COST[k] || locked} title={locked ? `Build ${k === 'tank' ? 'a factory' : 'an airfield'} here first` : `Recruit one ${UT[k].name.toLowerCase()} (Shift-click buys 5)`}
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

function BuildRow({ icon, name, desc, pips, label, disabled, onBuy }: { icon: Parameters<typeof Icon>[0]['k']; name: string; desc: string; pips?: string; label: React.ReactNode; disabled: boolean; onBuy: () => void }) {
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
      <BuildRow icon="airfield" name="Airfield" desc="Unlocks aircraft in this region" label={region.airfield ? 'Built' : <><SupplyIcon />{COST.airfield}</>} disabled={region.airfield || supply < COST.airfield} onBuy={() => build(id, 'airfield')} />
      <p className="note">Fixed defences for a specific border are in the <b>Fortify</b> tab.</p>
    </>
  );
}

const DDESC: Record<DefKind, string> = {
  pill: 'Concrete MG nest · fights attacks over this border',
  fort: 'Heavy gun · shells attackers over this border',
  flak: 'Shoots down aircraft anywhere in the region',
};

/** Pick a border (or the interior) and place pillboxes, gun emplacements or anti-air guns there. */
export function FortifyTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const marker = useUi(s => s.fortMarker); const ui = useUi.getState;
  if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), supply = g.factions[me].supply;
  const sector = marker && marker[0] === id ? marker[1] : -2;
  const sectors = [...W.regions[id].adj.map(n => ({ s: n, name: W.regions[n].name, owner: g.regions[n].owner, sea: W.seaLane.has(id + '|' + n) })), { s: -1, name: 'Interior', owner: -1, sea: false }];
  const here = (s: number) => region.defs.filter(d => d.s === s);
  return (
    <>
      <div className="lbl"><span>Where to build · pick a border</span></div>
      <div className="sectors" role="listbox" aria-label="Border sectors">
        {sectors.map(x => {
          const ds = here(x.s), F = x.owner >= 0 ? FACTIONS[x.owner] : null, hostile = x.owner >= 0 && x.owner !== me;
          return (
            <button key={x.s} role="option" aria-selected={sector === x.s} className={'sec' + (hostile ? ' hostile' : '')} onClick={() => { click(); ui().setFortMarker([id, x.s]); }}>
              {F ? <i className="dot" style={{ '--c': F.color } as React.CSSProperties} /> : <i className="dot in" />}
              <span className="nm">{x.s < 0 ? 'Interior' : `Border · ${x.name}`}{x.sea ? ' (sea)' : ''}</span>
              <span className="have">{ds.map(d => <Icon key={d.id} k={d.k} size={14} />)}<small>{ds.length}/{x.s < 0 ? MAX_DEF_INTERIOR : MAX_DEF_SECTOR}</small></span>
            </button>
          );
        })}
      </div>
      {sector > -2 ? (
        <>
          <div className="lbl"><span>{sector < 0 ? 'Interior defences join every battle here' : `Defences facing ${W.regions[sector].name} only fight attacks from there`}</span></div>
          {DEF_KINDS.map(k => {
            const full = here(sector).length >= (sector < 0 ? MAX_DEF_INTERIOR : MAX_DEF_SECTOR);
            return <BuildRow key={k} icon={k} name={DT[k].name} desc={DDESC[k]} label={full ? 'Full' : <><SupplyIcon />{COST[k]}</>} disabled={full || supply < COST[k]} onBuy={() => ui().fortify(id, k, sector)} />;
          })}
        </>
      ) : <p className="note">Defences stand where you build them. A pillbox on the border to one neighbour does nothing against an attack from another; if the field army falls, defences on other borders hold out and keep the region contested.</p>}
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
  const units = groundUnits(garrisonOf(g, shown)); const sea = W.seaLane.has(from + '|' + to);
  const disabled = src.battle >= 0 || groundUnits(src.units) < 2;
  const info = list === to ? `${shown.owner === me ? 'Yours' : F.short} · ${units} ${units === 1 ? 'unit' : 'units'}${shown.defs.length ? ` · ${shown.defs.length} def.` : ''}` : `${units} available`;
  return (
    <div className="it nb">
      <i className="dot" style={{ '--c': F.color } as React.CSSProperties} />
      <div className="tx"><b>{W.regions[list].name}</b><small>{info}{sea ? ' · by sea' : ''}</small></div>
      <button className={'buy ' + (label === 'Attack' ? 'atk' : 'plain')} disabled={disabled}
        title={src.battle >= 0 ? 'Troops in a battle cannot leave' : groundUnits(src.units) < 2 ? 'Needs at least 2 ground units' : undefined} onClick={() => march(from, to)}>{label}</button>
    </div>
  );
}

/** "2 / 3 attacks under way", or nothing when there is no limit. */
export function AttackBudget() {
  const sim = useSim(); if (!sim) return null;
  const cap = sim.g.cfg?.attackCap ?? 0, n = offensives(sim.g, sim.me).size;
  if (!cap) return null;
  return <p className={'note budget' + (n >= cap ? ' full' : '')}>Attacks under way: <b>{n} / {cap}</b>{n >= cap ? ' · wait for one to end before opening a new front' : ''}</p>;
}

function AirSection({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const orderMode = useUi(s => s.orderMode); const kind = useUi(s => s.orderKind);
  if (!sim || region.units.plane < 1) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const targets = g.regions.filter(r => r.id !== id && hops(id, r.id, AIR_RANGE) <= AIR_RANGE && (r.owner !== me || r.battle >= 0))
    .sort((a, b) => (b.battle >= 0 ? 1 : 0) - (a.battle >= 0 ? 1 : 0) || hops(id, a.id) - hops(id, b.id)).slice(0, 8);
  const active = orderMode && kind === 'air';
  return (
    <>
      <div className="lbl"><span>Air strike · {region.units.plane} aircraft · reach {AIR_RANGE} borders</span></div>
      <button className="btn sm wide pick-target" aria-pressed={active} onClick={() => { click(); if (active) ui().cancelOrder(); else ui().beginOrder('air'); }}>
        {active ? 'Cancel · pick a target on the map' : 'Pick an air target on the map'}<kbd>A</kbd>
      </button>
      {targets.map(r => {
        const F = FACTIONS[r.owner], d = hops(id, r.id), flak = r.defs.filter(x => x.k === 'flak' && x.f === r.owner).length;
        return (
          <div className="it nb" key={r.id}>
            <i className="dot" style={{ '--c': F.color } as React.CSSProperties} />
            <div className="tx"><b>{W.regions[r.id].name}</b><small>{r.owner === me ? 'Support our defence' : F.short} · {d} border{d > 1 ? 's' : ''}{r.battle >= 0 ? ' · battle' : ''}{flak ? ` · ${flak} AA` : ''}</small></div>
            <button className={'buy ' + (r.owner === me ? 'plain' : 'atk')} onClick={() => ui().air(id, r.id)}>{r.owner === me ? 'Support' : 'Strike'}</button>
          </div>
        );
      })}
      <p className="note">Aircraft bomb and strafe but cannot take ground. They return home when their fuel runs out.</p>
    </>
  );
}

export function MarchTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const orderMode = useUi(s => s.orderMode); const kind = useUi(s => s.orderKind);
  if (!sim) return null;
  const adj = buildWorld().regions[id].adj; const { g, me } = sim;
  const active = orderMode && kind === 'march';
  return (
    <>
      <AttackBudget />
      <SharePicker />
      <button className="btn sm wide pick-target" aria-pressed={active} disabled={region.battle >= 0 || groundUnits(region.units) < 2}
        onClick={() => { click(); const u = useUi.getState(); if (active) u.cancelOrder(); else u.beginOrder('march'); }}>
        {active ? 'Cancel · pick a target on the map' : 'Pick a target on the map'}
      </button>
      <div className="lbl"><span>Neighbouring regions · infantry and tanks attack across direct borders only</span></div>
      {adj.map(i => <NeighbourRow key={i} from={id} to={i} list={i} label={g.regions[i].owner === me ? 'Reinforce' : 'Attack'} />)}
      <AirSection region={region} id={id} />
      <p className="note">Shortcut: right-click a region on the map.</p>
    </>
  );
}
