// Turns structured game events into text for a given viewer, so server and clients phrase them identically.
import { FACTIONS, cap } from '../data/factions';
import { corpsName } from '../data/names';
import { world } from './core';
import { SHIP } from '../data/sea';
import { sectorName } from '../world/zones';
import { techDef, doctrineDef } from '../data/tech';
import { PHRASES, TREATY_NAMES, type GameEvent, type GameState } from './types';

export interface Described { text: string; cls: '' | 'me' | 'bad' | 'good'; region?: number; report?: number; offer?: number }

export function describeEvent(g: GameState, e: GameEvent, me: number): Described | null {
  const R = (i: number) => world().regions[i].name, F = (i: number) => FACTIONS[i], Z = (z: number) => world().zones[z]?.name ?? 'the open sea', S = (k: number) => sectorName(world(), k);
  switch (e.k) {
    case 'start': return { text: 'War is declared. Sealed orders received.', cls: 'me' };
    case 'march': return e.faction === me && g.regions[e.to].owner !== me ? { text: `${e.units} formation${e.units === 1 ? '' : 's'} march from ${R(e.from)} on ${R(e.to)}.`, cls: 'me' } : null;
    case 'intel': {
      if (e.faction !== me) return null;
      const by = e.by === 'patrol' ? 'Our cavalry patrol is back from' : e.by === 'recon' ? 'Reconnaissance photographs of' : 'Our agent reports from';
      return { text: `${by} ${R(e.region)}: the report is in the region file.`, cls: 'me', region: e.region };
    }
    case 'scoutLost': return e.faction === me ? { text: e.by === 'patrol' ? `Our patrol into ${R(e.region)} was caught at the border.` : `Our reconnaissance flight over ${R(e.region)} was shot down.`, cls: 'bad', region: e.region } : null;
    case 'spyFound':
      if (e.faction === me) return { text: `Our agent in ${R(e.region)} has been unmasked and shot.`, cls: 'bad', region: e.region };
      if (e.owner === me) return { text: `A ${F(e.faction).short} spy was caught in ${R(e.region)}.`, cls: 'good', region: e.region };
      return null;
    case 'cut': return e.faction === me ? { text: `${R(e.region)} is cut off from supply. The garrison will wear down until a route home is reopened.`, cls: 'bad', region: e.region } : null;
    case 'surrender':
      if (e.faction === me) return { text: `Our men in ${R(e.region)} are breaking. Some battalions lay down their arms.`, cls: 'bad', region: e.region };
      if (g.regions[e.region].owner === me || g.battles.some(b => b.region === e.region && b.sides.includes(me))) return { text: `Enemy troops in ${R(e.region)} are surrendering.`, cls: 'good', region: e.region };
      return null;
    case 'breakthrough':
      if (e.faction === me) return { text: `Breakthrough at ${R(e.region)}! Our troops fall on the defenders of the other front from behind.`, cls: 'good', region: e.region };
      if (g.regions[e.region].owner === me) return { text: `The ${e.from >= 0 ? S(e.from) + ' ' : ''}front of ${R(e.region)} has broken. The enemy is behind our lines.`, cls: 'bad', region: e.region };
      return null;
    case 'overTop':
      if (e.faction === me) return { text: `Whistles blow at ${R(e.region)}: our men go over the top.`, cls: 'me', region: e.region };
      if (g.regions[e.region].owner === me) return { text: `The enemy leaves his trenches at ${R(e.region)}. Stand to!`, cls: 'bad', region: e.region };
      return null;
    case 'withdraw':
      if (e.faction === me) return { text: `Our troops fall back from ${R(e.region)} to ${R(e.to)}.`, cls: 'me', region: e.to };
      if (g.regions[e.region].owner === me || g.battles.some(b => b.region === e.region && b.sides.includes(me))) return { text: `The enemy pulls back from ${R(e.region)}.`, cls: 'good', region: e.region };
      return null;
    case 'report': return e.sides.includes(me) ? { text: `After-action report: battle of ${R(e.region)}.`, cls: '', region: e.region, report: e.id } : null;
    case 'strike':
      if (e.faction !== me) return null;
      return e.end ? { text: `The strikes in ${R(e.region)} are over. The region works for the war again.`, cls: 'good', region: e.region }
        : { text: `Strikes in ${R(e.region)}: the war-weary workers down tools. No supply, shells or recruits from there.`, cls: 'bad', region: e.region };
    case 'rising':
      if (e.faction === me) return { text: `Uprising in ${R(e.region)}! The garrison mutinies and the region goes over to ${F(e.to).the}.`, cls: 'bad', region: e.region };
      if (e.to === me) return { text: `${R(e.region)} rises against ${F(e.faction).the} and declares for us.`, cls: 'good', region: e.region };
      return { text: `Uprising in ${R(e.region)}: it breaks away from ${F(e.faction).the}.`, cls: '', region: e.region };
    case 'railCut':
      if (e.faction === me) return { text: e.by === 'air' ? `Our bombers wreck the railways of ${R(e.region)}.` : `Our agent blows up a railway line in ${R(e.region)}.`, cls: 'good', region: e.region };
      if (e.owner === me) return { text: e.by === 'air' ? `Enemy bombers have cut the railways of ${R(e.region)}.` : `Saboteurs have blown up a railway line in ${R(e.region)}.`, cls: 'bad', region: e.region };
      return null;
    case 'railBuilt': return e.faction === me ? { text: `The railway between ${R(e.a)} and ${R(e.b)} is open.`, cls: 'good', region: e.b } : null;
    case 'tech': return e.faction === me ? { text: `New in the field: ${techDef(e.tech).name}. ${techDef(e.tech).desc}.`, cls: 'good' } : null;
    case 'docOffer': return e.faction === me ? { text: `${e.year}: the General Staff asks for this year's doctrine.`, cls: 'me' } : null;
    case 'doctrine': return e.faction === me ? { text: `Doctrine adopted: ${doctrineDef(e.doc).name}.`, cls: 'me' } : { text: `${cap(F(e.faction).the)} adopts ${doctrineDef(e.doc).name.toLowerCase()}.`, cls: '' };
    case 'bombed':
      if (e.faction === me) return { text: `Our bombers hit the factory of ${R(e.region)}. It will be out of action for three convoys.`, cls: 'good', region: e.region };
      if (e.owner === me) return { text: `Enemy bombers have wrecked the factory of ${R(e.region)}.`, cls: 'bad', region: e.region };
      return null;
    case 'fallback':
      if (e.faction === me) return { text: `Our defenders at ${R(e.region)} fall back to the second line and steady.`, cls: 'me', region: e.region };
      if (g.battles.some(b => b.region === e.region && b.sides.includes(me))) return { text: `The enemy at ${R(e.region)} falls back to a second line.`, cls: '', region: e.region };
      return null;
    case 'firstLine':
      if (e.faction === me) return { text: e.hold ? `We hold the enemy's first line at ${R(e.region)}. The troops dig in there; order the invasion when ready.` : `The first line at ${R(e.region)} is ours. The troops consolidate before pushing into the depth.`, cls: 'good', region: e.region };
      if (e.def === me) return { text: e.from >= 1000 ? `The enemy has taken the beach of ${R(e.region)} on the ${S(e.from)}.` : `The enemy has taken our first line at ${R(e.region)} on the border with ${R(e.from)}.`, cls: 'bad', region: e.region };
      return null;
    case 'depth':
      if (e.faction === me) return { text: `Our troops push into the depth of ${R(e.region)}.`, cls: 'me', region: e.region };
      if (e.def === me) return { text: `The enemy pushes into ${R(e.region)}. The main army meets them.`, cls: 'bad', region: e.region };
      return null;
    case 'advance': return e.faction === me ? { text: `The advance from our foothold in ${R(e.region)} begins.`, cls: 'me', region: e.region } : null;
    case 'massing': return e.owner === me ? { text: `${cap(F(e.faction).the)} is massing troops in ${R(e.region)}, facing ${R(e.to)}.`, cls: 'bad', region: e.to } : null;
    case 'raid':
      if (e.faction === me) return { text: e.ok ? `Our trench raid at ${R(e.region)} comes back with prisoners${e.target >= 0 ? ` and a report on ${R(e.target)}` : ''}.` : `Our trench raid at ${R(e.region)} was beaten back.`, cls: e.ok ? 'good' : 'bad', region: e.region };
      if (e.ok && (g.regions[e.region].owner === me || g.battles.some(b => b.region === e.region && b.sides.includes(me)))) return { text: `An enemy raiding party got into our trenches at ${R(e.region)}.`, cls: 'bad', region: e.region };
      return null;
    case 'offer':
      if (e.to === me) return { text: `${cap(F(e.from).the)} offers a ${TREATY_NAMES[e.kind].toLowerCase()}.`, cls: 'me', offer: e.id };
      return null;
    case 'treaty': {
      const other = e.a === me ? e.b : e.b === me ? e.a : -1, n = TREATY_NAMES[e.kind];
      if (e.what === 'broken') {
        if (e.by === me) return { text: `We broke the ${n.toLowerCase()} with ${F(other).the}. The world will remember.`, cls: 'bad' };
        if (other >= 0) return { text: `${cap(F(e.by!).the)} has broken the ${n.toLowerCase()} and attacks us!`, cls: 'bad' };
        return { text: `${cap(F(e.by!).the)} breaks its ${n.toLowerCase()} with ${F(e.by === e.a ? e.b : e.a).the}.`, cls: '' };
      }
      if (other < 0) return e.what === 'signed' ? { text: `${cap(F(e.a).the)} and ${F(e.b).the} sign a ${n.toLowerCase()}.`, cls: '' } : null;
      if (e.what === 'signed') return { text: `${n} with ${F(other).the} signed.`, cls: 'good' };
      if (e.what === 'declined') return e.by === me ? null : { text: `${cap(F(other).the)} declines our offer of a ${n.toLowerCase()}.`, cls: 'bad' };
      if (e.what === 'notice') return { text: `${e.by === me ? 'We have' : cap(F(other).the) + ' has'} given notice on the ${n.toLowerCase()}: it ends in three convoys.`, cls: 'me' };
      return { text: `The ${n.toLowerCase()} with ${F(other).the} has ended.`, cls: 'me' };
    }
    case 'say':
      if (e.from === me) return { text: `To ${e.to < 0 ? 'all powers' : F(e.to).the}: "${PHRASES[e.p]}"`, cls: 'me' };
      if (e.to === me || e.to < 0) return { text: `${F(e.from).short}: "${PHRASES[e.p]}"`, cls: '' };
      return null;
    case 'air':
      if (e.faction === me) return { text: `${e.units} squadron${e.units === 1 ? '' : 's'} take off from ${R(e.from)} for ${R(e.to)}.`, cls: 'me', region: e.to };
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
      if (e.winner === e.prev && e.prev === me) return { text: g.battles.some(b => b.region === e.region && !b.ended) ? `One front of ${R(e.region)} holds. The fight goes on elsewhere.` : `${R(e.region)} holds. The attack is beaten back.`, cls: 'good', region: e.region };
      if (e.winner === null && (e.prev === me || e.sides.includes(me))) return { text: `Battle of ${R(e.region)}: no one is left standing.`, cls: 'me', region: e.region };
      return null;
    }
    case 'eliminated': return { text: `${cap(F(e.faction).the)} has been destroyed.`, cls: e.faction === me ? 'bad' : '' };
    case 'newOrders': return e.faction === me ? { text: 'Your target fell to another power. New orders: hold 30 regions.', cls: 'me' } : null;
    case 'shipBuilt': return e.faction === me ? { text: `A new ${SHIP[e.kind].one} is ready in ${R(e.region)}.`, cls: 'good', region: e.region } : null;
    case 'portBuilt': return e.faction === me ? { text: `The port of ${R(e.region)} is open.`, cls: 'good', region: e.region } : null;
    case 'shipped': return e.faction === me ? { text: `${e.units} formation${e.units === 1 ? '' : 's'} embark in ${R(e.from)} for ${R(e.to)}.`, cls: 'me', region: e.to } : null;
    case 'offshore':
      if (e.owner === me) return { text: `Enemy fleet off the coast of ${R(e.region)} on the ${Z(e.zone)}: about ${e.est} battalions. A landing is coming!`, cls: 'bad', region: e.region };
      if (e.faction === me) return { text: `Our assault fleet assembles off ${R(e.region)}. The landing goes in shortly.`, cls: 'me', region: e.region };
      return null;
    case 'landing':
      if (e.faction === me) return e.ok ? { text: `The first wave goes ashore at ${R(e.region)}.`, cls: 'me', region: e.region } : { text: `The landing at ${R(e.region)} has failed. The boats take off what is left.`, cls: 'bad', region: e.region };
      if (e.owner === me) return e.ok ? { text: `The enemy is landing at ${R(e.region)}!`, cls: 'bad', region: e.region } : { text: `The landing at ${R(e.region)} is thrown back into the sea.`, cls: 'good', region: e.region };
      return null;
    case 'convoyLost':
      if (e.faction !== me) return null;
      return { text: e.by === 'uboat' ? `Convoy torpedoed in the ${Z(e.zone)}: ${e.ships} ${e.ships === 1 ? 'transport' : 'transports'}, ${e.men} men lost.` : e.ships ? `${e.ships} of our ships sunk in the ${Z(e.zone)}${e.men ? `, ${e.men} men lost with them` : ''}.` : `${e.men} men lost at sea in the ${Z(e.zone)}.`, cls: 'bad' };
    case 'scuttled': return e.faction === me ? { text: `Our ships in the port of ${R(e.region)} were scuttled as the town fell.`, cls: 'bad', region: e.region } : null;
    case 'strait': return null;
    case 'release': {
      if (e.faction !== me) return null;
      const h = (g.hq ?? []).find(x => x.id === e.army), who = h ? h.cmd.name : 'The commander';
      return { text: `${who} sends ${corpsName(me, e.n)} back to you${e.why === 'peace' ? ': the border is at peace' : e.why === 'lost' ? ': the front is lost' : ': the front can spare it'}. It waits in ${R(e.region)}.`, cls: 'me', region: e.region };
    }
    case 'request': {
      if (e.faction !== me || e.urg < 2) return null;
      const h = (g.hq ?? []).find(x => x.id === e.army), who = h ? h.cmd.name : 'A commander';
      const what = e.kind === 'men' ? 'urgently asks for men' : e.kind === 'fallback' ? 'asks permission to fall back' : 'needs an answer';
      return { text: `${who} ${what} at ${R(e.region)}${e.sector >= 0 && e.sector < 1000 ? ` (${R(e.sector)} border)` : ''}. See the Inbox.`, cls: 'bad', region: e.region };
    }
    case 'reqExpired': {
      if (e.faction !== me) return null;
      const h = (g.hq ?? []).find(x => x.id === e.army), who = h ? h.cmd.name : 'A commander', at = R(e.region);
      if (!e.mor) return { text: e.kind === 'attack' ? `No answer came: ${who} gave up his attack from ${at}.` : `No answer came: ${who} keeps the corps he offered back at ${at}.`, cls: '', region: e.region };
      const what = e.kind === 'men' ? `No reinforcements for ${who} at ${at}` : e.kind === 'fort' ? `No field works for ${who} at ${at}` : e.kind === 'recon' ? `No reconnaissance for ${who} at ${at}` : `${who} was not allowed to fall back at ${at}`;
      return { text: `${what}: no answer came. The corps there lose ${e.mor} morale.`, cls: 'bad', region: e.region };
    }
    case 'trained': return e.faction === me ? { text: e.n === 1 ? `1 battalion has finished training in ${R(e.region)}.` : `${e.n} battalions have finished training in ${R(e.region)}.`, cls: '', region: e.region } : null;
    case 'vote': {
      const who = e.faction === me ? 'You' : F(e.faction).name;
      if (e.what === 'call') return { text: e.faction === me ? 'You asked the other players for a pause.' : `${who} asks for a pause.`, cls: 'me' };
      if (e.what === 'carried') return { text: 'The pause was agreed: the war stands still for a minute.', cls: 'me' };
      if (e.what === 'refused') return { text: 'No majority for a pause: the war goes on.', cls: '' };
      return { text: 'The pause is over.', cls: '' };
    }
    case 'seaBattle': {
      const side = e.sides.findIndex(s => s.includes(me)); if (side < 0) return null;
      const foe = e.sides[1 - side].map(f => F(f).short).join(', ');
      if (e.start) return { text: `Naval battle in the ${Z(e.zone)}: our ships engage the ${foe} fleet.`, cls: 'me' };
      const lost = (i: number) => { const s = e.sunk[i] ?? {}; const n = (s.dn ?? 0) + (s.cv ?? 0), d = s.dd ?? 0, t = (s.tr ?? 0) + (s.lc ?? 0); return [n ? `${n} capital ship${n === 1 ? '' : 's'}` : '', d ? `${d} destroyer${d === 1 ? '' : 's'}` : '', t ? `${t} transport${t === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') || 'nothing'; };
      const res = e.winner === side ? 'the enemy breaks off' : e.winner === 1 - side ? 'our fleet withdraws' : 'neither side gives way';
      return { text: `Battle of the ${Z(e.zone)}: ${res}. We lost ${lost(side)}; the ${foe} lost ${lost(1 - side)}.`, cls: e.winner === side ? 'good' : e.winner === 1 - side ? 'bad' : '' };
    }
    default: return null;
  }
}

/** Events a recipient may receive over the network: only those that concern it (spectators, -1: public ones only). */
export function eventsFor(g: GameState, events: GameEvent[], me: number): GameEvent[] {
  return events.filter(e => e.k === 'supply' || e.k === 'over' || e.k === 'start' || describeEvent(g, e, me) !== null);
}
