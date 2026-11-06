// Fog of war. Every power sees its own regions in full and the owner of every region on the map. Across its own borders it
// observes an estimate of the troops and the defences facing it; everything else it knows only from reconnaissance reports
// (cavalry patrols, reconnaissance flights, spies), which age. Views are built from the authoritative state for one viewer:
// the local player's screen, each network guest's snapshots and each computer power's decisions all go through fogView.
import { isCoast, zoneAt, zoneOfKey } from '../world/zones';
import { emptyUnits, groundUnits, type Units } from '../data/units';
import { emit, menTotal, rnd, world } from './core';
import type { Army, Battle, Corps, Defence, GameState, Intel, RegionState, Works } from './types';
import { corpsIn } from './posts';
import { allied } from './diplomacy';

export const MAX_SPIES = 3;
/** Days after which a report is shown as out of date. */
export const STALE_DAYS = 21;

const cloneWorks = (w: Record<number, Works>) => { const o: Record<number, Works> = {}; for (const [k, v] of Object.entries(w)) o[+k] = { ...v }; return o; };
const cloneDefs = (d: Defence[]) => d.map(x => ({ ...x }));
const cloneCorps = (cs?: Corps[]) => cs?.length ? cs.map(c => ({ ...c, u: { ...c.u }, m: { ...c.m } })) : undefined;

/** File a report on `region` for `fid`. With `sector`, only the troops and that border's defences are seen (a patrol). */
export function recordIntel(g: GameState, fid: number, region: number, sector?: number) {
  const r = g.regions[region], prev = g.intel[fid]?.[region] ?? null;
  const own = r.defs.filter(d => d.f === r.owner);
  let defs: Defence[], works: Record<number, Works>;
  if (sector === undefined) { defs = cloneDefs(own); works = cloneWorks(r.works); }
  else {
    defs = [...(prev?.defs.filter(d => d.s !== sector) ?? []), ...cloneDefs(own.filter(d => d.s === sector))];
    works = prev ? cloneWorks(prev.works) : {}; if (r.works[sector]) works[sector] = { ...r.works[sector] }; else delete works[sector];
  }
  // corps: every border on a full report, the patrolled border (and what was known of the others) on a patrol
  let cs: Corps[] | undefined;
  if (sector === undefined) cs = cloneCorps(r.cs);
  else cs = cloneCorps([...(prev?.cs ?? []).filter(c => c.p !== sector), ...corpsIn(r).filter(c => c.p === sector)]);
  const it: Intel = {
    day: g.day, time: g.time, owner: r.owner, units: { ...r.units }, men: { ...r.men }, defs, works, cs,
    factory: sector === undefined ? r.factory : prev?.factory ?? false, barracks: sector === undefined ? r.barracks : prev?.barracks ?? false, airfield: sector === undefined ? r.airfield : prev?.airfield ?? false,
  };
  (g.intel[fid] ??= [])[region] = it;
}

/** Spies that have reached their region and still work there. */
export const activeSpies = (g: GameState, fid: number) => g.spies.filter(s => s.f === fid && s.eta <= g.time);

/** Spies: a spy whose region became ours is done; arrivals file a report and are announced. Called every step. */
export function updateSpies(g: GameState) {
  for (let i = g.spies.length - 1; i >= 0; i--) {
    const s = g.spies[i], r = g.regions[s.region];
    if (r.owner === s.f) { g.spies.splice(i, 1); continue; }
    if (s.eta <= g.time && s.eta > g.time - .051) { recordIntel(g, s.f, s.region); emit(g, { k: 'intel', faction: s.f, region: s.region, by: 'spy' }); }
  }
}

/** Each convoy, working spies refresh their report and may be caught (capitals and barracks towns watch harder). */
export function spiesOnConvoy(g: GameState) {
  for (let i = g.spies.length - 1; i >= 0; i--) {
    const s = g.spies[i], r = g.regions[s.region]; if (s.eta > g.time) continue;
    recordIntel(g, s.f, s.region);
    let p = .1 + (r.capitalOf === r.owner ? .1 : 0) + (r.barracks ? .06 : 0) + (r.battle >= 0 ? .04 : 0);
    if ((s.hot ?? -1) > g.day) p *= 2;
    if (rnd(g) < p) { g.spies.splice(i, 1); emit(g, { k: 'spyFound', faction: s.f, region: s.region, owner: r.owner }); }
  }
}

/** How much a viewer sees of each region: 3 full, 2 report only, 1 observed across the border, 0 unknown. */
export function visibility(g: GameState, fid: number): Uint8Array {
  const W = world(), v = new Uint8Array(g.regions.length);
  if (fid < 0 || !g.factions[fid]?.alive || g.over) { v.fill(3); return v; }
  // own and allied regions are seen in full, and across their borders
  for (const r of g.regions) if (r.owner === fid || (r.owner >= 0 && allied(g, fid, r.owner))) { v[r.id] = 3; for (const j of W.regions[r.id].adj) if (v[j] < 1) v[j] = 1; }
  for (const s of activeSpies(g, fid)) v[s.region] = 3;
  for (const b of g.battles) if (!b.ended && b.sides.some(s => allied(g, fid, s))) v[b.region] = 3;
  const it = g.intel[fid] ?? [];
  for (let i = 0; i < v.length; i++) if (v[i] === 0 && it[i]) v[i] = 2;
  return v;
}

/** Estimated men in a region seen from across the border: a range around a noisy guess, in hundreds. */
export function estimate(g: GameState, r: RegionState, reportDay = -1): [number, number] {
  // a fake concentration inflates the estimate until a newer report shows the truth
  const fake = r.fake && r.fake.until > g.day && reportDay < r.fake.day ? r.fake.men : 0;
  return estimateMen(g, r.id, menTotal(r.men) + fake);
}

/** A range around a noisy guess of `m` men, the same for every viewer during one week. */
export function estimateMen(g: GameState, key: number, m: number): [number, number] {
  if (m <= 0) return [0, 0];
  let h = (key * 2654435761 + Math.floor(g.day / 7) * 40503) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  const c = m * (.85 + (h % 1000) / 1000 * .3);
  return [Math.max(100, Math.floor(c * .7 / 100) * 100), Math.max(100, Math.ceil(c * 1.3 / 100) * 100)];
}

/** Sea zones a power watches: it (or an ally) has a coast on them, or ships at sea there. */
export function seenZones(g: GameState, fid: number): boolean[] {
  const W = world(), out = W.zones.map(() => false);
  if (fid < 0 || g.over) return out.map(() => true);
  const mates = (o: number) => o === fid || (o >= 0 && allied(g, fid, o));
  for (const r of g.regions) if (mates(r.owner)) for (const z of W.regions[r.id].zones) out[z] = true;
  for (const fl of g.fleets ?? []) if (mates(fl.owner) && fl.zs.length) { const z = zoneAt(fl.zs, fl.d); if (z >= 0) out[z] = true; }
  return out;
}

/** Region record as `fid` sees it. */
function regionView(g: GameState, fid: number, r: RegionState, vis: number, it: Intel | null, spied: boolean, zones: boolean[]): RegionState {
  if (vis >= 3) return { ...r, units: { ...r.units }, men: { ...r.men }, defs: r.defs, works: r.works, vis: 3, spied };
  const W = world(), mine = (s: number) => isCoast(s) ? zones[zoneOfKey(s)] : s >= 0 && g.regions[s]?.owner === fid;
  // the viewer's own holdouts are always known; a report fills in what lies beyond
  const defs: Defence[] = r.defs.filter(d => d.f === fid);
  const works: Record<number, Works> = {};
  if (it && it.owner === r.owner) { for (const d of it.defs) if (!(vis >= 1 && mine(d.s))) defs.push(d); for (const [k, w] of Object.entries(it.works)) works[+k] = w; }
  if (vis >= 1) for (const s of W.regions[r.id].sectors) if (mine(s)) { for (const d of r.defs) if (d.s === s && d.f === r.owner) defs.push(d); if (r.works[s]) works[s] = r.works[s]; else delete works[s]; }
  const known = it && it.owner === r.owner ? it : null;
  // corps: those on a report, and those across the viewer's own borders as an estimate (a fake concentration swells the biggest)
  // across a border the viewer sees how many men stand there in all, not how they are split into corps
  let cs: Corps[] = (known?.cs ? cloneCorps(known.cs) : undefined) ?? [];
  const posts = new Set(corpsIn(r).filter(c => c.p >= 0).map(c => c.p));
  if (vis >= 1) for (const s of W.regions[r.id].sectors) if (mine(s)) {
    cs = cs.filter(c => c.p !== s);
    const here = corpsIn(r).filter(c => c.p === s);
    if (!here.length) continue;
    const fake = r.fake && r.fake.until > g.day && (it?.day ?? -1) < r.fake.day ? r.fake.men / Math.max(1, posts.size) : 0;
    const men = here.reduce((m, c) => m + menTotal(c.m), 0), att = here.find(c => (c.ord ?? 0) >= 1 && g.time >= (c.ready ?? 0) - 30);
    cs.push({ id: -1 - s, n: -1, p: s, u: emptyUnits(), m: emptyUnits(), mor: 70, est: estimateMen(g, r.id * 64 + s, men + fake), ord: att?.ord });
  }
  return {
    cs: cs.length ? cs : undefined,
    id: r.id, owner: r.owner, units: known ? { ...known.units } : emptyUnits(), men: known ? { ...known.men } : emptyUnits(),
    factory: known?.factory ?? false, barracks: known?.barracks ?? false, airfield: known?.airfield ?? false, port: r.port, portAt: vis >= 1 ? r.portAt : undefined,
    supplyQ: undefined, bombed: vis >= 1 ? r.bombed : undefined, defs, works, mor: 70, home: r.home, cut: false, strike: vis >= 1 ? r.strike : undefined, contested: r.contested, capitalOf: r.capitalOf, battle: vis >= 1 ? r.battle : -1, stance: 0, cr: vis >= 1 ? r.cr : undefined,
    vis, seen: known ? known.day : undefined, est: vis >= 1 ? estimate(g, r, it?.day ?? -1) : undefined,
  };
}

/** The game as one power sees it. Battles and armies in view are shared by reference; nothing in the view may be mutated. */
export function fogView(g: GameState, fid: number): GameState {
  const vis = visibility(g, fid), it = g.intel[fid] ?? [], spied = new Set(activeSpies(g, fid).map(s => s.region));
  // troops forming up in the middle of a region are only seen in full view (a spy there); once they march, observers see them
  const seeArmy = (a: Army) => a.owner === fid || (a.wait ? vis[a.from] >= 3 : vis[a.to] >= 1 || vis[a.from] >= 1);
  const seeBattle = (b: Battle) => b.sides.includes(fid) || vis[b.region] >= 1;
  // at sea: own and allied ships always; others' fleets in watched zones (troops aboard as a rough count), docked ships in ports in view
  const zones = seenZones(g, fid), mates = (o: number) => o === fid || (o >= 0 && allied(g, fid, o)) || fid < 0 || g.over;
  const fleets = (g.fleets ?? []).filter(fl => mates(fl.owner) || (fl.zs.length > 0 && zones[zoneAt(fl.zs, fl.d)] && fl.state !== 'muster'))
    .map(fl => mates(fl.owner) ? fl : { ...fl, cargo: { ...emptyUnits(), inf: Math.round(groundUnits(fl.cargo) / 5) * 5 }, men: emptyUnits(), toPost: undefined, from: -1, to: fl.task === 'assault' && fl.state !== 'sail' ? fl.to : -1 });
  const seenFleet = new Set(fleets.map(f => f.id));
  const ships = (g.ships ?? []).filter(s => mates(s.owner) || (s.fleet >= 0 ? seenFleet.has(s.fleet) : s.port >= 0 && (vis[s.port] >= 1) && (s.ready ?? 0) <= g.time));
  const seaBattles = (g.seaBattles ?? []).filter(b => b.sides.some(side => side.some(mates)) || zones[b.zone]);
  return {
    ...g,
    ships, fleets, seaBattles,
    regions: g.regions.map(r => regionView(g, fid, r, vis[r.id], it[r.id] ?? null, spied.has(r.id), zones)),
    factions: g.factions.map(f => (f.id === fid || g.over) ? f : { ...f, mission: null }),
    // a decoy looks like the real thing to everyone but its owner
    armies: g.armies.filter(seeArmy).map(a => !a.decoy || a.owner === fid ? a : { ...a, decoy: undefined, fake: undefined, units: { ...a.units, inf: a.fake ?? 8 }, men: { ...a.men, inf: (a.fake ?? 8) * 100 } }),
    battles: g.battles.filter(seeBattle),
    intel: g.intel.map((row, i) => i === fid ? row : []),
    // armies and requests are a power's own business
    hq: g.over ? g.hq : (g.hq ?? []).filter(h => h.owner === fid), requests: (g.requests ?? []).filter(q => q.owner === fid),
    spies: g.spies.filter(s => s.f === fid),
    reports: (g.reports ?? []).filter(r => g.over || r.sides.some(s => s.f === fid)).slice(-20),
    viewer: fid,
  };
}

/** The best guess of a region's ground strength a viewer can make from a view: exact if known, else the middle of the estimate. */
export function guessedUnits(r: RegionState): Units {
  if ((r.vis ?? 3) >= 3) return r.units;
  if (r.est) { const u = emptyUnits(); u.inf = Math.round((r.est[0] + r.est[1]) / 2 / 100); return u; }
  return r.units;
}
