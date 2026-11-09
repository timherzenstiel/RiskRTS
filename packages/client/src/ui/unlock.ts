// What the guided first war has unlocked so far (design-play §6). Kept apart from the Tutorial component so the store can
// use it to keep keyboard shortcuts from opening a panel or map mode that is still hidden.
import { TUT_STAGES, type GameState } from '@riskrts/shared';

const DONE = TUT_STAGES.length;
/** Stage (0-based) from which a rail panel or overlay, and a map mode, is there. */
const UNLOCK: Record<string, number> = { forces: 0, rules: 0, situation: 2, reports: 2, staff: 3, economy: 4, navy: DONE, intel: DONE, diplomacy: DONE, calendar: DONE };
const MODE_UNLOCK = [0, 3, 0, 4, DONE];

/** Whether a panel, overlay or map mode (`mode:3`) is there yet: always outside the guided war. */
export function unlocked(g: GameState | undefined, key: string): boolean {
  const s = g?.tut?.stage; if (s === undefined || s >= DONE) return true;
  if (key.startsWith('mode:')) return s >= (MODE_UNLOCK[+key.slice(5)] ?? 0);
  return s >= (UNLOCK[key] ?? 0);
}
export const guiding = (g: GameState | undefined) => !!g?.tut && g.tut.stage < DONE;

