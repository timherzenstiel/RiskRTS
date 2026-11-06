import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// GitHub Pages serves the site from /RiskRTS/. Override with BASE=/ for local preview or custom domains.
const base = process.env.BASE ?? '/RiskRTS/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,glb,json,mp3}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // the neural radio voice's worker loads only for players who use it (and the model is cached by the voice itself)
        globIgnores: ['**/voice.worker-*.js'],
        runtimeCaching: [{ urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts' } }] },
      manifest: {
        name: 'Fronts of 1914', short_name: 'Fronts 1914',
        description: 'Real-time Risiko-style World War I strategy with auto-battles and peer-to-peer multiplayer.',
        start_url: base, scope: base, display: 'standalone', orientation: 'landscape', background_color: '#0b0c0a', theme_color: '#2c2e28',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // The radio's neural voice uses kokoro-js' self-contained browser build (the default entry pulls in node's fs/path).
  resolve: { alias: { 'kokoro-web': fileURLToPath(new URL('../../node_modules/kokoro-js/dist/kokoro.web.js', import.meta.url)) } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
