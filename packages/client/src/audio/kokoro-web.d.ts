// The browser build of kokoro-js (self-contained, aliased in vite.config.ts) has the same API as the package.
declare module 'kokoro-web' {
  export { KokoroTTS } from 'kokoro-js';
}
