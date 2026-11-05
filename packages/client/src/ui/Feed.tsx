// Bottom-left event feed. Items with a region fly the camera there and select it.
import { useUi } from '../game/store';
import { rendererRef } from './refs';

export function Feed() {
  const feed = useUi(s => s.feed);
  return (
    <div id="feed" aria-live="polite">
      {feed.map(f => {
        const go = f.region !== undefined || f.report !== undefined;
        const open = () => {
          if (f.report !== undefined) { useUi.setState({ reportId: f.report }); useUi.getState().setOverlay('reports'); return; }
          if (f.region === undefined) return; rendererRef.current?.flyTo(f.region, 16); useUi.getState().select(f.region);
        };
        const body = <><time>{f.day}</time><span>{f.text}</span></>;
        return go
          ? <button key={f.id} className={`fi go ${f.cls}`} title={f.report !== undefined ? 'Read the after-action report' : 'Jump to this region'} onClick={open}>{body}</button>
          : <div key={f.id} className={`fi ${f.cls}`}>{body}</div>;
      })}
    </div>
  );
}
