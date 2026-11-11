// The simple command (design-simple): a game started with the `staff` setting is played by region and by front order. This
// module holds what the client needs for it: the test, the orders a right-click gives, and the troops block of the region card.
import { FORMATION, GROUND_TYPES, buildWorld, corpsIn, depotOf, frontOrderOf, groundUnits, lookCorps, reserveId, type GameState, type RegionState } from '@riskrts/shared';
import { useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { nm } from './format';
import { t, tx } from '../i18n';

/** Whether this game is played with the simple command. */
export const isSimple = (g: GameState | null | undefined) => !!g?.cfg?.staff;

/** The troops of a region that take an order: every corps not in a fight or under an attack order, and the reserve. Ids as the
 *  corps commands take them. `half`: about half the battalions, the reserve first. */
export function regionTroops(g: GameState, me: number, region: number, half = false): number[] {
  const r = g.regions[region]; if (!r || r.owner !== me) return [];
  const list: { id: number; n: number }[] = [];
  if (lookCorps(g, me, reserveId(region))) list.push({ id: reserveId(region), n: groundUnits(depotOf(r).u) });
  for (const c of corpsIn(r)) if ((c.ord ?? 0) === 0) list.push({ id: c.id, n: groundUnits(c.u) });
  if (!half) return list.map(x => x.id);
  const total = list.reduce((s, x) => s + x.n, 0); let got = 0; const out: number[] = [];
  for (const x of list) { if (got >= total / 2) break; out.push(x.id); got += x.n; }
  return out;
}

/**
 * A right-click with an own region selected: its troops march to own land or attack an enemy neighbour. Returns the corps ids
 * to order (empty: nothing to send), after selecting them so the corps orders can run.
 */
export function selectRegionTroops(region: number, half: boolean): number[] {
  const ui = useUi.getState(), s = ui.session; if (!s) return [];
  const ids = regionTroops(s.state, s.me, region, half);
  if (!ids.length) { ui.say('No troops in that region are free to march.'); Sfx.deny(); return []; }
  useUi.setState({ corps: ids });
  return ids;
}

/** Where a region's troops stand and who runs them, as a few plain lines (the corps list is gone from view). */
export function SimpleTroops({ g, me, r }: { g: GameState; me: number; r: RegionState }) {
  const W = buildWorld(), dep = depotOf(r).u, posts = new Map<number, number>();
  for (const c of corpsIn(r)) if (c.p >= 0) posts.set(c.p, (posts.get(c.p) ?? 0) + groundUnits(c.u));
  const centre = groundUnits(dep) + corpsIn(r).filter(c => c.p < 0).reduce((n, c) => n + groundUnits(c.u), 0);
  const fo = frontOrderOf(g, me, r.id), front = W.regions[r.id].land.some(n => g.regions[n].owner !== me);
  const who = !front ? '' : fo.order === 'mine' ? t('You run this front yourself.') : fo.hq ? (fo.order === 'attack' && fo.target !== undefined ? t('{0} attacks {1}.', fo.hq.cmd.name, nm(W.regions[fo.target].name)) : t('{0} holds this front.', fo.hq.cmd.name)) : '';
  return (
    <div className="pad simple-troops">
      <p className="st-u">{GROUND_TYPES.filter(k => r.units[k] > 0).map(k => <span key={k}><b>{r.units[k]}</b> {tx(r.units[k] === 1 ? FORMATION[k].one : FORMATION[k].many)}</span>)}{groundUnits(r.units) === 0 && <span>{t('No troops here.')}</span>}</p>
      <ul className="st-l">
        {centre > 0 && <li><span>{t('In reserve')}</span><b>{centre}</b></li>}
        {[...posts].sort((a, b) => b[1] - a[1]).map(([p, n]) => <li key={p}><span>{p >= 1000 ? t('On the coast') : t('Facing {0}', nm(W.regions[p].name))}</span><b>{n}</b></li>)}
      </ul>
      {who && <p className="st-w">{who}</p>}
      <p className="note">{t('Right-click the map to send these troops: your own land to march there, an enemy neighbour to attack it. One battalion stays behind. Hold Ctrl to send half.')}</p>
    </div>
  );
}
