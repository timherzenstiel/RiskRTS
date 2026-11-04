# Architecture

```
            ┌───────────────────────── packages/shared ─────────────────────────┐
            │ world/    lon/lat outlines → 720×282 tile raster → 54 regions      │
            │ data/     factions, units, costs, region seeds                     │
            │ sim/      GameState · step() · applyCommand() · AI · battles       │
            │           missions · economy · events · snapshots                  │
            │ protocol  ClientMsg / ServerMsg / LobbyState                       │
            └───────────────▲───────────────────────────────▲────────────────────┘
                            │ imports                        │ imports
        ┌───────────────────┴────────────┐     ┌─────────────┴───────────────────┐
        │ client/game  Session           │     │ future: packages/server          │
        │   HostSession  (local + host)  │     │   Node + WebSocket Channel,      │
        │   GuestSession (mirror)        │     │   runs the same step()/commands  │
        │ client/net   Channel · PeerJS  │     └──────────────────────────────────┘
        │              LobbyHost/Guest   │
        │ client/render WorldRenderer    │  Three.js, reads session.state each frame
        │ client/ui     React screens    │  reads state via useSim(), acts via store
        └────────────────────────────────┘
```

## Principles

1. **The simulation is the game.** `shared/sim` has no knowledge of rendering, DOM or networking. State is plain JSON. Randomness comes from a seeded generator stored in the state, so a given seed and command history reproduce the same war.
2. **Everything a player can do is a `Command`** (`recruit`, `build`, `fortify`, `march`, `air`, `assault`) validated by `applyCommand`. Humans, AI and remote players all use it.
3. **Visual effects are not game state.** The sim emits `Fx` events (tracers, muzzle flashes, explosions) only when asked to; they never influence outcomes. Headless servers switch them off.
4. **Sessions hide where the simulation runs.** The renderer and UI only see `Session.state`. A local game, a hosted game and a joined game look the same to them.
5. **Transport is a `Channel`.** WebRTC today, WebSocket tomorrow.

## Game loop

`HostSession.update(dt)` advances the sim in fixed 50 ms steps (speed-scaled), buffers events and fx, and (when hosting) sends each guest a snapshot ten times a second. The renderer draws whatever `session.state` currently holds; guests smooth unit positions between snapshots.

## Adding things

- **A new unit or building:** `shared/data/units.ts` (stats, cost), `sim/commands.ts` (rules), a model in `client/render/models.ts`, an icon and row in the drawer.
- **A new command:** add to `Command` in `sim/types.ts`, handle in `applyCommand`, call from the store. Multiplayer works automatically.
- **Balance:** `data/units.ts` (units, defences `DT`, anti-air table), `sim/economy.ts` (income, difficulty, holdout wear), `sim/types.ts` (`PACES`, `ATTACK_CAPS`), `sim/ai.ts`.
- **Close-up map detail:** `client/render/detail.ts` builds ground decoration per 12×12-tile chunk near the camera; `render/sectors.ts` places defences on their border.
- **A dedicated server:** create `packages/server`, import `createGame/step/applyCommand/makeSnapshot` from `@riskrts/shared`, implement `Channel` over `ws`, and reuse the host logic from `client/game/session.ts` (move `HostSession` into shared if you want to share it verbatim).
