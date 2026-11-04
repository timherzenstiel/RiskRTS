// One calm, contextual hint at a time (the tutorial). Dismissing hides tips for good; the menu turns them back on.
import type { ReactNode } from 'react';
import { FACTIONS } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';

export function Hint() {
  const sim = useSim(); const { tips, tut, orderMode, sel, overlay } = useUi();
  if (!sim || !tips || overlay) return null;
  const { g, me, session } = sim;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  const own = sel >= 0 && g.regions[sel]?.owner === me;
  let text: ReactNode = null;
  if (g.over) text = null;
  else if (session.speed === 0) text = 'Paused';
  else if (orderMode) text = <>Click a <b>bordering region</b> to march on it · <kbd>Esc</kbd> cancels</>;
  else if (tut < 1) text = <>{touch ? 'Tap' : 'Click'} one of your <b>{FACTIONS[me].short}</b> regions on the map to open it</>;
  else if (tut < 2) text = own ? <>Spend supply in the <b>Recruit</b> tab · keys <kbd>1</kbd>–<kbd>4</kbd></> : 'Select one of your own regions to recruit';
  else if (tut < 3) text = own ? (touch ? <>Open the <b>March</b> tab to send troops to a neighbour</> : <>Now <b>right-click</b> a neighbouring region to march, or use the <b>March</b> tab</>) : (touch ? 'Select your region, then open its March tab' : 'Select your region, then right-click a neighbour to attack');
  else if (tut < 4) text = <>{touch ? 'Pinch' : 'Scroll'} in on a <b>red battle marker</b> to watch the fight</>;
  if (!text) return null;
  return (
    <div id="hint" className="glass" role="status">
      <span>{text}</span>
      <button id="hint-x" aria-label="Hide tips" title="Hide tips" onClick={() => useUi.getState().setTips(false)}>×</button>
    </div>
  );
}
