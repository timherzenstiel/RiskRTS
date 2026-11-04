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

## Moving to a dedicated server later

1. Create `packages/server` that imports `@riskrts/shared`.
2. Implement `Channel` on top of `ws`.
3. Run the `HostSession` loop there (it only needs `createGame`, `step`, `applyCommand`, `makeSnapshot`).
4. In the client, add a `joinServer(url)` that returns a `Channel` and builds a `GuestSession`. Nothing in the UI or renderer changes.
