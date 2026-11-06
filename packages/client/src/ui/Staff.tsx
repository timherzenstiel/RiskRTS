// Commanders and requests (design-command §2.5): the Staff panel (requests waiting for an answer, grouped by army, and what the
// commanders did lately), the army card (commander, mandate, target, budget, standing approvals, front, corps), and the words
// for a request (the simulation keeps only numbers).
import {
  BUDGET_MAX, FACTIONS, MANDATES, STANDING_KINDS, TRAITS, armyCorps, armyName, borderLabel, buildWorld, groundUnits, groupName, income, transferCandidate, treatyOf,
  type GameState, type Hq, type Mandate, type Req, type ReqKind,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click } from './actions';
import { CloseIcon } from './icons';
import { rendererRef } from './refs';
import { stars } from './Forces';

const KIND: Record<ReqKind, string> = { men: 'Reinforcements', fort: 'Field works', recon: 'Reconnaissance', attack: 'Permission to attack', fallback: 'Permission to fall back', release: 'Send corps back' };
const URG = ['Routine', 'Urgent', 'Critical'] as const;
const SHORT: Record<ReqKind, string> = { men: 'Men', fort: 'Works', recon: 'Patrols', attack: 'Attacks', fallback: 'Falling back', release: 'Sending back' };
const rng = (a?: [number, number]) => !a ? '?' : a[0] === a[1] ? String(a[0]) : `~${a[0]}–${a[1]}`;

export const hqName = (h: Hq) => armyName(h.owner, h.n);
const hqs = (g: GameState, me: number) => (g.hq ?? []).filter(h => h.owner === me);

interface Opt { label: string; opt: 'yes' | 'recruit' | 'transfer' | 'deny'; n?: number; title?: string; danger?: boolean; off?: boolean }
/** Title, one line of reasons and the answers of a request. */
export function reqText(g: GameState, me: number, q: Req, n?: number): { title: string; why: string; opts: Opt[] } {
  const W = buildWorld(), R = (i: number) => W.regions[i].name, where = q.sector >= 0 ? `${R(q.region)} · ${borderLabel(W, q.sector)}` : R(q.region);
  const bal = q.own !== undefined ? `ours ${q.own} : theirs ${rng(q.their)}${q.massing ? ' · massing' : ''}` : '';
  const sup = g.factions[me]?.supply ?? 0, names = (q.corps ?? []).map(id => { for (const r of g.regions) { const c = r.cs?.find(x => x.id === id); if (c) return groupName(me, 1, c.n); } return null; }).filter(Boolean).join(', ');
  switch (q.kind) {
    case 'men': {
      const k = n ?? q.n ?? 1, cost = (q.cost ?? 0) * k, t = transferCandidate(g, me, q);
      return { title: `${q.n} battalions for ${where}`, why: `The line is short: ${bal}.`, opts: [
        { label: `Recruit ${k} · ${cost}`, opt: 'recruit', n: k, off: sup < cost, title: `${k} infantry battalions, raised in ${R(q.region)}: they train for a week, then take up that border` },
        { label: t ? `Send ${groupName(me, 1, t.c.n)}` : 'No corps free', opt: 'transfer', off: !t, title: t ? `${groupName(me, 1, t.c.n)} (${groundUnits(t.c.u)} btl) from ${R(t.r.id)} joins the army` : 'Form a corps from a depot first' },
        { label: 'Deny', opt: 'deny' },
      ] };
    }
    case 'fort': return { title: `${q.fort === 'wire' ? 'Barbed wire' : 'Trench'} on ${where}`, why: `The border is not safe: ${bal}.`, opts: [{ label: `Dig · ${q.cost}`, opt: 'yes', off: sup < (q.cost ?? 0) }, { label: 'Deny', opt: 'deny' }] };
    case 'recon': {
      const what = q.by === 'spy' ? `Spy into ${R(q.sector)}` : q.by === 'recon' ? `Reconnaissance flight over ${R(q.sector)}` : `Cavalry patrol across to ${R(q.sector)}`;
      const how = q.by === 'spy' ? 'An agent from the capital reports from inside every week until caught.' : q.by === 'recon' ? `From the airfield at ${R(q.from ?? q.region)}: troops, buildings and every border.` : `From ${R(q.from ?? q.region)}: the troops and the defences of this border.`;
      const why = q.for === 'attack' ? 'He will not propose an attack without a fresh report.' : q.for === 'target' ? 'He wants eyes on the target of his offensive.' : 'Our report on this border is missing or old.';
      return { title: what, why: `${why} ${how}`, opts: [{ label: `Send · ${q.cost}`, opt: 'yes', off: sup < (q.cost ?? 0) }, { label: 'Deny', opt: 'deny' }] };
    }
    case 'attack': return { title: `${q.goal === 2 ? 'Invade' : 'Take the first line of'} ${R(q.sector)}`, why: `${names || 'His corps'} on ${where} · ${bal} · ratio ${(q.ratio ?? 0).toFixed(1)}×.`, opts: [{ label: 'Attack', opt: 'yes', danger: true, title: 'The corps assemble on the border and go over' }, { label: 'Deny', opt: 'deny' }] };
    case 'fallback': return { title: `Fall back from ${where}`, why: `The border cannot be held: ${bal}. ${names} would fall back to the centre.`, opts: [{ label: 'Fall back', opt: 'yes', danger: true }, { label: 'Hold on', opt: 'deny' }] };
    case 'release': {
      const across = q.sector >= 0 && q.sector < 1000 ? g.regions[q.sector]?.owner ?? -1 : -1, t = across >= 0 ? treatyOf(g, me, across) : undefined;
      return { title: `Send back ${names || 'corps'}`, why: q.why === 'peace' ? `${t ? `We have a ${t.kind === 'cease' ? 'ceasefire' : t.kind === 'nap' ? 'non-aggression pact' : 'alliance'} with ${FACTIONS[across].the}` : 'That border is at peace'}: the front does not need them. They would wait at the centre of their region, under your orders.` : 'The front is safe without them. They would wait at the centre of their region, under your orders.',
        opts: [{ label: 'Send back', opt: 'yes' }, { label: 'Keep them', opt: 'deny' }] };
    }
  }
}

function send(cmd: Parameters<ReturnType<typeof useUi.getState>['order']>[0]) { return useUi.getState().order(cmd); }

function ReqRow({ g, me, q }: { g: GameState; me: number; q: Req }) {
  const t = reqText(g, me, q);
  return (
    <div className={'rq u' + q.urg}>
      <div className="rq-h"><span className="tag">{KIND[q.kind]}</span><small>{URG[q.urg]}</small>
        <button className="lnk" title="Show on the map" onClick={() => { click(); useUi.getState().select(q.region); rendererRef.current?.flyTo(q.region, 22); }}>Show</button></div>
      <b>{t.title}</b>
      <small className="rq-w">{t.why}</small>
      <div className="rq-a">{t.opts.map(o => <button key={o.opt} className={'btn sm' + (o.danger ? ' danger' : '')} disabled={o.off} title={o.title} onClick={() => send({ t: 'reply', req: q.id, opt: o.opt, n: o.n })}>{o.label}</button>)}</div>
    </div>
  );
}

/** Left-rail badge: open requests, and whether one is critical. */
export function staffBadge(g: GameState, me: number) { const qs = (g.requests ?? []).filter(q => q.owner === me); return { n: qs.length, crit: qs.some(q => q.urg === 2) }; }

export function StaffPanel() {
  const panel = useUi(s => s.panel); const sim = useSim();
  if (panel !== 'staff' || !sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState, armies = hqs(g, me);
  return (
    <section id="panel" className="plate" aria-label="Staff">
      <div className="pn-h"><h2>Staff</h2><button className="x" aria-label="Close panel" onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <div className="pn-body">
        {!armies.length && <p className="note">No armies yet. Select corps (Forces panel, or click them on the map) and press <b>Form army</b> on the corps card. Its commander then holds that stretch of front, shifts his corps where they are needed and asks you for men, works, patrols and permission to attack, fall back or send corps back.</p>}
        {armies.map(h => {
          const qs = (g.requests ?? []).filter(q => q.army === h.id).sort((a, b) => b.urg - a.urg), cs = armyCorps(g, h);
          return (
            <div key={h.id} className="st-army">
              <button className="oob-rh" onClick={() => { click(); ui().selectArmy(h.id); }}>
                <b>{hqName(h)}</b><small>{h.cmd.name} · {MANDATES[h.mandate]}{h.mandate === 2 && h.target !== undefined ? ` → ${W.regions[h.target].name}` : ''} · {cs.length} corps</small>
              </button>
              {qs.length ? qs.map(q => <ReqRow key={q.id} g={g} me={me} q={q} />) : <p className="note">No requests.</p>}
              {h.notes.length > 0 && <div className="st-log">{h.notes.slice(0, 3).map((n, i) => <small key={i}>{n.k === 'move' ? `Moved ${groupName(me, 1, n.n)} to ${borderLabel(W, n.post)} of ${W.regions[n.region].name}` : `Sent ${groupName(me, 1, n.n)} back (${n.why === 'peace' ? 'border at peace' : n.why === 'lost' ? 'front lost' : 'not needed'})`}</small>)}</div>}
            </div>
          );
        })}
        <p className="note">Commanders never attack or send troops back without your answer. Standing approvals and a front budget (army card) let them carry out the small things themselves.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- army card

export function ArmyCard() {
  const id = useUi(s => s.armySel); const sel = useUi(s => s.sel); const sim = useSim();
  if (!sim || id < 0) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const h = (g.hq ?? []).find(x => x.id === id && x.owner === me);
  if (!h) return null;
  const cs = armyCorps(g, h), targets = [...new Set(h.front.flatMap(r => W.regions[r].land))].filter(n => g.regions[n].owner !== me && g.regions[n].owner >= 0);
  const perWeek = Math.round(income(g, me) * h.budget), set = (o: Record<string, unknown>) => send({ t: 'armySet', army: h.id, ...o } as never);
  const own = sel >= 0 && g.regions[sel]?.owner === me;
  return (
    <section className="ccard acard" aria-label="Army" style={{ '--c': FACTIONS[me].color } as React.CSSProperties}>
      <div className="bc-h">
        <div><small>{hqName(h)} · {cs.length} corps · {cs.reduce((s, x) => s + groundUnits(x.c.u), 0)} btl</small><h3>{h.cmd.name}</h3></div>
        <button className="x" aria-label="Close army" onClick={() => ui().selectArmy(-1)}><CloseIcon /></button>
      </div>
      <p className="ac-tr">{h.cmd.tr.filter((t, i, a) => a.indexOf(t) === i).map(t => <span key={t} className="tag" title={TRAITS[t].desc}>{TRAITS[t].name}</span>)}<span className="oc-xp" title="Experience: battles won on his front">{stars(Math.floor(h.cmd.xp)) || 'new to command'}</span></p>
      <div className="lv-row"><span className="lv-l" title="What the commander may do on his own">Mandate</span>
        <div className="seg" role="group" aria-label="Mandate">
          {MANDATES.map((m, k) => <button key={m} aria-pressed={h.mandate === k} title={['Hold the line: no attacks', 'Hold, and propose local attacks on the first line', 'Prepare an offensive on the target and ask for the go'][k]} onClick={() => { click(); set({ mandate: k as Mandate }); }}>{m}</button>)}
        </div>
      </div>
      {h.mandate === 2 && (
        <div className="lv-row"><span className="lv-l">Target</span>
          <select className="sel" value={h.target ?? -1} onChange={e => set({ target: +e.target.value })}>
            <option value={-1}>– pick a region –</option>
            {targets.map(t => <option key={t} value={t}>{W.regions[t].name} ({FACTIONS[g.regions[t].owner].short})</option>)}
          </select>
        </div>
      )}
      <div className="lv-row"><span className="lv-l" title="Share of weekly income the commander may spend himself on men, works and patrols">Budget</span>
        <input type="range" min={0} max={BUDGET_MAX * 100} step={5} value={Math.round(h.budget * 100)} onChange={e => set({ budget: +e.target.value / 100 })} aria-label="Front budget" />
        <small className="lcdn">{Math.round(h.budget * 100)}% · {perWeek}/wk</small>
      </div>
      <div className="lv-row ac-st"><span className="lv-l" title="Carried out without asking">Always approve</span>
        {STANDING_KINDS.map(k => { const on = h.standing.includes(k); return <button key={k} className="tgl" aria-pressed={on} onClick={() => { click(); set({ standing: on ? h.standing.filter(x => x !== k) : [...h.standing, k] }); }}>{SHORT[k]}</button>; })}
      </div>
      <div className="lbl"><span>Front</span>{own && !h.front.includes(sel) && <button className="lnk" onClick={() => { click(); set({ front: [...h.front, sel] }); }}>+ {W.regions[sel].name}</button>}</div>
      <p className="ac-fr">{h.front.map(r => <span key={r} className="chip">{W.regions[r].name}{h.front.length > 1 && <button className="x" aria-label={`Take ${W.regions[r].name} off the front`} onClick={() => { click(); set({ front: h.front.filter(x => x !== r) }); }}>×</button>}</span>)}</p>
      <div className="lbl"><span>Corps</span></div>
      {cs.map(({ r, c }) => (
        <button key={c.id} className="oob-c" onClick={e => { useUi.getState().selectCorps([c.id], e.shiftKey, r.id); }}>
          <span className="oc-n"><b>{groupName(me, 1, c.n)}{c.man ? ' ✋' : ''}</b><small>{W.regions[r.id].name} · {c.p < 0 ? 'reserve' : borderLabel(W, c.p)}</small></span>
          <span className="oc-v"><b className="lcdn">{groundUnits(c.u)}</b><small>btl</small></span><span className="oc-xp">{stars(c.xp)}</span>
        </button>
      ))}
      <div className="cc-acts">
        <button className="btn sm" title="A new commander takes over; his corps lose 5 morale" onClick={() => { click(); send({ t: 'relieve', army: h.id }); }}>Relieve</button>
        <button className="btn sm" title="The corps come under your own orders" onClick={() => { click(); if (send({ t: 'disband', army: h.id })) ui().selectArmy(-1); }}>Disband</button>
        <button className="btn sm" onClick={() => { Sfx.clunk(); ui().setPanel('staff'); }}>Requests…</button>
      </div>
    </section>
  );
}

/** Army controls on the corps card: form an army from the selected corps, put them into one, or take them out. */
export function CorpsArmyRow({ ids }: { ids: number[] }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, armies = hqs(g, me), ui = useUi.getState;
  const inArmy = ids.map(id => { for (const r of g.regions) { const c = r.cs?.find(x => x.id === id); if (c) return c.army; } return undefined; });
  const one = inArmy.every(a => a === inArmy[0]) ? inArmy[0] : undefined, h = one !== undefined ? armies.find(x => x.id === one) : undefined;
  return (
    <div className="lv-row ac-row"><span className="lv-l">Army</span>
      {h ? <><button className="lnk" onClick={() => { click(); ui().selectArmy(h.id); }}>{hqName(h)} · {h.cmd.name}</button><button className="btn sm" title="Take out of the army: the corps come under your own orders" onClick={() => { click(); send({ t: 'armyAssign', army: h.id, corps: ids, on: false }); }}>Take out</button></> : (
        <>
          <button className="btn sm" title="A commander takes these corps and the regions they stand in as his front" onClick={() => { click(); if (send({ t: 'army', corps: ids })) { const a = (useUi.getState().session?.state.hq ?? []).filter(x => x.owner === me).slice(-1)[0]; if (a) ui().selectArmy(a.id); } }}>Form army</button>
          {armies.length > 0 && <select className="sel" value="" aria-label="Assign to army" onChange={e => { if (e.target.value) send({ t: 'armyAssign', army: +e.target.value, corps: ids, on: true }); }}>
            <option value="">Assign to…</option>{armies.map(a => <option key={a.id} value={a.id}>{hqName(a)}</option>)}
          </select>}
        </>
      )}
    </div>
  );
}
