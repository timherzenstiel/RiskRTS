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
        │ client/game  Session           │     │ packages/server                  │
        │   HostSession  (local + host)  │     │   Node + ws: persistent worlds,  │
        │   GuestSession (mirror)        │     │   ranked ladder, spectators      │
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
- **Unit models:** `client/render/models.ts` builds every unit from instanced boxes in a local frame (`at` + `b`). Base boxes always draw; fine detail (faces, webbing, rivets, wheel spokes, ammo belts, national markings, ship fittings) is gated on `Models.hi`, set when the camera is closer than distance 7. `dev/harness.ts` `showcase()` lines up every unit for every faction for screenshots.
- **Close-up map detail:** `client/render/detail.ts` builds, per 12×12-tile chunk near the camera, a smooth surface mesh over the voxel tiles plus fine props (trees, rocks, hedges, farms). `render/groundPaint.ts` paints that surface procedurally in its shader (grass, dirt, pebbles, fields, roads and railways, rivers, cliffs, ownership borders) from two per-tile textures kept by `terrain.ts`. `render/sectors.ts` places defences on their border.
- **The look:** `render/camera.ts` is an orthographic, fixed-pitch Command & Conquer camera with the sun at the top-left of the screen. `render/post.ts` grades the frame (Tiberian = muddy brown/grey, Red Alert = industrial chrome; the player picks one in the menu), adds grain and an ordered dither. `pools.ts` `litMaterial` gives steel parts a specular sheen.
- **Rule modifiers:** `shared/sim/rules.ts` is the one place battle and economy code ask about national units (`statsOf(g, faction, type)`), national traits, stance, suppression, terrain, weather, technologies and doctrines. Data lives in `data/nations.ts`, `data/rails.ts`, `data/terrain.ts`, `data/tech.ts`, `data/calendar.ts`.
- **Great War systems:** `sim/levers.ts` (barrage, over the top, stance, reinforce, withdraw, shells, mobilisation, decoys, raids), `sim/rails.ts` (rail network, supply quality, sabotage, building), `sim/tech.ts` (unlocks, rushes, doctrines), `sim/diplomacy.ts` (treaties, offers, AI interest). Save/snapshot format v4; `migrateState` upgrades v2 and v3 saves.
- **The dedicated server:** `packages/server` (`world.ts` one persistent war, `server.ts` connections, lobby and persistence, `ladder.ts` Elo). See [multiplayer.md](multiplayer.md).
