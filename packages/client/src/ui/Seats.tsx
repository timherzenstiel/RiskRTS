// The six seats of a lobby (shared by host and guest views) and the player list.
import { FACTIONS, type LobbyState } from '@riskrts/shared';
import { t, tx } from '../i18n';

export function Seats({ lobby, you, onPick }: { lobby: LobbyState; you: string; onPick: (faction: number) => void }) {
  return (
    <div className="seats" role="group" aria-label={t('Seats')}>
      {lobby.seats.map(s => {
        const f = FACTIONS[s.faction]; const mine = s.player === you; const taken = !!s.player && !mine; const free = !s.player;
        return (
          <button key={s.faction} className={'seat' + (mine ? ' mine' : '') + (taken ? ' taken' : '')} style={{ '--c': f.color } as React.CSSProperties}
            disabled={!free} aria-pressed={mine} aria-label={`${tx(f.name)}: ${mine ? t('you') : taken ? s.name : t('Computer. Click to take this seat')}`} onClick={() => onPick(s.faction)}>
            <i className="swatch" />
            <span className="sn"><b>{tx(f.name)}</b><small>{s.player ? (mine ? `${s.name} ${t('(you)')}` : s.name) : t('Computer')}</small></span>
            {free && <span className="take">{t('Take seat')}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Players({ lobby, you }: { lobby: LobbyState; you: string }) {
  return (
    <ul className="players" aria-label={t('Players in the room')}>
      {lobby.players.map(p => (
        <li key={p.id} className={p.id === you ? 'me' : ''}>{p.name}{p.id === lobby.hostId ? ` · ${t('host')}` : ''}{p.id === you ? ` · ${t('you')}` : ''}</li>
      ))}
    </ul>
  );
}
