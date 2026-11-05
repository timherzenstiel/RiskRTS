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
npm start -w @riskrts/server   # optional dedicated server on ws://localhost:8787
```

## Layout

| Package | What it is |
|---|---|
| `packages/shared` | The game itself: world map, rules, economy, AI, auto-battle simulation, commands, snapshots, wire protocol. Pure TypeScript, no DOM, fully tested. Runs identically in a browser or on a server. |
| `packages/client` | Vite + React + Three.js. React renders the interface, `render/` draws the world from the simulation state, `net/` is the WebRTC transport and lobby (and the WebSocket link to a dedicated server), `game/` holds sessions and UI state. |
| `packages/server` | Optional dedicated server (Node + `ws`): persistent wars saved after every convoy, the computer standing in for absent players, ranked wars with an Elo ladder, delayed full-vision spectators. |
| `legacy/` | The single-file prototypes this project grew out of (kept for reference). |

See [docs/architecture.md](docs/architecture.md) for how the pieces fit and [docs/multiplayer.md](docs/multiplayer.md) for the networking model.

## Multiplayer in one paragraph

GitHub Pages is static, so by default there is no game server. One player hosts: their browser runs the authoritative simulation and shares a 5-letter room code. Friends join over WebRTC (signalling through the free PeerJS cloud, game traffic is peer-to-peer). Guests send *commands*, the host validates them and streams *snapshots*. Because the simulation lives in `@riskrts/shared`, the same code also runs in `packages/server` behind a WebSocket: **Online server** on the title screen connects to one (see [docs/multiplayer.md](docs/multiplayer.md)).

## Rules at a glance

- **Formations, not counters.** One infantry unit is a battalion of 100 men; MG companies, batteries, tank platoons and squadrons likewise. Losses thin formations out (a half-strength battalion fights with half its strength), battered ones are merged, and about a third of the casualties come back as wounded with later convoys.
- **Borders matter.** Ground troops attack only across a direct border (land or sea lane). Aircraft fly from an airfield region to targets up to **two borders** away; they bomb and strafe but cannot take ground.
- **Battles are fought on the border** the attack comes over. Every attacked border is its own **front**: a region attacked from two sides fights two battles, splits its defenders between them (*Reserves* moves more to one front), and falls only when its last front collapses. Troops that break through one front fall on the defenders of another from behind. Fronts that get no fresh troops for a while settle into trench warfare.
- **Fortify per border** (Fortify tab, or tap the border on the map): trench depth I–III, sandbags, barbed wire, MG nests, bunkers, gun emplacements and anti-air guns. Each border has building slots (4 on land, 2 on a sea lane, 3 in the interior; a bunker takes two). Works only help against attacks over their own border; interior defences and anti-air join the first front.
- **Fog of war.** You see the owner of every region, but rivals' troops only across your own borders, and only as an estimate (with the defences facing you). Cavalry patrols (one border), reconnaissance flights (two borders, from an airfield) and spies (from your capital, anywhere, until caught) bring reports, which age. Computer powers play by the same fog (except on Marshal).
- **Supply lines.** A region is supplied when a chain of your own regions (land borders, or sea lanes between two of your regions) leads to your capital, a factory or your home territory. Cut-off regions pay nothing, cannot recruit, and lose strength and morale every convoy.
- **Morale and war weariness.** Losses shake a front's morale (shaken troops shoot worse; broken battalions surrender); rest, supply and victories restore it. Every power's casualties raise its war weariness, which cuts income (up to 30%), caps morale and, above 60%, stops volunteers from barracks.
- **Contested regions.** If a region's field army is beaten while defences on another border still stand, the attacker takes the region but it stays contested until the holdouts are stormed (or run out of supplies).
- **Supply** has diminishing returns on land (2 + 1.5·√regions), plus continent bonuses and +2 per factory.
- **Lobby settings:** attacks at once per power and battle pace.

### The Great War update

- **Battle levers per front:** barrage (hold fire, light, heavy) burning shells from the national stockpile; shells landing on a side **suppress** it (it fires less, its MGs fall silent); attackers with guns wait at the start line until you send them **over the top** (or the pace's latest time); stance (balanced, aggressive, defensive, hold at all costs); **reinforce** a front straight from a neighbouring region; **withdraw**; **trench raids** from quiet fronts. Every battle files an **after-action report**.
- **Shells and men:** factories and the capital make shells (buy more with supply); recruiting draws on a finite **manpower pool** that grows with every home region held; **mobilisation** speeds it up at the price of war weariness; long weariness brings **strikes** and **risings**.
- **Six different powers:** each fields a national unit (Mark IV tanks, Canon de 75, Siberian rifles, storm battalions, Škoda siege guns, fortress infantry) and has two strengths and two weaknesses; the computer plays to its nation's character.
- **Rails, weather, mountains:** the 1914 rail network triples marching speed between your regions and decides supply quality (full / thin / cut); rails can be bombed, sabotaged or built. Mud, winter and heat follow the calendar; mountain borders favour the defender. The Royal Navy and blockades thin enemy sea lanes.
- **War calendar:** aircraft from spring 1915, tanks by nation from September 1916, better tanks, strategic bombing and combined arms later; rush one development a year; adopt one **doctrine** each January (12 in all).
- **Deception and diplomacy:** decoy marches and fake concentrations; ceasefires, non-aggression pacts and alliances (shared vision and supply), broken at a price. Sealed orders stay secret.

Design: [`design-great-war.md`](docs/design-great-war.md).

## Controls

Click a region to open it (foreign regions: attack, patrol, recon flight, spy) · right-click a neighbour to march · `A` then click: air strike · drag / wheel / pinch to pan and zoom · `1`–`5` recruit (Shift ×5) · `Space` pause (single player / host) · `Esc` deselect, then menu.
