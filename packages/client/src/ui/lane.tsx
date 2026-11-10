// The news lane (design-optimize §4.2): on desktop everything that reports or asks is shown in one column at the bottom of
// the right sidebar instead of floating over the map. Each kind has its slot there, so the order stays fixed: decisions to
// answer, then alerts, then the latest dispatches. On phones (no docked sidebar) the pieces keep their old places.
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';

export type LaneSlot = 'ask' | 'alert' | 'feed';

/** Whether the lane exists right now (a docked sidebar wide enough to hold it). */
export const laneOn = () => typeof document !== 'undefined' && window.innerWidth > 760 && !!document.getElementById('lane-ask');

/** Render `node` in its slot of the lane when there is one, else where the component stands. */
export function inLane(slot: LaneSlot, node: ReactNode): ReactNode {
  const el = typeof document !== 'undefined' && window.innerWidth > 760 ? document.getElementById('lane-' + slot) : null;
  return el ? createPortal(node, el) : node;
}

/** The lane itself, at the bottom of the sidebar. Empty slots take no room; with nothing to show the whole lane hides (CSS). */
export function Lane() {
  return (
    <section id="lane" aria-label={t('Dispatches')}>
      <h4 className="lane-h">{t('Dispatches')}</h4>
      <div id="lane-ask" /><div id="lane-alert" /><div id="lane-feed" />
    </section>
  );
}
