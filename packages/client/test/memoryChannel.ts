import type { Channel } from '../src/net/channel';

/** Two connected in-memory channels with JSON round-tripping, to test the protocol without WebRTC. */
export function channelPair(): [Channel, Channel] {
  const mk = (id: string) => { const msg: ((m: unknown) => void)[] = [], close: (() => void)[] = []; let other: ReturnType<typeof mk> | null = null; let closed = false;
    const ch: Channel & { _deliver(m: unknown): void; _link(o: unknown): void; _closed(): void } = {
      id,
      send: (m) => { if (!closed) other!._deliver(JSON.parse(JSON.stringify(m))); },
      onMessage: (cb) => { msg.push(cb); }, onClose: (cb) => { close.push(cb); },
      close: () => { if (closed) return; closed = true; close.forEach(f => f()); other?._closed(); },
      _deliver: (m) => msg.forEach(f => f(m)), _link: (o) => { other = o as typeof other; }, _closed: () => { if (!closed) { closed = true; close.forEach(f => f()); } },
    };
    return ch; };
  const a = mk('a'), b = mk('b'); a._link(b); b._link(a); return [a, b];
}
