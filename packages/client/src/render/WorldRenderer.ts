// PLACEHOLDER: replaced by the real Three.js renderer. Implements the API with no drawing so the UI can be developed in parallel.
import type { CreateRenderer } from './api';
export const createWorldRenderer: CreateRenderer = () => ({
  setSession() {}, frame() {}, resize() {}, setQuality() {}, flyTo() {}, panTo() {}, viewPolygon: () => null,
  cameraDistance: () => 70, battleInFocus: () => null, watchedBattles: () => [], dispose() {},
});
