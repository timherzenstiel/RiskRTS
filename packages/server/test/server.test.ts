// Dedicated server: worlds, seats, the computer standing in, rejoining, persistence, spectators and the ranked ladder.
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@riskrts/shared';
import { GameServer, rateWar, ELO_START, type Rating } from '../src';

/** A test client that collects messages and can wait for one. */
class Client {
  ws: WebSocket; msgs: ServerMsg[] = [];
  private waiters: [(m: ServerMsg) => boolean, (m: ServerMsg) => void][] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.on('message', raw => { const m = JSON.parse(String(raw)) as ServerMsg; this.msgs.push(m); this.waiters = this.waiters.filter(([p, r]) => (p(m) ? (r(m), false) : true)); });
  }
  open() { return new Promise<void>(r => this.ws.readyState === this.ws.OPEN ? r() : this.ws.once('open', () => r())); }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  wait<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 4000): Promise<Extract<ServerMsg, { t: T }>> {
    const hit = this.msgs.find(m => m.t === t && pred(m as Extract<ServerMsg, { t: T }>)); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit as Extract<ServerMsg, { t: T }>); }
    return new Promise((res, rej) => { const to = setTimeout(() => rej(new Error(`timeout waiting for ${t}`)), ms); this.waiters.push([m => m.t === t && pred(m as Extract<ServerMsg, { t: T }>), m => { clearTimeout(to); this.msgs.splice(this.msgs.indexOf(m), 1); res(m as Extract<ServerMsg, { t: T }>); }]); });
  }
  close() { this.ws.close(); }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: GameServer | null = null; const dirs: string[] = [];
afterEach(async () => { await server?.close(); server = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function hello(port: number, name: string) { const c = new Client(port); await c.open(); c.send({ t: 'hello', v: PROTOCOL_VERSION, name }); await c.wait('worlds'); return c; }

describe('dedicated server', () => {
  it('creates a world, seats a player, runs commands and streams snapshots', async () => {
    server = new GameServer({ port: 0 }); const a = await hello(server.port, 'Haig');
    a.send({ t: 'create', name: 'Test war', ranked: false, settings: { attackCap: 3, pace: 1 }, difficulty: 1 });
    const list = await a.wait('worlds', m => m.worlds.length === 1);
    const w = list.worlds[0]; expect(w.seats.every(s => s.name === null)).toBe(true);
    a.send({ t: 'join', world: w.id, faction: 0, player: 'p-haig' });
    const j = await a.wait('joined'); expect(j.faction).toBe(0); expect(j.token.length).toBeGreaterThan(8);
    await a.wait('start'); const s1 = await a.wait('snap');
    expect(s1.snap.missions[0]).not.toBeNull(); expect(s1.snap.missions[1]).toBeNull();
    const world = server.worlds.get(w.id)!; expect(world.sim.factions[0].ai).toBe(false); expect(world.running).toBe(true);
    const cap = world.sim.regions.find(r => r.capitalOf === 0)!, n = cap.train?.length ?? 0;
    a.send({ t: 'cmd', cmd: { t: 'recruit', region: cap.id, unit: 'inf' } }); await sleep(150);
    // the recruits train for a week first
    expect(world.sim.regions[cap.id].train?.length ?? 0).toBeGreaterThanOrEqual(n + 1);
    a.send({ t: 'cmd', cmd: { t: 'recruit', region: world.sim.regions.find(r => r.owner === 1)!.id, unit: 'inf' } });
    expect((await a.wait('err')).message).toMatch(/own regions/);
    a.close();
  });

  it('hands a leaving player\'s power to the computer and gives it back with the token', async () => {
    server = new GameServer({ port: 0 }); const a = await hello(server.port, 'Foch');
    a.send({ t: 'create', name: 'W', ranked: false, settings: { attackCap: 3, pace: 1 }, difficulty: 1 });
    const w = (await a.wait('worlds', m => m.worlds.length === 1)).worlds[0];
    a.send({ t: 'join', world: w.id, faction: 1, player: 'p-foch' }); const { token } = await a.wait('joined');
    const world = server.worlds.get(w.id)!; a.close(); await sleep(100);
    expect(world.sim.factions[1].ai).toBe(true); expect(world.sim.factions[1].away).toBe(true); expect(world.running).toBe(false);
    const b = await hello(server.port, 'Intruder');
    b.send({ t: 'join', world: w.id, faction: 1, player: 'p-other' }); expect((await b.wait('err')).message).toMatch(/commands that power/);
    b.send({ t: 'join', world: w.id, faction: 1, player: 'p-foch' }); expect((await b.wait('err')).message).toMatch(/commands that power/); // the id alone is not enough
    const c = await hello(server.port, 'Foch');
    c.send({ t: 'join', world: w.id, faction: 1, player: 'new-device', token }); expect((await c.wait('joined')).faction).toBe(1);
    expect(world.sim.factions[1].ai).toBe(false); b.close(); c.close();
  });

  it('saves after each convoy and restores the worlds on restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'f14-')); dirs.push(dir);
    server = new GameServer({ port: 0, dataDir: dir }); const a = await hello(server.port, 'Joffre');
    a.send({ t: 'create', name: 'Saved war', ranked: false, settings: { attackCap: 3, pace: 1 }, difficulty: 1 });
    const w = (await a.wait('worlds', m => m.worlds.length === 1)).worlds[0];
    a.send({ t: 'join', world: w.id, faction: 2, player: 'p-j' }); await a.wait('joined');
    const world = server.worlds.get(w.id)!;
    for (let i = 0; i < 45; i++) world.update(.5); // past one convoy
    expect(world.sim.day).toBeGreaterThan(0);
    a.close(); await server.close();
    server = new GameServer({ port: 0, dataDir: dir });
    const back = server.worlds.get(w.id)!; expect(back).toBeTruthy(); expect(back.sim.day).toBe(world.sim.day);
    expect(back.seats[2].name).toBe('Joffre'); expect(back.sim.factions[2].ai).toBe(true);
  });

  it('spectators get full vision, delayed, and cannot give orders', async () => {
    server = new GameServer({ port: 0, spectatorDelay: .3 }); const a = await hello(server.port, 'Spec');
    a.send({ t: 'create', name: 'Ranked war', ranked: true, settings: { attackCap: 0, pace: 0 }, difficulty: 2 });
    const w = (await a.wait('worlds', m => m.worlds.length === 1)).worlds[0];
    expect(w.ranked).toBe(true); expect(w.settings.attackCap).toBe(3); expect(w.difficulty).toBe(1);
    a.send({ t: 'spectate', world: w.id, follow: 3 }); const sp = await a.wait('spectating'); expect(sp.delay).toBeCloseTo(.3);
    const s = await a.wait('snap', () => true, 3000);
    expect(s.snap.r.every(r => r[9] === 3)).toBe(true); expect(s.snap.missions.every(m => m === null)).toBe(true);
    a.send({ t: 'cmd', cmd: { t: 'mobilise', level: 1 } }); expect((await a.wait('err')).message).toMatch(/Spectators/);
    a.close();
  });
});

describe('ranked ladder', () => {
  it('the winner takes points from every other human; computers and no-winner wars change nothing between them', () => {
    const L = new Map<string, Rating>();
    rateWar(L, [[0, 'a', 'A'], [1, 'b', 'B'], [2, 'c', 'C']], 1);
    expect(L.get('b')!.elo).toBe(ELO_START + 32); expect(L.get('a')!.elo).toBe(ELO_START - 16); expect(L.get('c')!.games).toBe(1);
    rateWar(L, [[0, 'a', 'A'], [1, 'b', 'B']], 4);
    expect(L.get('a')!.elo).toBe(ELO_START - 16); expect(L.get('b')!.games).toBe(2);
    expect(rateWar(L, [[0, 'a', 'A']], 0)).toEqual([]);
  });
});
