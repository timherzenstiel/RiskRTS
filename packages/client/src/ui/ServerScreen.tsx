// The dedicated server: connect, see the running wars and the ranked ladder, start a war, take or retake a seat, or watch.
import { useEffect, useReducer, useState } from 'react';
import { DEFAULT_SETTINGS, DIFFICULTIES, FACTIONS, type GameSettings } from '@riskrts/shared';
import { ServerLink, mySeat } from '../net/server';
import { GuestSession } from '../game/session';
import { dateStr, useUi } from '../game/store';
import { click } from './actions';
import { Shell } from './HostLobby';
import { RulesPicker } from './Rules';
import { lsGet, lsSet, playerName } from './storage';
import { netSet, useNet } from './netStore';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';

const URL_KEY = 'f14srv';
const defaultUrl = () => lsGet(URL_KEY) ?? (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'ws://localhost:8787';

/** Start the game screen for a seat or a spectator view handed out by the server. */
function startFrom(link: ServerLink) {
  const ui = useUi.getState;
  link.onStart = (faction, ch, spectate, ranked) => {
    const s = new GuestSession(faction, ch); s.spectator = spectate; s.ranked = ranked;
    ch.onClose(() => { if (!useNet.getState().leaving && ui().session === s) netSet({ hostLost: true }); });
    ui().startSession(s); ui().setOverlay(spectate ? null : 'orders');
  };
}

export function ServerScreen() {
  const [url, setUrl] = useState(defaultUrl); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const link = useNet(s => s.server); const [, force] = useReducer((n: number) => n + 1, 0);
  const [name, setName] = useState(() => tn("{0}'s war", { raw: playerName() || t('Commander') })); const [ranked, setRanked] = useState(false);
  const [rules, setRules] = useState<GameSettings>({ ...DEFAULT_SETTINGS }); const [diff, setDiff] = useState(1);
  useEffect(() => { if (link) { link.onList = () => force(); link.onError = (m) => useUi.getState().say(m); link.onClosed = () => { if (!useNet.getState().leaving) { netSet({ server: null }); setErr('The server closed the connection.'); } }; startFrom(link); } }, [link]);

  const connect = async () => {
    setBusy(true); setErr(''); lsSet(URL_KEY, url.trim());
    try { const l = await ServerLink.connect(url.trim(), playerName() || t('Commander')); netSet({ server: l }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.'); }
    setBusy(false);
  };
  const back = () => { click(); netSet({ leaving: true }); link?.close(); netSet({ server: null, leaving: false }); useUi.getState().setScreen('title'); };

  if (!link) return (
    <Shell title={t('Online server')} kicker={t('Dedicated server · persistent wars')}>
      <p className="lede small">{t('A dedicated server keeps wars running when players leave: the computer stands in for them, and they can come back to their power from any device. Ranked wars use fixed rules and count for the ladder. Anyone can watch a war, a little delayed.')}</p>
      <form className="joinform" onSubmit={e => { e.preventDefault(); void connect(); }}>
        <label className="field"><span className="lbl">{t('Server address')}</span>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="wss://example.org" spellCheck={false} autoComplete="url" disabled={busy} /></label>
        {err && <p className="notice" role="alert">{tx(err)}</p>}
        {busy && <p className="muted"><span className="spin" aria-hidden="true" /> {t('Connecting…')}</p>}
        <div className="row"><button className="btn primary" type="submit" disabled={busy || !url.trim()}>{t('Connect')}</button><button className="btn" type="button" onClick={back}>{t('Back')}</button></div>
      </form>
      <p className="muted tiny">{t('Run your own:')} <code>npm start -w @riskrts/server</code> {t('(port 8787).')}</p>
    </Shell>
  );

  return (
    <Shell title={t('Online wars')} kicker={`${t('Connected')} · ${link.url}`}>
      <div className="worlds">
        {!link.worlds.length && <p className="muted">{t('No wars on this server yet. Start one below.')}</p>}
        {link.worlds.map(w => {
          const seat = mySeat(link.url, w.id);
          return (
            <div key={w.id} className={'world' + (w.over ? ' over' : '')}>
              <div className="wh"><b>{w.name}</b>{w.ranked && <span className="badge">{t('Ranked')}</span>}
                <small>{w.over ? `${t('Over')}${w.winner !== null ? ` · ${t('{0} won', FACTIONS[w.winner].name)}` : ''}` : dateStr(w.day)} · {tx(DIFFICULTIES[w.difficulty]?.name)}{w.spectators ? ` · ${t('{0} watching', w.spectators)}` : ''}</small></div>
              <div className="wseats">
                {w.seats.map(s => {
                  const F = FACTIONS[s.faction], mine = seat?.faction === s.faction;
                  return (
                    <button key={s.faction} className={'wseat' + (s.online ? ' on' : '') + (mine ? ' mine' : '')} style={{ '--c': F.color } as React.CSSProperties} disabled={w.over || (!!s.name && !mine) || (s.online && !mine)}
                      title={mine ? t('Return to {0}', F.name) : s.name ? tn('{0} commands {1}', { raw: s.name }, F.name) : t('Take command of {0} from the computer', F.name)} onClick={() => { click(); link.join(w.id, s.faction); }}>
                      <i className="dot" /><span>{tx(F.short)}</span><small>{mine ? t('Return') : s.name ?? t('Computer')}</small>
                    </button>
                  );
                })}
                <button className="btn sm" onClick={() => { click(); link.spectate(w.id, seat?.faction ?? 0); }}>{t('Watch')}</button>
              </div>
            </div>
          );
        })}
      </div>
      <details className="newwar">
        <summary>{t('Start a new war')}</summary>
        <label className="field"><span className="lbl">{t('Name')}</span><input value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
        <div className="seg" role="group" aria-label={t('Ranked')}><button aria-pressed={!ranked} onClick={() => setRanked(false)}>{t('Casual')}</button><button aria-pressed={ranked} onClick={() => setRanked(true)}>{t('Ranked')}</button></div>
        {ranked ? <p className="muted small">{t('Ranked wars use fixed rules (3 attacks at once, normal pace, Officer computers), cannot be paused and count for the ladder.')}</p> : (
          <>
            <RulesPicker value={rules} onChange={p => setRules(r => ({ ...r, ...p }))} />
            <div className="seg" role="group" aria-label={t('Difficulty')}>{DIFFICULTIES.map((d, i) => <button key={d.name} aria-pressed={diff === i} onClick={() => setDiff(i)}>{tx(d.name)}</button>)}</div>
            <p className="muted small">{t('Casual wars run while at least one player is connected and wait when everyone has left.')}</p>
          </>
        )}
        <div className="row"><button className="btn primary" onClick={() => { click(); link.create(name, ranked, rules, diff); }}>{t('Create war')}</button></div>
      </details>
      {link.ladder.length > 0 && (
        <div className="ladder"><div className="lbl"><span>{t('Ranked ladder')}</span></div>
          <ol>{link.ladder.map(r => <li key={r.player}><b>{r.name}</b><span>{r.elo}</span><small>{r.games === 1 ? t('1 war') : t('{0} wars', r.games)}</small></li>)}</ol></div>
      )}
      <div className="row"><button className="btn" onClick={() => { click(); link.refresh(); }}>{t('Refresh')}</button><button className="btn" onClick={back}>{t('Disconnect')}</button></div>
    </Shell>
  );
}
