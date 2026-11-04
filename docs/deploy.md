# Deploying to GitHub Pages

The workflow in `.github/workflows/pages.yml` type-checks, tests, builds and deploys on every push to `main`.

One-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The app is served from `https://<user>.github.io/RiskRTS/`. The Vite `base` is `/RiskRTS/`; for a custom domain or a fork with another repo name set `BASE` (for example `BASE=/ npm run build -w @riskrts/client`, and the same in the workflow).

## PWA

`vite-plugin-pwa` generates the service worker and web manifest. After the first visit the game works offline for single player (multiplayer needs the network). Updates apply automatically on the next load. Chrome, Edge and Safari offer "Install" / "Add to Home Screen"; the title screen also shows an Install button when the browser allows it.
