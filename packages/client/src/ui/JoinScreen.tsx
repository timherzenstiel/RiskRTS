// Join a room by code (or from an invite link), then wait in the guest lobby until the host starts.
import { useEffect, useRef, useState } from 'react';
import { DIFFICULTIES } from '@riskrts/shared';
import { LobbyGuest } from '../net/lobby';
import { joinRoom, normaliseCode } from '../net/peer';
import { GuestSession } from '../game/session';
import { useUi } from '../game/store';
import { click } from './actions';
import { closeNet, netSet, useNet } from './netStore';
import { NAME_KEY, lsSet, playerName } from './storage';
import { Players, Seats } from './Seats';
import { NationCard } from './Nation';
import { Shell } from './HostLobby';
import { RulesPicker } from './Rules';

/** Connect to a room and wire the guest lobby to the app. Resolves when the welcome handshake has been sent. */
async function connect(code: string, name: string) {
  const ui = useUi.getState;
  const { ch, close } = await joinRoom(code);
  const g = new LobbyGuest(ch, name, close);
  g.onChange = (lobby) => netSet({ lobby: { ...lobby, seats: lobby.seats.map(s => ({ ...s })), players: [...lobby.players] } });
  g.onError = (m) => ui().say(m);
  g.onClosed = () => { if (useNet.getState().leaving) return; ui().say('The host closed the lobby.'); closeNet(); ui().setScreen('title'); };
  g.onStarted = (faction, chan) => {
    const session = new GuestSession(faction, chan);
    chan.onClose(() => { if (!useNet.getState().leaving && ui().session === session) netSet({ hostLost: true }); });
    ui().startSession(session); ui().setOverlay('orders');
  };
  netSet({ guest: g, guestClose: close, lobby: null });
  ui().setScreen('lobby');
}

export function JoinScreen() {
  const [code, setCode] = useState(() => useNet.getState().pendingCode ?? '');
  const [name, setName] = useState(() => playerName());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const auto = useRef(useNet.getState().pendingCode);

  const join = async (c = code) => {
    const norm = normaliseCode(c); if (norm.length !== 5 || busy) return;
    setBusy(true); setErr('');
    try { await connect(norm, name.trim() || 'Guest'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not join that room.'); setBusy(false); }
  };
  useEffect(() => {
    if (auto.current) { const c = auto.current; auto.current = null; netSet({ pendingCode: null }); void join(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell title="Join a war" kicker="Multiplayer">
      <form className="joinform" onSubmit={e => { e.preventDefault(); void join(); }}>
        <label className="field"><span className="lbl">Room code</span>
          <input className="codein" value={code} autoFocus inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={5} placeholder="ABCDE" aria-label="Room code, 5 characters"
            onChange={e => setCode(normaliseCode(e.target.value))} disabled={busy} /></label>
        <label className="field"><span className="lbl">Your name</span>
          <input value={name} maxLength={20} placeholder="Guest" autoComplete="nickname" disabled={busy} onChange={e => { setName(e.target.value); lsSet(NAME_KEY, e.target.value); }} /></label>
        {err && <p className="notice" role="alert">{err}</p>}
        {busy && <p className="muted"><span className="spin" aria-hidden="true" /> Connecting to the room… this can take a few seconds.</p>}
        <div className="row"><button className="btn primary" type="submit" disabled={busy || normaliseCode(code).length !== 5}>Join</button>
          <button className="btn" type="button" onClick={() => { click(); useUi.getState().setScreen('title'); }}>Back</button></div>
      </form>
    </Shell>
  );
}

export function GuestLobby() {
  const lobby = useNet(s => s.lobby); const guest = useNet(s => s.guest);
  useEffect(() => { if (!guest) useUi.getState().setScreen('title'); }, [guest]);
  const leave = () => { click(); netSet({ leaving: true }); closeNet(); netSet({ leaving: false }); useUi.getState().setScreen('title'); };
  if (!guest || !lobby) return <Shell title="Joining…"><p className="lede"><span className="spin" aria-hidden="true" /> Waiting for the host…</p><div className="row"><button className="btn" onClick={leave}>Cancel</button></div></Shell>;
  return (
    <Shell title={`Room ${lobby.room}`} kicker="Multiplayer · waiting for the host to start">
      <div><div className="lbl"><span>Seats · click a computer seat to take it</span></div>
        <Seats lobby={lobby} you={guest.you} onPick={f => { click(); guest.pick(f); }} /></div>
      {(() => { const mine = lobby.seats.find(x => x.player === guest.you); return mine ? <NationCard f={mine.faction} /> : null; })()}
      {lobby.settings && <RulesPicker value={lobby.settings} />}
      <div className="row spread">
        <div><div className="lbl"><span>Difficulty</span></div><p className="muted" style={{ margin: 0 }}>{DIFFICULTIES[lobby.difficulty]?.name} · {DIFFICULTIES[lobby.difficulty]?.desc}</p></div>
        <div><div className="lbl"><span>In the room ({lobby.players.length})</span></div><Players lobby={lobby} you={guest.you} /></div>
      </div>
      <div className="row"><button className="btn" onClick={leave}>Leave room</button></div>
    </Shell>
  );
}
