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

/** Where the pointer last went down, for placing the card. */
let ptr = { x: 0, y: 0 };
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { ptr = { x: e.clientX, y: e.clientY }; }, true);
export const lastPointer = () => ptr;

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
    </div>
  );
}
