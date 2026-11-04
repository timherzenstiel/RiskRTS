// Cross-cutting UI actions that touch several stores.
import { useUi } from '../game/store';
import { closeNet, netSet } from './netStore';
import { writeSave } from './storage';
import { Sfx } from '../audio/sfx';

/** Leave the running game: autosave single player, tear down the network, go to the title screen. */
export function quitToTitle(after?: 'solo') {
  const ui = useUi.getState();
  writeSave(ui.session);
  netSet({ leaving: true });
  ui.leaveGame();
  closeNet();
  netSet({ leaving: false, hostLost: false });
  if (after) useUi.getState().setScreen(after);
}

export const click = () => { Sfx.init(); Sfx.click(); };

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
