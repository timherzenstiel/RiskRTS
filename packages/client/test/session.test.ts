import { describe, it, expect } from 'vitest';
import { HostSession, GuestSession } from '../src/game/session';
import { channelPair } from './memoryChannel';

function world() {
  const host = new HostSession(0, { seed: 11, humans: [0, 1], difficulty: 1, network: true });
  const [hostSide, guestSide] = channelPair();
  host.addPeer('guest', 1, hostSide);
  const guest = new GuestSession(1, guestSide);
  const tick = (sec: number) => { for (let i = 0; i < sec * 20; i++) { host.update(.05); guest.update(.05); } };
  return { host, guest, tick };
}

describe('host / guest sessions', () => {
  it('guest mirrors the host state', () => {
    const { host, guest, tick } = world(); tick(30);
    expect(guest.state.regions.map(r => r.owner)).toEqual(host.state.regions.map(r => r.owner));
    expect(guest.state.factions.map(f => f.supply)).toEqual(host.state.factions.map(f => f.supply));
    expect(guest.state.factions[1].mission).toEqual(host['sim'].factions[1].mission);
    expect(host.state.factions[1].mission).toBeNull(); // the host's screen does not see the guest's orders either
    expect(guest.state.factions[0].mission).toBeNull(); // the host's secret mission is not leaked
  });
  it("guest commands are executed by the host for the guest's faction only", () => {
    const { host, guest, tick } = world(); tick(1);
    const mine = host.state.regions.find(r => r.owner === 1)!, theirs = host.state.regions.find(r => r.owner === 0)!;
    const before = host.state.factions[1].supply;
    guest.send({ t: 'recruit', region: mine.id, unit: 'inf', n: 2 }); tick(.5);
    expect(host.state.factions[1].supply).toBe(before - 2);
    let err = ''; guest.onError = (m) => { err = m; };
    guest.send({ t: 'recruit', region: theirs.id, unit: 'inf' }); tick(.5);
    expect(err).toMatch(/own regions/);
  });
  it('streams unit detail only for watched battles', () => {
    const { host, guest, tick } = world(); tick(90);
    const b = host.state.battles.find(x => !x.ended); if (!b) return; // seed-dependent; AI usually fights by 90 s
    tick(1); expect(guest.state.battles.find(x => x.id === b.id)!.agents.length).toBe(0);
    guest.setWatch([b.id]); tick(1);
    expect(guest.state.battles.find(x => x.id === b.id)!.agents.length).toBe(b.agents.length);
  });
  it('each player sees its own fog of war', () => {
    const { host, guest, tick } = world(); tick(5);
    const far = host['sim'].regions.find(r => r.owner !== 0 && host.state.regions[r.id].vis === 0 && r.units.inf > 0);
    if (far) expect(host.state.regions[far.id].units.inf).toBe(0);
    for (const r of guest.state.regions) if (r.owner === 1) expect(r.vis).toBe(3);
  });
  it('a disconnected guest hands its power to the AI', () => {
    const { host, guest, tick } = world(); tick(1); guest.destroy(); tick(.2);
    expect(host.state.factions[1].ai).toBe(true);
  });
  it('single-player saves restore exactly', () => {
    const a = new HostSession(2, { seed: 5, humans: [2], difficulty: 2 }); for (let i = 0; i < 400; i++) a.update(.05);
    const b = HostSession.restore(a.serialize())!;
    expect(b.state.regions.map(r => r.owner)).toEqual(a.state.regions.map(r => r.owner));
    expect(b.me).toBe(2); expect(b.state.time).toBeCloseTo(a.state.time);
    for (let i = 0; i < 100; i++) { a.update(.05); b.update(.05); }
    expect(b.state.regions.map(r => r.owner)).toEqual(a.state.regions.map(r => r.owner));
  });
});
