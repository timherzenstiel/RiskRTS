// German dictionary: English text (or template with {0}, {1} …) → German. Split by area.
import { SHARED } from './shared';
import { UI_MENUS } from './ui-menus';
import { UI_GAME } from './ui-game';
import { AUDIO_RENDER } from './audio-render';
import { UI_COMMAND } from './ui-command';
import { UI_PLAY } from './ui-play';
export { DECL } from './decl';

export const DE: Record<string, string> = { ...SHARED, ...UI_MENUS, ...UI_GAME, ...AUDIO_RENDER, ...UI_COMMAND, ...UI_PLAY };
