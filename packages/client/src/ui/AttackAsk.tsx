// The attack card (design-optimize §3.4): a right-click on an enemy region does not send the troops at once. A small card at
// the cursor says who would attack, what is known of the other side and how the odds look, and takes the goal: take the first
// line, or invade. 1 / 2 or Enter confirm, Esc cancels.
import { useEffect } from 'react';
import { ASSEMBLE, FACTIONS, borderBalance, buildWorld, groundUnits, lookCorps, mainOf, marchEta, moveK, type Order } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { orderCorps, corpsTitle } from './Forces';
import { nm } from './format';
import { t } from '../i18n';
import { tn } from './LangPicker';
import { frontLevels, corpsIn } from '@riskrts/shared';

export { lastPointer } from './pointer';

/** How an attack looks before it starts: 2 good, 1 open, 0 bad, -1 nothing known. */
export function oddsOf(mine: number, their: [number, number], known: boolean): -1 | 0 | 1 | 2 {
  if (!known) return -1;
  if (mine >= their[1] * 1.5 && mine >= 3) return 2;
  if (mine < their[0] || mine < their[1] * .75) return 0;
  return 1;
}

export function AttackAsk() {
  const ask = useUi(s => s.attackAsk); const ids = useUi(s => s.corps); const goal = useUi(s => s.goal); const frac = useUi(s => s.sendFrac); const sim = useSim();
  const ui = useUi.getState;
  const go = (k: Order) => {
    const a = ui().attackAsk; if (!a) return;
    click(); ui().setGoal(k as 1 | 2); ui().askAttack(null);
    if (a.from !== undefined) ui().march(a.from, a.target); else orderCorps(a.target, undefined, true);
  };
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); ui().askAttack(null); }
      else if (e.key === '1') { e.stopPropagation(); go(1); }
      else if (e.key === '2') { e.stopPropagation(); go(2); }
      else if (e.key === 'Enter') { e.stopPropagation(); go(ui().goal as Order); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);
  if (!sim || !ask) return null;
  const { g, me } = sim, W = buildWorld(), T = g.regions[ask.target];
  if (!T || T.owner === me) return null;
  // who goes: the selected corps that border the target, or the share of a region's reserve
  let who: string, mine: number, from: number, wait: number;
  if (ask.from !== undefined) {
    const A = g.regions[ask.from]; from = ask.from;
    mine = Math.max(1, Math.round(groundUnits(mainOf(A)) * frac)); who = tn('{0} of the reserve of {1}', { raw: `${Math.round(frac * 100)} %` }, W.regions[from].name); wait = (marchEta(g, me, from, -1, from, ask.target) ?? 0) + ASSEMBLE * moveK(g);
  } else {
    const can = ids.map(id => lookCorps(g, me, id)).filter((x): x is NonNullable<typeof x> => !!x).filter(x => W.regions[x.r.id].land.includes(ask.target));
    if (!can.length) return null;
    from = can[0].r.id; mine = can.reduce((n, x) => n + groundUnits(x.c.u), 0);
    who = can.length === 1 ? corpsTitle(me, can[0].r, can[0].c) : t('{0} corps', can.length);
    wait = Math.max(...can.map(x => marchEta(g, me, x.r.id, x.c.p, x.r.id, ask.target) ?? 0)) + ASSEMBLE * moveK(g);
  }
  const b = borderBalance(g, from, ask.target), their: [number, number] = [b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]];
  const odds = oddsOf(mine, their, b.know > 0);
  const verdict = odds < 0 ? t('Nothing is known of the other side. Scout first, or attack blind.') : odds === 0 ? t('Bad odds: they are probably stronger, and they sit in their works.') : odds === 1 ? t('Open: about even. The defender has the trench on his side.') : t('Good odds.');
  const theirs = b.know ? (their[0] === their[1] ? String(their[0]) : `${their[0]}–${their[1]}`) : '?';
  const w = 300, x = Math.max(8, Math.min(window.innerWidth - w - 8, ask.x + 14)), y = Math.max(60, Math.min(window.innerHeight - 190, ask.y - 20));
  return (
    <div id="atkask" className={'plate o' + odds} role="dialog" aria-label={t('Attack')} style={{ left: x, top: y, width: w }} onPointerDown={e => e.stopPropagation()}>
      <div className="aa-h"><small>{t('Attack')} · {T.owner >= 0 ? nm(FACTIONS[T.owner].short) : ''}</small><b>{nm(W.regions[ask.target].name)}</b></div>
      <p className="aa-who">{who}</p>
      <p className="aa-n"><b className="lcdn">{mine}</b> <span>{t('btl')}</span> <i>:</i> <b className="lcdn">{theirs}</b>{b.their.trench ? <span> · {t('trench {0}', 'I'.repeat(Math.min(3, b.their.trench)))}</span> : null}<span> · {t('goes in after about {0} s', Math.round(wait))}</span></p>
      <p className="aa-v">{verdict}</p>
      <div className="aa-b">
        <button className={'btn sm' + (goal === 1 ? ' primary' : '')} title={t('Take the enemy\'s first line on this border and hold it')} onClick={() => go(1)}>{t('First line')}<kbd>1</kbd></button>
        <button className={'btn sm' + (goal === 2 ? ' primary' : '')} title={t('Take the first line, then fight on into the region')} onClick={() => go(2)}>{t('Invade')}<kbd>2</kbd></button>
        <button className="btn sm" onClick={() => { click(); ui().askAttack(null); }}>{t('Cancel')}</button>
      </div>
      <p className="aa-tip">{t('Shift + right-click attacks at once, with the goal used last.')}</p>
    </div>
  );
}

/**
 * The owner switch of a front (design-play §3.1, design-optimize §3.3), opened from the front's banner on the map: you place
 * every corps yourself, a general runs it, or the regions look after themselves.
 */
export function FrontAsk() {
  const ask = useUi(s => s.frontAsk); const sim = useSim(); const ui = useUi.getState;
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); ui().askFront(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);
  if (!sim || !ask) return null;
  const { g, me, session } = sim, W = buildWorld(), fr = frontLevels(g, me).find(f => f.regions.includes(ask.region));
  if (!fr) return null;
  const send = (c: Parameters<typeof session.send>[0]) => session.send(c);
  // You: no army, every region placed by hand. Auto: no army, the regions place their troops, corps go back to them.
  const set = (level: 'you' | 'auto') => {
    click();
    if (fr.hq !== undefined) send({ t: 'disband', army: fr.hq });
    for (const id of fr.regions) {
      send({ t: 'deploy', region: id, mode: level === 'you' ? 1 : 0 });
      if (level === 'auto') for (const c of corpsIn(g.regions[id])) if (c.man && (c.ord ?? 0) === 0) send({ t: 'corpsSet', region: id, id: c.id, man: false });
    }
    ui().askFront(null); ui().bump();
  };
  const general = () => { click(); ui().askFront(null); if (fr.hq !== undefined) ui().selectArmy(fr.hq); else ui().setPanel('situation'); };
  const names = fr.regions.slice(0, 3).map(id => nm(W.regions[id].name)).join(', ') + (fr.regions.length > 3 ? ' …' : '');
  const w = 320, x = Math.max(8, Math.min(window.innerWidth - w - 8, ask.x - w / 2)), y = Math.max(60, Math.min(window.innerHeight - 250, ask.y + 14));
  const row = (on: boolean, label: string, text: string, run: () => void) => (
    <button className={'fa-o' + (on ? ' on' : '')} aria-pressed={on} onClick={run}><b>{label}</b><small>{text}</small></button>
  );
  return (
    <div id="frontask" className="plate" role="dialog" aria-label={t('Who runs this front')} style={{ left: x, top: y, width: w }} onPointerDown={e => e.stopPropagation()}>
      <div className="aa-h"><small>{t('Who runs this front')} · {fr.borders === 1 ? t('1 hostile border') : t('{0} hostile borders', fr.borders)}</small><b>{names}</b></div>
      {row(fr.level === 'you', t('You'), t('You place every corps yourself. Nothing moves while you look away.'), () => set('you'))}
      {row(fr.level === 'cmd', t('A general'), fr.hq !== undefined ? t('He holds the line, asks for what he lacks and attacks by his mandate. Opens his army.') : t('He holds the line, asks for what he lacks and attacks by his mandate. Pick one in Situation.'), general)}
      {row(fr.level === 'auto', t('Auto'), t('The regions man their borders and refill them. Auto never attacks.'), () => set('auto'))}
      <button className="btn sm fa-x" onClick={() => { click(); ui().askFront(null); }}>{t('Close')}</button>
    </div>
  );
}
