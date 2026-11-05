import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { useUi } from './game/store';
// Self-hosted fonts (latin subset): work offline and need no third-party request.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/saira-stencil-one/latin-400.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './ui/styles.css';
import './ui/war-office.css';

// Service worker: auto-updates in the background and tells the player once the app works offline.
registerSW({ immediate: true, onOfflineReady() { useUi.getState().say('Ready to play offline.'); } });

// Dev builds expose the UI store for automated screenshots.
if (import.meta.env.DEV) (window as unknown as { __ui: typeof useUi }).__ui = useUi;

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
