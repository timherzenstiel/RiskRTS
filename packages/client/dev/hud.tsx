// Throw-away harness for the HUD without the 3D map (not part of the production build): renders the in-game panels over a
// plain background so Playwright can screenshot them quickly. Exposes window.__ui and window.__s.
import { createRoot } from 'react-dom/client';
import { useUi, useSim } from '../src/game/store';
import { HostSession } from '../src/game/session';
import { TopBar } from '../src/ui/TopBar';
import { Drawer } from '../src/ui/Drawer';
import { Feed } from '../src/ui/Feed';
import { Overlays } from '../src/ui/Overlays';
import { Toast } from '../src/ui/Toast';
import { FrontControls } from '../src/ui/FrontCard';
import { OfferBanner } from '../src/ui/Diplomacy';
import { FACTIONS, battleCounts, buildWorld } from '@riskrts/shared';
import '../src/ui/styles.css';

const q = new URLSearchParams(location.search), me = Number(q.get('me') ?? 1);
const session = new HostSession(me, { humans: [me], difficulty: 1, seed: 11 });
session.speed = 0;
useUi.setState({ session, screen: 'game' });
setInterval(() => useUi.getState().pump(), 200);
Object.assign(window, { __ui: useUi, __s: session });

function Card() {
  const sim = useSim(); const id = useUi(s => (s as unknown as { focus?: number }).focus);
  const b = sim?.g.battles.find(x => x.id === id); if (!sim || !b) return null;
  const W = buildWorld();
  return (
    <div id="bcard" className="glass">
      <div className="bt"><b>Battle of {W.regions[b.region].name}</b><small>{Math.floor(b.age)} s</small></div>
      {[...battleCounts(b)].map(([f, [a, all]]) => <div className="side" key={f}><span className="nm"><i className="dot" style={{ '--c': FACTIONS[f].color } as React.CSSProperties} />{FACTIONS[f].short}</span><span className="sb" style={{ '--c': FACTIONS[f].color } as React.CSSProperties}><i style={{ width: `${a / all * 100}%` }} /></span><span className="n">{a}/{all}</span></div>)}
      <FrontControls g={sim.g} me={sim.me} b={b} />
    </div>
  );
}
function Hud() {
  const hasDrawer = useUi(s => s.sel >= 0);
  return <div id="app" className={hasDrawer ? 'has-drawer' : ''}><TopBar /><Drawer /><OfferBanner /><div id="leftcol"><Feed /></div><div id="bottom"><Card /></div><Overlays /><Toast /></div>;
}
createRoot(document.getElementById('root')!).render(<Hud />);
