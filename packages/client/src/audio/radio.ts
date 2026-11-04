// Field radio: turns game events into signal cues (bugles, whistles, alarm bells) and spoken dispatches
// that come in over a crackling line, with the front audible behind the speaker.
// The voice is the browser's speech synthesis; everything around it is synthesised in sfx.ts.
import { FACTIONS, world, type GameEvent, type GameState } from '@riskrts/shared';
import { Sfx, type Stinger } from './sfx';

/** How people at the front name each power. */
const DEMONYM: Record<string, string> = { GB: 'the British', FR: 'the French', RU: 'the Russians', DE: 'the Germans', AH: 'the Austrians', OT: 'the Ottomans' };

export interface Dispatch {
  /** What the voice says. */
  say: string;
  /** Higher plays first and survives a full queue. 3 = critical (capital, elimination, game over). */
  pri: number;
  /** 0..1: how loud the battle is behind the speaker. */
  front: number;
  /** Morse heard before the voice, e.g. '...-' (V for victory). */
  morse?: string;
  stinger?: Stinger;
  /** Repeat-suppression key and cooldown in seconds. */
  key?: string; cool?: number;
}

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const CALL = ['Headquarters', 'Command', 'H Q', 'General Staff'] as const;
const SIGN = ['Over.', 'Over.', 'Over and out.', ''] as const;

/** Decide what (if anything) the radio says about an event, from the point of view of faction `me`. */
export function dispatchFor(g: GameState, e: GameEvent, me: number): Dispatch | null {
  const R = (i: number) => world().regions[i].name, D = (i: number) => DEMONYM[FACTIONS[i].key] ?? FACTIONS[i].the;
  const hq = pick(CALL), over = pick(SIGN);
  switch (e.k) {
    case 'start': return { say: 'All stations, all stations. War has been declared. Open your sealed orders and stand by.', pri: 3, front: 0, morse: '-.-. --.-', stinger: 'declare' };
    case 'air':
      if (e.faction === me || g.regions[e.to].owner !== me) return null;
      return { say: pick([`Air raid warning! Enemy aircraft approaching ${R(e.to)}!`, `${hq}, enemy planes sighted, heading for ${R(e.to)}. Man the guns!`, `Aircraft! ${D(e.faction)} are flying on ${R(e.to)}!`]), pri: 2, front: .3, stinger: 'siren', key: 'air', cool: 25 };
    case 'battleStart':
      if (e.attacker === me) return { say: pick([`${hq}, the attack on ${R(e.region)} has begun. The men are going over the top.`, `Whistles have blown at ${R(e.region)}. We are advancing on ${D(e.defender)}.`, `Our assault on ${R(e.region)} is under way. ${over}`]), pri: 0, front: 1, stinger: 'over-the-top', key: 'atk', cool: 14 };
      if (e.defender === me) return { say: pick([`${hq}, ${hq}! ${D(e.attacker)} are attacking ${R(e.region)}! Request reinforcements!`, `Stand to! Enemy assault at ${R(e.region)}. ${D(e.attacker)} are in our wire!`, `Urgent from ${R(e.region)}: we are under attack. ${over}`]), pri: 2, front: 1, stinger: 'alarm', morse: '..- .-. --.', key: 'def-' + e.region, cool: 10 };
      return null;
    case 'battleEnd': {
      const took = e.winner !== null && e.winner !== e.prev;
      if (took && e.winner === me) {
        if (e.capital) return { say: `${hq}, this is the front. We have taken ${R(e.region)}. Their capital has fallen! The enemy is in full retreat.`, pri: 3, front: .5, morse: '...-', stinger: 'capital-taken' };
        const hold = e.holdouts >= 0 ? ' Enemy strongpoints are still holding out on one border.' : '';
        return { say: pick([`${R(e.region)} is ours! ${D(e.prev)} are falling back.${hold} ${over}`, `${hq}, we have captured ${R(e.region)}.${hold} ${over}`, `Victory at ${R(e.region)}. The flag is up.${hold}`]), pri: 1, front: .4, morse: '...-', stinger: 'victory' };
      }
      if (took && e.prev === me) {
        if (e.capital) return { say: `${hq}, ${hq}... the capital has fallen. ${R(e.region)} is in the hands of ${D(e.winner!)}. God help us.`, pri: 3, front: 1, stinger: 'capital-lost' };
        const hold = e.holdouts === me ? ' Some of our positions are still holding out.' : '';
        return { say: pick([`${hq}, we've lost ${R(e.region)}. ${D(e.winner!)} have broken through. We are pulling back.${hold}`, `${R(e.region)} has fallen. Too many of them, we could not hold.${hold} ${over}`, `This is ${R(e.region)}. The line is broken. ${D(e.winner!)} have taken the town.${hold}`]), pri: 2, front: 1, stinger: 'lost' };
      }
      if (!took && e.winner === me && e.prev === me) return { say: pick([`${R(e.region)} holds! The attack has been beaten back.`, `${hq}, enemy assault on ${R(e.region)} repulsed. ${over}`, `They broke against our wire at ${R(e.region)}. The line holds.`]), pri: 1, front: .5, stinger: 'held' };
      if (e.winner === null && (e.prev === me || e.sides.includes(me))) return { say: `${R(e.region)}... there is no one left standing. Both sides are spent.`, pri: 1, front: .2, stinger: 'toll' };
      return null;
    }
    case 'cleared': return e.faction === me ? { say: `The last holdouts in ${R(e.region)} have been silenced. The sector is secure. ${over}`, pri: 1, front: .3, stinger: 'cleared' } : null;
    case 'eliminated':
      if (e.faction === me) return { say: 'All stations. The government has capitulated. Lay down your arms.', pri: 3, front: .2, stinger: 'toll' };
      return { say: pick([`Flash message. ${FACTIONS[e.faction].name} has capitulated.`, `Intercepted signal: ${FACTIONS[e.faction].name} has surrendered.`]), pri: 3, front: 0, morse: '..-. .-.. .- ... ....', stinger: 'toll' };
    case 'newOrders': return e.faction === me ? { say: 'New orders from the General Staff. Your target has fallen to another power. Hold thirty regions.', pri: 2, front: 0, morse: '--- .-. -.. . .-. ...', stinger: 'orders' } : null;
    case 'over':
      if (e.winner === me) return { say: 'All stations. The war is won. Your orders are fulfilled. Ceasefire on all fronts.', pri: 3, front: 0, stinger: 'triumph' };
      return { say: 'All stations. The war is lost. Ceasefire on all fronts.', pri: 3, front: 0, stinger: 'taps' };
    default: return null;
  }
}

class RadioOperator {
  /** Spoken dispatches on/off (menu → Radio voice). Signal cues still play when this is off. */
  voice = true;
  private queue: Dispatch[] = [];
  private busy = false;
  private seen: Record<string, number> = {};
  private speech: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  private picked: SpeechSynthesisVoice | null = null;

  /** Call from a user gesture once: iOS only lets speech start after one. */
  unlock() {
    const s = this.speech; if (!s) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u); } catch { /* not allowed here */ }
    if (!this.picked) { this.choose(); s.onvoiceschanged = () => this.choose(); }
  }

  /** A clipped British officer if there is one, else any English voice. */
  private choose() {
    const vs = this.speech?.getVoices() ?? []; if (!vs.length) return;
    const score = (v: SpeechSynthesisVoice) => {
      let s = 0; const n = v.name.toLowerCase();
      if (v.lang === 'en-GB') s += 6; else if (v.lang.startsWith('en')) s += 3; else return -1;
      if (/daniel|arthur|george|ryan|oliver|uk english male|male/.test(n)) s += 3;
      if (/female|susan|kate|serena|libby|sonia|hazel|martha|stephanie/.test(n)) s -= 1;
      if (/natural|neural|enhanced|premium|online/.test(n)) s += 2;
      if (/novelty|whisper|bad news|bubbles|cellos|zarvox|trinoids|bells|boing/.test(n)) s -= 20;
      return s;
    };
    this.picked = vs.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  /** Feed a game event in. Plays its cue right away and queues the spoken dispatch. */
  event(g: GameState, e: GameEvent, me: number) {
    const d = dispatchFor(g, e, me); if (!d) return;
    const now = performance.now() / 1000;
    if (d.key) { if (now - (this.seen[d.key] ?? -1e9) < (d.cool ?? 0)) { if (d.pri < 2) return; } this.seen[d.key] = now; }
    if (d.stinger) Sfx.stinger(d.stinger);
    this.send(d, d.stinger ? 1100 : 300);
  }

  /** Queue a dispatch. The queue keeps the three most urgent; low-priority chatter is dropped rather than going stale. */
  send(d: Dispatch, delay = 300) {
    if (typeof document !== 'undefined' && document.hidden) return;
    this.queue.push(d); this.queue.sort((a, b) => b.pri - a.pri);
    if (this.queue.length > 3) this.queue.length = 3;
    if (!this.busy) { this.busy = true; setTimeout(() => this.next(), delay); }
  }

  /** Drop everything (leaving a game). */
  reset() { this.queue.length = 0; try { this.speech?.cancel(); } catch { /* ignore */ } }

  private next() {
    const d = this.queue.shift(); if (!d) { this.busy = false; return; }
    this.busy = true;
    if (!Sfx.on) { this.busy = false; this.queue.length = 0; return; }
    Sfx.duck(true);
    const close = Sfx.radioOpen(d.front);
    let done = false;
    const finish = () => {
      if (done) return; done = true; close?.(); Sfx.duck(false);
      setTimeout(() => this.next(), 650);
    };
    const pre = d.morse ? Sfx.morse(d.morse) + .15 : .35;
    const talk = this.voice && !!this.speech;
    setTimeout(() => {
      if (!talk) { setTimeout(finish, 900); return; }
      try {
        const s = this.speech!, u = new SpeechSynthesisUtterance(d.say);
        if (!this.picked) this.choose();
        if (this.picked) { u.voice = this.picked; u.lang = this.picked.lang; } else u.lang = 'en-GB';
        u.rate = 1.06; u.pitch = .82; u.volume = 1;
        u.onend = finish; u.onerror = finish;
        s.cancel(); s.speak(u);
        // speech engines sometimes never fire onend; never let the line stay open
        setTimeout(finish, 2500 + d.say.length * 90);
      } catch { finish(); }
    }, pre * 1000);
  }
}

export const Radio = new RadioOperator();
Sfx.onInit = () => Radio.unlock();
