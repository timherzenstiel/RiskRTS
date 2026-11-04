// Install prompt capture and capability checks for the title screen.
import { useEffect, useState } from 'react';

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; subs.forEach(f => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach(f => f()); });
}

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return deferred ? async () => { const d = deferred; if (!d) return; await d.prompt(); await d.userChoice; deferred = null; subs.forEach(f => f()); } : null;
}

export function capabilities() {
  let webgl = false;
  try { const c = document.createElement('canvas'); webgl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { /* no WebGL */ }
  return { webgl, webrtc: typeof RTCPeerConnection !== 'undefined' };
}
