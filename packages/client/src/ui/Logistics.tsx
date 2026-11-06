// Logistics on screen: a region's supply route, load against capacity (with the terms behind it), and why it is cut off.
import { OVER, WEATHER, buildWorld, capTerms, cutBreak, load, type GameState, type RegionState } from '@riskrts/shared';
import { t } from '../i18n';

const W = buildWorld();

/** "Rail", "Road" or "Cut off" (translated). */
export const routeName = (r: RegionState) => t(r.cut ? 'Cut off' : (r.supplyQ ?? 2) >= 2 ? 'route|Rail' : 'route|Road');

/** Why an own region is cut off, in a few words: "the route broke at Galicia" (translated: wrap it with tn({ raw }), not t()). */
export function cutReason(g: GameState, r: RegionState): string {
  const b = cutBreak(g, r);
  return b >= 0 ? t('the route home broke at {0}', W.regions[b].name) : t('no route home');
}

/** The capacity breakdown as tooltip lines (translated). */
export function capLines(g: GameState, r: RegionState): string {
  const { cap, terms } = capTerms(g, r), l = load(g, r);
  const lines = terms.map(x => x.k === 'route' ? `${t(r.cut ? 'Cut off' : (r.supplyQ ?? 2) >= 2 ? 'Rail route' : 'Road route (no rail all the way)')}  ${x.v}`
    : x.k === 'depot' ? `${t(x.n === 1 ? 'Depot (capital, factory, harbour) · {0}' : 'Depots (capital, factory, harbour) · {0}', x.n)}  +${x.v}`
    : x.k === 'link' ? `${t('Rail links · {0}, from the 2nd', x.n)}  +${x.v}`
    : `${t(WEATHER[x.w ?? 0])}  ${x.v}`);
  return [t('Supply capacity {0} · load {1}', cap, l), ...lines.map(x => '  ' + x),
    t('Each battalion draws 1, a battery or tank 2. Over capacity: no replacements, shells cost half again, morale −{0} a week; over {1} %: {2} % of the men lost a week.', OVER.morale, Math.round(OVER.far * 100), Math.round(OVER.farWear * 100))].join('\n');
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
      <span className="sb-l">{t('Supply')} · <b>{routeName(r)}</b></span>
      <span className="sb-bar"><i style={{ width: `${Math.min(100, cap > 0 ? l / cap * 100 : l > 0 ? 100 : 0)}%` }} /></span>
      <span className="sb-n"><b>{l}</b> / {cap}</span>
    </div>
  );
}
