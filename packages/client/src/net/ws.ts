// A Channel over a WebSocket to the dedicated server (JSON messages, any number of listeners).
import type { Channel } from './channel';

export function wsChannel(url: string): Promise<Channel> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e) { reject(new Error(`That server address does not work (${e instanceof Error ? e.message : e}).`)); return; }
    const msg: ((m: unknown) => void)[] = [], closed: (() => void)[] = [];
    let open = false;
    const to = setTimeout(() => { if (!open) { ws.close(); reject(new Error('The server did not answer.')); } }, 8000);
    ws.onopen = () => {
      open = true; clearTimeout(to);
      resolve({
        id: url,
        send: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
        onMessage: (cb) => { msg.push(cb); },
        onClose: (cb) => { closed.push(cb); },
        close: () => ws.close(),
      });
    };
    ws.onmessage = (e) => { let m: unknown; try { m = JSON.parse(String(e.data)); } catch { return; } for (const cb of [...msg]) cb(m); };
    ws.onerror = () => { if (!open) { clearTimeout(to); reject(new Error('Could not reach the server.')); } };
    ws.onclose = () => { for (const cb of [...closed]) cb(); };
  });
}
