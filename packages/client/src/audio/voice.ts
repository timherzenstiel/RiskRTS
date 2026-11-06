// Radio voices. 'neural' runs Kokoro in a worker (voice.worker.ts) and returns PCM that sfx.ts pushes
// through a field-telephone chain; 'basic' is the browser's own speech (can't be filtered); 'off' is silent.
import { Sfx } from './sfx';

export type VoiceMode = 'off' | 'basic' | 'neural';
export type Speaker = 'hq' | 'front' | 'ops';

/** Kokoro voices per role. Front officers get a fixed voice per corps so a player learns to know them. */
const HQ = 'bm_george', OPS = 'bm_daniel';
const FRONT = ['bm_lewis', 'bm_fable', 'am_michael', 'bm_daniel', 'am_fenrir', 'am_puck'] as const;

export function voiceFor(who: Speaker, id = 0): { voice: string; speed: number } {
  if (who === 'hq') return { voice: HQ, speed: .95 };
  if (who === 'ops') return { voice: OPS, speed: 1.12 };
  const h = Math.abs(Math.imul(id + 7, 2654435761)) >>> 0;
  return { voice: FRONT[h % FRONT.length], speed: 1.02 + (h % 5) * .03 };
}

/** Default: the neural voice on desktop; the browser voice when the device asks to save data or is a phone. */
export function defaultVoiceMode(): VoiceMode {
  if (typeof navigator === 'undefined') return 'basic';
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return 'basic';
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return 'basic';
  return 'neural';
}

class NeuralVoice {
  /** 'idle' until first use, then 'loading' (with progress 0..1), 'ready' or 'error'. */
  state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  progress = 0;
  onState: (() => void) | null = null;
  private w: Worker | null = null;
  private id = 0;
  private wait = new Map<number, (r: { pcm: Float32Array; rate: number } | null) => void>();

  load() {
    if (this.w || typeof Worker === 'undefined') return;
    try {
      this.w = new Worker(new URL('./voice.worker.ts', import.meta.url), { type: 'module' });
    } catch { this.fail(); return; }
    this.state = 'loading'; this.onState?.();
    this.w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.t === 'progress') { this.progress = m.p; this.onState?.(); }
      else if (m.t === 'ready') { this.state = 'ready'; this.progress = 1; this.onState?.(); }
      else if (m.t === 'error') this.fail();
      else if (m.t === 'audio' || m.t === 'fail') { const r = this.wait.get(m.id); this.wait.delete(m.id); r?.(m.t === 'audio' ? { pcm: m.pcm, rate: m.rate } : null); }
    };
    this.w.onerror = () => this.fail();
    this.w.postMessage({ t: 'load' });
  }

  private fail() {
    this.state = 'error'; this.onState?.();
    for (const r of this.wait.values()) r(null); this.wait.clear();
    try { this.w?.terminate(); } catch { /* gone */ } this.w = null;
  }

  /** Synthesise one line. Resolves to null when the voice isn't ready or synthesis fails. */
  say(text: string, who: Speaker, id = 0): Promise<AudioBuffer | null> {
    if (this.state !== 'ready' || !this.w) return Promise.resolve(null);
    const n = ++this.id, v = voiceFor(who, id);
    return new Promise(res => {
      this.wait.set(n, r => {
        const c = Sfx.ctx;
        if (!r || !c || !r.pcm.length) { res(null); return; }
        try { const b = c.createBuffer(1, r.pcm.length, r.rate); b.copyToChannel(r.pcm as Float32Array<ArrayBuffer>, 0); res(b); } catch { res(null); }
      });
      this.w!.postMessage({ t: 'say', id: n, text, voice: v.voice, speed: v.speed });
    });
  }
}

export const Neural = new NeuralVoice();
