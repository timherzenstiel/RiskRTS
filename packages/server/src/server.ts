// The dedicated server: WebSocket connections, the world list, creating and joining worlds, persistence and the ladder.
import { DEFAULT_SETTINGS, PROTOCOL_VERSION, type ClientMsg, type GameSettings, type ServerMsg } from '@riskrts/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RANKED_RULES, World, type Conn, type SavedWorld } from './world';
import { rateWar, type Rating } from './ladder';

export interface ServerOptions {
  port: number;
  /** Folder for saved worlds and the ladder (none = nothing is saved). */
  dataDir?: string;
  /** Seconds spectators lag behind the war. */
  spectatorDelay?: number;
  /** Most worlds at once. */
  maxWorlds?: number;
}

interface Client { id: string; ws: WebSocket; name: string; world: World | null; hello: boolean }

export class GameServer {
  readonly worlds = new Map<string, World>();
  readonly ladder = new Map<string, Rating>();
  private clients = new Map<string, Client>();
  private wss: WebSocketServer;
  private timer: ReturnType<typeof setInterval>;
  private last = Date.now();

  constructor(private readonly opt: ServerOptions) {
    if (opt.dataDir) this.load();
    this.wss = new WebSocketServer({ port: opt.port });
    this.wss.on('connection', ws => this.connect(ws));
    this.timer = setInterval(() => this.tick(), 50);
  }
  get port() { const a = this.wss.address(); return typeof a === 'object' && a ? a.port : this.opt.port; }

  private connect(ws: WebSocket) {
    const c: Client = { id: randomBytes(6).toString('hex'), ws, name: 'Commander', world: null, hello: false };
    this.clients.set(c.id, c);
    ws.on('message', raw => { try { this.message(c, JSON.parse(String(raw)) as ClientMsg); } catch { this.send(c, { t: 'err', message: 'Bad message.' }); } });
    ws.on('close', () => { c.world?.leave(c.id); this.clients.delete(c.id); this.broadcastList(); });
  }
  private send(c: Client, m: ServerMsg) { if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m)); }
  private conn(c: Client): Conn { return { id: c.id, send: m => this.send(c, m) }; }

  private message(c: Client, m: ClientMsg) {
    if (m.t === 'hello') {
      if (m.v !== PROTOCOL_VERSION) { this.send(c, { t: 'err', message: 'Version mismatch. Reload the page to update.' }); c.ws.close(); return; }
      c.hello = true; c.name = (m.name || 'Commander').slice(0, 20); this.send(c, this.list()); return;
    }
    if (!c.hello) { this.send(c, { t: 'err', message: 'Say hello first.' }); return; }
    switch (m.t) {
      case 'list': this.send(c, this.list()); return;
      case 'create': {
        if (this.worlds.size >= (this.opt.maxWorlds ?? 40)) { this.send(c, { t: 'err', message: 'The server is full. Join a running war instead.' }); return; }
        const id = randomBytes(4).toString('hex'), settings: GameSettings = m.ranked ? { ...RANKED_RULES } : { ...DEFAULT_SETTINGS, ...m.settings };
        const w = this.add(new World(id, (m.name || `${c.name}'s war`).slice(0, 40), !!m.ranked, m.ranked ? 1 : Math.max(0, Math.min(2, m.difficulty | 0)), settings, { spectatorDelay: this.opt.spectatorDelay }));
        w.save(); this.broadcastList(); return;
      }
      case 'join': {
        const w = this.worlds.get(m.world); if (!w) { this.send(c, { t: 'err', message: 'That war no longer exists.' }); return; }
        c.world?.leave(c.id);
        const r = w.join(this.conn(c), m.faction | 0, typeof m.player === 'string' ? m.player.slice(0, 64) : '', c.name, typeof m.token === 'string' ? m.token : undefined);
        if ('error' in r) { this.send(c, { t: 'err', message: r.error }); return; }
        c.world = w; this.broadcastList(); return;
      }
      case 'spectate': {
        const w = this.worlds.get(m.world); if (!w) { this.send(c, { t: 'err', message: 'That war no longer exists.' }); return; }
        c.world?.leave(c.id); w.spectate(this.conn(c), m.follow); c.world = w; this.broadcastList(); return;
      }
      case 'leave': c.world?.leave(c.id); c.world = null; this.send(c, this.list()); this.broadcastList(); return;
      default: c.world?.message(c.id, m);
    }
  }

  private add(w: World) {
    w.onSave = s => this.persist(s);
    w.onOver = x => this.over(x);
    this.worlds.set(w.id, w); return w;
  }

  /** A ranked war ended: rate it once and save the ladder. */
  private over(w: World) {
    if (!w.ranked || w.rated) return;
    w.rated = true; rateWar(this.ladder, w.players(), w.sim.winner); w.save(); this.saveLadder(); this.broadcastList();
  }

  private list(): ServerMsg {
    const worlds = [...this.worlds.values()].map(w => w.info()).sort((a, b) => Number(a.over) - Number(b.over) || b.day - a.day);
    // player ids stay on the server: the ladder shows names only
    const ladder = [...this.ladder.values()].sort((a, b) => b.elo - a.elo).slice(0, 20).map((r, i) => ({ player: String(i + 1), name: r.name, elo: r.elo, games: r.games }));
    return { t: 'worlds', worlds, ladder };
  }
  private listTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcastList() {
    if (this.listTimer) return;
    this.listTimer = setTimeout(() => { this.listTimer = null; const m = this.list(); for (const c of this.clients.values()) if (c.hello && !c.world) this.send(c, m); }, 200);
  }

  private tick() {
    const now = Date.now(), dt = Math.min(.5, (now - this.last) / 1000); this.last = now;
    for (const w of this.worlds.values()) w.update(dt);
  }

  // ---- persistence
  private persist(s: SavedWorld) {
    if (!this.opt.dataDir) return;
    const dir = join(this.opt.dataDir, 'worlds'); mkdirSync(dir, { recursive: true });
    const f = join(dir, `${s.id}.json`), tmp = f + '.tmp';
    writeFileSync(tmp, JSON.stringify(s)); renameSync(tmp, f);
  }
  private saveLadder() {
    if (!this.opt.dataDir) return;
    mkdirSync(this.opt.dataDir, { recursive: true });
    writeFileSync(join(this.opt.dataDir, 'ladder.json'), JSON.stringify([...this.ladder.values()]));
  }
  private load() {
    const dir = join(this.opt.dataDir!, 'worlds');
    if (existsSync(dir)) for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SavedWorld;
        this.add(new World(s.id, s.name, s.ranked, s.difficulty, s.settings, { restore: s, spectatorDelay: this.opt.spectatorDelay }));
      } catch (e) { console.warn(`Skipping ${f}: ${e instanceof Error ? e.message : e}`); }
    }
    const lf = join(this.opt.dataDir!, 'ladder.json');
    if (existsSync(lf)) for (const r of JSON.parse(readFileSync(lf, 'utf8')) as Rating[]) this.ladder.set(r.player, r);
  }

  /** Save every world and stop. */
  async close() {
    clearInterval(this.timer); if (this.listTimer) clearTimeout(this.listTimer);
    for (const w of this.worlds.values()) w.save();
    this.saveLadder();
    for (const c of this.clients.values()) c.ws.close();
    await new Promise<void>(r => this.wss.close(() => r()));
  }
}
