// The in-game screen: map, top strip, War Office sidebar (docked right), dispatches, front command bar, overlays.
import { useEffect } from 'react';
import { useSim, useUi } from '../game/store';
import { GuestSession } from '../game/session';
import { BattleCard } from './BattleCard';
import { Feed } from './Feed';
import { Hint } from './Hint';
import { Overlays } from './Overlays';
import { OfferBanner } from './Diplomacy';
import { Sidebar } from './Sidebar';
import { Stage } from './Stage';
import { TopBar } from './TopBar';
import { Modal } from './Modal';
import { useGameKeys } from './useGameKeys';
import { useNet } from './netStore';
import { quitToTitle } from './actions';
import { SAVE_KEY, lsDel, writeSave } from './storage';

const AUTOSAVE_MS = 45_000;

function Connection() {
  const sim = useSim(); const lost = useNet(s => s.hostLost);
  if (!sim) return null;
  const s = sim.session;
  return (
    <>
      {s instanceof GuestSession && !lost && (
        <div className="conn plate" role="status" title="Round-trip time to the host">
          <i className={'led' + (s.latency > 250 ? ' slow' : '')} />{s.latency ? `${s.latency} ms` : 'Connected'}
        </div>
      )}
      {lost && (
        <Modal label="Host disconnected" narrow>
          <div className="kicker">Connection lost</div><h2>Host disconnected</h2>
          <p className="lede">The host left or lost their connection, so this war has ended.</p>
          <div className="row"><button className="btn primary" onClick={() => quitToTitle()}>Back to title</button></div>
        </Modal>
      )}
    </>
  );
}

function Fatal() {
  const fatal = useUi(s => s.fatal);
  if (!fatal) return null;
  return (
    <div className="fatal" role="alert">
      <div className="plate sheet narrow">
        <div className="kicker">Cannot draw the map</div><h2>The 3D view could not start</h2>
        <p className="lede small">Your browser or graphics driver refused WebGL. Try reloading, turning on hardware acceleration, or using a recent Chrome, Edge, Firefox or Safari.</p>
        <p className="muted tiny">{fatal}</p>
        <div className="row"><a className="btn primary" href={location.href.split('#')[0]}>Reload</a><button className="btn" onClick={() => quitToTitle()}>Back to title</button></div>
      </div>
    </div>
  );
}

export function Game() {
  useGameKeys();
  const hasDrawer = useUi(s => s.sel >= 0); const session = useUi(s => s.session); const over = useSim()?.g.over ?? false;

  // Single-player autosave every 45 s of play (the wall clock only advances while the game is not paused).
  useEffect(() => {
    if (!session || session.kind !== 'local') return;
    const t = setInterval(() => { if (session.speed > 0 && !session.state.over) writeSave(session); }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [session]);
  useEffect(() => { if (over && session?.kind === 'local') lsDel(SAVE_KEY); }, [over, session]);
  // a new war year: the General Staff asks for a doctrine (opens once per offer, when no other sheet is up)
  const offer = useSim()?.g.factions[session?.me ?? 0]?.docOffer;
  useEffect(() => { if (offer && !useUi.getState().overlay) useUi.getState().setOverlay('doctrine'); }, [offer]);

  return (
    <div id="app" className={hasDrawer ? 'has-drawer' : ''}>
      <Stage />
      <TopBar />
      <Sidebar />
      <OfferBanner />
      <div id="leftcol"><Feed /></div>
      <div id="bottom"><BattleCard /><Hint /></div>
      <Connection />
      <Overlays />
      <Fatal />
    </div>
  );
}
