// Bottom-left event feed. Items with a region fly the camera there and select it.
import { useSim, useUi } from '../game/store';
import { inLane, laneOn } from './lane';
import { rendererRef } from './refs';
import { t, tx } from '../i18n';

export function Feed() {
  const live = useUi(s => s.feed), log = useUi(s => s.log); useSim();
  // in the lane the last dispatches stay (newest first); floating over the map they fade after a few seconds
  const feed = laneOn() ? log.slice(0, 3) : live;
  return inLane('feed',
    <div id="feed" aria-live="polite">
      {feed.map(f => {
        const go = f.region !== undefined || f.report !== undefined;
        const open = () => {
          if (f.report !== undefined) { useUi.setState({ reportId: f.report }); useUi.getState().setOverlay('reports'); return; }
          if (f.region === undefined) return; rendererRef.current?.flyTo(f.region, 16); useUi.getState().select(f.region);
        };
        const body = <><time>{(f.day)}</time><span>{tx(f.text)}</span></>;
        return go
          ? <button key={f.id} className={`fi go ${f.cls}`} title={f.report !== undefined ? t('Read the after-action report') : t('Jump to this region')} onClick={open}>{body}</button>
          : <div key={f.id} className={`fi ${f.cls}`}>{body}</div>;
      })}
    </div>
  );
}
