// The navy in the War Office: the Harbour tab of a coastal region (port, ships in port, shipbuilding, shipping and landings,
// battle fleets and carriers), the card of a selected fleet at sea, the card of a naval battle, and the fleets list.
import {
  FACTIONS, PORT, SHIP, AIR_RANGE, buildWorld, carrierAt, carrierDay, carrierHops, dateStr as simDate, docked, fleetLabel, fleetPos, fleetShips, fleetZone, groundUnits, portReady, shipCost, shipMax,
  type Fleet, type GameState, type RegionState, type SeaBattle, type Ship, type ShipKind,
} from '@riskrts/shared';
import { monthStr, useSim, useUi } from '../game/store';
import { click } from './actions';
import { CloseIcon, Icon, SupplyIcon } from './icons';
import { rendererRef } from './refs';
import { SharePicker } from './DrawerTabs';
import { t, tx } from '../i18n';
import { nm } from './format';

const KINDS: ShipKind[] = ['trans', 'land', 'bb', 'carrier'];
const STATE: Record<Fleet['state'], string> = { muster: 'Gathering at the coast', embark: 'Embarking', sail: 'At sea', offshore: 'Assembling offshore', beach: 'Landing', unload: 'Landing the second wave', land: 'Disembarking', stationed: 'On station' };

/** "2 dreadnoughts, 1 transport" in the interface language (fleetLabel of the simulation). */
function fleetName(g: GameState, fl: Fleet): string {
  const ships = fleetShips(g, fl);
  return (['bb', 'carrier', 'land', 'trans'] as const).map(k => { const c = ships.filter(s => s.kind === k).length; return c ? `${c} ${tx(c === 1 ? SHIP[k].one : SHIP[k].many)}` : ''; }).filter(Boolean).join(', ');
}
void fleetLabel;

/** What a fleet is doing, in words, with the seconds left. */
export function fleetState(g: GameState, fl: Fleet): string {
  const W = buildWorld(), z = fleetZone(fl), zn = z >= 0 ? W.zones[z].name : 'the open sea';
  const left = fl.state === 'sail' ? Math.ceil((fl.len - fl.d) / Math.max(.01, fl.v)) : Math.ceil(fl.t);
  const to = fl.to >= 0 ? W.regions[fl.to].name : '';
  if (fl.sea !== undefined) return t('Fighting in the {0}', zn);
  if (fl.state === 'stationed') return t('On station in the {0}', zn);
  if (fl.state === 'sail') return fl.task === 'station' ? t('Sailing to the {0} · {1} s', W.zones[fl.zone]?.name ?? zn, left) : fl.task === 'return' ? (to ? t('Homeward bound to {0} · {1} s', to, left) : t('Homeward bound · {0} s', left)) : t('Bound for {0} · {1} s · in the {2}', to, left, zn);
  if (fl.state === 'offshore') return fl.storm ? t('Offshore at {0}, held back by storms', to) : t('Offshore at {0} · landing in {1} s', to, left);
  return `${t(STATE[fl.state])}${to ? ' · ' + nm(to) : ''}${fl.t > 0 ? ` · ${left} s` : ''}`;
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
      <div className="lbl"><span>{t('Port')}</span></div>
      {region.port ? (
        <p className="note">{ready ? t('Port of {0} · ships load in {1} s here, guns and tanks need a quay · damaged ships repair here each convoy.', W.regions[id].name, Math.round(15)) : t('The port is being built · ready in {0} s.', Math.ceil((region.portAt ?? g.time) - g.time))}</p>
      ) : (
        <div className="it">
          <span className="ic"><Icon k="port" /></span>
          <div className="tx"><b>{t('Build a port')}</b><small>{t('Ships are built and repaired in ports; troops embark in 15 s instead of 40, and guns and tanks only at a quay · ready in {0} convoys', PORT.convoys)}</small></div>
          <button className="buy" disabled={supply < PORT.cost} onClick={() => ui().build(id, 'port')}><SupplyIcon />{PORT.cost}</button>
        </div>
      )}
      {(here.length > 0 || building.length > 0) && <div className="lbl"><span>{t('In port')}</span></div>}
      {KINDS.map(k => {
        const list = here.filter(s => s.kind === k), b = building.filter(s => s.kind === k).length;
        if (!list.length && !b) return null;
        const hp = list.reduce((s, x) => s + x.hp / shipMax(x), 0) / Math.max(1, list.length);
        return (
          <div className="it fleet-card" key={k}>
            <span className="ic"><Icon k={shipIcon(k)} /></span>
            <div className="tx"><b>{list.length} {tx(list.length === 1 ? SHIP[k].one : SHIP[k].many)}{b ? ' · ' + t('{0} building', b) : ''}</b>
              <small>{k === 'carrier' ? list.map(s => t('{0}/3 squadrons', s.planes ?? 0)).join(' · ') : list.length ? t('{0}% fit', Math.round(hp * 100)) : t('ready in {0} s', Math.ceil(Math.min(...building.filter(s => s.kind === k).map(s => (s.ready ?? 0) - g.time))))}</small>
              {list.length > 0 && <HpBar v={hp} c={FACTIONS[me].color} />}</div>
          </div>
        );
      })}
      {ready && (
        <>
          <div className="lbl"><span>{t('Shipyard')}</span></div>
          {KINDS.map(k => {
            const c = shipCost(me, k), noYard = SHIP[k].factory && !region.factory, early = k === 'carrier' && g.day < carrierDay(me);
            const lock = early ? (monthStr(carrierDay(me))) : noYard ? t('Needs factory') : '';
            return (
              <div className="it" key={k}>
                <span className="ic"><Icon k={shipIcon(k)} /></span>
                <div className="tx"><b>{tx(SHIP[k].name)}</b><small>{lock ? lock + ' · ' : ''}{tx(SHIP[k].desc)} · {SHIP[k].convoys === 1 ? t('{0} convoy', 1) : t('{0} convoys', SHIP[k].convoys)}</small></div>
                <button className="buy" disabled={!!lock || supply < c || region.cut} onClick={() => ui().order({ t: 'buildShip', region: id, kind: k })}><SupplyIcon />{c}</button>
              </div>
            );
          })}
        </>
      )}
      <SharePicker />
      <div className="lbl"><span>{t('Over the sea')}</span></div>
      <div className="it">
        <span className="ic"><Icon k="trans" /></span>
        <div className="tx"><b>{t('Ship troops to…')}</b><small>{anyFree('trans') ? t('The nearest free transports come here; click one of your coastal regions') : t('No transports free: build one in a port')}</small></div>
        <button className="buy plain" disabled={!anyFree('trans')} onClick={() => { click(); ui().beginOrder('ship'); }}>{t('Pick')}</button>
      </div>
      <div className="it">
        <span className="ic"><Icon k="land" /></span>
        <div className="tx"><b>{t('Assault a coast…')}</b><small>{anyFree('land') ? t('Landing craft carry the first wave, transports the rest; click an enemy coast') : t('No landing flotillas free: build one in a port')}</small></div>
        <button className="buy atk" disabled={!anyFree('land')} onClick={() => { click(); ui().beginOrder('landing'); }}>{t('Pick')}</button>
      </div>
      {bbs.length > 0 && (
        <div className="it">
          <span className="ic"><Icon k="bb" /></span>
          <div className="tx"><b>{t('Station the battleships…')}</b><small>{t('{0} fit for sea · they hold a zone, intercept convoys and bombard coasts · in port they still deny the zone (fleet in being)', bbs.filter(s => s.hp > shipMax(s) * .4).length)}</small></div>
          <button className="buy plain" onClick={() => { click(); ui().beginOrder('station', -1, 'bb'); }}>{t('Pick zone')}</button>
        </div>
      )}
      {cv.map(s => (
        <div className="it" key={s.id}>
          <span className="ic"><Icon k="carrier" /></span>
          <div className="tx"><b>{t('Carrier · {0}/3 squadrons aboard', s.planes ?? 0)}</b><small>{t('Take squadrons of this region aboard, then station it in a zone or strike the coasts in reach')}</small></div>
          <div className="buys">
            <button className="buy plain" disabled={region.units.plane < 1 || (s.planes ?? 0) >= 3} onClick={() => ui().order({ t: 'embarkAir', region: id, ship: s.id, n: 3 })}>{t('Embark')}</button>
            <button className="buy plain" disabled={!(s.planes ?? 0)} onClick={() => { click(); ui().beginOrder('cvair', s.id); }}>{t('Strike')}</button>
            <button className="buy plain" onClick={() => { click(); ui().beginOrder('station', -1, 'carrier'); }}>{t('Station')}</button>
          </div>
        </div>
      ))}
      {fleets.length > 0 && <div className="lbl"><span>{t('Fleets at sea')}</span></div>}
      {fleets.slice(0, 8).map(f => <FleetRow key={f.id} g={g} f={f} />)}
      <p className="note">{t('Every crossing of the sea needs ships. A move to a coast you cannot reach over land uses transports on its own; an attack over a sea lane is an amphibious assault.')}</p>
    </>
  );
}

function FleetRow({ g, f }: { g: GameState; f: Fleet }) {
  return (
    <button className="it nb front-it" onClick={() => { click(); useUi.getState().selectFleet(f.id); const p = fleetPos(f); rendererRef.current?.flyToPoint?.(p.x, p.z, 14); }}>
      <i className="dot" style={{ '--c': FACTIONS[f.owner].color } as React.CSSProperties} />
      <span className="tx"><b>{fleetName(g, f)}</b><small>{fleetState(g, f)}{groundUnits(f.cargo) ? ' · ' + t('{0} formations aboard', groundUnits(f.cargo)) : ''}</small></span>
      <span className="go">{t('Go')}</span>
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
      <div className="lbl"><span>{t('At sea')}</span></div>
      {seas.map(b => (
        <button key={'s' + b.id} className="it nb front-it" onClick={() => { click(); useUi.getState().selectSea(b.id); rendererRef.current?.flyToSea?.(b.id); }}>
          <span className="ic"><Icon k="bb" size={18} /></span>
          <span className="tx"><b>{t('Naval battle · {0}', W.zones[b.zone].name)}</b><small>{Math.floor(b.age)} s{b.age >= b.night ? ' · ' + t('night action') : ''}</small></span>
          <span className="go">{t('Go')}</span>
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
        <div className="bt"><b>{own ? t('Our fleet') : t('{0} fleet', F.short)} · {fleetName(g, fl)}</b>
          <button className="x" aria-label={t('Close')} onClick={() => ui().selectFleet(-1)}><CloseIcon /></button></div>
        <div className="bf"><small>{fleetState(g, fl)}{groundUnits(fl.cargo) ? ' · ' + t('{0} formations aboard', `${own ? '' : '~'}${groundUnits(fl.cargo)}`) : ''}</small></div>
        {ships.slice(0, 8).map(s => <ShipLine key={s.id} s={s} />)}
      </div>
      {own && (
        <div className="levers compact"><div className="lv-row acts">
          {war && fl.sea === undefined && <button className="btn sm" onClick={() => { click(); ui().beginOrder('station', fl.id); }}>{t('Station elsewhere')}</button>}
          {war && fl.sea === undefined && <button className="btn sm" onClick={() => ui().order({ t: 'dock', fleet: fl.id })}>{t('Return to port')}</button>}
          {cv && fl.sea === undefined && <button className="btn sm primary" onClick={() => { click(); ui().beginOrder('cvair', cv.id); }}>{t('Carrier strike')}</button>}
          {fl.sea !== undefined && <button className="btn sm danger" onClick={() => ui().order({ t: 'breakOff', sea: fl.sea! })}>{t('Break off')}</button>}
          <button className="btn sm" onClick={() => { const p = fleetPos(fl); rendererRef.current?.flyToPoint?.(p.x, p.z, 10); }}>{t('Follow')}</button>
        </div></div>
      )}
    </div>
  );
}

function ShipLine({ s }: { s: Ship }) {
  return (
    <div className="side" style={{ '--c': FACTIONS[s.owner].color } as React.CSSProperties}>
      <span className="nm"><Icon k={shipIcon(s.kind)} size={14} /> {tx(SHIP[s.kind].name)}{s.kind === 'carrier' ? ' · ' + t('{0} sq.', s.planes ?? 0) : ''}</span>
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
  const sunk = (s: number) => { const x = b.sunk[s] ?? {}; return (['dn', 'dd', 'cv', 'tr', 'lc'] as const).map(k => x[k] ? `${x[k]} ${x[k] > 1 ? ({ dn: t('dreadnoughts'), dd: t('destroyers'), cv: t('carriers'), tr: t('transports'), lc: t('landing flotillas') })[k] : ({ dn: t('dreadnought'), dd: t('destroyer'), cv: t('carrier'), tr: t('transport'), lc: t('landing flotilla') })[k]}` : '').filter(Boolean).join(', ') || t('none'); };
  const night = b.age >= b.night && !b.ended;
  return (
    <div id="scard" className="plate cmdbar sea-card" aria-live="polite">
      <div className="cb-sides">
        <div className="bt"><b>{t('Naval battle · {0}', W.zones[b.zone].name)}</b><small className="lcd-t">{b.ended ? (b.winner === mySide ? t('Won') : b.winner === 1 - mySide ? t('Lost') : t('Over')) : `${Math.floor(b.age)} s${night ? ' · ' + t('night action') : ''}`}</small>
          <button className="x" aria-label={t('Close')} onClick={() => useUi.getState().selectSea(-1)}><CloseIcon /></button></div>
        {[0, 1].map(s => (
          <div className="side" key={s} style={{ '--c': FACTIONS[b.sides[s][0]]?.color ?? '#888' } as React.CSSProperties}>
            <span className="nm"><span className="crest sm">{FACTIONS[b.sides[s][0]]?.key}</span>{b.sides[s].map(f => nm(FACTIONS[f].short)).join(', ')}{b.brk[s] ? ' · ' + t('breaking off') : ''}</span>
            <span className="sb"><i style={{ width: `${b.hp0[s] ? hp[s] / b.hp0[s] * 100 : 0}%` }} /></span>
            <span className="n">{left[s].length}<small> · {t('lost {0}', sunk(s))}</small></span>
          </div>
        ))}
      </div>
      <div className="levers compact"><div className="lv-row acts">
        <button className="btn sm" onClick={() => rendererRef.current?.flyToSea?.(b.id)}>{t('Watch')}</button>
        {mySide >= 0 && !b.ended && <button className="btn sm danger" disabled={b.brk[mySide]} title={t('Turn away and run for port: the battle line falls back under fire')} onClick={() => useUi.getState().order({ t: 'breakOff', sea: b.id })}>{t('Break off')}</button>}
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
      <div className="lbl"><span>{t('Assault from the sea')}{crafts ? '' : ' · ' + t('no landing flotillas free')}</span></div>
      {bases.map(r => (
        <div className="it nb" key={r.id}>
          <span className="ic"><Icon k="land" size={18} /></span>
          <div className="tx"><b>{t('From {0}', W.regions[r.id].name)}</b><small>{t('{0} formations · the first wave lands from boats, guns follow once the beach is taken', groundUnits(r.units))}</small></div>
          <button className="buy atk" disabled={!crafts} onClick={() => ui().order({ t: 'landing', from: r.id, to: target, frac: ui().sendFrac, goal: ui().goal })}>{t('Land')}</button>
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
      <div className="lbl"><span>{t('Carrier strike')}</span></div>
      {cvs.map(s => { const at = carrierAt(g, s)!; return (
        <div className="it nb" key={s.id}>
          <span className="ic"><Icon k="carrier" size={18} /></span>
          <div className="tx"><b>{t('Carrier in the {0}', W.zones[at.zone].name)}</b><small>{s.planes === 1 ? t('{0} squadron aboard', 1) : t('{0} squadrons aboard', s.planes ?? 0)}</small></div>
          <button className="buy atk" onClick={() => useUi.getState().order({ t: 'carrierAir', ship: s.id, to: target })}>{t('Strike')}</button>
        </div>
      ); })}
    </>
  );
}
void simDate;
