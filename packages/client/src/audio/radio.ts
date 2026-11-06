// Field radio: turns game events into signal cues (bugles, whistles, alarm bells) and spoken dispatches
// that come in over a crackling line, with the front audible behind the speaker. Between events, the most
// pressing front sends a situation report (dispatches.ts).
// Voices: Kokoro in a worker, filtered like a field telephone (voice.ts, sfx.ts radioVoice); the browser's own
// speech while that loads, when it fails, or on the 'basic' setting.
// German: Kokoro only speaks English, so in German the radio always uses the browser's speech with a German
// voice (the 'neural' setting is kept and comes back when the language is English again).
import { PACES, type GameEvent, type GameState } from '@riskrts/shared';
import { Sfx } from './sfx';
import { Neural, defaultVoiceMode, voiceFor, type VoiceMode } from './voice';
import { dispatchFor, sitrep, type Dispatch, type SitrepMemo } from './dispatches';
import { getLang, onLang } from '../i18n';

export type { Dispatch } from './dispatches';
export { dispatchFor } from './dispatches';

interface Queued extends Dispatch { born: number; audio?: Promise<AudioBuffer | null> }

/** Non-critical messages older than this (seconds) are dropped rather than going stale. */
const STALE = 20;

class RadioOperator {
  /** Off, the browser voice, or the neural field-telephone voice. Signal cues still play when off. */
  mode: VoiceMode = defaultVoiceMode();
  get voice() { return this.mode !== 'off'; }
  /** The line on air (for subtitles), or null. */
  onAir: ((d: Dispatch | null) => void) | null = null;
  private queue: Queued[] = [];
  private busy = false;
  private seen: Record<string, number> = {};
  private speech: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  private picked: SpeechSynthesisVoice | null = null;
  private memo: SitrepMemo = {};
  private nextSit = 25;
  private lastHome = -1e9;

  constructor() {
    // a new language needs a new browser voice, and English may now want the neural one
    onLang(() => {
      this.picked = null; this.choose();
      if (this.neural && Sfx.ctx) Neural.load();
    });
  }

  /** The neural voice is used: set to 'neural' and the language is English (Kokoro speaks only English). */
  private get neural() { return this.mode === 'neural' && getLang() === 'en'; }

  setMode(m: VoiceMode) {
    this.mode = m;
    if (m === 'off') this.reset();
    if (this.neural && Sfx.ctx) Neural.load();
  }

  /** Call from a user gesture once: iOS only lets speech start after one. Starts loading the neural voice. */
  unlock() {
    const s = this.speech;
    if (s) {
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u); } catch { /* not allowed here */ }
      if (!this.picked) { this.choose(); s.onvoiceschanged = () => this.choose(); }
    }
    if (this.neural) Neural.load();
  }

  /** A clipped British officer if there is one, else any English voice. In German: a German man, de-DE first. */
  private choose() {
    const vs = this.speech?.getVoices() ?? []; if (!vs.length) return;
    if (getLang() === 'de') {
      const score = (v: SpeechSynthesisVoice) => {
        let s = 0; const n = v.name.toLowerCase(), l = v.lang.replace('_', '-');
        if (/^de-DE$/i.test(l)) s += 6; else if (/^de\b/i.test(l)) s += 3; else return -1;
        if (/conrad|killian|stefan|markus|yannick|hans|jonas|ralf|florian|bernd|christoph|kasper|klaus|male|männlich/.test(n)) s += 3;
        if (/female|weiblich|katja|amala|anna|petra|helena|hedda|marlene|vicki|sabine|elke|louisa|gisela|seraphina|tanja/.test(n)) s -= 1;
        if (/natural|neural|enhanced|premium|online/.test(n)) s += 2;
        if (/novelty|whisper|bad news|bubbles|cellos|zarvox|trinoids|bells|boing/.test(n)) s -= 20;
        return s;
      };
      const best = vs.slice().sort((a, b) => score(b) - score(a))[0];
      this.picked = best && score(best) >= 0 ? best : null;
      return;
    }
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
    if (e.k === 'start') { this.memo = {}; this.nextSit = g.time + 30; this.lastHome = -1e9; }
    const d = dispatchFor(g, e, me); if (!d) return;
    if (!this.fresh(d)) return;
    if (d.stinger) Sfx.stinger(d.stinger);
    this.send(d, d.stinger ? 1100 : 300);
    // an event call counts as news from that front: hold the next situation report back a little
    this.nextSit = Math.max(this.nextSit, g.time + 12);
  }

  /** Called ~5×/s with the current state: sends a situation report every 30–60 s (scaled by pace) when the line is free. */
  tick(g: GameState, me: number) {
    if (me < 0 || g.time < this.nextSit) return;
    const pace = PACES[g.cfg?.pace ?? 1]?.move ?? 1;
    if (this.busy || this.queue.length) { this.nextSit = g.time + 5; return; }
    const battles = g.battles.some(b => !b.ended && b.sides.includes(me));
    this.nextSit = g.time + (30 + Math.random() * 30) * pace;
    if (!battles && g.time - this.lastHome < 120 * pace) return;
    const d = sitrep(g, me, this.memo); if (!d || !this.fresh(d)) return;
    if (!battles) this.lastHome = g.time;
    this.send(d, 200);
  }

  private fresh(d: Dispatch) {
    if (!d.key) return true;
    const now = performance.now() / 1000;
    if (now - (this.seen[d.key] ?? -1e9) < (d.cool ?? 0) && d.pri < 2) return false;
    this.seen[d.key] = now; return true;
  }

  /** Queue a dispatch. The queue keeps the three most urgent; low-priority chatter is dropped rather than going stale. */
  send(d: Dispatch, delay = 300) {
    if (typeof document !== 'undefined' && document.hidden) return;
    const q: Queued = { ...d, born: performance.now() / 1000 };
    // start synthesising right away, so the voice is ready by the time the stinger and morse are done
    if (this.neural && Neural.state === 'ready') q.audio = Neural.say(q.say, q.who, q.voice);
    this.queue.push(q); this.queue.sort((a, b) => b.pri - a.pri);
    if (this.queue.length > 3) this.queue.length = 3;
    if (!this.busy) { this.busy = true; setTimeout(() => this.next(), delay); }
  }

  /** Drop everything (leaving a game). */
  reset() { this.queue.length = 0; this.memo = {}; try { this.speech?.cancel(); } catch { /* ignore */ } this.onAir?.(null); }

  private next() {
    const now = performance.now() / 1000;
    this.queue = this.queue.filter(q => q.pri >= 3 || now - q.born < STALE);
    const d = this.queue.shift(); if (!d) { this.busy = false; return; }
    this.busy = true;
    if (!Sfx.on) { this.busy = false; this.queue.length = 0; return; }
    Sfx.duck(true);
    const close = Sfx.radioOpen(d.front);
    this.onAir?.(d);
    let done = false;
    const finish = () => {
      if (done) return; done = true; close?.(); Sfx.duck(false); this.onAir?.(null);
      setTimeout(() => this.next(), 650);
    };
    const pre = d.morse ? Sfx.morse(d.morse) + .15 : .35;
    const t0 = performance.now();
    setTimeout(async () => {
      if (this.mode === 'off') { setTimeout(finish, 900); return; }
      if (this.neural) {
        // wait for the neural voice (it was started when queued), but never more than ~5 s of dead air
        const buf = await Promise.race([d.audio ?? Neural.say(d.say, d.who, d.voice), new Promise<null>(r => setTimeout(() => r(null), Math.max(1500, 5000 - (performance.now() - t0))))]);
        if (buf) { const len = Sfx.radioVoice(buf, d.front); setTimeout(finish, len * 1000 + 250); return; }
      }
      this.browserSay(d, finish);
    }, pre * 1000);
  }

  private browserSay(d: Dispatch, finish: () => void) {
    if (!this.speech) { setTimeout(finish, 900); return; }
    try {
      const s = this.speech, u = new SpeechSynthesisUtterance(d.say), v = voiceFor(d.who, d.voice);
      if (!this.picked) this.choose();
      if (this.picked) { u.voice = this.picked; u.lang = this.picked.lang; } else u.lang = getLang() === 'de' ? 'de-DE' : 'en-GB';
      u.rate = 1.04 * (v.speed / 1.02); u.pitch = d.who === 'hq' ? .75 : d.who === 'ops' ? .95 : .82 + ((d.voice ?? 0) % 4) * .05; u.volume = 1;
      u.onend = finish; u.onerror = finish;
      s.cancel(); s.speak(u);
      // speech engines sometimes never fire onend; never let the line stay open
      setTimeout(finish, 2500 + d.say.length * 90);
    } catch { finish(); }
  }
}

export const Radio = new RadioOperator();
Sfx.onInit = () => Radio.unlock();
