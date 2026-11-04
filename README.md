# Fronts of 1914

A real-time, Risiko-style World War I strategy game. Six empires, 54 regions, secret missions, simultaneous play (no turns: a supply convoy reaches every power at the same moment), and battles that fight themselves while you zoom from the operations map into a 3D pixel-art battlefield. Runs in the browser as an installable PWA, with peer-to-peer multiplayer.

**Play:** https://timherzenstiel.github.io/RiskRTS/ (after the first deploy, see [docs/deploy.md](docs/deploy.md))

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173/RiskRTS/
npm test             # simulation + network-protocol tests
npm run typecheck
npm run build        # production build -> packages/client/dist
```

## Layout

| Package | What it is |
|---|---|
| `packages/shared` | The game itself: world map, rules, economy, AI, auto-battle simulation, commands, snapshots, wire protocol. Pure TypeScript, no DOM, fully tested. Runs identically in a browser or on a server. |
| `packages/client` | Vite + React + Three.js. React renders the interface, `render/` draws the world from the simulation state, `net/` is the WebRTC transport and lobby, `game/` holds sessions and UI state. |
| `legacy/` | The single-file prototypes this project grew out of (kept for reference). |

See [docs/architecture.md](docs/architecture.md) for how the pieces fit and [docs/multiplayer.md](docs/multiplayer.md) for the networking model.

## Multiplayer in one paragraph

GitHub Pages is static, so there is no game server. One player hosts: their browser runs the authoritative simulation and shares a 5-letter room code. Friends join over WebRTC (signalling through the free PeerJS cloud, game traffic is peer-to-peer). Guests send *commands*, the host validates them and streams *snapshots*. Because the simulation lives in `@riskrts/shared`, the same code can later run in a Node server behind a WebSocket `Channel` with no change to game rules or UI.

## Rules at a glance

- **Borders matter.** Infantry, machine guns, field guns and tanks attack only across a direct border (land or sea lane). Aircraft fly from an airfield region to targets up to **two borders** away; they bomb and strafe but cannot take ground, and return home when their fuel runs out.
- **Fixed defences stand where you build them** (Fortify tab): pillboxes and gun emplacements on one border sector only fight attacks coming over that border; interior defences join every battle in the region; anti-air guns cover the whole region against aircraft.
- **Contested regions.** If a region's field army is beaten while defences on another border still stand, the attacker takes the region but it stays contested: no supply, recruiting or building there until the holdouts are stormed (or run out of supplies after a few minutes).
- **Supply** has diminishing returns on land (2 + 1.5·√regions), plus continent bonuses and +2 per factory, so the biggest power does not snowball.
- **Lobby settings:** attacks at once per power (1 / 2 / 3 / 5 / no limit; reinforcing your own regions never counts) and battle pace (Fast / Normal / Long). Battles always last until one side has no ground troops or defences left; pace scales the rate of fire and when entrenched troops leave their trenches to charge.

## Controls

Click a region to open it · right-click a neighbour to march · `A` then click: air strike · drag / wheel / pinch to pan and zoom · `1`–`5` recruit (Shift ×5) · `Space` pause (single player / host) · `Esc` deselect, then menu.
