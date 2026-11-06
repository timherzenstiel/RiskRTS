// The command bar (design-play §1): one strip at the top of the War Office sidebar with every verb for what is selected – an
// own region, a border, corps, an army, an enemy region. Each verb shows its key; a verb that cannot be used says why when
// clicked or hovered. The cards below hold the details; the bar is the quick way in.
import { useEffect, type ReactNode } from 'react';
import {
  AIR_RANGE, CORPS_CAP, COST, MANDATES, armyCorps, borderBalance, buildWorld, corpsAtPost, corpsIn, depotOf, findCorps, fortCost, groundUnits, groupName, hops, treatyOf,
  type GameState, type Mandate, type Units,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click } from './actions';
import { rendererRef } from './refs';
import { MAND, hqName } from './Staff';
import { nm } from './format';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';

/** One verb. `off` is the reason it cannot be used now; `ext` marks a key handled elsewhere (only shown here). */
export interface Verb { id: string; label: string; key?: string; run: () => void; off?: string; on?: boolean; danger?: boolean; ext?: boolean; title?: string }

const ui = useUi.getState;

/** Up to CORPS_CAP battalions of a group, infantry first. */
export function upToCap(u: Units): Partial<Units> {
  const out: Partial<Units> = {}; let left = CORPS_CAP;
  for (const k of ['inf', 'mg', 'art', 'tank'] as const) { const q = Math.min(u[k], left); if (q) { out[k] = q; left -= q; } }
  return out;
}

/** Scroll the Borders list of the region Overview into view. */
function showBorders() {
  ui().setTab('over');
  setTimeout(() => { const el = document.getElementById('borders-list'); el?.scrollIntoView({ block: 'start', behavior: 'smooth' }); el?.classList.remove('flash'); void el?.offsetWidth; el?.classList.add('flash'); }, 30);
}

function regionVerbs(g: GameState, me: number, sel: number): Verb[] {
  const r = g.regions[sel], ground = groundUnits(r.units), dep = groundUnits(depotOf(r).u);
  const busy = r.battle >= 0 ? t('A battle is going on here') : null;
  const v: Verb[] = [
    { id: 'rec', label: t('Recruit…'), key: 'r', run: () => { ui().setTab('rec'); }, off: r.cut ? t('Cut off: no recruiting') : r.contested >= 0 ? t('Contested: no recruiting') : undefined },
    { id: 'build', label: t('Build…'), key: 'u', run: () => { ui().setTab('build'); } },
    { id: 'fort', label: t('Fortify a border…'), key: 'h', run: showBorders, title: t('Pick the border in the list below, or click a chip or a border on the map') },
    { id: 'move', label: t('Move troops'), key: 'm', run: () => { ui().orderMode && ui().orderKind === 'march' ? ui().cancelOrder() : ui().beginOrder('march'); }, on: ui().orderMode && ui().orderKind === 'march',
      off: busy ?? (ground < 2 ? t('Needs 2 battalions') : undefined), title: t('Pick a neighbour on the map: the share set in the Overview marches there or attacks it') },
    { id: 'form', label: t('Form corps from reserve'), key: 'j', run: () => { ui().order({ t: 'form', region: sel, u: upToCap(depotOf(r).u) }); },
      off: dep < 1 ? t('The reserve holds no battalions') : undefined, title: t('Turn the {0} battalions waiting in the reserve into a corps you command. Only corps can be selected, moved and put into an army.', Math.min(dep, CORPS_CAP)) },
  ];
  if (r.units.plane > 0) v.push({ id: 'air', label: t('Air strike'), key: 'a', ext: true, run: () => ui().beginOrder('air'), off: busy ?? undefined });
  return v;
}

function borderVerbs(g: GameState, me: number, rid: number, sec: number): Verb[] {
  const r = g.regions[rid], b = borderBalance(g, rid, sec), ours = corpsAtPost(r, sec), tool = ui().borderTool;
  const toggle = (k: 'send' | 'fort' | 'scout') => () => ui().setBorderTool(tool === k ? '' : k);
  const army = (g.hq ?? []).find(h => h.owner === me && h.front.includes(rid));
  const v: Verb[] = [
    { id: 'send', label: t('Send corps…'), key: 'm', run: toggle('send'), on: tool === 'send' },
    { id: 'fort', label: t('Fortify…'), key: 'h', run: toggle('fort'), on: tool === 'fort' },
  ];
  if (b.nb >= 0) v.push({ id: 'scout', label: t('Scout…'), key: 'j', run: toggle('scout'), on: tool === 'scout' });
  if (b.nb >= 0 && b.foe !== me) v.push({ id: 'atk', label: t('Attack across'), key: 'k', danger: true, run: () => ui().march(rid, b.nb, !!treatyOf(g, me, b.foe) || undefined),
    off: r.battle >= 0 ? t('A battle is going on here') : groundUnits(r.units) < 2 ? t('Needs 2 battalions') : undefined });
  v.push({
    id: 'cmd', label: army ? tn('Hand to {0}', { raw: hqName(army) }) : t('Hand to a commander'), key: 'l',
    off: !ours.length ? t('No corps of ours on this border') : army && ours.every(c => c.army === army.id) ? tn('Already under {0}', { raw: hqName(army) }) : undefined,
    title: t('A commander holds this border with the corps standing on it and asks you for what he needs'),
    run: () => { const ids = ours.map(c => c.id); if (army) ui().order({ t: 'armyAssign', army: army.id, corps: ids, on: true }); else if (ui().order({ t: 'army', corps: ids })) openNewArmy(me); },
  });
  return v;
}

function openNewArmy(me: number) { const a = (ui().session?.state.hq ?? []).filter(x => x.owner === me).slice(-1)[0]; if (a) ui().selectArmy(a.id); }

function corpsVerbs(g: GameState, me: number, ids: number[]): Verb[] {
  const W = buildWorld(), found = ids.map(id => findCorps(g, me, id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!found.length) return [];
  const mode = ui().orderMode && ui().orderKind === 'corps', goal = ui().goal;
  const target = (g2: 1 | 2 | null) => () => { if (g2) ui().setGoal(g2); if (mode && !g2) ui().cancelOrder(); else ui().beginOrder('corps'); };
  const canAtk = found.some(x => W.regions[x.r.id].land.some(n => g.regions[n].owner !== me && g.regions[n].owner >= 0));
  const posts = found.filter(x => x.c.p >= 0 && x.c.p < 1000);
  const digCost = posts.reduce((s, x) => s + (fortCost(x.r, 'trench', x.c.p, g) ?? 0), 0), digMax = posts.length > 0 && posts.every(x => fortCost(x.r, 'trench', x.c.p, g) === null);
  const one = found.length === 1 ? found[0] : null;
  const inArmy = found.map(x => x.c.army), sameArmy = inArmy.every(a => a === inArmy[0]) ? inArmy[0] : undefined;
  const h = sameArmy !== undefined ? (g.hq ?? []).find(x => x.id === sameArmy) : undefined;
  const pair = found.length === 2 && found[0].r.id === found[1].r.id && found[0].c.p === found[1].c.p ? found : null;
  const nr = found.every(x => x.c.nr);
  const v: Verb[] = [
    { id: 'move', label: t('Move'), key: 'm', run: target(null), on: mode, title: t('Then click an own region or border on the map (or right-click it straight away)') },
    { id: 'atk', label: goal === 2 ? t('Attack · invade') : t('Attack · first line'), key: 'k', danger: true, run: target(goal), off: canAtk ? undefined : t('None of them borders an enemy'), title: t('Then click an enemy region next to them (or right-click it straight away)') },
    { id: 'dig', label: digCost ? t('Dig in · {0}', digCost) : t('Dig in'), key: 'h', run: () => { for (const x of posts) if (fortCost(x.r, 'trench', x.c.p, g) !== null) ui().fortify(x.r.id, 'trench', x.c.p); },
      off: !posts.length ? t('They stand in the centre, not on a border') : digMax ? t('The trench is as deep as it goes') : g.factions[me].supply < digCost ? t('{0} Production short', digCost - g.factions[me].supply) : undefined,
      title: t('Deepen the trench on the border each corps stands on') },
  ];
  if (one && one.c.p >= 0) v.push({ id: 'fort', label: t('Fortify…'), key: 'u', run: () => ui().selectBorder(one.r.id, one.c.p, 'fort'), title: t('Open this border\'s card: wire, sandbags, MG nests, bunkers, guns') });
  if (pair) { const sum = groundUnits(pair[0].c.u) + groundUnits(pair[1].c.u); v.push({ id: 'merge', label: t('Merge'), key: 'j', run: () => ui().order({ t: 'merge', region: pair[0].r.id, a: pair[0].c.id, b: pair[1].c.id }), off: sum > CORPS_CAP ? t('Together more than {0} battalions', CORPS_CAP) : undefined }); }
  v.push({ id: 'refill', label: nr ? t('Refill off') : t('Refill on'), key: 'e', on: !nr, run: () => { for (const x of found) ui().order({ t: 'corpsSet', region: x.r.id, id: x.c.id, refill: nr }); },
    title: t('Whether these corps take men from the pool each week to make good their losses') });
  v.push(h
    ? { id: 'army', label: tn('Army: {0}', { raw: hqName(h) }), key: 'l', run: () => ui().selectArmy(h.id) }
    : { id: 'army', label: found.length === 1 ? t('Appoint a commander') : t('Form army'), key: 'l', run: () => { if (ui().order({ t: 'army', corps: found.map(x => x.c.id) })) openNewArmy(me); },
      title: t('A commander takes these corps and the regions they stand in as his front, and asks you for what he needs') });
  return v;
}

function armyVerbs(g: GameState, me: number, id: number): Verb[] {
  const h = (g.hq ?? []).find(x => x.id === id && x.owner === me); if (!h) return [];
  const n = (g.requests ?? []).filter(q => q.army === h.id).length;
  return [
    ...MANDATES.map((_, k): Verb => ({ id: 'm' + k, label: t(MAND[k]), on: h.mandate === k, danger: k === 2, run: () => ui().order({ t: 'armySet', army: h.id, mandate: k as Mandate }),
      title: t(['Hold the line: no attacks', 'Hold, and propose local attacks on the first line', 'Prepare an offensive on the target and ask for the go'][k]) })),
    { id: 'req', label: n ? t('Requests ({0})', n) : t('Requests'), key: 'q', run: () => ui().setPanel('staff') },
    { id: 'sel', label: t('Select its corps'), key: 'j', run: () => { const cs = armyCorps(g, h); if (cs.length) ui().selectCorps(cs.map(x => x.c.id), false, cs[0].r.id); }, off: armyCorps(g, h).length ? undefined : t('No corps') },
    { id: 'rel', label: t('Relieve'), run: () => ui().order({ t: 'relieve', army: h.id }), title: t('A new commander takes over; his corps lose 5 morale') },
    { id: 'dis', label: t('Disband'), run: () => { if (ui().order({ t: 'disband', army: h.id })) ui().selectArmy(-1); }, title: t('The corps come under your own orders') },
  ];
}

function enemyVerbs(g: GameState, me: number, sel: number): Verb[] {
  const W = buildWorld(), r = g.regions[sel], sup = g.factions[me].supply;
  const from = W.regions[sel].adj.filter(i => g.regions[i].owner === me).sort((a, b) => groundUnits(g.regions[b].units) - groundUnits(g.regions[a].units))[0];
  const tr = r.owner >= 0 ? treatyOf(g, me, r.owner) : undefined;
  const air = g.regions.find(x => x.owner === me && x.units.plane > 0 && x.battle < 0 && x.id !== sel && hops(x.id, sel, AIR_RANGE) <= AIR_RANGE);
  const cap = g.regions.find(x => x.capitalOf === me && x.owner === me), spies = g.spies.filter(s => s.f === me);
  const fr = from !== undefined ? g.regions[from] : null;
  const v: Verb[] = [
    { id: 'atk', label: from !== undefined ? t('Attack from {0}', W.regions[from].name) : t('Attack'), key: 'k', danger: true, run: () => ui().march(from!, sel, !!tr || undefined),
      off: fr === null ? t('None of your regions borders it') : fr.battle >= 0 ? t('A battle is going on in {0}', W.regions[fr.id].name) : groundUnits(fr.units) < 2 ? t('Needs 2 battalions in {0}', W.regions[fr.id].name) : undefined,
      title: tr ? t('Attacking breaks the treaty: war weariness and lost trust') : t('The share set below marches from the strongest neighbour') },
    { id: 'scout', label: t('Patrol · {0}', COST.patrol), key: 'u', run: () => ui().order({ t: 'patrol', from: from!, to: sel }),
      off: from === undefined ? t('None of your regions borders it') : sup < COST.patrol ? t('{0} Production short', COST.patrol - sup) : undefined },
    { id: 'spy', label: t('Spy · {0}', COST.spy), key: 'j', run: () => ui().order({ t: 'spy', to: sel }),
      off: spies.some(s => s.region === sel) ? t('Our agent is already there') : !cap ? t('Our capital has fallen') : spies.length >= 3 ? t('3 agents in the field already') : sup < COST.spy ? t('{0} Production short', COST.spy - sup) : undefined },
  ];
  if (air) v.push({ id: 'air', label: t('Air strike from {0}', W.regions[air.id].name), key: 'e', danger: true, run: () => tr ? ui().order({ t: 'air', from: air.id, to: sel, frac: ui().sendFrac, brk: true }) : ui().air(air.id, sel) });
  if (r.battle >= 0) v.push({ id: 'watch', label: t('Watch the battle'), run: () => { const b = g.battles.find(x => x.region === sel && !x.ended); if (b) rendererRef.current?.flyToBattle(b.id, 6); } });
  return v;
}

/** What is selected, for the bar's title line, and its verbs. */
function current(g: GameState, me: number, s: ReturnType<typeof ui>): { title: ReactNode; sub: string; verbs: Verb[] } | null {
  const W = buildWorld();
  if (s.armySel >= 0) { const h = (g.hq ?? []).find(x => x.id === s.armySel && x.owner === me); if (h) return { title: hqName(h), sub: `${h.cmd.name} · ${t(MAND[h.mandate])}`, verbs: armyVerbs(g, me, h.id) }; }
  if (s.corps.length) {
    const found = s.corps.map(id => findCorps(g, me, id)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!found.length) return { title: t('{0} corps', s.corps.length), sub: t('on the move: orders once they stand at a post'), verbs: [] };
    const btl = found.reduce((n, x) => n + groundUnits(x.c.u), 0);
    return { title: found.length === 1 ? groupName(me, 1, found[0].c.n) : found.slice(0, 2).map(x => groupName(me, 1, x.c.n).split(' ')[0]).join(' + ') + (found.length > 2 ? ' …' : ''), sub: t('{0} corps · {1} btl', found.length, btl), verbs: corpsVerbs(g, me, s.corps) };
  }
  if (s.sel < 0) return null;
  const r = g.regions[s.sel];
  if (s.border && s.border[0] === s.sel && r.owner === me) {
    const [rid, sec] = s.border, b = borderBalance(g, rid, sec);
    return { title: `${nm(W.regions[rid].name)} ↔ ${b.nb >= 0 ? nm(W.regions[b.nb].name) : sec >= 1000 ? t('coast') : '?'}`, sub: t('Border'), verbs: borderVerbs(g, me, rid, sec) };
  }
  if (r.owner === me) return { title: nm(W.regions[s.sel].name), sub: t('{0} btl · {1} corps', groundUnits(r.units), corpsIn(r).length), verbs: regionVerbs(g, me, s.sel) };
  return { title: nm(W.regions[s.sel].name), sub: r.owner >= 0 ? t('Enemy region') : t('Neutral region'), verbs: enemyVerbs(g, me, s.sel) };
}

function fire(v: Verb) {
  if (v.off) { ui().say(v.off); Sfx.deny(); return; }
  click(); v.run();
}

export function CommandBar() {
  const sim = useSim(); const s = useUi();
  const cur = sim ? current(sim.g, sim.me, s) : null;
  // keys: only the verbs on the bar right now, never while typing, with a modifier or under an overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === 'y' || e.key === 'n' || e.key === 'Y' || e.key === 'N') return; // the Inbox answers with Y / N
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const st = ui(), ss = st.session; if (!ss || st.overlay) return;
      const c = current(ss.state, ss.me, st); if (!c) return;
      const v = c.verbs.find(x => x.key === e.key.toLowerCase() && !x.ext); if (!v) return;
      e.preventDefault(); fire(v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!sim) return null;
  if (!cur) return <div className="cmdbar idle" role="toolbar" aria-label={t('Orders')}><small>{t('Select a region, a border or a corps on the map to see its orders here.')}</small></div>;
  return (
    <div className="cmdbar" role="toolbar" aria-label={t('Orders')}>
      <div className="cb-h"><b>{cur.title}</b><small>{cur.sub}</small></div>
      {cur.verbs.length > 0 && (
        <div className="cb-v">
          {cur.verbs.map(v => (
            <button key={v.id} className={'cb' + (v.danger ? ' danger' : '') + (v.off ? ' off' : '')} aria-pressed={v.on ?? undefined} aria-disabled={!!v.off || undefined}
              title={[v.off ?? v.title, v.key ? `(${v.key.toUpperCase()})` : ''].filter(Boolean).join(' ')} onClick={() => fire(v)}>
              <span>{v.label}</span>{v.key && <kbd>{v.key.toUpperCase()}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
