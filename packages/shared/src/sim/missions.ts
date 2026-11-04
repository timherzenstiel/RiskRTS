// Secret missions, elimination and victory.
import { CONT, CONT_KEYS, type ContKey } from '../data/regions';
import { FACTIONS } from '../data/factions';
import { totalUnits } from '../data/units';
import { controls, emit, updateContested, world } from './core';
import type { FactionState, GameState, Mission } from './types';

export function buildMissions(): Mission[] {
  const L: Mission[] = [
    { type: 'conts', conts: ['NA', 'AF'] }, { type: 'conts', conts: ['NA', 'OC'] }, { type: 'conts', conts: ['AS', 'SA'] }, { type: 'conts', conts: ['AS', 'AF'] },
    { type: 'conts1', conts: ['EU', 'SA'] }, { type: 'conts1', conts: ['EU', 'OC'] }, { type: 'count', n: 30 }, { type: 'count2', n: 24 }];
  FACTIONS.forEach((_, i) => L.push({ type: 'destroy', target: i }));
  return L;
}

/** [title, description] for a mission. */
export function missionText(m: Mission): [string, string] {
  const C = (k: ContKey) => CONT[k].name;
  switch (m.type) {
    case 'conts': return [`Secure ${C(m.conts[0])} and ${C(m.conts[1])}`, `Hold every region of ${C(m.conts[0])} and of ${C(m.conts[1])} at the same time.`];
    case 'conts1': return [`Secure ${C(m.conts[0])}, ${C(m.conts[1])} and one more`, `Hold every region of ${C(m.conts[0])} and ${C(m.conts[1])}, plus every region of one other continent of your choice.`];
    case 'count': return [`Hold ${m.n} regions`, m.converted ? `Your original target was destroyed by another power. New orders: hold ${m.n} regions of the world map.` : `Hold ${m.n} regions of the world map at the same time.`];
    case 'count2': return [`Hold ${m.n} garrisoned regions`, `Hold ${m.n} regions, each with at least 2 units stationed in it.`];
    case 'destroy': return [`Destroy ${FACTIONS[m.target].the}`, `Take the last region of ${FACTIONS[m.target].the}. If another power finishes them first, your orders change to holding 30 regions.`];
  }
}

export const ownsCont = (g: GameState, fid: number, k: ContKey) => g.regions.every((r, i) => world().regions[i].cont !== k || controls(r, fid));

export function missionDone(g: GameState, f: FactionState): boolean {
  const m = f.mission; if (!m) return false; const mine = g.regions.filter(r => controls(r, f.id));
  if (m.type === 'conts') return m.conts.every(k => ownsCont(g, f.id, k));
  if (m.type === 'conts1') return m.conts.every(k => ownsCont(g, f.id, k)) && CONT_KEYS.some(k => !m.conts.includes(k) && ownsCont(g, f.id, k));
  if (m.type === 'count') return mine.length >= m.n;
  if (m.type === 'count2') return mine.filter(r => r.battle < 0 && totalUnits(r.units) >= 2).length >= m.n;
  return false;
}
/** Does the faction's mission want this region? (AI uses it to pick targets.) */
export function missionWants(g: GameState, f: FactionState, regionId: number): boolean {
  const m = f.mission; if (!m) return false;
  if (m.type === 'conts' || m.type === 'conts1') return m.conts.includes(world().regions[regionId].cont);
  if (m.type === 'destroy') return g.regions[regionId].owner === m.target;
  return true;
}
/** 0..1 progress towards the mission, for HUD bars. */
export function missionFrac(g: GameState, f: FactionState): number {
  const m = f.mission; if (!m) return 0; const mine = g.regions.filter(r => r.owner === f.id);
  if (m.type === 'conts' || m.type === 'conts1') { const ids = world().regions.filter(r => m.conts.includes(r.cont)).map(r => r.id); return ids.filter(i => g.regions[i].owner === f.id).length / ids.length; }
  if (m.type === 'count') return Math.min(1, mine.length / m.n);
  if (m.type === 'count2') return Math.min(1, mine.filter(r => totalUnits(r.units) >= 2).length / m.n);
  if (m.type !== 'destroy') return 0;
  const left = g.regions.filter(r => r.owner === m.target).length; return Math.max(0, Math.min(1, 1 - left / Math.max(1, m.n0 ?? left)));
}

export function endGame(g: GameState, winner: number | null, reason?: string) {
  if (g.over) return; g.over = true; g.winner = winner;
  emit(g, { k: 'over', winner, reason });
}
export function checkMissions(g: GameState) {
  if (g.over) return;
  for (const f of g.factions) if (f.alive && missionDone(g, f)) { endGame(g, f.id); return; }
}
/** Marks a faction destroyed if it has nothing left, and resolves "destroy" missions. */
export function checkElim(g: GameState, fid: number, by: number | null) {
  const f = g.factions[fid]; if (!f || !f.alive || g.over) return;
  if (g.regions.some(r => r.owner === fid) || g.armies.some(a => a.owner === fid)) return;
  for (const b of g.battles) if (!b.ended && b.agents.some(a => !a.dead && a.f === fid)) return;
  f.alive = false; emit(g, { k: 'eliminated', faction: fid });
  // a destroyed power's holdouts surrender
  for (const r of g.regions) if (r.defs.some(d => d.f === fid)) { r.defs = r.defs.filter(d => d.f !== fid); updateContested(r); }
  for (const o of g.factions) {
    if (!o.alive || !o.mission || o.mission.type !== 'destroy' || o.mission.target !== fid) continue;
    if (by === o.id) { endGame(g, o.id); return; }
    o.mission = { type: 'count', n: 30, converted: true }; emit(g, { k: 'newOrders', faction: o.id });
  }
  if (g.factions.filter(x => !x.ai).length && g.factions.filter(x => !x.ai).every(x => !x.alive)) endGame(g, null, 'Every human power has been destroyed. The war is lost.');
}
