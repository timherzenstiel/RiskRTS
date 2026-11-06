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
import { nm } from './format';
import { getLang, t, tx } from '../i18n';
import { rich, tn } from './LangPicker';

const KIND: Record<ReqKind, string> = { men: 'Reinforcements', fort: 'Field works', recon: 'Reconnaissance', attack: 'Permission to attack', fallback: 'Permission to fall back', release: 'Send corps back' };
const URG = ['Routine', 'Urgent', 'Critical'] as const;
/** Mandates in short words (design-play §4.3); the simulation's names are MANDATES. */
export const MAND = ['Hold', 'Defend', 'Attack'] as const;
const SHORT: Record<ReqKind, string> = { men: 'Men', fort: 'Works', recon: 'Patrols', attack: 'Attacks', fallback: 'Falling back', release: 'Sending back' };
const rng = (a?: [number, number]) => !a ? '?' : a[0] === a[1] ? String(a[0]) : `~${a[0]}–${a[1]}`;
/** One decimal, with a German decimal comma when German is on. */
const dec1 = (x: number) => { const s = x.toFixed(1); return getLang() === 'de' ? s.replace('.', ',') : s; };

export const hqName = (h: Hq) => armyName(h.owner, h.n);
const hqs = (g: GameState, me: number) => (g.hq ?? []).filter(h => h.owner === me);

interface Opt { label: string; opt: 'yes' | 'recruit' | 'transfer' | 'deny'; n?: number; title?: string; danger?: boolean; off?: boolean }
/** Title, one line of reasons and the answers of a request. */
export function reqText(g: GameState, me: number, q: Req, n?: number): { title: string; why: string; opts: Opt[] } {
  const W = buildWorld(), R = (i: number) => W.regions[i].name, where = { raw: q.sector >= 0 ? `${nm(R(q.region))} · ${tx(borderLabel(W, q.sector))}` : nm(R(q.region)) };
  const bal = { raw: q.own !== undefined ? `${tn('ours {0} : theirs {1}', q.own, { raw: rng(q.their) })}${q.massing ? ' · ' + t('massing') : ''}` : '' };
  const sup = g.factions[me]?.supply ?? 0, names = (q.corps ?? []).map(id => { for (const r of g.regions) { const c = r.cs?.find(x => x.id === id); if (c) return groupName(me, 1, c.n); } return null; }).filter(Boolean).join(', ');
  switch (q.kind) {
    case 'men': {
      const k = n ?? q.n ?? 1, cost = (q.cost ?? 0) * k, tc = transferCandidate(g, me, q);
      return { title: tn('{0} battalions for {1}', q.n, where), why: tn('The line is short: {0}.', bal), opts: [
        { label: t('Recruit {0} · {1}', k, cost), opt: 'recruit', n: k, off: sup < cost, title: t('{0} infantry battalions, raised in {1}: they train for a week, then take up that border', k, R(q.region)) },
        { label: tc ? tn('Send {0}', { raw: groupName(me, 1, tc.c.n) }) : t('No corps free'), opt: 'transfer', off: !tc, title: tc ? tn('{0} ({1} btl) from {2} joins the army', { raw: groupName(me, 1, tc.c.n) }, groundUnits(tc.c.u), R(tc.r.id)) : t('Form a corps from a reserve first') },
        { label: t('Deny'), opt: 'deny' },
      ] };
    }
    case 'fort': return { title: tn(q.fort === 'wire' ? 'Barbed wire on {0}' : 'Trench on {0}', where), why: tn('The border is not safe: {0}.', bal), opts: [{ label: t('Dig · {0}', q.cost), opt: 'yes', off: sup < (q.cost ?? 0) }, { label: t('Deny'), opt: 'deny' }] };
    case 'recon': {
      const what = q.by === 'spy' ? t('Spy into {0}', R(q.sector)) : q.by === 'recon' ? t('Reconnaissance flight over {0}', R(q.sector)) : t('Cavalry patrol across to {0}', R(q.sector));
      const how = q.by === 'spy' ? t('An agent from the capital reports from inside every week until caught.') : q.by === 'recon' ? t('From the airfield at {0}: troops, buildings and every border.', R(q.from ?? q.region)) : t('From {0}: the troops and the defences of this border.', R(q.from ?? q.region));
      const why = q.for === 'attack' ? t('He will not propose an attack without a fresh report.') : q.for === 'target' ? t('He wants eyes on the target of his offensive.') : t('Our report on this border is missing or old.');
      return { title: what, why: `${why} ${how}`, opts: [{ label: t('Send · {0}', q.cost), opt: 'yes', off: sup < (q.cost ?? 0) }, { label: t('Deny'), opt: 'deny' }] };
    }
    case 'attack': return { title: t(q.goal === 2 ? 'Invade {0}' : 'Take the first line of {0}', R(q.sector)), why: tn('{0} on {1} · {2} · ratio {3}×.', { raw: names || t('His corps') }, where, bal, { raw: dec1(q.ratio ?? 0) }), opts: [{ label: t('Attack'), opt: 'yes', danger: true, title: t('The corps assemble on the border and go over') }, { label: t('Deny'), opt: 'deny' }] };
    case 'fallback': return { title: tn('Fall back from {0}', where), why: tn('The border cannot be held: {0}. {1} would fall back to the centre.', bal, { raw: names }), opts: [{ label: t('Fall back'), opt: 'yes', danger: true }, { label: t('Hold on'), opt: 'deny' }] };
    case 'release': {
      const across = q.sector >= 0 && q.sector < 1000 ? g.regions[q.sector]?.owner ?? -1 : -1, tr = across >= 0 ? treatyOf(g, me, across) : undefined;
      const rest = q.why !== 'peace' ? t('The front is safe without them. They would wait at the centre of their region, under your orders.')
        : !tr ? t('That border is at peace: the front does not need them. They would wait at the centre of their region, under your orders.')
          : t(tr.kind === 'cease' ? 'We have a ceasefire with {0}: the front does not need them. They would wait at the centre of their region, under your orders.'
            : tr.kind === 'nap' ? 'We have a non-aggression pact with {0}: the front does not need them. They would wait at the centre of their region, under your orders.'
              : 'We have a alliance with {0}: the front does not need them. They would wait at the centre of their region, under your orders.', FACTIONS[across].the);
      return { title: names ? tn('Send back {0}', { raw: names }) : t('Send back corps'), why: rest,
        opts: [{ label: t('Send back'), opt: 'yes' }, { label: t('Keep them'), opt: 'deny' }] };
    }
  }
}

function send(cmd: Parameters<ReturnType<typeof useUi.getState>['order']>[0]) { return useUi.getState().order(cmd); }

function ReqRow({ g, me, q }: { g: GameState; me: number; q: Req }) {
  const rt = reqText(g, me, q);
  return (
    <div className={'rq u' + q.urg}>
      <div className="rq-h"><span className="tag">{t(KIND[q.kind])}</span><small>{t(URG[q.urg])}</small>
        <button className="lnk" title={t('Show on the map')} onClick={() => { click(); useUi.getState().select(q.region); rendererRef.current?.flyTo(q.region, 22); }}>{t('Show')}</button></div>
      <b>{rt.title}</b>
      <small className="rq-w">{rt.why}</small>
      <div className="rq-a">{rt.opts.map(o => <button key={o.opt} className={'btn sm' + (o.danger ? ' danger' : '')} disabled={o.off} title={o.title} onClick={() => send({ t: 'reply', req: q.id, opt: o.opt, n: o.n })}>{o.label}</button>)}</div>
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
    <section id="panel" className="plate" aria-label={t('Staff')}>
      <div className="pn-h"><h2>{t('Staff')}</h2><button className="x" aria-label={t('Close panel')} onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <p className="pn-sub">{t('Requests from your commanders. Answer them here, or let them approve small things by themselves.')}</p>
      <div className="pn-body">
        {!armies.length && <p className="note">{rich(t('No armies yet. Select corps (Forces panel, or click them on the map) and press <b>Form army</b> on the corps card. Its commander then holds that stretch of front, shifts his corps where they are needed and asks you for men, works, patrols and permission to attack, fall back or send corps back.'))}</p>}
        {armies.map(h => {
          const qs = (g.requests ?? []).filter(q => q.army === h.id).sort((a, b) => b.urg - a.urg), cs = armyCorps(g, h);
          return (
            <div key={h.id} className="st-army">
              <button className="oob-rh" onClick={() => { click(); ui().selectArmy(h.id); }}>
                <b>{hqName(h)}</b><small>{h.cmd.name} · {t(MAND[h.mandate])}{h.mandate === 2 && h.target !== undefined ? ` → ${nm(W.regions[h.target].name)}` : ''} · {t('{0} corps', cs.length)}</small>
              </button>
              {qs.length ? qs.map(q => <ReqRow key={q.id} g={g} me={me} q={q} />) : <p className="note">{t('No requests.')}</p>}
              {h.notes.length > 0 && <div className="st-log">{h.notes.slice(0, 3).map((n, i) => <small key={i}>{n.k === 'move' ? tn('Moved {0} to {1} of {2}', { raw: groupName(me, 1, n.n) }, borderLabel(W, n.post), W.regions[n.region].name) : tn('Sent {0} back ({1})', { raw: groupName(me, 1, n.n) }, n.why === 'peace' ? 'border at peace' : n.why === 'lost' ? 'front lost' : 'not needed')}</small>)}</div>}
            </div>
          );
        })}
        <p className="note">{t('Commanders never attack or send troops back without your answer. "Approves by himself" and a front budget (army card) let them carry out the small things themselves.')}</p>
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
    <section className="ccard acard" aria-label={t('Army')} style={{ '--c': FACTIONS[me].color } as React.CSSProperties}>
      <div className="bc-h">
        <div><small>{hqName(h)} · {t('{0} corps', cs.length)} · {t('{0} btl', cs.reduce((s, x) => s + groundUnits(x.c.u), 0))}</small><h3>{h.cmd.name}</h3></div>
        <button className="x" aria-label={t('Close army')} onClick={() => ui().selectArmy(-1)}><CloseIcon /></button>
      </div>
      <p className="ac-tr">{h.cmd.tr.filter((x, i, a) => a.indexOf(x) === i).map(x => <span key={x} className="tag" title={tx(TRAITS[x].desc)}>{tx(TRAITS[x].name)}</span>)}<span className="oc-xp" title={t('Experience: battles won on his front')}>{stars(Math.floor(h.cmd.xp)) || t('new to command')}</span></p>
      <div className="lv-row"><span className="lv-l" title={t('What the commander may do on his own')}>{t('Mandate')}</span>
        <div className="seg" role="group" aria-label={t('Mandate')}>
          {MANDATES.map((m, k) => <button key={m} aria-pressed={h.mandate === k} title={t(['Hold the line: no attacks', 'Hold, and propose local attacks on the first line', 'Prepare an offensive on the target and ask for the go'][k])} onClick={() => { click(); set({ mandate: k as Mandate }); }}>{t(MAND[k])}</button>)}
        </div>
      </div>
      {h.mandate === 2 && (
        <div className="lv-row"><span className="lv-l">{t('Target')}</span>
          <select className="sel" value={h.target ?? -1} onChange={e => set({ target: +e.target.value })}>
            <option value={-1}>{t('– pick a region –')}</option>
            {targets.map(x => <option key={x} value={x}>{nm(W.regions[x].name)} ({nm(FACTIONS[g.regions[x].owner].short)})</option>)}
          </select>
        </div>
      )}
      <div className="lv-row"><span className="lv-l" title={t('Share of weekly income the commander may spend himself on men, works and patrols')}>{t('Budget')}</span>
        <input type="range" min={0} max={BUDGET_MAX * 100} step={5} value={Math.round(h.budget * 100)} onChange={e => set({ budget: +e.target.value / 100 })} aria-label={t('Front budget')} />
        <small className="lcdn">{t('{0}% · {1}/wk', Math.round(h.budget * 100), perWeek)}</small>
      </div>
      <div className="lv-row ac-st"><span className="lv-l" title={t('Carried out without asking')}>{t('Approves by himself')}</span>
        {STANDING_KINDS.map(k => { const on = h.standing.includes(k); return <button key={k} className="tgl" aria-pressed={on} onClick={() => { click(); set({ standing: on ? h.standing.filter(x => x !== k) : [...h.standing, k] }); }}>{t(SHORT[k])}</button>; })}
      </div>
      <div className="lbl"><span>{t('Front')}</span>{own && !h.front.includes(sel) && <button className="lnk" onClick={() => { click(); set({ front: [...h.front, sel] }); }}>+ {nm(W.regions[sel].name)}</button>}</div>
      <p className="ac-fr">{h.front.map(r => <span key={r} className="chip">{nm(W.regions[r].name)}{h.front.length > 1 && <button className="x" aria-label={t('Take {0} off the front', W.regions[r].name)} onClick={() => { click(); set({ front: h.front.filter(x => x !== r) }); }}>×</button>}</span>)}</p>
      <div className="lbl"><span>{t('Corps')}</span></div>
      {cs.map(({ r, c }) => (
        <button key={c.id} className="oob-c" onClick={e => { useUi.getState().selectCorps([c.id], e.shiftKey, r.id); }}>
          <span className="oc-n"><b>{groupName(me, 1, c.n)}{c.man ? ' ✋' : ''}</b><small>{nm(W.regions[r.id].name)} · {c.p < 0 ? t('reserve') : tx(borderLabel(W, c.p))}</small></span>
          <span className="oc-v"><b className="lcdn">{groundUnits(c.u)}</b><small>{t('btl')}</small></span><span className="oc-xp">{stars(c.xp)}</span>
        </button>
      ))}
      <div className="cc-acts">
        <button className="btn sm" title={t('A new commander takes over; his corps lose 5 morale')} onClick={() => { click(); send({ t: 'relieve', army: h.id }); }}>{t('Relieve')}</button>
        <button className="btn sm" title={t('The corps come under your own orders')} onClick={() => { click(); if (send({ t: 'disband', army: h.id })) ui().selectArmy(-1); }}>{t('Disband')}</button>
        <button className="btn sm" onClick={() => { Sfx.clunk(); ui().setPanel('staff'); }}>{t('Requests…')}</button>
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
    <div className="lv-row ac-row"><span className="lv-l">{t('Army')}</span>
      {h ? <><button className="lnk" onClick={() => { click(); ui().selectArmy(h.id); }}>{hqName(h)} · {h.cmd.name}</button><button className="btn sm" title={t('Take out of the army: the corps come under your own orders')} onClick={() => { click(); send({ t: 'armyAssign', army: h.id, corps: ids, on: false }); }}>{t('Take out')}</button></> : (
        <>
          <button className="btn sm" title={t('A commander takes these corps and the regions they stand in as his front')} onClick={() => { click(); if (send({ t: 'army', corps: ids })) { const a = (useUi.getState().session?.state.hq ?? []).filter(x => x.owner === me).slice(-1)[0]; if (a) ui().selectArmy(a.id); } }}>{ids.length === 1 ? t('Appoint a commander') : t('Form army')}</button>
          {armies.length > 0 && <select className="sel" value="" aria-label={t('Assign to army')} onChange={e => { if (e.target.value) send({ t: 'armyAssign', army: +e.target.value, corps: ids, on: true }); }}>
            <option value="">{t('Assign to…')}</option>{armies.map(a => <option key={a.id} value={a.id}>{hqName(a)}</option>)}
          </select>}
        </>
      )}
    </div>
  );
}
