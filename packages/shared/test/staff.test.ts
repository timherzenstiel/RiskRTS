// The simple command (design-simple): a staff runs a human power's fronts; the player gives one order per front.
import { describe, it, expect } from 'vitest';
import { applyCommand, buildWorld, corpsIn, createGame, depotOf, frontOrderOf, frontsOfPower, groundUnits, run, type GameState } from '../src';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const game = (me = 1, seed = 11) => { const g = createGame({ seed, humans: [me], fx: false, settings: { staff: true } }); return { g, me, cap: g.regions.find(r => r.capitalOf === me)! }; };
const attacking = (g: GameState, me: number) => g.battles.some(b => b.attacker === me) || g.armies.some(a => a.owner === me && (a.ord ?? 0) >= 1) || g.regions.some(r => r.owner === me && corpsIn(r).some(c => (c.ord ?? 0) >= 1));

describe('the staff', () => {
  it('puts a general on every front and leaves the Inbox empty', () => {
    const { g, me } = game();
    run(g, 60);
    const fronts = frontsOfPower(g, me);
    expect(fronts.length).toBeGreaterThan(0);
    for (const fr of fronts.slice(0, 8)) expect((g.hq ?? []).some(h => h.owner === me && h.front.some(r => fr.regions.includes(r))), `front of ${W.regions[fr.regions[0]].name}`).toBe(true);
    for (const h of (g.hq ?? []).filter(x => x.owner === me)) { expect(h.mandate).toBe(0); expect(h.auto).toBe(true); }
    run(g, 120);
    // nothing waits for the player: what a general asks is answered by the staff or by his own budget
    const open = (g.requests ?? []).filter(q => q.owner === me && g.time - q.at > 45);
    expect(open.map(q => q.kind)).toEqual([]);
    expect(attacking(g, me)).toBe(false);
  });

  it('a front ordered to attack goes in by itself, and holds again when the region is taken or the order is withdrawn', () => {
    const { g, me, cap } = game();
    for (let i = 0; i < 4; i++) applyCommand(g, me, { t: 'recruit', region: cap.id, unit: 'inf', n: 2 });
    run(g, 45);
    expect(applyCommand(g, me, { t: 'front', region: cap.id, order: 'attack', target: id('Egypt') })).toBeTruthy();
    expect(applyCommand(g, me, { t: 'front', region: cap.id, order: 'attack', target: id('Iberia') })).toBeNull();
    expect(frontOrderOf(g, me, cap.id)).toMatchObject({ order: 'attack', target: id('Iberia') });
    let went = false;
    for (let i = 0; i < 48 && !went; i++) { run(g, 5); went = attacking(g, me); }
    expect(went).toBe(true);
    expect(applyCommand(g, me, { t: 'front', region: cap.id, order: 'hold' })).toBeNull();
    expect(frontOrderOf(g, me, cap.id).order).toBe('hold');
  });

  it('leaves a front alone that the player keeps for himself, and takes it back on a new order', () => {
    const { g, me, cap } = game();
    run(g, 20);
    expect(applyCommand(g, me, { t: 'front', region: cap.id, order: 'mine' })).toBeNull();
    run(g, 30);
    expect(frontOrderOf(g, me, cap.id).order).toBe('mine');
    expect((g.hq ?? []).some(h => h.owner === me && h.front.includes(cap.id))).toBe(false);
    expect(corpsIn(cap).some(c => c.army !== undefined)).toBe(false);
    expect(applyCommand(g, me, { t: 'front', region: cap.id, order: 'hold' })).toBeNull();
    expect((g.hq ?? []).some(h => h.owner === me && h.front.includes(cap.id))).toBe(true);
  });

  it('leaves troops the player put on a border there until the front gets a new order', () => {
    const { g, me, cap } = game();
    run(g, 10);
    const c = corpsIn(cap).find(x => x.p >= 0 && x.p < 1000)!;
    const other = W.regions[cap.id].land.find(n => g.regions[n].owner !== me && n !== c.p)!;
    expect(applyCommand(g, me, { t: 'moveCorps', region: cap.id, id: c.id, to: cap.id, toPost: other })).toBeNull();
    run(g, 15);
    expect(corpsIn(cap).some(x => x.id === c.id && x.man)).toBe(true);
    run(g, 60);
    expect(corpsIn(cap).some(x => x.id === c.id && x.man && x.p === other)).toBe(true);
    expect(applyCommand(g, me, { t: 'front', region: cap.id, order: 'hold' })).toBeNull();
    expect(corpsIn(cap).some(x => x.man)).toBe(false);
    expect(groundUnits(cap.units)).toBeGreaterThan(0); void depotOf;
  });

  it('is off unless the game asks for it', () => {
    const g = createGame({ seed: 11, humans: [1], fx: false });
    run(g, 30);
    expect((g.hq ?? []).filter(h => h.owner === 1).length).toBe(0);
    expect(applyCommand(g, 1, { t: 'front', region: g.regions.find(r => r.capitalOf === 1)!.id, order: 'hold' })).toBeTruthy();
  });
});
