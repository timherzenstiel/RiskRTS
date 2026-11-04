// The contract between the React app and the Three.js world renderer.
// The renderer reads selection/hover/orderMode from useUi.getState() every frame and reports input through the callbacks.
import type { Session } from '../game/session';

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
  /** 0 Ultra (device pixels), 1 High (CSS pixels), 2 Chunky (half resolution). */
  setQuality(q: 0 | 1 | 2): void;
  flyTo(regionId: number, distance?: number): void;
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
