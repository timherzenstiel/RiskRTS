// Lobby/connection state shared by the title, host, join and game screens (zustand, separate from the game UI store).
import { create } from 'zustand';
import type { LobbyState } from '@riskrts/shared';
import type { LobbyGuest, LobbyHost } from '../net/lobby';

interface Net {
  host: LobbyHost | null;
  guest: LobbyGuest | null;
  guestClose: (() => void) | null;
  /** Snapshot of the lobby (a fresh object on every change so React re-renders). */
  lobby: LobbyState | null;
  /** True once a started guest game lost its host. */
  hostLost: boolean;
  /** Set while the user is leaving on purpose, so the close is not reported as a disconnect. */
  leaving: boolean;
  /** Room code from an invite link, consumed by the join screen. */
  pendingCode: string | null;
}

export const useNet = create<Net>(() => ({ host: null, guest: null, guestClose: null, lobby: null, hostLost: false, leaving: false, pendingCode: null }));
export const netSet = (p: Partial<Net>) => useNet.setState(p);

/** Close every lobby/connection object. Safe to call repeatedly. */
export function closeNet() {
  const { host, guest } = useNet.getState();
  try { host?.close(); } catch { /* already closed */ }
  try { guest?.leave(); } catch { /* already closed */ }
  useNet.setState({ host: null, guest: null, guestClose: null, lobby: null, hostLost: false });
}
