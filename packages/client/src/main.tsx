import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { useUi } from './game/store';
import './ui/styles.css';

// Service worker: auto-updates in the background and tells the player once the app works offline.
registerSW({ immediate: true, onOfflineReady() { useUi.getState().say('Ready to play offline.'); } });

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
