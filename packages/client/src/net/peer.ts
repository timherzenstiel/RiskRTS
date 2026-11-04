// WebRTC transport through PeerJS. The free public PeerJS cloud brokers the connection; game traffic is peer-to-peer.
// Works from a static host such as GitHub Pages. Strict corporate NATs may need a TURN server (see docs/multiplayer.md).
import Peer, { type DataConnection } from 'peerjs';
import type { Channel } from './channel';

const PREFIX = 'riskrts-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const newRoomCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const normaliseCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function wrap(conn: DataConnection): Channel {
  const msgCbs: ((m: unknown) => void)[] = [], closeCbs: (() => void)[] = []; let closed = false;
  const fire = () => { if (closed) return; closed = true; closeCbs.forEach(f => f()); };
  conn.on('data', (d) => msgCbs.forEach(f => f(d)));
  conn.on('close', fire); conn.on('error', fire);
  return {
    id: conn.peer,
    send: (m) => { if (conn.open) conn.send(m); },
    onMessage: (cb) => { msgCbs.push(cb); },
    onClose: (cb) => { closeCbs.push(cb); },
    close: () => { try { conn.close(); } catch { /* already closed */ } fire(); },
  };
}

export interface RoomHost { code: string; onGuest(cb: (ch: Channel) => void): void; close(): void }

/** Open a room and listen for guests. Retries with a new code if the id is taken. */
export function openRoom(): Promise<RoomHost> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      const code = newRoomCode(); const peer = new Peer(PREFIX + code, { debug: 0 });
      const cbs: ((ch: Channel) => void)[] = [];
      peer.on('open', () => {
        peer.on('connection', (conn) => { conn.on('open', () => { const ch = wrap(conn); cbs.forEach(f => f(ch)); }); });
        resolve({ code, onGuest: (cb) => { cbs.push(cb); }, close: () => peer.destroy() });
      });
      peer.on('error', (e: { type?: string }) => { if (e.type === 'unavailable-id' && n < 5) { peer.destroy(); attempt(n + 1); } else if (n >= 5 || e.type !== 'unavailable-id') reject(new Error(friendly(e))); });
    };
    attempt(0);
  });
}

/** Connect to a host by room code. */
export function joinRoom(code: string): Promise<{ ch: Channel; close: () => void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 }); let done = false;
    const fail = (m: string) => { if (done) return; done = true; peer.destroy(); reject(new Error(m)); };
    const timer = setTimeout(() => fail('Could not reach that room. Check the code, or ask the host to reopen the lobby.'), 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + normaliseCode(code), { reliable: true, serialization: 'json' });
      conn.on('open', () => { if (done) return; done = true; clearTimeout(timer); resolve({ ch: wrap(conn), close: () => peer.destroy() }); });
      conn.on('error', () => fail('Connection failed.'));
    });
    peer.on('error', (e: { type?: string }) => fail(e.type === 'peer-unavailable' ? 'No room with that code.' : friendly(e)));
  });
}

function friendly(e: { type?: string }) {
  switch (e.type) {
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'Cannot reach the matchmaking service. Check your connection.';
    case 'browser-incompatible': return 'This browser does not support WebRTC.';
    default: return `Network error${e.type ? ` (${e.type})` : ''}.`;
  }
}
