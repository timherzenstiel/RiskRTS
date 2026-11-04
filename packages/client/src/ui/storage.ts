// Guarded localStorage helpers and the single-player save slot.
import { HostSession, type Session } from '../game/session';

export const NAME_KEY = 'f14name';
export const SAVE_KEY = 'f14save';
export const REPO_URL = 'https://github.com/timherzenstiel/RiskRTS';
export const VERSION = '0.1.0';

export const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
export const lsDel = (k: string) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } };

export const hasSave = () => lsGet(SAVE_KEY) !== null;
export const playerName = () => (lsGet(NAME_KEY) ?? '').trim().slice(0, 20);

/** Write the single-player save. Returns false when this session cannot be saved or storage is unavailable. */
export function writeSave(s: Session | null): boolean {
  if (!s || s.kind !== 'local' || !(s instanceof HostSession) || s.state.over) return false;
  try { localStorage.setItem(SAVE_KEY, s.serialize()); return true; } catch { return false; }
}
