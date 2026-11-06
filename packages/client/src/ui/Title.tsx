import { useMemo, useState } from 'react';
import { HostSession } from '../game/session';
import { useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { NAME_KEY, REPO_URL, SAVE_KEY, VERSION, hasSave, lsDel, lsGet, lsSet } from './storage';
import { capabilities, useInstall } from './usePwa';
import { click } from './actions';
import { TitleBackdrop } from './TitleBackdrop';

export function Title() {
  const [name, setName] = useState(() => lsGet(NAME_KEY) ?? '');
  const install = useInstall(); const caps = useMemo(capabilities, []);
  const go = (s: 'solo' | 'host' | 'join' | 'server') => { click(); useUi.getState().setScreen(s); };
  const cont = () => {
    Sfx.init(); const raw = lsGet(SAVE_KEY); const s = raw ? HostSession.restore(raw) : null; const ui = useUi.getState();
    if (!s) { lsDel(SAVE_KEY); ui.say('That save could not be loaded.'); ui.bump(); return; }
    ui.startSession(s); ui.setOverlay(null);
  };
  return (
    <main className="screen title">
      <div className="bgfx" aria-hidden="true" style={{ '--title-art': `url(${import.meta.env.BASE_URL}art/title/front-dusk.webp)` } as React.CSSProperties} />
      <TitleBackdrop />
      <div className="titleplate plate">
        <div className="kicker">The world at war · August 1914</div><h1>Fronts<br />of 1914</h1>
      </div>
      <div className="sheet plate">
        <div className="tgrid">
          <div className="tcol">
        <p className="lede">Six empires, one map. Each week reaches every power at the same instant, so everybody builds and marches at once. Claim regions, dig in, and finish your sealed orders before anyone else finishes theirs. Battles fight themselves. Zoom in and watch.</p>
          </div>
          <div className="tcol">
        <label className="field"><span className="lbl">Your name</span>
          <input value={name} maxLength={20} placeholder="Commander" autoComplete="nickname" onChange={e => { setName(e.target.value); lsSet(NAME_KEY, e.target.value); }} /></label>
        <div className="menu-btns">
          {hasSave() && <button className="btn wide" onClick={cont}>Continue saved war</button>}
          <button className="btn primary wide" onClick={() => go('solo')}>Single player</button>
          <div className="row two">
            <button className="btn" disabled={!caps.webrtc} onClick={() => go('host')}>Host multiplayer</button>
            <button className="btn" disabled={!caps.webrtc} onClick={() => go('join')}>Join with code</button>
          </div>
          <button className="btn wide" onClick={() => go('server')}>Online server · persistent wars</button>
          {install && <button className="btn sm" onClick={() => { void install(); }}>Install app</button>}
        </div>
        {!caps.webgl && <p className="notice" role="alert">This browser does not seem to support WebGL, so the 3D map may not start. Try a current Chrome, Edge, Firefox or Safari.</p>}
        {!caps.webrtc && <p className="notice" role="alert">WebRTC is not available here, so online multiplayer is switched off. Single player still works.</p>}

          </div>
        </div>
        <footer className="foot"><span>v{VERSION}</span><a href={REPO_URL} target="_blank" rel="noreferrer noopener">github.com/timherzenstiel/RiskRTS</a></footer>
      </div>
    </main>
  );
}
