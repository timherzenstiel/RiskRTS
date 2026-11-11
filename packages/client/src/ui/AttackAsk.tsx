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
import { frontLevels, corpsIn, frontOrderOf } from '@riskrts/shared';

export { lastPointer } from './pointer';

/** Whether the game on screen uses the simple command (set while the card renders, read by its key handler). */
const simpleRef = { on: false };

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
    if (simpleRef.on) useUi.setState({ corps: [] });
  };
  const cancel = () => { ui().askAttack(null); if (simpleRef.on) useUi.setState({ corps: [] }); };
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
      else if (e.key === '1') { e.stopPropagation(); go(1); }
      else if (e.key === '2') { e.stopPropagation(); go(2); }
      else if (e.key === 'Enter') { e.stopPropagation(); go(simpleRef.on ? 2 : ui().goal as Order); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);
  if (!sim || !ask) return null;
  const { g, me } = sim, W = buildWorld(), T = g.regions[ask.target], simple = !!g.cfg?.staff; simpleRef.on = simple;
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
    who = simple ? t('From {0}', nm(W.regions[can[0].r.id].name)) : can.length === 1 ? corpsTitle(me, can[0].r, can[0].c) : t('{0} corps', can.length);
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
      {simple ? (
        <div className="aa-b">
          <button className="btn primary" onClick={() => go(2)}>{t('Attack')}<kbd>↵</kbd></button>
          <button className="btn sm" onClick={() => { click(); cancel(); }}>{t('Cancel')}</button>
        </div>
      ) : (
        <div className="aa-b">
        <button className={'btn sm' + (goal === 1 ? ' primary' : '')} title={t('Take the enemy\'s first line on this border and hold it')} onClick={() => go(1)}>{t('First line')}<kbd>1</kbd></button>
        <button className={'btn sm' + (goal === 2 ? ' primary' : '')} title={t('Take the first line, then fight on into the region')} onClick={() => go(2)}>{t('Invade')}<kbd>2</kbd></button>
        <button className="btn sm" onClick={() => { click(); ui().askAttack(null); }}>{t('Cancel')}</button>
      </div>
      )}
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
  const row = (on: boolean, label: string, text: string, run: () => void) => (
    <button className={'fa-o' + (on ? ' on' : '')} aria-pressed={on} onClick={run}><b>{label}</b><small>{text}</small></button>
  );
  const names = fr.regions.slice(0, 3).map(id => nm(W.regions[id].name)).join(', ') + (fr.regions.length > 3 ? ' …' : '');
  if (g.cfg?.staff) {
    const fo = frontOrderOf(g, me, ask.region), order = (o: 'hold' | 'mine' | 'attack', target?: number) => { click(); const e = send({ t: 'front', region: ask.region, order: o, target }); if (e) ui().say(e); ui().askFront(null); ui().bump(); };
    // the regions he could take: every foreign neighbour of the front, the weakest first
    const targets = [...new Set(fr.regions.flatMap(id => W.regions[id].land.filter(n => g.regions[n].owner !== me)))].map(n => {
      const from = fr.regions.find(id => W.regions[id].land.includes(n))!, b = borderBalance(g, from, n), their: [number, number] = [b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]];
      return { n, their, known: b.know > 0, o: g.regions[n].owner };
    }).sort((a, b) => a.their[1] - b.their[1]);
    const w2 = 340, x2 = Math.max(8, Math.min(window.innerWidth - w2 - 8, ask.x - w2 / 2)), y2 = Math.max(60, Math.min(window.innerHeight - 130 - targets.length * 34 - 150, ask.y + 14));
    return (
      <div id="frontask" className="plate" role="dialog" aria-label={t('Front order')} style={{ left: x2, top: y2, width: w2 }} onPointerDown={e => e.stopPropagation()}>
        <div className="aa-h"><small>{t('Front order')}{fo.hq ? ' · ' + fo.hq.cmd.name : ''}</small><b>{names}</b></div>
        {row(fo.order === 'hold', t('Hold'), t('The general spreads the troops by threat, digs in and throws back what breaks in.'), () => order('hold'))}
        <div className={'fa-o fa-atk' + (fo.order === 'attack' ? ' on' : '')}>
          <b>{t('Attack')}</b><small>{t('He gathers what he needs and goes in when the odds are good. Pick the region to take:')}</small>
          <div className="fa-t">
            {targets.map(x => (
              <button key={x.n} className={'btn sm' + (fo.order === 'attack' && fo.target === x.n ? ' primary' : '')} onClick={() => order('attack', x.n)}>
                <i className="dot" style={{ background: x.o >= 0 ? FACTIONS[x.o].color : '#888' }} />{nm(W.regions[x.n].name)}<em>{x.known ? (x.their[0] === x.their[1] ? x.their[0] : `${x.their[0]}–${x.their[1]}`) : '?'}</em>
              </button>
            ))}
          </div>
        </div>
        {row(fo.order === 'mine', t('Mine'), t('No general. You move every battalion on this front yourself.'), () => order('mine'))}
        <button className="btn sm fa-x" onClick={() => { click(); ui().askFront(null); }}>{t('Close')}</button>
      </div>
    );
  }
  const w = 320, x = Math.max(8, Math.min(window.innerWidth - w - 8, ask.x - w / 2)), y = Math.max(60, Math.min(window.innerHeight - 250, ask.y + 14));
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
