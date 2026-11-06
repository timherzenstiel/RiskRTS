// The order tabs of the region drawer: Recruit, Build, Fortify, March (with air strikes and reconnaissance).
import {
  AIR_RANGE, COST, DT, FACTIONS, FORMATION, MAX_SAND, MAX_TRENCH, MAX_WIRE, SHELLS, SLOT_USE, UNIT_TYPES, UT, buildWorld, fortCost, groundUnits, hops, offensives, slotsMax, slotsUsed, worksAt,
  nationalUnit, NATIONS, unitCost, unitName, treatyOf, buildCostOf, RAIL_BUILD, hasRail, isMountain, monthStr, techOn, techDayFor,
  type FortKind, type RegionState, type UnitType,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { Icon, SupplyIcon } from './icons';
import { Cameo, CameoGrid } from './Cameo';
import { garrisonOf } from './garrison';
import { menStr } from './format';

const UDESC: Record<UnitType, string> = {
  inf: '100 riflemen · cheap line troops',
  mg: '6 machine guns · pins down attackers',
  art: '4 field guns · outranges everything',
  tank: '3 tanks · shrugs off rifle fire · needs a factory',
  plane: '6 aircraft · strikes 2 borders away · needs an airfield',
};

export function RecruitTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const recruit = useUi.getState().recruit;
  if (!sim) return null;
  const { g, me } = sim, supply = g.factions[me].supply, pool = g.factions[me].men ?? 0;
  return (
    <>
      {region.cut && <p className="note budget full">Cut off from supply: no recruiting here until a route home is reopened.</p>}
      {region.strike && <p className="note budget full">On strike: no recruits from here until the war weariness eases.</p>}
      {pool < FORMATION.inf.men && <p className="note budget full">The manpower pool is nearly empty ({Math.floor(pool)} men). Raise conscription on the nation screen, or wait for the next age class.</p>}
      <CameoGrid label="Recruit" hint="Price: supply and men from the pool · 'here': already in this region · click buys one, 'buy 5' five · keys 1–4">
        {UNIT_TYPES.map((k, i) => {
          const c = unitCost(g, me, k), men = FORMATION[k].men, nat = nationalUnit(me, k, g.day);
          const tech = k === 'tank' ? 'tank' : k === 'plane' ? 'air' : null, early = tech && !techOn(g, me, tech);
          const needs = k === 'tank' && !region.factory ? 'Needs factory' : k === 'plane' && !region.airfield ? 'Needs airfield' : null;
          const locked = !!early || !!needs || region.cut || !!region.strike;
          const noMen = pool < men;
          const lock = early ? monthStr(techDayFor(me, tech!, g.factions[me].rushed)) : needs ?? (region.cut ? 'Cut off' : region.strike ? 'Strike' : undefined);
          return (
            <Cameo key={k} k={k} nation={me} name={unitName(g, me, k)} hotkey={i < 4 ? String(i + 1) : undefined} national={!!nat} count={region.units[k]}
              cost={<><SupplyIcon />{c}<span className={'cm-men' + (noMen ? ' short' : '')}>· {men} men</span></>} lock={lock} disabled={supply < c || locked || noMen}
              title={`${nat ? NATIONS[me].unitDesc : UDESC[k]} · ${men} men${noMen && !locked ? ` · needs ${men} men from the pool` : ''}`}
              onBuy={five => recruit(id, k, five ? 5 : 1)} five fiveDisabled={supply < c * 5 || locked || pool < men * 5} />
          );
        })}
      </CameoGrid>
      <p className="note">Each formation is raised at full strength; its men come from the manpower pool (a battalion is 100 men). New formations join a running defence at once.</p>
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
  const supply = sim.g.factions[sim.me].supply;
  return (
    <>
      <CameoGrid label="Build">
        <Cameo k="factory" name="Factory" done={region.factory} cost={region.factory ? 'Built' : <><SupplyIcon />{buildCostOf(sim.me, 'factory')}</>} disabled={region.factory || supply < buildCostOf(sim.me, 'factory')}
          title={`+2 supply and +${NATIONS[sim.me].factoryShells} shells per convoy · unlocks tanks · a supply depot`} onBuy={() => build(id, 'factory')} />
        <Cameo k="barracks" name="Barracks" done={region.barracks} cost={region.barracks ? 'Built' : <><SupplyIcon />{COST.barracks}</>} disabled={region.barracks || supply < COST.barracks}
          title="One volunteer battalion per convoy (stops when the war weariness is high)" onBuy={() => build(id, 'barracks')} />
        {(() => { const early = !techOn(sim.g, sim.me, 'air'); return <Cameo k="airfield" name="Airfield" done={region.airfield} lock={early && !region.airfield ? monthStr(techDayFor(sim.me, 'air', sim.g.factions[sim.me].rushed)) : undefined} cost={region.airfield ? 'Built' : <><SupplyIcon />{COST.airfield}</>} disabled={region.airfield || early || supply < COST.airfield}
          title="Unlocks squadrons and reconnaissance flights here" onBuy={() => build(id, 'airfield')} />; })()}
      </CameoGrid>
      <Railways region={region} id={id} />
      <div className="lbl"><span>Munitions · {Math.floor(sim.g.factions[sim.me].shells ?? 0)} shells in stock</span></div>
      <div className="it">
        <span className="ic"><Icon k="art" /></span>
        <div className="tx"><b>Shell production</b><small>Turn supply into shells for the guns · 1 supply = {SHELLS.perSupply} shells</small></div>
        <div className="buys">
          <button className="buy" disabled={supply < 1} onClick={() => useUi.getState().order({ t: 'produce', kind: 'shells', n: 1 })}>+{SHELLS.perSupply} <SupplyIcon />1</button>
          <button className="buy five" disabled={supply < 5} aria-label={`Buy ${SHELLS.perSupply * 5} shells for 5 supply`} onClick={() => useUi.getState().order({ t: 'produce', kind: 'shells', n: 5 })}>×5</button>
        </div>
      </div>
      <p className="note">Trenches, sandbags, wire and fixed defences are dug on a specific border in the <b>Fortify</b> tab.</p>
    </>
  );
}

const FDESC: Record<FortKind, string> = {
  trench: 'Defenders on this border take less damage · depth I–III',
  sand: 'Sandbagged parapet · less damage from rifles and MGs · 1 slot',
  wire: 'Barbed wire · attacking infantry crawl through under fire · 1 slot',
  pill: 'Concrete MG nest · fights attacks over this border · 1 slot',
  bunk: 'Deep bunker, 2 MGs · shelters this border from shells and bombs · 2 slots',
  fort: 'Heavy gun · shells attackers over this border · 1 slot',
  flak: 'Anti-air gun · covers the region; on a border it hits harder there · 1 slot',
};
const FNAME: Record<FortKind, string> = { trench: 'Trench', sand: 'Sandbags', wire: 'Barbed wire', pill: DT.pill.name, bunk: DT.bunk.name, fort: DT.fort.name, flak: DT.flak.name };
const BORDER_KINDS: FortKind[] = ['trench', 'sand', 'wire', 'pill', 'bunk', 'fort', 'flak'];
const INTERIOR_KINDS: FortKind[] = ['pill', 'bunk', 'fort', 'flak'];
const roman = (n: number) => ['', 'I', 'II', 'III'][n] ?? '';

/** Pick a border (or the interior) and dig in there: trench, sandbags, wire, MG nests, bunkers, guns, anti-air. */
export function FortifyTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); const marker = useUi(s => s.fortMarker); const ui = useUi.getState;
  if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), supply = g.factions[me].supply;
  const sector = marker && marker[0] === id ? marker[1] : -2;
  const sectors = [...W.regions[id].land.map(n => ({ s: n, name: W.regions[n].name, owner: g.regions[n].owner, sea: false })), ...W.regions[id].zones.map(z => ({ s: 1000 + z, name: W.zones[z].name, owner: -1, sea: true })), { s: -1, name: 'Interior', owner: -1, sea: false }];
  const here = (s: number) => region.defs.filter(d => d.s === s && d.f === region.owner);
  return (
    <>
      <div className="lbl"><span>Where to build · pick a border (or tap it on the map)</span></div>
      <div className="sectors" role="listbox" aria-label="Border sectors">
        {sectors.map(x => {
          const ds = here(x.s), w = worksAt(region, x.s), F = x.owner >= 0 ? FACTIONS[x.owner] : null, hostile = x.owner >= 0 && x.owner !== me;
          return (
            <button key={x.s} role="option" aria-selected={sector === x.s} className={'sec' + (hostile ? ' hostile' : '')} onClick={() => { click(); ui().setFortMarker([id, x.s]); }}>
              {F ? <i className="dot" style={{ '--c': F.color } as React.CSSProperties} /> : <i className="dot in" />}
              <span className="nm">{x.s < 0 ? 'Interior' : x.sea ? `Coast · ${x.name}` : `Border · ${x.name}`}{x.s >= 0 && !x.sea && isMountain(id, x.s) ? ' · mountains' : ''}</span>
              <span className="have">
                {w.tr > 0 && <span className="wtag" title={`Trench ${roman(w.tr)}`}><Icon k="trench" size={14} />{roman(w.tr)}</span>}
                {w.sand > 0 && <Icon k="sand" size={14} />}{w.wire > 0 && <Icon k="wire" size={14} />}
                {ds.map(d => <Icon key={d.id} k={d.k} size={14} />)}<small>{slotsUsed(region, x.s)}/{slotsMax(id, x.s)}</small>
              </span>
            </button>
          );
        })}
      </div>
      {sector > -2 ? (
        <>
          <div className="lbl"><span>{sector < 0 ? 'Interior defences join the first front of every battle here' : `${sector >= 1000 ? `Works on the ${W.zones[sector - 1000].name} coast only fight landings there` : `Works facing ${W.regions[sector].name} only fight attacks from there`} · ${slotsUsed(region, sector)}/${slotsMax(id, sector)} slots`}</span></div>
          <CameoGrid label="Works">
            {(sector < 0 ? INTERIOR_KINDS : BORDER_KINDS).map(k => {
              const c = fortCost(region, k, sector, g), w = worksAt(region, sector);
              const need = k === 'flak' ? 'air' : k === 'bunk' ? 'trench3' : k === 'trench' && w.tr >= 2 ? 'trench3' : k === 'trench' && w.tr >= 1 ? 'trench2' : null;
              const early = need && !techOn(g, me, need);
              const room = k === 'trench' || slotsUsed(region, sector) + SLOT_USE[k] <= slotsMax(id, sector);
              const pips = k === 'trench' ? '■'.repeat(w.tr) + '□'.repeat(MAX_TRENCH - w.tr) : k === 'sand' ? '■'.repeat(w.sand) + '□'.repeat(MAX_SAND - w.sand) : k === 'wire' ? '■'.repeat(w.wire) + '□'.repeat(MAX_WIRE - w.wire) : undefined;
              const cost = c === null ? 'Max' : !room && !early ? 'Full' : <><SupplyIcon />{c}</>;
              return <Cameo key={k} k={k} name={FNAME[k]} pips={pips} done={c === null} lock={early ? monthStr(techDayFor(me, need!, g.factions[me].rushed)) : undefined} cost={cost}
                count={k === 'trench' || k === 'sand' || k === 'wire' ? undefined : here(sector).filter(d => d.k === k).length}
                title={FDESC[k]} disabled={c === null || !!early || !room || supply < (c ?? 0)} onBuy={() => ui().fortify(id, k, sector)} />;
            })}
          </CameoGrid>
        </>
      ) : <p className="note">Everything stands on the border you build it on. A trench facing one neighbour does nothing against an attack from another. If the field army falls, defences on other borders hold out and keep the region contested.</p>}
    </>
  );
}

/** Railways from this region to neighbouring regions of ours: lay new lines, see the ones being built. */
function Railways({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), supply = g.factions[me].supply;
  const nb = W.regions[id].adj.filter(n => g.regions[n].owner === me && !W.seaLane.has(id + '|' + n));
  const rows = nb.map(n => ({ n, has: hasRail(g, id, n), job: (g.railNew ?? []).find(([a, b]) => (a === id && b === n) || (a === n && b === id)) })).filter(x => !x.has || x.job);
  if (!rows.length) return null;
  return (
    <>
      <div className="lbl"><span>Railways · rail lines carry troops 3× as fast and give full supply</span></div>
      {rows.map(({ n, job }) => (
        <BuildRow key={n} icon="factory" name={`Railway to ${W.regions[n].name}`} desc={job && job[2] > g.day ? `Being laid · open in ${monthStr(job[2])}` : `${RAIL_BUILD.days / 7} convoys to lay`}
          label={job ? 'Building' : <><SupplyIcon />{RAIL_BUILD.cost}</>} disabled={!!job || supply < RAIL_BUILD.cost || region.contested >= 0} onBuy={() => useUi.getState().order({ t: 'rail', region: id, to: n })} />
      ))}
    </>
  );
}

const FRACS: [number, string][] = [[.25, '25%'], [.5, '50%'], [.75, '75%'], [1, 'All but 1']];

/** Goal of new attacks: take the enemy's first line and dig in there, or invade the region. */
export function GoalPicker() {
  const goal = useUi(s => s.goal);
  return (
    <>
      <div className="lbl"><span>Attack goal</span></div>
      <div className="seg share" role="group" aria-label="Attack goal">
        <button aria-pressed={goal === 2} title="Take the first line, consolidate, then fight the main army in the depth and take the region" onClick={() => { click(); useUi.getState().setGoal(2); }}>Invade</button>
        <button aria-pressed={goal === 1} title="Take the enemy's first line on that border and dig in there; order the invasion later" onClick={() => { click(); useUi.getState().setGoal(1); }}>First line only</button>
      </div>
    </>
  );
}

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

/** What we know of a region's ground troops, in words. */
export function knownTroops(r: RegionState, mine: boolean): string {
  const v = r.vis ?? 3;
  if (mine || v >= 3) { const n = groundUnits(r.units); return `${n} formation${n === 1 ? '' : 's'}`; }
  if (r.est) return r.est[1] > 0 ? `est. ${menStr(r.est[0])}–${menStr(r.est[1])} men` : 'no troops seen';
  if (v === 2) { const n = groundUnits(r.units); return `${n} formation${n === 1 ? '' : 's'} (old report)`; }
  return 'strength unknown';
}

/** One neighbour line that marches `from` -> `to`; `list` is the region shown on the line (the neighbour of the drawer's region). */
export function NeighbourRow({ from, to, list, label, brk }: { from: number; to: number; list: number; label: string; brk?: boolean }) {
  const sim = useSim(); const march = useUi.getState().march;
  if (!sim) return null;
  const { g, me } = sim; const W = buildWorld(); const src = g.regions[from]; const shown = g.regions[list]; const F = FACTIONS[shown.owner];
  const units = groundUnits(garrisonOf(g, shown)); const sea = W.seaLane.has(from + '|' + to);
  const disabled = src.battle >= 0 || groundUnits(src.units) < 2;
  const facing = shown.defs.filter(d => d.s === from && d.f === shown.owner).length, w = worksAt(shown, from);
  const works = list === to && (facing || w.tr || w.wire || w.sand) ? ` · facing us: ${[w.tr ? `trench ${roman(w.tr)}` : '', w.wire ? 'wire' : '', w.sand ? 'sandbags' : '', facing ? `${facing} def.` : ''].filter(Boolean).join(', ')}` : '';
  const info = list === to ? `${shown.owner === me ? 'Yours' : F.short} · ${knownTroops(shown, shown.owner === me)}${works}` : `${units} available`;
  return (
    <div className="it nb">
      <i className="dot" style={{ '--c': F.color } as React.CSSProperties} />
      <div className="tx"><b>{W.regions[list].name}</b><small>{info}{sea ? (shown.owner === me ? ' · by transport' : ' · amphibious assault') : ''}{isMountain(from, to) ? ' · over mountains' : ''}</small></div>
      <button className={'buy ' + (label === 'Attack' ? 'atk' : 'plain')} disabled={disabled}
        title={src.battle >= 0 ? 'Troops in a battle cannot leave' : groundUnits(src.units) < 2 ? 'Needs at least 2 ground formations' : brk ? 'This breaks the treaty: war weariness and lost trust' : undefined} onClick={() => march(from, to, brk)}>{label}</button>
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
      <div className="lbl"><span>Air strike · {region.units.plane} squadron{region.units.plane === 1 ? '' : 's'} · reach {AIR_RANGE} borders</span></div>
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

/** Cavalry patrols over our borders, and reconnaissance flights from this region's airfield. */
function ReconSection({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState, supply = g.factions[me].supply;
  const foes = W.regions[id].adj.filter(n => g.regions[n].owner !== me);
  const far = region.airfield ? g.regions.filter(r => r.owner !== me && hops(id, r.id, AIR_RANGE) === 2).slice(0, 6) : [];
  if (!foes.length && !far.length) return null;
  return (
    <>
      <div className="lbl"><span>Reconnaissance</span></div>
      {foes.map(n => (
        <div className="it nb" key={'p' + n}>
          <span className="ic"><Icon k="patrol" size={18} /></span>
          <div className="tx"><b>Patrol · {W.regions[n].name}</b><small>{reportAge(g, g.regions[n])} · may be caught by MG nests or wire</small></div>
          <button className="buy plain" disabled={supply < COST.patrol} onClick={() => ui().order({ t: 'patrol', from: id, to: n })}><SupplyIcon />{COST.patrol}</button>
        </div>
      ))}
      {region.airfield && [...foes.map(n => g.regions[n]), ...far].map(r => (
        <div className="it nb" key={'r' + r.id}>
          <span className="ic"><Icon k="recon" size={18} /></span>
          <div className="tx"><b>Recon flight · {W.regions[r.id].name}</b><small>{reportAge(g, r)} · photographs everything · anti-air may shoot it down</small></div>
          <button className="buy plain" disabled={supply < COST.recon} onClick={() => ui().order({ t: 'recon', from: id, to: r.id })}><SupplyIcon />{COST.recon}</button>
        </div>
      ))}
    </>
  );
}

/** Decoy marches: rivals watching see an army that is not there; into an own border region it fakes a concentration. */
function Feints({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); if (!sim || region.battle >= 0) return null;
  const { g, me } = sim, W = buildWorld(), supply = g.factions[me].supply;
  const adj = W.regions[id].adj;
  return (
    <>
      <div className="lbl"><span>Deception · a decoy march costs {COST.decoy} supply</span></div>
      {adj.slice(0, 6).map(n => {
        const own = g.regions[n].owner === me;
        return (
          <div className="it nb" key={'d' + n}>
            <span className="ic"><Icon k="inf" size={18} /></span>
            <div className="tx"><b>Feint {own ? 'to' : 'on'} {W.regions[n].name}</b><small>{own ? 'Rivals see an army arrive and a big concentration there until they scout it' : 'Rivals see an army marching on them; it melts away on arrival'}</small></div>
            <button className="buy plain" disabled={supply < COST.decoy} onClick={() => useUi.getState().order({ t: 'decoy', from: id, to: n })}><SupplyIcon />{COST.decoy}</button>
          </div>
        );
      })}
    </>
  );
}

/** "No report", "Report: 3 days old", "Our agent is there". */
export function reportAge(g: { day: number }, r: RegionState): string {
  if (r.spied) return 'our agent is there';
  if ((r.vis ?? 3) >= 3) return 'in full view';
  if (r.seen === undefined) return 'no report';
  const d = g.day - r.seen; return d <= 0 ? 'report: fresh' : `report: ${d} day${d === 1 ? '' : 's'} old`;
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
      <GoalPicker />
      <p className="note">An attack runs in phases: the troops form up in the middle of the region, march to the border, assemble there for half a minute, then go in. The enemy sees them gather.</p>
      <button className="btn sm wide pick-target" aria-pressed={active} disabled={region.battle >= 0 || groundUnits(region.units) < 2}
        onClick={() => { click(); const u = useUi.getState(); if (active) u.cancelOrder(); else u.beginOrder('march'); }}>
        {active ? 'Cancel · pick a target on the map' : 'Pick a target on the map'}
      </button>
      <div className="lbl"><span>Neighbouring regions · infantry and tanks attack across direct borders only</span></div>
      {adj.map(i => { const peace = g.regions[i].owner !== me && !!treatyOf(g, me, g.regions[i].owner); return <NeighbourRow key={i} from={id} to={i} list={i} brk={peace} label={g.regions[i].owner === me ? 'Reinforce' : peace ? 'Break treaty' : 'Attack'} />; })}
      <Feints region={region} id={id} />
      <AirSection region={region} id={id} />
      <ReconSection region={region} id={id} />
      <p className="note">Shortcut: right-click a region on the map.</p>
    </>
  );
}
