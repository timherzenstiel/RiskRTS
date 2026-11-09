// One calm, contextual hint at a time (the tutorial). Dismissing hides tips for good; the menu turns them back on.
import { useState, type ReactNode } from 'react';
import { hostileBorders } from '@riskrts/shared';
import { inboxOf } from './Inbox';
import { guiding } from './unlock';
import { lsGet, lsSet } from './storage';
import { FACTIONS } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { t } from '../i18n';
import { rich, tn } from './LangPicker';
import { frontName, frontsOf } from './Generals';

const loadSeen = () => (lsGet('f14hints') ?? '').split(',').filter(Boolean);

export function Hint() {
  const sim = useSim(); const { tips, tut, orderMode, orderKind, overlay, panel } = useUi(); const [seen, setSeen] = useState(loadSeen);
  if (!sim || !tips || overlay) return null;
  const { g, me, session } = sim;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  let text: ReactNode = null, key = '';
  if (g.over) text = null;
  else if (session.speed === 0) text = t('Paused');
  else if (orderMode && orderKind === 'air') text = rich(t('Click a region up to <b>two borders away</b> for the air strike · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'ship') text = rich(t('Click one of <b>your coastal regions</b> to ship troops there · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'landing') text = rich(t('Click an <b>enemy coast</b> to land on · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'station') text = rich(t('Click a <b>sea zone</b> to station the fleet in · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'cvair') text = rich(t("Click a region on the coasts of the carrier's zone, or next to them · <kbd>Esc</kbd> cancels"));
  else if (orderMode && orderKind === 'corps') text = rich(t('Click <b>an own region or border</b> to move the selected corps there, <b>an enemy region</b> to attack · <kbd>Esc</kbd> cancels'));
  else if (orderMode) text = rich(t('Click a <b>bordering region</b> to march on it · <kbd>Esc</kbd> cancels'));
  else if (guiding(g)) text = null; // the guided war has its objective list instead
  else {
    // contextual hints, one at a time, each dismissed for good with ×
    const inbox = inboxOf(g, me), red = hostileBorders(g, me).some(b => b.danger === 3), fight = g.battles.some(b => !b.ended && b.sides.includes(me));
    const fr = frontsOf(g, me).find(x => x.level === 'you' && x.manual >= 3);
    const cand: [string, boolean, () => ReactNode][] = [
      ['start', tut < 1, () => rich(touch ? t('Tap one of your <b>{0}</b> regions on the map to open it', FACTIONS[me].short) : t('Click one of your <b>{0}</b> regions on the map to open it', FACTIONS[me].short))],
      ['inbox', inbox.length > 0 && panel !== 'staff', () => rich(t('Decisions wait in the <b>Inbox</b> (<kbd>G</kbd>): requests from your commanders, offers, choices.'))],
      ['red', red, () => rich(t('A <b>red border</b> is outnumbered: move corps there or dig in. <b>Situation</b> lists every border in danger.'))],
      ['battle', fight, () => rich(touch ? t('Pinch in on a <b>red battle marker</b> to watch the fight') : t('Scroll in on a <b>red battle marker</b> to watch the fight'))],
      ['manual', !!fr, () => rich(tn('You run {0} corps by hand on the <b>{1}</b> front. Open <b>Situation</b> and <b>appoint a commander</b>: he holds it while you look elsewhere.', fr!.manual, { raw: frontName(fr!) }))],
    ];
    const pick = cand.find(([k, on]) => on && !seen.includes(k));
    if (pick) { key = pick[0]; text = pick[2](); }
  }
  if (!text) return null;
  return (
    <div id="hint" className="glass" role="status">
      <span>{text}</span>
      <button id="hint-x" aria-label={key ? t('Got it: do not show this tip again') : t('Hide tips')} title={key ? t('Got it: do not show this tip again') : t('Hide tips')}
        onClick={() => { if (!key) { useUi.getState().setTips(false); return; } const n = [...seen, key]; setSeen(n); lsSet('f14hints', n.join(',')); }}>×</button>
    </div>
  );
}
