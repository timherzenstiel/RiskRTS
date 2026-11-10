// The guided first war (design-play §6): the objective list top left with a "Show me" for each objective, what each stage
// unlocks (rail buttons and map modes stay hidden until then), and a card when a new stage opens.
import { useEffect, useState } from 'react';
import { FACTIONS, TUT_STAGES, buildWorld, loadRatio, type GameState } from '@riskrts/shared';
import { eventTaps, useSim, useUi, type TutPoint } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click } from './actions';
import { t } from '../i18n';
import { rendererRef } from './refs';
import { useStory } from './Story';
import { guiding } from './unlock';
export { guiding, unlocked } from './unlock';

const DONE = TUT_STAGES.length;

const STAGE_NAME = ['Mobilise', 'Dig in', 'First battle', 'Hand off', 'Supply', 'Offensive'];
const STAGE_WHY = [
  'New battalions wait in their region\'s reserve. Select the reserve like a corps and right-click the map: its battalions march as a corps under your orders, which you can then move, dig in or hand to a commander.',
  'Your corps on the border fights harder behind field works. "Dig in" adds a trench level for Production (up to three, each +25 % defence); sandbags and wire add more. Works only help in defence, and they stay on the border when the corps leaves.',
  'The neighbour attacks now, and the other powers stop holding back. The battle card shows both sides and your levers: the barrage spends shells for firepower, the stance trades losses against damage. Your trench is already working for you.',
  'You cannot run every front by hand. A commander moves the corps of his front by himself and asks you in the Inbox for what he may not decide: men, works, patrols, attacks.',
  'Every region feeds only so many battalions. Over its capacity they lose morale every week and get no replacements. The Supply map mode shows it: red regions are over capacity.',
  'On the Attack mandate your commander prepares an operation and sends you the plan: forces, barrage, odds and expected losses. Approve it and he attacks by himself. Or attack yourself: select corps, press Attack (K) and click an enemy region.',
];
/** The section of the Rules' Basics that explains each stage. */
const STAGE_RULE = ['b-reserve', 'b-dig', 'b-battle', 'b-cmd', 'b-supply', 'b-attack'];

type Point = Omit<TutPoint, 'key'>;

/** The text of an objective, how to do it, what "Show me" opens, and where it points: buttons to pulse and a pin on the map. */
function goal(g: GameState, me: number, key: string): { text: string; how: string; open: () => void; point: Point } {
  const T = g.tut!, W = buildWorld(), home = W.regions[T.home]?.name ?? '?', foe = FACTIONS[T.foe]?.the ?? '?', ui = useUi.getState;
  const fly = (r = T.home) => { ui().select(r); rendererRef.current?.flyTo(r, 26); };
  const border = (tool: 'send' | 'fort' | '') => { fly(); ui().selectBorder(T.home, T.front, tool || undefined); };
  const atBorder: Point = { sel: '', region: T.home, sector: T.front };
  const army = (g.hq ?? []).find(h => h.owner === me);
  const staff = () => ui().setPanel('staff');
  switch (key) {
    case 'corps2': return { text: t('Send the reserve of {0} towards the border with {1}', home, foe), how: t('Click {0} on the map and press "Select the reserve" (J) in the command bar at the top left. Then right-click the border with {1} on the map: the reserve marches there as a corps under your orders.', home, foe),
      open: () => fly(), point: { sel: '[data-cmd="form"]', region: T.home, label: t('Click {0}', home) } };
    case 'post': return { text: t('Move a corps to the border with {0}', foe), how: t('"Show me" opens the border card with a list of your corps: press Send next to one. Any time later: select a corps, press Move (M) and click a border on the map.'),
      open: () => border('send'), point: { ...atBorder, sel: '.bc-send .buy, [data-cmd="send"]', label: t('This border') } };
    case 'trench': return { text: t('Dig field works on the border with {0}', foe), how: t('In the border card, press a work under Fortify. Or select the corps on the border and press Dig in (H).'),
      open: () => border('fort'), point: { ...atBorder, sel: '.bcard .cm-b:not(:disabled), [data-cmd="dig"]', label: t('Dig in here') } };
    case 'hold': return { text: t('Hold {0} against the first attack', home), how: t('Nothing to press: wait for the attack. Unpause with the space bar if the game is paused.'),
      open: () => fly(), point: { ...atBorder, label: t('The attack comes here') } };
    case 'army': return { text: t('Appoint a commander for the front facing {0}', foe), how: t('"Show me" selects the border: press "Hand to a commander" (L) in the command bar.'),
      open: () => border(''), point: { ...atBorder, sel: '[data-cmd="cmd"], [data-cmd="army"]', label: t('This border') } };
    case 'reply': return { text: t('Answer his first request in the Inbox'), how: t('Requests arrive in the Staff panel on the left rail. Grant or refuse one.'),
      open: staff, point: { sel: '[data-panel="staff"]:not([aria-pressed="true"]), [data-tut="req"] .btn:not(:disabled)' } };
    case 'mode': return { text: t('Open the Supply map mode'), how: t('Press the Supply button in the map modes at the top of the sidebar, or the key B.'), open: () => {}, point: { sel: '[data-mode="3"]' } };
    case 'cap': {
      const over = g.regions.find(r => r.owner === me && loadRatio(g, r) > 1);
      return { text: t('Keep every region under its supply capacity'), how: t('Red regions hold more men than they can feed: move a corps out, or build a depot there.'),
        open: () => { ui().setMode(3); if (over) fly(over.id); }, point: { sel: over ? '[data-cmd="move"]' : '', region: over?.id, label: t('Over capacity') } };
    }
    case 'attack': return { text: t('Give an army the Attack order'), how: t('Open your army (Staff panel or click its commander) and press Attack.'),
      open: () => { if (army) ui().selectArmy(army.id); else staff(); }, point: { sel: '[data-tut="mand2"], [data-cmd="m2"]' } };
    case 'take': return { text: t('Take one region: approve his plan, or attack yourself'), how: t('Approve the plan in the Staff panel. Or select corps, press Attack (K) and click an enemy region.'),
      open: staff, point: { sel: '[data-panel="staff"]:not([aria-pressed="true"]), [data-tut="req"] .btn.primary, [data-tut="req"] .btn.danger', region: T.front, label: t('Take this region') } };
    default: return { text: key, how: '', open: () => {}, point: { sel: '' } };
  }
}

/** Keep pulsing the buttons of the active pointer until its objective is done: panels open and close, so look again a few times a second. */
function usePointer() {
  const tp = useUi(s => s.tutPoint);
  useEffect(() => {
    const clear = () => { for (const el of document.querySelectorAll('.tut-on')) el.classList.remove('tut-on'); };
    if (!tp?.sel) { clear(); return; }
    const mark = () => { const want = new Set(document.querySelectorAll(tp.sel)); for (const el of document.querySelectorAll('.tut-on')) if (!want.has(el)) el.classList.remove('tut-on'); for (const el of want) el.classList.add('tut-on'); };
    mark(); const iv = setInterval(mark, 300);
    return () => { clearInterval(iv); clear(); };
  }, [tp]);
}

/** The objective list, top left, while the guided war runs. */
export function Objectives() {
  const sim = useSim(); const [open, setOpen] = useState(true); const tp = useUi(s => s.tutPoint);
  usePointer();
  const T = sim && guiding(sim.g) ? sim.g.tut! : null;
  // the pointer goes once its objective is done, the stage moves on, or the guidance ends
  const gi = T && tp ? ((TUT_STAGES[T.stage]?.goals ?? []) as readonly string[]).indexOf(tp.key) : -1;
  const stale = !!tp && (!T || gi < 0 || T.ok.includes(gi));
  useEffect(() => { if (stale) useUi.setState({ tutPoint: null }); }, [stale]);
  if (!sim || !T) return null;
  const { g, me } = sim, st = TUT_STAGES[T.stage];
  const point = (k: string, x: ReturnType<typeof goal>) => {
    if (tp?.key === k) { useUi.setState({ tutPoint: null }); return; }
    x.open(); setTimeout(() => useUi.setState({ tutPoint: { key: k, ...x.point } }), 150);
  };
  return (
    <div id="objectives" className="plate" role="region" aria-label={t('Objectives')}>
      <button className="ob-h" aria-expanded={open} onClick={() => { click(); setOpen(!open); }}>
        <small>{t('First war · stage {0} of {1}', T.stage + 1, DONE)}</small><b>{t(STAGE_NAME[T.stage])}</b><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <>
        <p className="ob-why">{t(STAGE_WHY[T.stage])} <button className="lnk" onClick={() => { click(); useUi.getState().openRules(STAGE_RULE[T.stage]); }}>{t('More in the rules')}</button></p>
        <ul className="ob-list">
          {st.goals.map((k, i) => { const x = goal(g, me, k), ok = T.ok.includes(i), on = tp?.key === k; return (
            <li key={k} className={ok ? 'ok' : ''}><span className="ob-c" aria-hidden="true">{ok ? '✓' : '○'}</span><span className="ob-t">{x.text}{!ok && x.how && <small className="ob-how">{x.how}</small>}</span>
              {!ok && <button className="lnk" aria-pressed={on} onClick={() => { click(); point(k, x); }}>{on ? t('Hide') : t('Show me')}</button>}</li>
          ); })}
        </ul>
        <button className="lnk ob-skip" onClick={() => { click(); useUi.getState().order({ t: 'tut', what: 'skip' }); }}>{t('End the guidance and play freely')}</button>
      </>}
    </div>
  );
}

// a new stage: a card with its name and first objective; the end of the guidance: one more
eventTaps.push((g, e, me) => {
  if (e.k !== 'tut' || g.tut?.me !== me) return;
  const m = e.stage >= DONE
    ? { title: t('The guided war is over'), text: t('Every panel is open now. The war goes on: good luck.'), tone: 'good' as const }
    : { title: t('Stage {0} · {1}', e.stage + 1, t(STAGE_NAME[e.stage])), text: t(STAGE_WHY[e.stage]), tone: 'me' as const };
  useStory.setState({ moment: m, at: g.time }); Sfx.stinger(e.stage >= DONE ? 'triumph' : 'orders');
});
