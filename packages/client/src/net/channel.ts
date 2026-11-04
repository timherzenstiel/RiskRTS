// A Channel is a reliable, ordered, message-based connection to one remote peer.
// WebRTC (PeerJS) implements it today; a WebSocket to a dedicated server can implement it later without touching game code.
export interface Channel {
  readonly id: string;
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}
