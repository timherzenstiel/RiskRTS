// Host a multiplayer room: open it through the matchmaking service, share the code, pick seats, start.
import { useEffect, useReducer, useRef, useState } from 'react';
import { DIFFICULTIES } from '@riskrts/shared';
import { LobbyHost } from '../net/lobby';
import { useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click, copyText } from './actions';
import { netSet, useNet } from './netStore';
import { playerName } from './storage';
import { Players, Seats } from './Seats';
import { RulesPicker } from './Rules';
import { NationCard } from './Nation';
import { t, tx } from '../i18n';

export const inviteLink = (code: string) => `${location.origin}${location.pathname}#join=${code}`;

export function HostLobby() {
  const [phase, setPhase] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [err, setErr] = useState(''); const [attempt, setAttempt] = useState(0);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const lobbyObj = useNet(s => s.host); const started = useRef(false);

  useEffect(() => {
    let dead = false; let mine: LobbyHost | null = null; setPhase('connecting');
    LobbyHost.open(playerName() || t('Commander')).then(l => {
      if (dead) { l.close(); return; }
      mine = l; l.onChange = () => force(); netSet({ host: l }); setPhase('ready');
    }).catch((e: unknown) => { if (!dead) { setErr(e instanceof Error ? e.message : 'Could not open a room.'); setPhase('error'); } });
    return () => { dead = true; if (mine && !started.current) { mine.close(); if (useNet.getState().host === mine) netSet({ host: null }); } };
  }, [attempt]);

  const back = () => { click(); useUi.getState().setScreen('title'); };
  const l = lobbyObj;
  if (phase === 'connecting' || (phase === 'ready' && !l)) return <Shell title={t('Opening a room…')}><p className="lede"><span className="spin" aria-hidden="true" /> {t('Contacting the matchmaking service…')}</p><div className="row"><button className="btn" onClick={back}>{t('Cancel')}</button></div></Shell>;
  if (phase === 'error' || !l) return (
    <Shell title={t('Cannot open a room')}>
      <p className="notice" role="alert">{tx(err)}</p>
      <p className="muted">{t('Online games need a connection to the free PeerJS matchmaking service. Single player works offline.')}</p>
      <div className="row"><button className="btn primary" onClick={() => { click(); setAttempt(a => a + 1); }}>{t('Try again')}</button><button className="btn" onClick={back}>{t('Back')}</button></div>
    </Shell>
  );

  const s = l.state; const code = s.room; const humans = s.players.length;
  const copy = async (what: string, text: string) => useUi.getState().say((await copyText(text)) ? `${what} copied.` : 'Could not copy. Select the text and copy it by hand.');
  const start = () => { Sfx.init(); started.current = true; const sess = l.start(); const ui = useUi.getState(); ui.startSession(sess); ui.setOverlay('orders'); };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <Shell title={t('Host a war')} kicker={t('Multiplayer · you are the host')}>
      <div className="roomcode"><small>{t('Room code')}</small>
        <div className="code" aria-label={`${t('Room code')} ${code.split('').join(' ')}`}>{code}</div>
        <div className="row"><button className="btn sm" onClick={() => copy('Code', code)}>{t('Copy code')}</button>
          <button className="btn sm" onClick={() => copy('Invite link', inviteLink(code))}>{t('Copy invite link')}</button>
          {canShare && <button className="btn sm" onClick={() => { void navigator.share({ title: t('Fronts of 1914'), text: `${t('Join my war:')} ${code}`, url: inviteLink(code) }).catch(() => undefined); }}>{t('Share')}</button>}</div>
      </div>
      <div><div className="lbl"><span>{t('Seats · pick yours, computers fill the rest')}</span></div>
        <Seats lobby={s} you="host" onPick={f => { click(); l.claim('host', null, f); }} /></div>
      {(() => { const mine = s.seats.find(x => x.player === 'host'); return mine ? <NationCard f={mine.faction} /> : null; })()}
      <RulesPicker value={s.settings} onChange={p => l.setSettings(p)} />
      <div className="row spread">
        <div><div className="lbl"><span>{t('Difficulty of the computer powers · {0}', DIFFICULTIES[s.difficulty].desc)}</span></div>
          <div className="seg" role="group" aria-label={t('Difficulty')}>
            {DIFFICULTIES.map((d, i) => <button key={d.name} aria-pressed={s.difficulty === i} onClick={() => { click(); l.setDifficulty(i); }}>{t('difficulty|' + d.name)}</button>)}
          </div></div>
        <div><div className="lbl"><span>{t('In the room ({0})', humans)}</span></div><Players lobby={s} you="host" /></div>
      </div>
      <div className="row"><button className="btn primary" onClick={start}>{humans > 1 ? t('Start the war ({0} players)', humans) : t('Start the war')}</button>
        <button className="btn" onClick={back}>{t('Close lobby')}</button></div>
    </Shell>
  );
}

export function Shell({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <main className="screen"><div className="bgfx" aria-hidden="true" />
      <div className="sheet glass"><div>{kicker && <div className="kicker">{kicker}</div>}<h2>{title}</h2></div>{children}</div></main>
  );
}
