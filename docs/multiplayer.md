# Multiplayer

## Model: host-authoritative peer-to-peer

```
 Host browser ── runs step() + applyCommand() ── owns the truth
   ▲  │ snapshots 10×/s (+ events, fx for watched battles)
   │  ▼
 Guest browsers ── send Commands, display a mirror GameState
```

- **Room code:** the host registers the PeerJS id `riskrts-XXXXX` (5 characters, no look-alike letters). Invite links are `…/RiskRTS/#join=XXXXX`.
- **Lobby:** `LobbyHost` owns seats (one per power). Guests claim seats, the host sets the difficulty and starts. Unclaimed powers are played by the AI. If a guest drops mid-game, their power is handed to the AI.
- **Secrecy:** `makeSnapshot(state, recipient)` includes only the recipient's sealed orders; everyone's orders are revealed when the war ends.
- **Bandwidth:** strategic state is ~3 KB per snapshot. Unit-level battle detail is streamed only for battles a guest is zoomed into (`Session.setWatch`).
- **Cheating:** guests can only send commands, and the host validates each one. The host itself is trusted (it holds all state), which is fine for friends and testing.

## Limits of the free setup

- Signalling uses the public PeerJS cloud (`0.peerjs.com`). It is free and fine for testing but has no uptime guarantee.
- WebRTC needs a STUN server (Google's public one is used by default). Strict symmetric NATs or some corporate networks also need a TURN relay; pass `config: { iceServers: [...] }` to `new Peer(...)` in `client/src/net/peer.ts`.
- If the host closes the tab the game ends for everyone. A dedicated server removes this.

## Dedicated server

`packages/server` runs the same simulation in Node behind a WebSocket and speaks the same protocol (`ClientMsg` / `ServerMsg`), so the client uses its ordinary `GuestSession`.

```bash
npm start -w @riskrts/server          # PORT=8787 DATA=./data SPECTATOR_DELAY=20
```

- **Persistent wars.** Each war is a `World` (`server/src/world.ts`), saved to `DATA/worlds/<id>.json` after every convoy and on shutdown, and restored on start. A player who leaves keeps their seat: the computer stands in (keeping their stances and doctrines) until they come back with the seat token their browser stored, from any device. Casual wars wait while nobody is connected; ranked wars keep running.
- **Ranked.** Fixed rules (3 attacks at once, normal pace, Officer computers), no pause, one power per player. When a ranked war ends, the winner takes Elo from every other human (`server/src/ladder.ts`, `DATA/ladder.json`).
- **Spectators.** Full-vision snapshots without anyone's sealed orders, delayed by `SPECTATOR_DELAY` seconds so watching cannot be used to scout. Their orders are refused.
- **Client.** Title screen → *Online server*: the address is remembered; the default comes from `VITE_SERVER_URL` at build time. Behind TLS use `wss://` (a reverse proxy such as Caddy or nginx in front of port 8787).
