// Turns structured game events into text for a given viewer, so server and clients phrase them identically.
import { FACTIONS, cap } from '../data/factions';
import { world } from './core';
import type { GameEvent, GameState } from './types';

export interface Described { text: string; cls: '' | 'me' | 'bad' | 'good'; region?: number }

export function describeEvent(g: GameState, e: GameEvent, me: number): Described | null {
  const R = (i: number) => world().regions[i].name, F = (i: number) => FACTIONS[i];
  switch (e.k) {
    case 'start': return { text: 'War is declared. Sealed orders received.', cls: 'me' };
    case 'march': return e.faction === me && g.regions[e.to].owner !== me ? { text: `${e.units} units march from ${R(e.from)} on ${R(e.to)}.`, cls: 'me' } : null;
    case 'air':
      if (e.faction === me) return { text: `${e.units} aircraft take off from ${R(e.from)} for ${R(e.to)}.`, cls: 'me', region: e.to };
      if (g.regions[e.to].owner === me) return { text: `Enemy aircraft spotted heading for ${R(e.to)}!`, cls: 'bad', region: e.to };
      return null;
    case 'cleared': return e.faction === me ? { text: `The last holdouts in ${R(e.region)} are silenced. The region is fully ours.`, cls: 'good', region: e.region } : null;
    case 'battleStart':
      if (e.attacker === me) return { text: `Our troops open the battle of ${R(e.region)} against ${F(e.defender).the}.`, cls: 'me', region: e.region };
      if (e.defender === me) return { text: `${cap(F(e.attacker).the)} attacks ${R(e.region)}!`, cls: 'bad', region: e.region };
      return null;
    case 'battleEnd': {
      const cp = e.capital ? ' The capital has fallen.' : '';
      if (e.winner !== null && e.winner !== e.prev) {
        const W = F(e.winner), P = F(e.prev);
        const ho = e.holdouts >= 0 ? (e.winner === me ? ` Enemy defences on another border still hold out: no supply from it until you storm them.` : e.holdouts === me ? ` Our defences on another border hold out.` : '') : '';
        if (e.winner === me) return { text: `Victory at ${R(e.region)}: taken from ${P.the}.${cp}${ho}`, cls: 'good', region: e.region };
        if (e.prev === me) return { text: `${R(e.region)} has fallen to ${W.the}.${cp}${ho}`, cls: 'bad', region: e.region };
        return { text: `${cap(W.the)} takes ${R(e.region)} from ${P.the}.${cp}`, cls: '', region: e.region };
      }
      if (e.winner === e.prev && e.prev === me) return { text: `${R(e.region)} holds. The attack is beaten back.`, cls: 'good', region: e.region };
      if (e.winner === null && (e.prev === me || e.sides.includes(me))) return { text: `Battle of ${R(e.region)}: no one is left standing.`, cls: 'me', region: e.region };
      return null;
    }
    case 'eliminated': return { text: `${cap(F(e.faction).the)} has been destroyed.`, cls: e.faction === me ? 'bad' : '' };
    case 'newOrders': return e.faction === me ? { text: 'Your target fell to another power. New orders: hold 30 regions.', cls: 'me' } : null;
    default: return null;
  }
}
