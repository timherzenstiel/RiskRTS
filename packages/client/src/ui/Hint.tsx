// One calm, contextual hint at a time (the tutorial). Dismissing hides tips for good; the menu turns them back on.
import type { ReactNode } from 'react';
import { FACTIONS } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { t } from '../i18n';
import { rich } from './LangPicker';

export function Hint() {
  const sim = useSim(); const { tips, tut, orderMode, orderKind, sel, overlay } = useUi();
  if (!sim || !tips || overlay) return null;
  const { g, me, session } = sim;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  const own = sel >= 0 && g.regions[sel]?.owner === me;
  let text: ReactNode = null;
  if (g.over) text = null;
  else if (session.speed === 0) text = t('Paused');
  else if (orderMode && orderKind === 'air') text = rich(t('Click a region up to <b>two borders away</b> for the air strike · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'ship') text = rich(t('Click one of <b>your coastal regions</b> to ship troops there · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'landing') text = rich(t('Click an <b>enemy coast</b> to land on · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'station') text = rich(t('Click a <b>sea zone</b> to station the fleet in · <kbd>Esc</kbd> cancels'));
  else if (orderMode && orderKind === 'cvair') text = rich(t("Click a region on the coasts of the carrier's zone, or next to them · <kbd>Esc</kbd> cancels"));
  else if (orderMode) text = rich(t('Click a <b>bordering region</b> to march on it · <kbd>Esc</kbd> cancels'));
  else if (tut < 1) text = rich(touch ? t('Tap one of your <b>{0}</b> regions on the map to open it', FACTIONS[me].short) : t('Click one of your <b>{0}</b> regions on the map to open it', FACTIONS[me].short));
  else if (tut < 2) text = own ? rich(t('Spend supply in the <b>Recruit</b> tab · keys <kbd>1</kbd>–<kbd>4</kbd>')) : t('Select one of your own regions to recruit');
  else if (tut < 3) text = own ? (touch ? rich(t('Use <b>Pick a target on the map</b> in the Overview to send troops to a neighbour')) : rich(t('Now <b>right-click</b> a neighbouring region to march, or select a corps and right-click'))) : (touch ? t('Select your region, then pick a target from its Overview') : t('Select your region, then right-click a neighbour to attack'));
  else if (tut < 4) text = rich(touch ? t('Pinch in on a <b>red battle marker</b> to watch the fight') : t('Scroll in on a <b>red battle marker</b> to watch the fight'));
  if (!text) return null;
  return (
    <div id="hint" className="glass" role="status">
      <span>{text}</span>
      <button id="hint-x" aria-label={t('Hide tips')} title={t('Hide tips')} onClick={() => useUi.getState().setTips(false)}>×</button>
    </div>
  );
}
