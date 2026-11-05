// Throw-away harness for the HUD without the 3D map (not part of the production build): renders the in-game panels over a
// plain background so Playwright can screenshot them quickly. Exposes window.__ui and window.__s.
import { createRoot } from 'react-dom/client';
import { useUi, useSim } from '../src/game/store';
import { HostSession } from '../src/game/session';
import { TopBar } from '../src/ui/TopBar';
import { Sidebar } from '../src/ui/Sidebar';
import { Feed } from '../src/ui/Feed';
import { Overlays } from '../src/ui/Overlays';
import { Toast } from '../src/ui/Toast';
import { FrontControls } from '../src/ui/FrontCard';
import { OfferBanner } from '../src/ui/Diplomacy';
import { FACTIONS, battleCounts, buildWorld } from '@riskrts/shared';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/saira-stencil-one/latin-400.css';
import '@fontsource/share-tech-mono/latin-400.css';
import '../src/ui/styles.css';
import '../src/ui/war-office.css';

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
    <div id="bcard" className="plate cmdbar">
      <div className="cb-sides">
        <div className="bt"><b>Battle of {W.regions[b.region].name}</b><small className="lcd-t">{Math.floor(b.age)} s</small></div>
        {[...battleCounts(b)].map(([f, [a, all]]) => <div className="side" key={f} style={{ '--c': FACTIONS[f].color } as React.CSSProperties}><span className="nm"><span className="crest sm">{FACTIONS[f].key}</span>{FACTIONS[f].short}</span><span className="sb"><i style={{ width: `${a / all * 100}%` }} /></span><span className="n">{a}/{all}</span></div>)}
      </div>
      <FrontControls g={sim.g} me={sim.me} b={b} />
    </div>
  );
}
function Hud() {
  const hasDrawer = useUi(s => s.sel >= 0);
  return <div id="app" className={hasDrawer ? 'has-drawer' : ''}><TopBar /><Sidebar /><OfferBanner /><div id="leftcol"><Feed /></div><div id="bottom"><Card /></div><Overlays /><Toast /></div>;
}
createRoot(document.getElementById('root')!).render(<Hud />);
