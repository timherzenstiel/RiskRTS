// Corps as objects (design-command §2): the Forces panel (order of battle), the corps card for the selected corps, and the
// orders the map gives them – right-click an own region or border to move the selected corps there, an enemy region to attack.
import { GeneralsRoster } from './Generals';
import {
  ASSEMBLE, CORPS_CAP, FACTIONS, FORMATION, GROUND_TYPES, ORDERS, STANCES, UT, borderBalance, borderLabel, buildWorld, corpsAtPost, corpsIn, depotOf, lookCorps, reserveId, sectorAt, marchEta, moveK,
  frontsOf, fullMen, groundUnits, groupName, menTotal, sectorPoint, wrapDx, type Army, type Corps, type GameState, type Order, type RegionState, type Stance, type Units, type World,
} from '@riskrts/shared';
import { useState } from 'react';
import { useSim, useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click } from './actions';
import { CloseIcon } from './icons';
import { menStr, nm } from './format';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';
import { rendererRef } from './refs';
import { corpsState, unitsLine } from './DeployTab';
import { CorpsArmyRow, hqName } from './Staff';

// ---------------------------------------------------------------- helpers

/** "centre", "Germany border", "North Sea coast". */
export function postLabel(W: World, p: number): string { return p < 0 ? 'centre' : borderLabel(W, p); }
/** Men present over full strength, 0..1. */
export const strengthOf = (c: { u: Units; m: Units }) => { const f = fullMen(c.u); return f > 0 ? Math.min(1, menTotal(c.m) / f) : 1; };
export const stars = (xp?: number) => xp ? '★'.repeat(xp) : '';
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The post of `region` a map point belongs to: the border or coast running nearest to it, else the centre. */
export function postAt(W: World, region: number, pt?: { x: number; z: number }): number {
  if (!pt) return -1;
  return sectorAt(W, region, pt.x, pt.z);
}

/** Corps of mine marching or aboard ship (columns and fleets that carry a whole corps). */
function corpsAway(g: GameState, me: number): { tag: NonNullable<Army['ct']>; where: string; u: Units }[] {
  const W = buildWorld(), out: { tag: NonNullable<Army['ct']>; where: string; u: Units }[] = [];
  for (const a of g.armies) if (a.owner === me && a.ct) {
    const to = a.path?.length ? a.path[a.path.length - 1] : a.to, post = a.path?.length ? a.fin ?? -1 : a.post ?? -1;
    out.push({ tag: a.ct, u: a.units, where: (a.ord ?? 0) >= 1 ? t('moving up to attack {0}', W.regions[a.post!]?.name ?? '') : post >= 0 ? t('marching to {0} · {1}', W.regions[to].name, postLabel(W, post)) : t('marching to {0}', W.regions[to].name) });
  }
  for (const fl of g.fleets) if (fl.owner === me && fl.ct) out.push({ tag: fl.ct, u: fl.cargo, where: t('at sea to {0}', W.regions[fl.to].name) });
  for (const b of g.battles) if (!b.ended && b.ct) for (const tag of Object.values(b.ct)) {
    const u: Units = { inf: 0, mg: 0, art: 0, tank: 0, plane: 0 };
    for (const x of b.agents) if (x.c === tag.id && x.f === me && !x.dead && !x.out && x.type in u) u[x.type as keyof Units]++;
    if (groundUnits(u)) out.push({ tag, u, where: t('fighting in {0}', W.regions[b.region].name) });
  }
  return out;
}

/** A corps' name; a region's reserve is called after its region. */
export const corpsTitle = (me: number, r: RegionState, c: Corps) => c.res ? t('Reserve {0}', buildWorld().regions[r.id].name) : groupName(me, 1, c.n);

/** Send the selected corps to region `target` (own: move to the post clicked; enemy: attack). */
export function orderCorps(target: number, pt?: { x: number; z: number }) {
  const ui = useUi.getState(), s = ui.session; if (!s) return;
  const W = buildWorld(), g = s.state, me = s.me, T = g.regions[target];
  let ok = 0, err: string | null = null;
  for (const id of ui.corps) {
    const f = lookCorps(g, me, id); if (!f) continue;
    const cmd = T.owner === me
      ? { t: 'moveCorps' as const, region: f.r.id, id, to: target, toPost: postAt(W, target, pt) }
      : { t: 'attackCorps' as const, region: f.r.id, id, to: target, goal: ui.goal as Order };
    const e = s.send(cmd); if (e) err ??= e; else ok++;
  }
  if (!ok && !err) err = 'The selected corps are on the move or in battle. Wait until they stand at a post.';
  if (err) { ui.say(err); if (!ok) Sfx.deny(); }
  if (ok) Sfx.order();
  ui.bump();
}

function pickCorps(r: RegionState, c: Corps, add: boolean) {
  useUi.getState().selectCorps([c.id], add, r.id);
  if (!add) { const p = sectorPoint(buildWorld(), r.id, c.p); rendererRef.current?.flyToPoint?.(p.x, p.z, 22); }
}

// ---------------------------------------------------------------- preview

/** What a right-click on the hovered region would do with the selected corps: where they go, how long it takes, the odds. */
export function OrderPreview() {
  const ids = useUi(s => s.corps); const hover = useUi(s => s.hover); const orderMode = useUi(s => s.orderMode); const kind = useUi(s => s.orderKind); const goal = useUi(s => s.goal); const sim = useSim();
  if (!sim || !ids.length || hover < 0 || (orderMode && kind !== 'corps')) return null;
  const { g, me } = sim, W = buildWorld(), T = g.regions[hover], found = ids.map(id => lookCorps(g, me, id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!found.length) return null;
  const btl = found.reduce((s, x) => s + groundUnits(x.c.u), 0), who = found.length === 1 ? groupName(me, 1, found[0].c.n) : t('{0} corps', found.length);
  let line: string, cls = 'mv', sub = '';
  if (T.owner === me) {
    const etas = found.map(x => marchEta(g, me, x.r.id, x.c.p, hover, -1)).filter((x): x is number => x !== null);
    line = tn('Move {0} ({1} btl) to {2}', { raw: who }, btl, W.regions[hover].name);
    sub = etas.length < found.length ? t('{0} cannot get there over land', found.length - etas.length) : t('about {0} s · right-click near a border to stand there', Math.round(Math.max(...etas)));
  } else {
    cls = 'atk';
    const can = found.filter(x => W.regions[x.r.id].land.includes(hover));
    const with_ = can.length === found.length ? who : t('{0} of {1} corps', can.length, found.length);
    line = tn(goal === 2 ? 'Invade {0} with {1}' : 'Take the first line of {0} with {1}', W.regions[hover].name, { raw: with_ });
    if (!can.length) { cls = 'no'; sub = t('None of them borders it'); }
    else {
      const b = borderBalance(g, can[0].r.id, hover), mine = can.reduce((s, x) => s + groundUnits(x.c.u), 0);
      const sec = Math.max(...can.map(x => (marchEta(g, me, x.r.id, x.c.p, x.r.id, hover) ?? 0))) + ASSEMBLE * moveK(g);
      const their = b.know ? `${b.their.btl[0] + b.their.reserve[0]}–${b.their.btl[1] + b.their.reserve[1]}` : '?';
      sub = `${tn('ours {0} btl : theirs {1}', mine, { raw: their })}${b.massing ? ' · ' + t('massing') : ''} · ${t('goes in after about {0} s', Math.round(sec))}${(T.owner >= 0 && FACTIONS[T.owner]) ? ` · ${nm(FACTIONS[T.owner].short)}` : ''}`;
    }
  }
  return <div id="preview" className={'plate ' + cls} role="status"><b>{line}</b><small>{sub}</small></div>;
}

// ---------------------------------------------------------------- forces panel

const armyShort = (g: GameState, id: number) => { const h = (g.hq ?? []).find(x => x.id === id); return h ? hqName(h).split(' ').slice(0, 2).join(' ') : t('army'); };

function CorpsRow({ g, me, r, c, sel }: { g: GameState; me: number; r: RegionState; c: Corps; sel: boolean }) {
  const W = buildWorld(), st = strengthOf(c), fight = c.p >= 0 && frontsOf(g, r.id).some(b => b.from === c.p);
  return (
    <button className={'oob-c' + (sel ? ' on' : '') + ((c.ord ?? 0) >= 1 ? ' att' : '')} aria-pressed={sel}
      title={`${groupName(me, 1, c.n)} · ${unitsLine(c.u)}\n${t('Click to select, Shift-click to add. Right-click the map to give orders.')}`}
      onClick={e => pickCorps(r, c, e.shiftKey)}>
      <span className="oc-n"><b>{groupName(me, 1, c.n)}{c.man ? <i className="hand" title={t('Under your orders: Auto leaves it alone')}>✋</i> : null}</b><small>{c.army !== undefined ? `${armyShort(g, c.army)} · ` : ''}{tx(postLabel(W, c.p))} · {fight ? t('in battle') : corpsState(g, c)}</small></span>
      <span className="oc-v"><b className="lcdn">{groundUnits(c.u)}</b><small>{t('btl')}</small></span>
      <span className="oc-bars" title={t('Strength {0}% · morale {1}%', Math.round(st * 100), Math.round(c.mor))}><i style={{ width: pct(st) }} /><i className="mor" style={{ width: `${Math.min(100, c.mor)}%` }} /></span>
      <span className="oc-xp" title={t('Experience: {0} of 3 stars (+5 % damage each)', c.xp ?? 0)}>{stars(c.xp)}</span>
    </button>
  );
}

export function ForcesPanel() {
  const panel = useUi(s => s.panel), selC = useUi(s => s.corps); const sim = useSim();
  const [mine, setMine] = useState(false);
  if (panel !== 'forces' || !sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const regions = g.regions.filter(r => r.owner === me && (corpsIn(r).length || groundUnits(depotOf(r).u)));
  // regions at war first (a battle, then hostile borders), then by size
  const score = (r: RegionState) => (r.battle >= 0 ? 1e6 : 0) + (corpsIn(r).some(c => c.p >= 0 && c.p < 1000 && g.regions[c.p].owner !== me) ? 1e4 : 0) + groundUnits(r.units);
  regions.sort((a, b) => score(b) - score(a));
  const all = regions.flatMap(r => corpsIn(r)), away = corpsAway(g, me);
  const btl = regions.reduce((s, r) => s + groundUnits(r.units), 0);
  return (
    <section id="panel" className="plate" aria-label={t('Forces')}>
      <div className="pn-h"><h2>{t('Forces')}</h2><button className="x" aria-label={t('Close panel')} onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <p className="pn-sub">{t('Corps you command, by army and region. Select one to give orders.')}</p>
      <div className="pn-body">
        <div className="oob-sum">
          <span><small>{t('Corps')}</small><b className="lcdn">{all.length + away.length}</b></span>
          <span><small>{t('Battalions')}</small><b className="lcdn">{btl}</b></span>
          <span><small>{t('Under your orders')}</small><b className="lcdn">{all.filter(c => c.man).length}</b></span>
          <div className="seg oob-f" role="group" aria-label={t('Show')}><button aria-pressed={!mine} onClick={() => { click(); setMine(false); }}>{t('All')}</button><button aria-pressed={mine} title={t('Only the corps under your orders (✋)')} onClick={() => { click(); setMine(true); }}>{t('Mine ✋')}</button></div>
        </div>
        <GeneralsRoster g={g} me={me} />
        {(g.hq ?? []).some(h => h.owner === me) && <div className="lbl"><span>{t('Armies')}</span></div>}
        {(g.hq ?? []).filter(h => h.owner === me).map(h => (
          <button key={'h' + h.id} className="oob-c army" onClick={() => { click(); ui().selectArmy(h.id); }}>
            <span className="oc-n"><b>{hqName(h)}</b><small>{h.cmd.name} · {h.front.map(r => nm(W.regions[r].name)).join(', ')}</small></span>
            <span className="oc-v"><b className="lcdn">{all.filter(c => c.army === h.id).length}</b><small>{t('corps')}</small></span>
            <span className="oc-xp">{(g.requests ?? []).some(q => q.army === h.id) ? <em className="rbadge">{(g.requests ?? []).filter(q => q.army === h.id).length}</em> : null}</span>
          </button>
        ))}
        {away.length > 0 && <div className="lbl"><span>{t('On the move')}</span></div>}
        {away.map(a => (
          <div key={'a' + a.tag.id} className="oob-c away"><span className="oc-n"><b>{groupName(me, 1, a.tag.n)}</b><small>{a.where}</small></span><span className="oc-v">{groundUnits(a.u) ? <><b className="lcdn">{groundUnits(a.u)}</b><small>{t('btl')}</small></> : null}</span><span className="oc-xp">{stars(a.tag.xp)}</span></div>
        ))}
        {regions.map(r => {
          const cs = corpsIn(r).filter(c => !mine || c.man).sort((a, b) => a.p - b.p), dep = depotOf(r).u, dn = groundUnits(dep);
          if (mine && !cs.length) return null;
          return (
            <div key={r.id} className="oob-r">
              <button className="oob-rh" onClick={() => { click(); ui().select(r.id); rendererRef.current?.flyTo(r.id, 26); }}>
                <b>{nm(W.regions[r.id].name)}</b>{r.battle >= 0 && <span className="tag red">{t('battle')}</span>}<small>{t('{0} btl', groundUnits(r.units))} · {r.deploy === 1 ? t('Manual') : t('Auto')}</small>
              </button>
              {cs.map(c => <CorpsRow key={c.id} g={g} me={me} r={r} c={c} sel={selC.includes(c.id)} />)}
              {!mine && dn > 0 && <div className="oob-c dep" title={t('Battalions in no corps: recruits and the troops Auto arranges')}><span className="oc-n"><b>{t('Reserve')}</b><small>{unitsLine(dep)}</small></span><span className="oc-v"><b className="lcdn">{dn}</b><small>{t('btl')}</small></span>
                <button className="btn sm" title={t('Select the {0} battalions of the reserve like a corps, then right-click the map to move them or to attack', dn)} onClick={e => { e.stopPropagation(); click(); ui().selectCorps([reserveId(r.id)], false, r.id); }}>{t('Select the reserve')}</button></div>}
            </div>
          );
        })}
        <p className="note">{t('Click a corps to select it (Shift adds more), then right-click the map: an own region or one of its borders moves it there, an enemy region attacks. Corps marked ✋ are yours; Auto arranges the rest.')}</p>
      </div>
    </section>
  );
}

/** Up to CORPS_CAP battalions of a group, infantry first. */
function fillUp(u: Units): Partial<Units> {
  const out: Partial<Units> = {}; let left = CORPS_CAP;
  for (const k of ['inf', 'mg', 'art', 'tank'] as const) { const q = Math.min(u[k], left); if (q) { out[k] = q; left -= q; } }
  return out;
}

// ---------------------------------------------------------------- corps card

function Detach({ r, c, done }: { r: RegionState; c: Corps; done: () => void }) {
  const [n, setN] = useState<Partial<Units>>({});
  const tot = GROUND_TYPES.reduce((s, k) => s + (n[k] ?? 0), 0);
  return (
    <div className="cc-det">
      {GROUND_TYPES.filter(k => c.u[k] > 0).map(k => (
        <label key={k}><span>{tx(UT[k].short)}</span>
          <input type="number" min={0} max={c.u[k]} value={n[k] ?? 0} onChange={e => setN({ ...n, [k]: Math.max(0, Math.min(c.u[k], Math.floor(+e.target.value || 0))) })} />
          <small>/ {c.u[k]}</small></label>
      ))}
      <button className="btn sm" disabled={!tot || tot >= groundUnits(c.u)} onClick={() => { click(); if (useUi.getState().order({ t: 'detach', region: r.id, id: c.id, u: n })) done(); }}>{t('Detach')}{tot ? ` ${tot}` : ''}</button>
    </div>
  );
}

/** The reserve of a region, selected like a corps: what it holds and how to order it. */
function ReserveBody({ c }: { c: Corps }) {
  return (
    <>
      <div className="cc-stats">
        <span><small>{t('Battalions')}</small><b className="lcdn">{groundUnits(c.u)}</b></span>
        <span><small>{t('Men')}</small><b className="lcdn">{menStr(menTotal(c.m))}</b></span>
        <span><small>{t('Strength')}</small><b className="lcdn">{pct(strengthOf(c))}</b></span>
        <span><small>{t('Morale')}</small><b className="lcdn">{Math.round(c.mor)}%</b></span>
      </div>
      <p className="cc-u">{GROUND_TYPES.filter(k => c.u[k] > 0).map(k => <span key={k}><b>{c.u[k]}</b> {tx(c.u[k] === 1 ? FORMATION[k].one : FORMATION[k].many)}</span>)}</p>
      <p className="note">{t('The reserve: recruits arrive here, and the region sends part of it to its borders by itself. Right-click the map to give it an order: an own region or border moves it there, a neighbouring enemy region is attacked. Up to {0} battalions go as one corps under your orders; one battalion always stays in the region.', CORPS_CAP)}</p>
    </>
  );
}

function OneCorps({ g, me, r, c }: { g: GameState; me: number; r: RegionState; c: Corps }) {
  const W = buildWorld(), ui = useUi.getState, [det, setDet] = useState(false);
  const st = strengthOf(c), mates = corpsAtPost(r, c.p).filter(x => x !== c);
  const foe = c.p >= 0 && c.p < 1000 && g.regions[c.p].owner !== me ? g.regions[c.p] : null;
  const order = (k: Order, now = false) => { click(); ui().order({ t: 'order', region: r.id, post: c.p, k, now, id: c.id }); };
  return (
    <>
      <div className="cc-stats">
        <span><small>{t('Battalions')}</small><b className="lcdn">{groundUnits(c.u)}<i>/{CORPS_CAP}</i></b></span>
        <span><small>{t('Men')}</small><b className="lcdn">{menStr(menTotal(c.m))}</b></span>
        <span><small>{t('Strength')}</small><b className="lcdn">{pct(st)}</b></span>
        <span><small>{t('Morale')}</small><b className="lcdn">{Math.round(c.mor)}%</b></span>
        <span title={t('+1 star per battle won, +5 % damage per star')}><small>{t('Experience')}</small><b className="xp">{c.xp ? stars(c.xp) : t('green')}</b></span>
      </div>
      <p className="cc-u">{GROUND_TYPES.filter(k => c.u[k] > 0).map(k => <span key={k}><b>{c.u[k]}</b> {tx(c.u[k] === 1 ? FORMATION[k].one : FORMATION[k].many)}</span>)}</p>
      <div className="lv-row"><span className="lv-l" title={t('How this corps fights')}>{t('Stance')}</span>
        <div className="seg" role="group" aria-label={t('Corps stance')}>
          {STANCES.map((sn, i) => <button key={sn} title={tx(sn)} aria-pressed={(c.st ?? r.stance ?? 0) === i} onClick={() => { click(); ui().order({ t: 'corpsSet', region: r.id, id: c.id, st: i as Stance }); }}>{t(['Balanced', 'Aggressive', 'Defensive', 'Hold'][i])}</button>)}
        </div>
      </div>
      {foe && (c.ord ?? 0) >= 1 && (
        <div className="lv-row"><span className="lv-l">{t('Order')}</span>
          <b className="cc-ord">{c.ord === 1 ? t('Take the first line') : t('Invade')} · {nm(W.regions[c.p].name)}</b>
          {!c.now && (c.ready ?? 0) > g.time && <button className="btn sm danger" title={t('Attack before the troops have assembled: tired men, unregistered guns')} onClick={() => order(c.ord!, true)}>{t('Go now')}</button>}
          <button className="btn sm" onClick={() => order(0)}>{t('Call off')}</button>
        </div>
      )}
      <div className="cc-acts">
        <button className="btn sm" aria-expanded={det} disabled={groundUnits(c.u) < 2} onClick={() => { click(); setDet(!det); }}>{t('Detach…')}</button>
        {mates.map(m => <button key={m.id} className="btn sm" disabled={groundUnits(m.u) + groundUnits(c.u) > CORPS_CAP} title={groundUnits(m.u) + groundUnits(c.u) > CORPS_CAP ? t('Together more than {0} battalions', CORPS_CAP) : tn('Merge {0} into this corps', { raw: groupName(me, 1, m.n) })} onClick={() => { click(); ui().order({ t: 'merge', region: r.id, a: c.id, b: m.id }); }}>{tn('Merge {0}', { raw: groupName(me, 1, m.n).split(' ')[0] })}</button>)}
        <button className="btn sm" title={c.man ? t('Hand the corps back to the region: Auto may move it or fold it into the reserve') : t('Keep the corps under your orders: Auto leaves it alone')} onClick={() => { click(); ui().order({ t: 'corpsSet', region: r.id, id: c.id, man: !c.man }); }}>{c.man ? t('Hand to Auto') : t('Take command')}</button>
      </div>
      {det && <Detach r={r} c={c} done={() => setDet(false)} />}
      <p className="note">{t(W.regions[r.id].land.length
        ? (ui().goal === 1 ? 'Right-click the map: an own region or border moves the corps there, a neighbouring enemy region attacks it (take the first line).' : 'Right-click the map: an own region or border moves the corps there, a neighbouring enemy region attacks it (invade).')
        : (ui().goal === 1 ? 'Right-click the map: an own region or border moves the corps there, an enemy region attacks it (take the first line).' : 'Right-click the map: an own region or border moves the corps there, an enemy region attacks it (invade).'))}</p>
    </>
  );
}

/** The card for the selected corps, above the region file. */
export function CorpsCard() {
  const ids = useUi(s => s.corps); const sim = useSim();
  if (!sim || !ids.length) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const found = ids.map(id => lookCorps(g, me, id)).filter((x): x is NonNullable<typeof x> => !!x);
  const goal = ui().goal;
  if (!found.length) return (
    <section className="ccard" aria-label={t('Corps')}><div className="bc-h"><div><small>{t('Corps')}</small><h3>{t('On the move')}</h3></div><button className="x" aria-label={t('Clear selection')} onClick={() => ui().selectCorps([])}><CloseIcon /></button></div>
      <p className="note">{t('The selected corps are marching, at sea or fighting. They take orders again once they stand at a post.')}</p></section>
  );
  const one = found.length === 1 ? found[0] : null;
  return (
    <section className="ccard" aria-label={t('Corps')} style={{ '--c': FACTIONS[me].color } as React.CSSProperties}>
      <div className="bc-h">
        <div>
          <small>{one ? `${nm(W.regions[one.r.id].name)} · ${tx(postLabel(W, one.c.p))} · ${one.c.res ? t('Reserve') : one.c.man ? t('under your orders') : t('Auto')}` : t('{0} corps selected', found.length)}</small>
          <h3>{one ? corpsTitle(me, one.r, one.c) : t('{0} battalions', found.reduce((s, f) => s + groundUnits(f.c.u), 0))}</h3>
        </div>
        <button className="x" aria-label={t('Clear selection')} onClick={() => ui().selectCorps([])}><CloseIcon /></button>
      </div>
      {one?.c.res ? <ReserveBody c={one.c} /> : one ? <OneCorps g={g} me={me} r={one.r} c={one.c} /> : (
        <>
          {found.map(({ r, c }) => (
            <button key={c.id} className="oob-c" onClick={e => pickCorps(r, c, e.shiftKey)}>
              <span className="oc-n"><b>{corpsTitle(me, r, c)}</b><small>{nm(W.regions[r.id].name)} · {tx(postLabel(W, c.p))}</small></span>
              <span className="oc-v"><b className="lcdn">{groundUnits(c.u)}</b><small>{t('btl')}</small></span>
              <span className="oc-xp">{stars(c.xp)}</span>
            </button>
          ))}
          <p className="note">{t('Right-click the map to move them all, or right-click an enemy region to attack with each one that borders it.')}</p>
        </>
      )}
      {found.some(x => !x.c.res) && <CorpsArmyRow ids={found.filter(x => !x.c.res).map(x => x.c.id)} />}
      <div className="lv-row"><span className="lv-l" title={t('What attacks ordered by right-click aim for')}>{t('Attack goal')}</span>
        <div className="seg" role="group" aria-label={t('Attack goal')}>
          <button aria-pressed={goal === 1} onClick={() => { click(); ui().setGoal(1); }}>{t('First line')}</button>
          <button aria-pressed={goal === 2} onClick={() => { click(); ui().setGoal(2); }}>{t('Invade')}</button>
        </div>
      </div>
    </section>
  );
}
