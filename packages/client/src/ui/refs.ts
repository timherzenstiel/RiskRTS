// Module-level handle to the live world renderer, set by Stage. HUD components call into it for camera moves.
import type { WorldRendererApi } from '../render/api';

export const rendererRef: { current: WorldRendererApi | null } = { current: null };
