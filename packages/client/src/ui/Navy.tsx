// The navy in the War Office: the Harbour tab of a coastal region (port, ships in port, shipbuilding, shipping and landings,
// battle fleets and carriers), the card of a selected fleet at sea, the card of a naval battle, and the fleets list.
import {
  FACTIONS, PORT, SHIP, AIR_RANGE, buildWorld, carrierAt, carrierDay, carrierHops, dateStr as simDate, docked, fleetLabel, fleetPos, fleetShips, fleetZone, groundUnits, monthStr, portReady, shipCost, shipMax,
  type Fleet, type GameState, type RegionState, type SeaBattle, type Ship, type ShipKind,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { CloseIcon, Icon, SupplyIcon } from './icons';
import { rendererRef } from './refs';
import { SharePicker } from './DrawerTabs';

const KINDS: ShipKind[] = ['trans', 'land', 'bb', 'carrier'];
const STATE: Record<Fleet['state'], string> = { muster: 'Gathering at the coast', embark: 'Embarking', sail: 'At sea', offshore: 'Assembling offshore', beach: 'Landing', unload: 'Landing the second wave', land: 'Disembarking', stationed: 'On station' };

/** What a fleet is doing, in words, with the seconds left. */
export function fleetState(g: GameState, fl: Fleet): string {
  const W = buildWorld(), z = fleetZone(fl), zn = z >= 0 ? W.zones[z].name : 'the open sea';
  const left = fl.state === 'sail' ? Math.ceil((fl.len - fl.d) / Math.max(.01, fl.v)) : Math.ceil(fl.t);
  const to = fl.to >= 0 ? W.regions[fl.to].name : '';
  if (fl.sea !== undefined) return `Fighting in the ${zn}`;
  if (fl.state === 'stationed') return `On station in the ${zn}`;
  if (fl.state === 'sail') return fl.task === 'station' ? `Sailing to the ${W.zones[fl.zone]?.name ?? zn} · ${left} s` : fl.task === 'return' ? `Homeward bound${to ? ' to ' + to : ''} · ${left} s` : `Bound for ${to} · ${left} s · in the ${zn}`;
  if (fl.state === 'offshore') return fl.storm ? `Offshore at ${to}, held back by storms` : `Offshore at ${to} · landing in ${left} s`;
  return `${STATE[fl.state]}${to ? ' · ' + to : ''}${fl.t > 0 ? ` · ${left} s` : ''}`;
}

function HpBar({ v, c }: { v: number; c?: string }) { return <span className="hpbar" style={{ '--c': c } as React.CSSProperties}><i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></span>; }

const shipIcon = (k: ShipKind) => k as 'trans' | 'land' | 'bb' | 'carrier';

/** The harbour section of an own coastal region's Build tab. */
export function NavyTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState, supply = g.factions[me].supply;
  const ready = portReady(g, region), here = docked(g, id, me), building = g.ships.filter(s => s.port === id && s.owner === me && (s.ready ?? 0) > g.time);
  const anyFree = (k: ShipKind) => g.ships.some(s => s.owner === me && s.kind === k && s.fleet < 0 && (s.ready ?? 0) <= g.time);
  const cv = here.filter(s => s.kind === 'carrier'), bbs = here.filter(s => s.kind === 'bb');
  const fleets = g.fleets.filter(f => f.owner === me);
  return (
    <>
      <div className="lbl"><span>Port</span></div>
      {region.port ? (
        <p className="note">{ready ? <>Port of {W.regions[id].name} · ships load in {Math.round(15)} s here, guns and tanks need a quay · damaged ships repair here each convoy.</> : <>The port is being built · ready in {Math.ceil((region.portAt ?? g.time) - g.time)} s.</>}</p>
      ) : (
        <div className="it">
          <span className="ic"><Icon k="port" /></span>
          <div className="tx"><b>Build a port</b><small>Ships are built and repaired in ports; troops embark in 15 s instead of 40, and guns and tanks only at a quay · ready in {PORT.convoys} convoys</small></div>
          <button className="buy" disabled={supply < PORT.cost} onClick={() => ui().build(id, 'port')}><SupplyIcon />{PORT.cost}</button>
        </div>
      )}
      {(here.length > 0 || building.length > 0) && <div className="lbl"><span>In port</span></div>}
      {KINDS.map(k => {
        const list = here.filter(s => s.kind === k), b = building.filter(s => s.kind === k).length;
        if (!list.length && !b) return null;
        const hp = list.reduce((s, x) => s + x.hp / shipMax(x), 0) / Math.max(1, list.length);
        return (
          <div className="it fleet-card" key={k}>
            <span className="ic"><Icon k={shipIcon(k)} /></span>
            <div className="tx"><b>{list.length} {list.length === 1 ? SHIP[k].one : SHIP[k].many}{b ? ` · ${b} building` : ''}</b>
              <small>{k === 'carrier' ? list.map(s => `${s.planes ?? 0}/3 squadrons`).join(' · ') : list.length ? `${Math.round(hp * 100)}% fit` : `ready in ${Math.ceil(Math.min(...building.filter(s => s.kind === k).map(s => (s.ready ?? 0) - g.time)))} s`}</small>
              {list.length > 0 && <HpBar v={hp} c={FACTIONS[me].color} />}</div>
          </div>
        );
      })}
      {ready && (
        <>
          <div className="lbl"><span>Shipyard</span></div>
          {KINDS.map(k => {
            const c = shipCost(me, k), noYard = SHIP[k].factory && !region.factory, early = k === 'carrier' && g.day < carrierDay(me);
            const lock = early ? monthStr(carrierDay(me)) : noYard ? 'Needs factory' : '';
            return (
              <div className="it" key={k}>
                <span className="ic"><Icon k={shipIcon(k)} /></span>
                <div className="tx"><b>{SHIP[k].name}</b><small>{lock ? lock + ' · ' : ''}{SHIP[k].desc} · {SHIP[k].convoys} convoy{SHIP[k].convoys === 1 ? '' : 's'}</small></div>
                <button className="buy" disabled={!!lock || supply < c || region.cut} onClick={() => ui().order({ t: 'buildShip', region: id, kind: k })}><SupplyIcon />{c}</button>
              </div>
            );
          })}
        </>
      )}
      <SharePicker />
      <div className="lbl"><span>Over the sea</span></div>
      <div className="it">
        <span className="ic"><Icon k="trans" /></span>
        <div className="tx"><b>Ship troops to…</b><small>{anyFree('trans') ? 'The nearest free transports come here; click one of your coastal regions' : 'No transports free: build one in a port'}</small></div>
        <button className="buy plain" disabled={!anyFree('trans')} onClick={() => { click(); ui().beginOrder('ship'); }}>Pick</button>
      </div>
      <div className="it">
        <span className="ic"><Icon k="land" /></span>
        <div className="tx"><b>Assault a coast…</b><small>{anyFree('land') ? 'Landing craft carry the first wave, transports the rest; click an enemy coast' : 'No landing flotillas free: build one in a port'}</small></div>
        <button className="buy atk" disabled={!anyFree('land')} onClick={() => { click(); ui().beginOrder('landing'); }}>Pick</button>
      </div>
      {bbs.length > 0 && (
        <div className="it">
          <span className="ic"><Icon k="bb" /></span>
          <div className="tx"><b>Station the battleships…</b><small>{bbs.filter(s => s.hp > shipMax(s) * .4).length} fit for sea · they hold a zone, intercept convoys and bombard coasts · in port they still deny the zone (fleet in being)</small></div>
          <button className="buy plain" onClick={() => { click(); ui().beginOrder('station', -1, 'bb'); }}>Pick zone</button>
        </div>
      )}
      {cv.map(s => (
        <div className="it" key={s.id}>
          <span className="ic"><Icon k="carrier" /></span>
          <div className="tx"><b>Carrier · {s.planes ?? 0}/3 squadrons aboard</b><small>Take squadrons of this region aboard, then station it in a zone or strike the coasts in reach</small></div>
          <div className="buys">
            <button className="buy plain" disabled={region.units.plane < 1 || (s.planes ?? 0) >= 3} onClick={() => ui().order({ t: 'embarkAir', region: id, ship: s.id, n: 3 })}>Embark</button>
            <button className="buy plain" disabled={!(s.planes ?? 0)} onClick={() => { click(); ui().beginOrder('cvair', s.id); }}>Strike</button>
            <button className="buy plain" onClick={() => { click(); ui().beginOrder('station', -1, 'carrier'); }}>Station</button>
          </div>
        </div>
      ))}
      {fleets.length > 0 && <div className="lbl"><span>Fleets at sea</span></div>}
      {fleets.slice(0, 8).map(f => <FleetRow key={f.id} g={g} f={f} />)}
      <p className="note">Every crossing of the sea needs ships. A move to a coast you cannot reach over land uses transports on its own; an attack over a sea lane is an amphibious assault.</p>
    </>
  );
}

function FleetRow({ g, f }: { g: GameState; f: Fleet }) {
  return (
    <button className="it nb front-it" onClick={() => { click(); useUi.getState().selectFleet(f.id); const p = fleetPos(f); rendererRef.current?.flyToPoint?.(p.x, p.z, 14); }}>
      <i className="dot" style={{ '--c': FACTIONS[f.owner].color } as React.CSSProperties} />
      <span className="tx"><b>{fleetLabel(g, f)}</b><small>{fleetState(g, f)}{groundUnits(f.cargo) ? ` · ${groundUnits(f.cargo)} formations aboard` : ''}</small></span>
      <span className="go">Go</span>
    </button>
  );
}

/** Fleets and naval battles of the power, for the War Office overview. */
export function FleetList() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld();
  const fleets = g.fleets.filter(f => f.owner === me), seas = (g.seaBattles ?? []).filter(b => !b.ended && b.sides.some(s => s.includes(me)));
  if (!fleets.length && !seas.length) return null;
  return (
    <>
      <div className="lbl"><span>At sea</span></div>
      {seas.map(b => (
        <button key={'s' + b.id} className="it nb front-it" onClick={() => { click(); useUi.getState().selectSea(b.id); rendererRef.current?.flyToSea?.(b.id); }}>
          <span className="ic"><Icon k="bb" size={18} /></span>
          <span className="tx"><b>Naval battle · {W.zones[b.zone].name}</b><small>{Math.floor(b.age)} s{b.age >= b.night ? ' · night action' : ''}</small></span>
          <span className="go">Go</span>
        </button>
      ))}
      {fleets.slice(0, 8).map(f => <FleetRow key={f.id} g={g} f={f} />)}
    </>
  );
}

/** The selected fleet: what it is, where it goes, its ships; orders for own warships. */
export function FleetCard() {
  const sim = useSim(); const id = useUi(s => s.fleet);
  if (!sim || id < 0) return null;
  const { g, me } = sim, fl = g.fleets.find(f => f.id === id);
  if (!fl) return null;
  const ships = fleetShips(g, fl), own = fl.owner === me, ui = useUi.getState, F = FACTIONS[fl.owner];
  const war = ships.some(s => s.kind === 'bb' || s.kind === 'carrier') && !ships.some(s => s.kind === 'trans' || s.kind === 'land');
  const cv = ships.find(s => s.kind === 'carrier' && (s.planes ?? 0) > 0);
  return (
    <div id="fcard" className="plate cmdbar fleet-card" aria-live="polite" style={{ '--c': F.color } as React.CSSProperties}>
      <div className="cb-sides">
        <div className="bt"><b>{own ? 'Our fleet' : `${F.short} fleet`} · {fleetLabel(g, fl)}</b>
          <button className="x" aria-label="Close" onClick={() => ui().selectFleet(-1)}><CloseIcon /></button></div>
        <div className="bf"><small>{fleetState(g, fl)}{groundUnits(fl.cargo) ? ` · ${own ? '' : '~'}${groundUnits(fl.cargo)} formations aboard` : ''}</small></div>
        {ships.slice(0, 8).map(s => <ShipLine key={s.id} s={s} />)}
      </div>
      {own && (
        <div className="levers compact"><div className="lv-row acts">
          {war && fl.sea === undefined && <button className="btn sm" onClick={() => { click(); ui().beginOrder('station', fl.id); }}>Station elsewhere</button>}
          {war && fl.sea === undefined && <button className="btn sm" onClick={() => ui().order({ t: 'dock', fleet: fl.id })}>Return to port</button>}
          {cv && fl.sea === undefined && <button className="btn sm primary" onClick={() => { click(); ui().beginOrder('cvair', cv.id); }}>Carrier strike</button>}
          {fl.sea !== undefined && <button className="btn sm danger" onClick={() => ui().order({ t: 'breakOff', sea: fl.sea! })}>Break off</button>}
          <button className="btn sm" onClick={() => { const p = fleetPos(fl); rendererRef.current?.flyToPoint?.(p.x, p.z, 10); }}>Follow</button>
        </div></div>
      )}
    </div>
  );
}

function ShipLine({ s }: { s: Ship }) {
  return (
    <div className="side" style={{ '--c': FACTIONS[s.owner].color } as React.CSSProperties}>
      <span className="nm"><Icon k={shipIcon(s.kind)} size={14} /> {SHIP[s.kind].name}{s.kind === 'carrier' ? ` · ${s.planes ?? 0} sq.` : ''}</span>
      <span className="sb"><i style={{ width: `${s.hp / shipMax(s) * 100}%` }} /></span>
      <span className="n">{Math.round(s.hp)}</span>
    </div>
  );
}

/** A naval battle: both fleets with their strength left and losses, night, and breaking off. */
export function SeaCard() {
  const sim = useSim(); const sel = useUi(s => s.seaSel);
  if (!sim) return null;
  const { g, me } = sim, W = buildWorld();
  const b: SeaBattle | undefined = (g.seaBattles ?? []).find(x => x.id === sel) ?? (sel < 0 ? (g.seaBattles ?? []).find(x => !x.ended && x.sides.some(s => s.includes(me))) : undefined);
  if (!b) return null;
  const mySide = b.sides.findIndex(s => s.includes(me));
  const hp = [0, 1].map(s => b.agents.reduce((h, a) => h + (a.kind !== 'pl' && b.sides[s].includes(a.f) && !a.dead ? Math.max(0, a.hp) : 0), 0));
  const left = [0, 1].map(s => b.agents.filter(a => !a.dead && !a.out && a.kind !== 'pl' && b.sides[s].includes(a.f)));
  const sunk = (s: number) => { const x = b.sunk[s] ?? {}; return (['dn', 'dd', 'cv', 'tr', 'lc'] as const).map(k => x[k] ? `${x[k]} ${({ dn: 'dreadnought', dd: 'destroyer', cv: 'carrier', tr: 'transport', lc: 'landing flotilla' })[k]}${x[k] > 1 ? 's' : ''}` : '').filter(Boolean).join(', ') || 'none'; };
  const night = b.age >= b.night && !b.ended;
  return (
    <div id="scard" className="plate cmdbar sea-card" aria-live="polite">
      <div className="cb-sides">
        <div className="bt"><b>Naval battle · {W.zones[b.zone].name}</b><small className="lcd-t">{b.ended ? (b.winner === mySide ? 'Won' : b.winner === 1 - mySide ? 'Lost' : 'Over') : `${Math.floor(b.age)} s${night ? ' · night action' : ''}`}</small>
          <button className="x" aria-label="Close" onClick={() => useUi.getState().selectSea(-1)}><CloseIcon /></button></div>
        {[0, 1].map(s => (
          <div className="side" key={s} style={{ '--c': FACTIONS[b.sides[s][0]]?.color ?? '#888' } as React.CSSProperties}>
            <span className="nm"><span className="crest sm">{FACTIONS[b.sides[s][0]]?.key}</span>{b.sides[s].map(f => FACTIONS[f].short).join(', ')}{b.brk[s] ? ' · breaking off' : ''}</span>
            <span className="sb"><i style={{ width: `${b.hp0[s] ? hp[s] / b.hp0[s] * 100 : 0}%` }} /></span>
            <span className="n">{left[s].length}<small> · lost {sunk(s)}</small></span>
          </div>
        ))}
      </div>
      <div className="levers compact"><div className="lv-row acts">
        <button className="btn sm" onClick={() => rendererRef.current?.flyToSea?.(b.id)}>Watch</button>
        {mySide >= 0 && !b.ended && <button className="btn sm danger" disabled={b.brk[mySide]} title="Turn away and run for port: the battle line falls back under fire" onClick={() => useUi.getState().order({ t: 'breakOff', sea: b.id })}>Break off</button>}
      </div></div>
    </div>
  );
}

/** Coastal regions of mine from which an enemy coast can be assaulted (rows for a foreign region's file). */
export function LandingRows({ target }: { target: number }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), T = W.regions[target];
  if (!T.zones.length) return null;
  const crafts = g.ships.some(s => s.owner === me && s.kind === 'land' && s.fleet < 0 && (s.ready ?? 0) <= g.time);
  const bases = g.regions.filter(r => r.owner === me && r.battle < 0 && W.regions[r.id].zones.length && groundUnits(r.units) >= 2 && !W.regions[r.id].land.includes(target))
    .sort((a, b) => (W.regions[b.id].zones.some(z => T.zones.includes(z)) ? 1 : 0) - (W.regions[a.id].zones.some(z => T.zones.includes(z)) ? 1 : 0) || groundUnits(b.units) - groundUnits(a.units)).slice(0, 3);
  if (!bases.length) return null;
  const ui = useUi.getState;
  return (
    <>
      <div className="lbl"><span>Assault from the sea{crafts ? '' : ' · no landing flotillas free'}</span></div>
      {bases.map(r => (
        <div className="it nb" key={r.id}>
          <span className="ic"><Icon k="land" size={18} /></span>
          <div className="tx"><b>From {W.regions[r.id].name}</b><small>{groundUnits(r.units)} formations · the first wave lands from boats, guns follow once the beach is taken</small></div>
          <button className="buy atk" disabled={!crafts} onClick={() => ui().order({ t: 'landing', from: r.id, to: target, frac: ui().sendFrac, goal: ui().goal })}>Land</button>
        </div>
      ))}
    </>
  );
}

/** Carriers of mine that reach a region (rows for a foreign region's file). */
export function CarrierRows({ target }: { target: number }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld();
  const cvs = g.ships.filter(s => s.owner === me && s.kind === 'carrier' && (s.planes ?? 0) > 0).filter(s => { const at = carrierAt(g, s); return at && carrierHops(at.zone, target) <= AIR_RANGE; });
  if (!cvs.length) return null;
  return (
    <>
      <div className="lbl"><span>Carrier strike</span></div>
      {cvs.map(s => { const at = carrierAt(g, s)!; return (
        <div className="it nb" key={s.id}>
          <span className="ic"><Icon k="carrier" size={18} /></span>
          <div className="tx"><b>Carrier in the {W.zones[at.zone].name}</b><small>{s.planes} squadron{s.planes === 1 ? '' : 's'} aboard</small></div>
          <button className="buy atk" onClick={() => useUi.getState().order({ t: 'carrierAir', ship: s.id, to: target })}>Strike</button>
        </div>
      ); })}
    </>
  );
}
void simDate;
