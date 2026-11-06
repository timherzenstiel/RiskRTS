// Deploy tab of the region drawer: the depot and reserve corps in the middle, one row per border with its corps (any number, at
// most 20 battalions each), and the troops on the move. Moves send a share of a post (the share picker below) to another
// post; a corps is selected by clicking it, and then takes its orders from the corps card and from right-clicks on the map.
import { borderLabel, coastThreat, sectorName } from '@riskrts/shared';
import {
  CORPS_CAP, FACTIONS, GROUND_TYPES, ORDERS, UT, buildWorld, corpsAtPost, depotOf, frontsOf, groundUnits, groupName, isMountain, legDist, mainOf, moveK, POST_SPEED, treatyOf,
  type Army, type Corps, type GameState, type Order, type RegionState, type Units,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { Icon } from './icons';
import { SharePicker } from './DrawerTabs';
import { t, tx } from '../i18n';
import { nm } from './format';
import { tn } from './LangPicker';

/** "6 inf · 2 MG · 1 art" (ground troops only). */
export function unitsLine(u: Units): string {
  const p = GROUND_TYPES.filter(k => u[k] > 0).map(k => `${u[k]} ${tx(UT[k].short).toLowerCase()}`);
  return p.length ? p.join(' · ') : t('no troops');
}
const secs = (s: number) => s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.ceil(s)}s`;

/** An order's name in lower case, for running text ("take the first line"). */
const ordL = (k: number) => [t('hold'), t('take the first line'), t('invade')][k] ?? ORDERS[k].toLowerCase();

/** What a corps is doing, in a few words. */
export function corpsState(g: GameState, c: Corps): string {
  const ord = c.ord ?? 0;
  if (ord >= 1) { const left = Math.max(0, (c.ready ?? 0) - g.time); return left > 0 && !c.now ? t('assembling · {0} in {1}', ordL(ord), secs(left)) : t('going in · {0}', ordL(ord)); }
  const held = c.since !== undefined ? g.time - c.since : 0;
  return held >= 40 ? t('holding · dug in') : t('holding');
}

/** Columns of this power that left or are heading for this region, with what they are doing. */
function columnsOf(g: GameState, me: number, id: number): Army[] {
  return g.armies.filter(a => a.owner === me && a.post !== undefined && !a.air && (a.from === id || a.to === id));
}

function ColumnRow({ g, a, id }: { g: GameState; a: Army; id: number }) {
  const W = buildWorld();
  const post = (p: number) => p >= 0 ? borderLabel(W, p) : 'the centre';
  const dest = a.inner ? tx(post(a.post!)) : a.to === id ? t('here ({0})', post(a.post!)) : nm(W.regions[a.path?.length ? a.path[a.path.length - 1] : a.to].name);
  const left = (a.wait ?? 0) + (1 - a.t) * a.dur;
  const what = a.wait ? t('forming up · {0}, then marching', secs(a.wait)) : t('marching · {0}', secs(left));
  const n = groundUnits(a.units);
  return (
    <div className="it nb col">
      <span className="ic"><Icon k="inf" size={18} /></span>
      <div className="tx"><b>{n === 1 ? t('{0} formation', n) : t('{0} formations', n)} → {dest}</b><small>{what}{(a.ord ?? 0) >= 1 ? ' · ' + t('then {0}', ordL(a.ord!)) : ''}{a.rail ? ' · ' + t('by rail') : ''}</small></div>
    </div>
  );
}

/** Up to CORPS_CAP battalions of a group, infantry first. */
function upTo(u: Units): Partial<Units> {
  const out: Partial<Units> = {}; let left = CORPS_CAP;
  for (const k of ['inf', 'mg', 'art', 'tank'] as const) { const q = Math.min(u[k], left); if (q) { out[k] = q; left -= q; } }
  return out;
}

/** One corps in a post row: click to select it (Shift adds); its card then takes the orders. */
function CorpsLine({ g, me, r, c }: { g: GameState; me: number; r: RegionState; c: Corps }) {
  const on = useUi(s => s.corps.includes(c.id));
  return (
    <button className={'st cl' + (on ? ' on' : '')} aria-pressed={on} title={t('Select this corps (Shift adds), then right-click the map to move or attack')}
      onClick={e => { click(); useUi.getState().selectCorps([c.id], e.shiftKey, r.id); }}>
      <b>{tx(groupName(me, 1, c.n))}</b>{c.man ? ' ✋' : ''} · {unitsLine(c.u)} · {corpsState(g, c)}{c.xp ? ` · ${'★'.repeat(c.xp)}` : ''}
    </button>
  );
}

/** A hand-placed move would be undone by Auto at the next convoy, so moving troops by hand switches the region to Manual. */
function manual(r: RegionState) {
  if (r.deploy === 1) return;
  const ui = useUi.getState(); ui.order({ t: 'deploy', region: r.id, mode: 1 });
  ui.say(`${buildWorld().regions[r.id].name} is now on Manual deployment, so your troops stay where you put them. Switch back to Auto at the top of this tab.`); // say() translates
}

function BorderRow({ g, me, r, n }: { g: GameState; me: number; r: RegionState; n: number }) {
  const W = buildWorld(), ui = useUi.getState, coast = n >= 1000, nb = coast ? null : g.regions[n], F = nb ? FACTIONS[nb.owner] : { short: 'Sea', color: '#7fb4d8' };
  const here = corpsAtPost(r, n), c = here[0], foreign = coast ? coastThreat(g, me, n - 1000) > 0 : nb!.owner !== me, peace = !coast && foreign && !!treatyOf(g, me, nb!.owner);
  const main = mainOf(r), fb = frontsOf(g, r.id).find(b => b.from === n);
  const foothold = frontsOf(g, n).find(b => b.from === r.id && b.attacker === me && b.stage === 3);
  const tm = Math.round(legDist(r.id, -1, r.id, n) / POST_SPEED * moveK(g));
  const frac = useUi.getState().sendFrac;
  const send = () => { click(); manual(r); ui().order({ t: 'move', region: r.id, post: -1, to: r.id, toPost: n, frac }); };
  const back = () => { click(); manual(r); ui().order({ t: 'move', region: r.id, post: n, to: r.id, toPost: -1, frac }); };
  const order = (k: Order, now = false) => { click(); ui().order({ t: 'order', region: r.id, post: n, k, now, brk: peace || undefined }); };
  return (
    <div className={'post' + (fb ? ' fight' : '')} style={{ '--c': F.color } as React.CSSProperties}>
      <div className="post-h">
        <i className="dot" />
        <div className="tx">
          <b>{nm(coast ? sectorName(W, n) : W.regions[n].name)}</b>
          <small>{coast ? (foreign ? t('Threatened from the sea') : t('Quiet coast')) : foreign ? nm(F.short) : t('Yours')}{!coast && isMountain(r.id, n) ? ' · ' + t('mountains') : ''} · {t('{0}s from the centre', tm)}</small>
        </div>
      </div>
      <div className="post-b">
        {fb ? <small className="st fight">{t('Battle on this border')}</small>
          : c ? here.map(x => <CorpsLine key={x.id} g={g} me={me} r={r} c={x} />)
            : <small className={'st ' + (foreign ? 'open' : '')}>{foreign ? (coast ? t('Unmanned: only the fixed defences hold this coast') : t('Unmanned: only the fixed defences hold this border')) : coast ? t('Quiet coast · an enemy landing would meet only the defences') : t('Quiet border')}</small>}
        {foothold && <small className="st good">{t('Foothold held across the border')}</small>}
      </div>
      <div className="post-a">
        <button className="btn sm" disabled={groundUnits(main) < 1 || !!fb} onClick={send} title={t('Send a share of the main army to this border')}>{t('Send')}</button>
        {c && <button className="btn sm" onClick={back} title={t('Bring a share of the corps here back to the centre')}>{t('Back')}</button>}
        {!coast && foreign && (c || foothold) && (
          <div className="seg ord" role="group" aria-label={t('Orders for the {0} border', W.regions[n].name)}>
            {ORDERS.map((o, k) => (
              <button key={o} aria-pressed={!!c && here.every(x => (x.ord ?? 0) === k)} disabled={!c && !(foothold && k === 2)}
                title={k === 0 ? t('Hold the border and dig in') : k === 1 ? t('Take the enemy\'s first line, then dig in there') : t('Take the first line, then push into the region')}
                onClick={() => order(k as Order)}>{k === 0 ? t('Hold') : k === 1 ? t('First line') : t('Invade')}</button>
            ))}
          </div>
        )}
        {c && (c.ord ?? 0) >= 1 && !c.now && (c.ready ?? 0) > g.time && <button className="btn sm danger" title={t('Attack before the troops have assembled: tired men, unregistered guns')} onClick={() => order(c.ord!, true)}>{t('Go now')}</button>}
      </div>
    </div>
  );
}

export function DeployTab({ region, id }: { region: RegionState; id: number }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const main = mainOf(region), dep = depotOf(region).u, reserve = corpsAtPost(region, -1), cols = columnsOf(g, me, id);
  const hostile = (n: number) => n >= 1000 ? coastThreat(g, me, n - 1000) > 0 : g.regions[n].owner !== me;
  const borders = [...W.regions[id].sectors].sort((a, b) => (hostile(b) ? 1 : 0) - (hostile(a) ? 1 : 0) || (a >= 1000 ? 1 : 0) - (b >= 1000 ? 1 : 0));
  const auto = region.deploy !== 1;
  return (
    <>
      <div className="lv-row deploy-mode">
        <span className="lv-l" title={t('A region on Auto keeps about a third of its troops in the middle and spreads the rest over the threatened borders every week')}>{t('Deploy')}</span>
        <div className="seg" role="group" aria-label={t('Deploy mode')}>
          <button aria-pressed={auto} onClick={() => { click(); ui().order({ t: 'deploy', region: id, mode: 0 }); }}>{t('Auto')}</button>
          <button aria-pressed={!auto} onClick={() => { click(); ui().order({ t: 'deploy', region: id, mode: 1 }); }}>{t('Manual')}</button>
        </div>
      </div>
      <div className="post main">
        <div className="post-h"><span className="ic"><Icon k="barracks" size={18} /></span>
          <div className="tx"><b>{t('Centre · {0}', groupName(me, 0, region.an))}</b><small>{tn('Depot {0}', { raw: unitsLine(dep) })}{dep.plane ? ' · ' + (dep.plane === 1 ? t('{0} squadron', 1) : t('{0} squadrons', dep.plane)) : ''}{reserve.length ? ' · ' + t('{0} reserve corps', reserve.length) : ''}</small></div>
          <button className="btn sm" disabled={groundUnits(dep) < 1} title={t('Form a corps of up to {0} battalions from the depot, under your orders', CORPS_CAP)} onClick={() => { click(); ui().order({ t: 'form', region: id, u: upTo(dep) }); }}>{t('Form corps')}</button>
        </div>
        {reserve.map(x => <CorpsLine key={x.id} g={g} me={me} r={region} c={x} />)}
        <small className="note">{t('The depot: recruits join it, it meets any enemy who breaks through, and Auto and offensives draw on it.')} {groundUnits(main) ? t('{0} battalions stand at the centre.', groundUnits(main)) : ''}</small>
      </div>
      <SharePicker />
      <div className="lbl"><span>{t('Borders and coasts · a corps on each one holds its trench')}</span></div>
      {borders.map(n => <BorderRow key={n} g={g} me={me} r={region} n={n} />)}
      {cols.length > 0 && <div className="lbl"><span>{t('On the move')}</span></div>}
      {cols.map(a => <ColumnRow key={a.id} g={g} a={a} id={id} />)}
      <p className="note">{t('Every move takes the distance divided by the marching speed; railways make it three times faster.')}</p>
    </>
  );
}
