// The guided first war (design-play §6): the objective list top left with a "Show me" for each objective, what each stage
// unlocks (rail buttons and map modes stay hidden until then), and a card when a new stage opens.
import { useState } from 'react';
import { FACTIONS, TUT_STAGES, buildWorld, type GameState } from '@riskrts/shared';
import { eventTaps, useSim, useUi } from '../game/store';
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
  'Troops in the reserve do nothing until you form them into corps. Corps can be moved, dug in and given to a commander.',
  'A trench, sandbags or wire on a border make every corps behind it fight harder.',
  'The neighbour attacks now, and the other powers stop holding back. Watch the battle bar at the bottom: the barrage and the stance are yours to set.',
  'You cannot run every front by hand. A commander holds his front by himself and sends you requests: men, works, patrols.',
  'Every region feeds only so many men. Corps over its capacity go hungry and lose strength.',
  'Give an army the Attack order: its commander prepares an operation and sends you the plan to approve.',
];

/** The text of an objective, how to do it, and what "Show me" does for it. */
function goal(g: GameState, key: string): { text: string; how: string; show: () => void } {
  const T = g.tut!, W = buildWorld(), home = W.regions[T.home]?.name ?? '?', foe = FACTIONS[T.foe]?.the ?? '?', ui = useUi.getState;
  const fly = (r = T.home) => { ui().select(r); rendererRef.current?.flyTo(r, 26); };
  const border = (tool: 'send' | 'fort') => { fly(); ui().selectBorder(T.home, T.front, tool); };
  switch (key) {
    case 'corps2': return { text: t('Form 2 corps from the reserve in {0}', home), how: t('Click {0} on the map, then press "Form corps from reserve" in the command bar at the top left, twice.', home),
      show: () => { fly(); hl('[data-cmd="form"]'); } };
    case 'post': return { text: t('Move one of them to the border with {0}', foe), how: t('"Show me" opens the border card with a list of your corps: press Send next to one. Any time later: select a corps, press Move (M) and click a border on the map.'),
      show: () => { border('send'); hl('.bc-send .buy'); } };
    case 'trench': return { text: t('Dig field works on the border with {0}', foe), how: t('In the border card, press a work under Fortify. Or select the corps on the border and press Dig in (H).'),
      show: () => { border('fort'); hl('.bcard .cm-b:not(:disabled)'); } };
    case 'hold': return { text: t('Hold {0} against the first attack', home), how: t('Nothing to press: wait for the attack. Unpause with the space bar if the game is paused.'), show: () => fly() };
    case 'army': return { text: t('Appoint a commander for the front facing {0}', foe), how: t('"Show me" selects the border: press "Hand to a commander" (L) in the command bar.'),
      show: () => { border('send'); hl('[data-cmd="cmd"], .bc-corps .lnk'); } };
    case 'reply': return { text: t('Answer his first request in the Inbox'), how: t('Requests arrive in the Staff panel on the left rail. Grant or refuse one.'), show: () => { ui().setPanel('staff'); hl('[data-panel="staff"]'); } };
    case 'mode': return { text: t('Open the Supply map mode'), how: t('Press the Supply button in the map modes at the top of the sidebar, or the key B.'), show: () => hl('[data-mode="3"]') };
    case 'cap': return { text: t('Keep every region under its supply capacity'), how: t('Red regions hold more men than they can feed: move a corps out, or build a depot there.'), show: () => { ui().setMode(3); hl('[data-mode="3"]'); } };
    case 'attack': return { text: t('Give an army the Attack order'), how: t('Open your army (Staff panel or click its commander) and press Attack.'), show: () => { ui().setPanel('staff'); hl('[data-panel="staff"]'); } };
    case 'take': return { text: t('Take one region: approve his plan, or attack yourself'), how: t('Approve the plan in the Staff panel. Or select corps, press Attack (K) and click an enemy region.'), show: () => { ui().setPanel('staff'); hl('[data-panel="staff"]'); } };
    default: return { text: key, how: '', show: () => {} };
  }
}

/** Light up the elements to press for a few seconds. */
function hl(sel: string) {
  // after the selection or panel change has rendered
  setTimeout(() => hlNow(sel), 200);
}
function hlNow(sel: string) {
  for (const el of document.querySelectorAll(sel)) { el.classList.remove('tut-hl'); void (el as HTMLElement).offsetWidth; el.classList.add('tut-hl'); setTimeout(() => el.classList.remove('tut-hl'), 4500); }
}

/** The objective list, top left, while the guided war runs. */
export function Objectives() {
  const sim = useSim(); const [open, setOpen] = useState(true);
  if (!sim || !guiding(sim.g)) return null;
  const { g } = sim, T = g.tut!, st = TUT_STAGES[T.stage];
  return (
    <div id="objectives" className="plate" role="region" aria-label={t('Objectives')}>
      <button className="ob-h" aria-expanded={open} onClick={() => { click(); setOpen(!open); }}>
        <small>{t('First war · stage {0} of {1}', T.stage + 1, DONE)}</small><b>{t(STAGE_NAME[T.stage])}</b><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <>
        <p className="ob-why">{t(STAGE_WHY[T.stage])}</p>
        <ul className="ob-list">
          {st.goals.map((k, i) => { const x = goal(g, k), ok = T.ok.includes(i); return (
            <li key={k} className={ok ? 'ok' : ''}><span className="ob-c" aria-hidden="true">{ok ? '✓' : '○'}</span><span className="ob-t">{x.text}{!ok && x.how && <small className="ob-how">{x.how}</small>}</span>
              {!ok && <button className="lnk" onClick={() => { click(); x.show(); }}>{t('Show me')}</button>}</li>
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
