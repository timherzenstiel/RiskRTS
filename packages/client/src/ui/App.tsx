// Screen router.
import { useEffect } from 'react';
import { useUi } from '../game/store';
import { normaliseCode } from '../net/peer';
import { Game } from './Game';
import { HostLobby } from './HostLobby';
import { GuestLobby, JoinScreen } from './JoinScreen';
import { SoloSetup } from './SoloSetup';
import { Title } from './Title';
import { ServerScreen } from './ServerScreen';
import { Toast } from './Toast';
import { netSet } from './netStore';

/** `#join=CODE` in the URL opens the join screen and connects straight away. */
function readInvite(): string | null {
  const m = /[#&]join=([A-Za-z0-9]+)/.exec(location.hash); const code = m ? normaliseCode(m[1]) : '';
  return code.length === 5 ? code : null;
}

export function App() {
  const screen = useUi(s => s.screen);
  useEffect(() => {
    const open = () => {
      const code = readInvite(); if (!code || useUi.getState().screen === 'game') return;
      netSet({ pendingCode: code }); useUi.getState().setScreen('join');
      history.replaceState(null, '', location.pathname + location.search);
    };
    open(); window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  return (
    <>
      {screen === 'title' && <Title />}
      {screen === 'solo' && <SoloSetup />}
      {screen === 'host' && <HostLobby />}
      {screen === 'join' && <JoinScreen />}
      {screen === 'lobby' && <GuestLobby />}
      {screen === 'server' && <ServerScreen />}
      {screen === 'game' && <Game />}
      <Toast />
    </>
  );
}
