// The contract between the React app and the Three.js world renderer.
// The renderer reads selection/hover/orderMode from useUi.getState() every frame and reports input through the callbacks.
import type { Session } from '../game/session';

/** Internal render scale: 0 Ultra (device pixels), 1 Crisp (1 CSS px), 2 Classic (0.75×, default), 3 Retro (0.5×). */
export type PixelScale = 0 | 1 | 2 | 3;
export const PIXEL_SCALES = ['Ultra', 'Crisp', 'Classic', 'Retro'] as const;
export const PIXEL_HINT = ['Device pixels: sharpest, heaviest on the GPU', 'One pixel per CSS pixel', '0.75× scale, softly upscaled: the classic 90s look (default)', 'Half resolution, big chunky pixels'] as const;
export const DEFAULT_PIXEL_SCALE: PixelScale = 2;

export interface RendererCallbacks {
  /** Left click / tap on a region (-1 for water). */
  onSelect(regionId: number): void;
  /** Right click, or a click while orderMode is on. */
  onOrder(regionId: number): void;
  onHover(regionId: number): void;
}

export interface WorldRendererApi {
  /** Attach the game to render. May be called again for a new game. */
  setSession(s: Session): void;
  /** Called once per animation frame, after session.update(dt). Updates camera, draws the world, positions map labels. */
  frame(dtReal: number): void;
  resize(): void;
  /** Pixel scale of the 3D view (see PixelScale). The UI always draws at full resolution. */
  setQuality(q: PixelScale): void;
  flyTo(regionId: number, distance?: number): void;
  /** Fly to one front (battle) of a region. */
  flyToBattle(battleId: number, distance?: number): void;
  /** Move the camera focus to a world position (used by the minimap). */
  panTo(x: number, z: number): void;
  /** World-space corners of the visible map area, for drawing the minimap viewport. */
  viewPolygon(): [number, number][] | null;
  /** Distance from the camera to the map; small values mean the player is zoomed into the fighting. */
  cameraDistance(): number;
  /** Id of the battle closest to the screen centre when zoomed in, else null. */
  battleInFocus(): number | null;
  /** Ids of battles currently close enough to need unit-level detail (used for guest streaming). */
  watchedBattles(): number[];
  dispose(): void;
}

export type CreateRenderer = (canvas: HTMLCanvasElement, labels: HTMLElement, cb: RendererCallbacks) => WorldRendererApi;
