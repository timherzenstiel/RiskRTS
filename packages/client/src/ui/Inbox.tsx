// The Inbox (design-play §2): every decision that waits for the player in one place – commanders' requests, recruits that
// finished training, shells running out, treaty offers, the year's doctrine. New items arrive as toasts with their answer
// buttons and a sound (Y / N answer the newest), stand as envelope pins on the map, and can stop the game by themselves.
import { useEffect, useRef } from 'react';
import {
  CORPS_CAP, ECON, FACTIONS, STANDING_KINDS, TREATY_NAMES, armyCorps, barrageWeeks, buildWorld, corpsIn, depotOf, doctrinesOf, econOf, groundUnits, groupName,
  reqExpiry, type GameState, type ReqKind,
} from '@riskrts/shared';
import { useSim, useUi, type AutoPause } from '../game/store';
import { pins } from '../game/pins';
import { Sfx } from '../audio/sfx';
import { click } from './actions';
import { CloseIcon } from './icons';
import { rendererRef } from './refs';
import { nm } from './format';
import { getLang, t, tx } from '../i18n';
import { tn } from './LangPicker';
import { KIND, hqName, reqText } from './Staff';
import { upToCap } from './CommandBar';
import { KDESC } from './Diplomacy';
import { stars } from './Forces';
import { storyInbox } from './Story';

export type Src = 'cmd' | 'train' | 'econ' | 'diplo' | 'cal' | 'war';
/** An answer; `run` returns false when the game refused it (the item then stays up). */
export interface Opt { label: string; run: () => boolean | void; danger?: boolean; off?: boolean; title?: string; primary?: boolean }
export interface InboxItem {
  key: string; src: Src; urg: 0 | 1 | 2; title: string; why: string; at: number;
  /** Tag shown instead of the source (a request's kind). */
  tag?: string;
  /** Where on the map (pins, Show), and from whom. */
  region?: number; sector?: number; who?: string;
  /** Game time it lapses, and when it came (for the countdown bar). */
  exp?: number; from?: number;
  /** A small table (an operation plan or result). */
  rows?: [string, string][];
  /** Answers: `y` is what Y does, `n` what N does. */
  opts: Opt[]; y?: number; n?: number;
}

const SRC: Record<Src, string> = { cmd: 'Commander', train: 'Training', econ: 'Economy', diplo: 'Diplomacy', cal: 'General Staff', war: 'War' };
const SHORT_KIND: Record<ReqKind, string> = { men: 'Always approve men for this army', fort: 'Always approve works for this army', recon: 'Always approve patrols for this army', attack: '', fallback: 'Always approve falling back for this army', release: 'Always approve sending corps back for this army', op: '' };
const ui = useUi.getState;
const send = (cmd: Parameters<ReturnType<typeof ui>['order']>[0]) => ui().order(cmd);
const clearTrained = (rid: number) => useUi.setState(s => { const tr = { ...s.trained }; delete tr[rid]; return { trained: tr }; });

/** Every decision waiting for power `me`, most urgent and newest first. Items the player left alone for a while are hidden. */
export function inboxOf(g: GameState, me: number): InboxItem[] {
  const W = buildWorld(), st = ui(), out: InboxItem[] = [], f = g.factions[me];
  if (!f) return out;
  // commanders' requests
  for (const q of (g.requests ?? []).filter(q => q.owner === me)) {
    const h = (g.hq ?? []).find(x => x.id === q.army), rt = reqText(g, me, q);
    const opts: Opt[] = rt.opts.map(o => ({ label: o.label, danger: o.danger, off: o.off, title: o.title, primary: o.opt === 'yes' || o.opt === 'recruit', run: () => send({ t: 'reply', req: q.id, opt: o.opt, n: o.n }) }));
    if (h && (STANDING_KINDS as readonly ReqKind[]).includes(q.kind) && !h.standing.includes(q.kind) && SHORT_KIND[q.kind]) {
      const first = rt.opts[0];
      opts.splice(opts.length - 1, 0, { label: t(SHORT_KIND[q.kind]), off: first.off, title: t('Approve this one, and let him carry out the same kind of request by himself from now on'),
        run: () => send({ t: 'reply', req: q.id, opt: first.opt, n: first.n }) && send({ t: 'armySet', army: h.id, standing: [...h.standing, q.kind] }) });
    }
    out.push({ key: 'rq' + q.id, src: 'cmd', tag: KIND[q.kind], urg: q.urg, title: rt.title, why: rt.why, rows: rt.rows, at: q.at, region: q.region, sector: q.sector, who: h ? `${h.cmd.name} · ${hqName(h)}` : undefined,
      exp: Number.isFinite(reqExpiry(q, g)) ? reqExpiry(q, g) : undefined, from: q.at, opts, y: opts.findIndex(o => o.primary && !o.off), n: opts.length - 1 });
  }
  // result cards of operations (design-play §3.3): plan against outcome, until read
  for (const o of (g.ops ?? []).filter(o => o.owner === me && g.day - o.day <= 120)) {
    const P = o.plan, pc = (p: number) => `${Math.round(p * 100)} %`;
    out.push({ key: 'op' + o.id, src: 'cmd', tag: 'Operation', urg: 0, at: g.time - (g.day - o.day) / 7 * 20, region: o.target, who: o.gen,
      title: o.off ? tn('Operation {0} was called off', { raw: o.name }) : o.ok ? tn('Operation {0} succeeded', { raw: o.name }) : tn('Operation {0} failed', { raw: o.name }),
      why: o.off ? t('The attack never started: the corps were gone or the border was lost.') : o.ok ? t('{0} is ours.', W.regions[o.target].name) : t('{0} is still in enemy hands.', W.regions[o.target].name),
      rows: o.off ? undefined : [
        ['', t('Plan → outcome')],
        [t('Success'), `${pc(P.p)} → ${o.ok ? t('taken') : t('not taken')}`],
        [t('Losses'), `~${P.loss} → ${o.lost} ${t('men')}`],
        [t('Shells'), `${P.shells} → ${o.shells}`],
        [t('General'), o.star > 0 ? t('+1 star') : o.star < 0 ? t('−1 star') : t('no change')],
      ],
      opts: [{ label: t('OK'), primary: true, run: () => ui().dropInbox('op' + o.id, 9e9) }], y: 0, n: 0 });
  }
  // recruits that finished training and still wait in the reserve
  for (const [k, v] of Object.entries(st.trained)) {
    const rid = +k, r = g.regions[rid]; if (!r || r.owner !== me) continue;
    const dep = depotOf(r).u, n = Math.min(v.n, groundUnits(dep)); if (n < 1 || g.time - v.at > 40 * 20) continue;
    const pick = upToCap(dep), q = Math.min(n, CORPS_CAP);
    const room = corpsIn(r).filter(c => (c.ord ?? 0) === 0 && groundUnits(c.u) + q <= CORPS_CAP).sort((a, b) => (b.man ? 1 : 0) - (a.man ? 1 : 0) || groundUnits(b.u) - groundUnits(a.u))[0];
    const some: Partial<typeof dep> = {}; let left = q; for (const kk of ['inf', 'mg', 'art', 'tank'] as const) { const x = Math.min(dep[kk], left); if (x) { some[kk] = x; left -= x; } }
    const opts: Opt[] = [];
    if (room) opts.push({ label: tn('Join {0}', { raw: groupName(me, 1, room.n) }), primary: true, run: () => { const ok = send({ t: 'form', region: rid, u: some, into: room.id }); if (ok) clearTrained(rid); return ok; } });
    opts.push({ label: t('New corps'), primary: !room, run: () => { const ok = send({ t: 'form', region: rid, u: pick }); if (ok) clearTrained(rid); return ok; } });
    opts.push({ label: t('Leave in reserve'), run: () => clearTrained(rid) });
    out.push({ key: 'tr' + rid, src: 'train', urg: 0, title: n === 1 ? t('1 battalion ready in {0}', W.regions[rid].name) : t('{0} battalions ready in {1}', n, W.regions[rid].name),
      why: room ? tn('They wait in the reserve. {0} has room for them.', { raw: groupName(me, 1, room.n) }) : t('They wait in the reserve. Form them into a corps to give them orders.'), at: v.at, region: rid, opts, y: 0, n: opts.length - 1 });
  }
  // shells running out
  const wk = barrageWeeks(g, me), econ = econOf(f);
  if (isFinite(wk) && wk < 1.5 && econ < 2) out.push({
    key: 'econ-shells', src: 'econ', urg: wk < .5 ? 1 : 0, title: wk < 1 ? t('Shells for less than a week') : t('Shells for about a week'),
    why: t('{0} shells in stock. Munitions first sends {1} % of factory output to the shell works.', Math.floor(f.shells ?? 0), Math.round(ECON[2].shells * 100)), at: Math.floor(g.time / 20) * 20,
    opts: [{ label: t('Munitions first'), primary: true, run: () => { const ok = send({ t: 'econ', level: 2 }); if (ok) ui().dropInbox('econ-shells', 9e9); return ok; } }, { label: t('Ignore'), run: () => ui().dropInbox('econ-shells', 3 * 20) }], y: 0, n: 1,
  });
  // treaty offers
  for (const o of (g.offers ?? []).filter(o => o.to === me)) out.push({
    key: 'of' + o.id, src: 'diplo', urg: 1, title: tn('{0} offers a {1}', { raw: tx(FACTIONS[o.from].name) }, { raw: getLang() === 'de' ? t(TREATY_NAMES[o.kind]) : TREATY_NAMES[o.kind].toLowerCase() }), why: t(KDESC[o.kind]), at: o.exp - 60, exp: o.exp, from: o.exp - 60,
    opts: [{ label: t('Accept'), primary: true, run: () => send({ t: 'answer', id: o.id, yes: true }) }, { label: t('Decline'), run: () => send({ t: 'answer', id: o.id, yes: false }) }], y: 0, n: 1,
  });
  // war aims to choose, peace terms to answer (design-play §5)
  out.push(...storyInbox(g, me, send));
  // the year's doctrine
  if (f.docOffer) out.push({
    key: 'doc' + f.docOffer, src: 'cal', urg: 1, title: t('Choose the doctrine for {0}', f.docOffer), why: doctrinesOf(f.docOffer).map(d => tx(d.name)).join(' · '), at: (f.docDue ?? g.time) - 60, exp: f.docDue, from: (f.docDue ?? g.time) - 60,
    opts: [{ label: t('Choose…'), primary: true, run: () => ui().setOverlay('doctrine') }], y: 0,
  });
  return out.filter(x => (st.dismissed['ib:' + x.key] ?? -1) < g.time).sort((a, b) => b.urg - a.urg || b.at - a.at);
}

pins.onClick = (key, region) => { click(); ui().select(region); ui().focusInbox(key); };

function show(x: InboxItem) {
  if (x.region === undefined) return;
  click(); ui().select(x.region); rendererRef.current?.flyTo(x.region, 22);
}

function Card({ g, x, toast, onClose }: { g: GameState; x: InboxItem; toast?: boolean; onClose?: () => void }) {
  const left = x.exp !== undefined && x.from !== undefined ? Math.max(0, Math.min(1, (x.exp - g.time) / Math.max(1, x.exp - x.from))) : null;
  return (
    <div className={'ib u' + x.urg + (toast ? ' plate ib-toast' : '')} role={toast ? 'alert' : undefined}>
      <div className="ib-h">
        <span className="tag">{t(x.tag ?? SRC[x.src])}</span>{x.urg > 0 && <small className="ib-urg">{t(x.urg === 2 ? 'Critical' : 'Urgent')}</small>}
        {x.who && <small className="ib-who">{x.who}</small>}
        {x.region !== undefined && <button className="lnk" title={t('Show on the map')} onClick={() => show(x)}>{t('Show')}</button>}
        {onClose && <button className="x" aria-label={t('Close')} onClick={onClose}><CloseIcon /></button>}
      </div>
      <b className="ib-t">{x.title}</b>
      <small className="ib-w">{x.why}</small>
      {x.rows && <table className="ib-tab"><tbody>{x.rows.map(([a, b], i) => <tr key={i}><th>{a}</th><td>{b}</td></tr>)}</tbody></table>}
      {left !== null && <div className="ib-exp" title={x.src === 'cmd' ? t('Unanswered, the request lapses and his corps lose morale') : t('Time left to answer')}><i style={{ width: `${(left * 100).toFixed(1)}%` }} /></div>}
      <div className="ib-a" data-tut={x.src === 'cmd' ? 'req' : undefined}>
        {x.opts.map((o, i) => (
          <button key={i} className={'btn sm' + (o.danger ? ' danger' : o.primary ? ' primary' : '')} disabled={o.off} title={o.title} onClick={() => { click(); if (o.run() !== false) ui().dropInbox(x.key); }}>
            {o.label}{toast && i === x.y ? <kbd>Y</kbd> : toast && i === x.n ? <kbd>N</kbd> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- panel

const AP: [keyof AutoPause, string][] = [['urgent', 'An urgent decision waits'], ['attacked', 'A region of ours is attacked'], ['lost', 'We lose a region'], ['won', 'We win a battle']];

export function InboxPanel() {
  const panel = useUi(s => s.panel); const ap = useUi(s => s.autoPause); const sim = useSim();
  if (panel !== 'staff' || !sim) return null;
  const { g, me, session } = sim, W = buildWorld(), items = inboxOf(g, me), armies = (g.hq ?? []).filter(h => h.owner === me);
  const multi = g.factions.filter(f => f.alive && !f.ai).length > 1;
  return (
    <section id="panel" className="plate" aria-label={t('Inbox')}>
      <div className="pn-h"><h2>{t('Inbox')}</h2><button className="x" aria-label={t('Close panel')} onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <p className="pn-sub">{t('Every decision that waits for you. Y and N answer the newest message.')}</p>
      <div className="pn-body">
        {items.length ? items.map(x => <Card key={x.key} g={g} x={x} />) : <p className="note">{t('Nothing waits for an answer.')}</p>}
        <div className="lbl"><span>{t('Armies')}</span><small>{armies.length === 1 ? t('{0} army', 1) : t('{0} armies', armies.length)}</small></div>
        {!armies.length && <p className="note">{t('No armies yet. Select corps and press Appoint a commander (L): he holds that front and sends his requests here.')}</p>}
        {armies.map(h => (
          <div key={h.id} className="st-army">
            <button className="oob-rh" onClick={() => { click(); ui().selectArmy(h.id); }}>
              <b>{hqName(h)}</b><small>{h.cmd.name} {stars(Math.floor(h.cmd.xp))} · {t('{0} corps', armyCorps(g, h).length)} · {h.front.map(r => nm(W.regions[r].name)).slice(0, 3).join(', ')}</small>
            </button>
          </div>
        ))}
        <div className="lbl"><span>{multi ? t('Ask the others for a pause when') : t('Pause the game when')}</span></div>
        <div className="ib-ap">
          {AP.map(([k, l]) => <label key={k}><input type="checkbox" checked={ap[k]} onChange={e => ui().setAutoPause({ [k]: e.target.checked })} /> {t(l)}</label>)}
        </div>
        {multi && session.kind !== 'local' && <p className="note">{t('In multiplayer a pause needs a majority of the players. Each player can call {0} pauses an hour.', 3)}</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- toasts, sounds, keys

/** Toasts for new items (urgent ones stay until answered), the item opened from a map pin, sounds, auto-pause, Y / N. */
export function InboxWatcher() {
  const sim = useSim(); const toasts = useUi(s => s.toasts); const focus = useUi(s => s.inboxFocus); const panel = useUi(s => s.panel);
  const seen = useRef<Set<string> | null>(null);
  const items = sim ? inboxOf(sim.g, sim.me) : [];
  pins.items = items.filter(x => x.region !== undefined).map(x => ({ key: x.key, region: x.region!, sector: x.sector, urg: x.urg, title: x.title }));
  // new items: a toast, a sound, maybe a pause
  useEffect(() => {
    if (!sim) return;
    const keys = new Set(items.map(x => x.key));
    if (!seen.current) { seen.current = keys; return; } // what waits at load time comes without fanfare
    const fresh = items.filter(x => !seen.current!.has(x.key)); seen.current = keys;
    const st = ui(), now = sim.g.time;
    let next = st.toasts.filter(x => keys.has(x.key) && x.until > now);
    if (fresh.length) {
      next = [...next, ...fresh.map(x => ({ key: x.key, until: x.urg > 0 ? Infinity : now + 15 }))].slice(-3);
      if (fresh.some(x => x.urg > 0)) Sfx.ring(); else Sfx.teletype();
      if (fresh.some(x => x.urg > 0 && x.src === 'cmd')) st.autoPauseFor('urgent');
    }
    if (next.length !== st.toasts.length || next.some((x, i) => x.key !== st.toasts[i]?.key)) useUi.setState({ toasts: next });
    if (st.inboxFocus && !keys.has(st.inboxFocus)) st.focusInbox(null);
  });
  // Y / N answer the newest toast (or the item opened from a pin)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null, k = e.key.toLowerCase();
      if ((k !== 'y' && k !== 'n') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const s = ui(), ss = s.session; if (!ss || s.overlay) return;
      const all = inboxOf(ss.state, ss.me), keys = [...(s.inboxFocus ? [s.inboxFocus] : []), ...s.toasts.map(x => x.key).reverse()];
      const x = keys.map(k2 => all.find(i => i.key === k2)).find(Boolean); if (!x) return;
      const i = k === 'y' ? x.y : x.n; if (i === undefined || i < 0) return;
      const o = x.opts[i]; if (!o || o.off) { Sfx.deny(); return; }
      e.preventDefault(); click(); if (o.run() !== false) s.dropInbox(x.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!sim) return null;
  // with the Inbox open the toasts would only repeat it
  const shown = [...(focus ? [focus] : []), ...(panel === 'staff' ? [] : toasts.map(x => x.key).filter(k => k !== focus))].map(k => items.find(x => x.key === k)).filter((x): x is InboxItem => !!x).slice(0, 3);
  if (!shown.length) return null;
  return (
    <div id="ib-toasts" aria-live="polite">
      {shown.map(x => <Card key={x.key} g={sim.g} x={x} toast onClose={() => ui().dropInbox(x.key)} />)}
    </div>
  );
}
