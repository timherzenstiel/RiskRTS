// Logistics on screen: a region's supply route, load against capacity (with the terms behind it), and why it is cut off.
import { OVER, WEATHER, buildWorld, capTerms, cutBreak, load, type GameState, type RegionState } from '@riskrts/shared';

const W = buildWorld();

/** "Rail", "Road" or "Cut off". */
export const routeName = (r: RegionState) => r.cut ? 'Cut off' : (r.supplyQ ?? 2) >= 2 ? 'Rail' : 'Road';

/** Why an own region is cut off, in a few words: "the route broke at Galicia". */
export function cutReason(g: GameState, r: RegionState): string {
  const b = cutBreak(g, r);
  return b >= 0 ? `the route home broke at ${W.regions[b].name}` : 'no route home';
}

/** The capacity breakdown as tooltip lines. */
export function capLines(g: GameState, r: RegionState): string {
  const { cap, terms } = capTerms(g, r), l = load(g, r);
  const lines = terms.map(t => t.k === 'route' ? `${r.cut ? 'Cut off' : (r.supplyQ ?? 2) >= 2 ? 'Rail route' : 'Road route (no rail all the way)'}  ${t.v}`
    : t.k === 'depot' ? `Depot${t.n === 1 ? '' : 's'} (capital, factory, harbour) · ${t.n}  +${t.v}`
    : t.k === 'link' ? `Rail links · ${t.n}, from the 2nd  +${t.v}`
    : `${WEATHER[t.w ?? 0]}  ${t.v}`);
  return [`Supply capacity ${cap} · load ${l}`, ...lines.map(x => '  ' + x),
    `Each battalion draws 1, a battery or tank 2. Over capacity: no replacements, shells cost half again, morale −${OVER.morale} a week; over ${Math.round(OVER.far * 100)} %: ${Math.round(OVER.farWear * 100)} % of the men lost a week.`].join('\n');
}

/** Load ÷ capacity → 'ok' | 'near' | 'over' | 'far'. */
export function loadLevel(l: number, cap: number): 'ok' | 'near' | 'over' | 'far' {
  if (l <= 0) return 'ok';
  if (cap <= 0) return 'far';
  const x = l / cap; return x > OVER.far ? 'far' : x > 1 ? 'over' : x > .8 ? 'near' : 'ok';
}

/** "Supply · Rail · 18 / 34" with a fill bar, for an own region. */
export function SupplyBar({ g, r }: { g: GameState; r: RegionState }) {
  const cap = capTerms(g, r).cap, l = load(g, r), lv = loadLevel(l, cap);
  return (
    <div className={'supbar ' + lv} title={capLines(g, r)}>
      <span className="sb-l">Supply · <b>{routeName(r)}</b></span>
      <span className="sb-bar"><i style={{ width: `${Math.min(100, cap > 0 ? l / cap * 100 : l > 0 ? 100 : 0)}%` }} /></span>
      <span className="sb-n"><b>{l}</b> / {cap}</span>
    </div>
  );
}
