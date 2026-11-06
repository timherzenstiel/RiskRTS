// Global keyboard shortcuts while a game is on screen.
import { useEffect } from 'react';
import type { UnitType } from '@riskrts/shared';
import { MAP_MODES, useUi, type MapMode } from '../game/store';
import { useNet } from './netStore';

const KEY_UNITS: UnitType[] = ['inf', 'mg', 'art', 'tank', 'plane'];
let lastSpeed = 1;

export function useGameKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useUi.getState(); const s = ui.session; if (!s || useNet.getState().hostLost) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (ui.overlay) ui.setOverlay(null);
        else if (ui.orderMode) ui.cancelOrder();
        else if (ui.scoreOpen) ui.toggleScore();
        else if (ui.sel >= 0) ui.select(-1);
        else ui.setOverlay('menu');
      } else if (e.key === ' ' || e.code === 'Space') {
        if (t && t.closest('[role=dialog]') && t.tagName === 'BUTTON') return; // dialog buttons keep Space for activation
        e.preventDefault();
        if (!s.canControlTime || ui.overlay) return;
        if (s.speed > 0) { lastSpeed = s.speed; ui.setSpeed(0); } else ui.setSpeed(s.canChangeSpeed ? lastSpeed || 1 : 1);
      } else if (MAP_MODES.some(m => m.key === e.key.toLowerCase())) {
        // map modes: P political, F fronts, T forces, B supply, I intel; the same key again goes back to the political map
        const want = MAP_MODES.findIndex(m => m.key === e.key.toLowerCase()) as MapMode; ui.setMode(ui.mode === want ? 0 : want);
      } else if ((e.key === 'a' || e.key === 'A') && ui.sel >= 0 && s.state.regions[ui.sel].owner === s.me && s.state.regions[ui.sel].units.plane > 0) {
        ui.beginOrder('air');
      } else if (e.key >= '1' && e.key <= '5' || (e.code >= 'Digit1' && e.code <= 'Digit5')) {
        if (ui.overlay || ui.sel < 0 || s.state.regions[ui.sel].owner !== s.me) return;
        const i = (e.code.startsWith('Digit') ? Number(e.code.slice(5)) : Number(e.key)) - 1;
        ui.recruit(ui.sel, KEY_UNITS[i], 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
