// Neural radio voice: Kokoro-82M (Apache-2.0) running on WASM in its own thread.
// The model (~90 MB, 8-bit) comes from Hugging Face once and is then cached by the browser.
// Messages in:  { t: 'load' } | { t: 'say', id, text, voice, speed }
// Messages out: { t: 'ready' } | { t: 'progress', p } | { t: 'error', msg } | { t: 'audio', id, pcm, rate } | { t: 'fail', id }
import { KokoroTTS } from 'kokoro-web';

type In = { t: 'load' } | { t: 'say'; id: number; text: string; voice: string; speed: number };

let tts: Promise<KokoroTTS> | null = null;
const files: Record<string, [number, number]> = {};

function load() {
  tts ??= KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8', device: 'wasm',
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files[p.file] = [p.loaded ?? 0, p.total];
      let a = 0, b = 0; for (const [l, t] of Object.values(files)) { a += l; b += t; }
      postMessage({ t: 'progress', p: b ? a / b : 0 });
    },
  });
  tts.then(() => postMessage({ t: 'ready' }), e => { tts = null; postMessage({ t: 'error', msg: String(e?.message ?? e) }); });
  return tts;
}

// One utterance at a time: WASM inference is single-threaded anyway, and order matters for the queue.
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (ev: MessageEvent<In>) => {
  const m = ev.data;
  if (m.t === 'load') { void load(); return; }
  if (m.t === 'say') {
    chain = chain.then(async () => {
      try {
        const k = await load();
        const a = await k.generate(m.text, { voice: m.voice as never, speed: m.speed });
        const pcm = a.audio as Float32Array;
        postMessage({ t: 'audio', id: m.id, pcm, rate: a.sampling_rate }, { transfer: [pcm.buffer] });
      } catch { postMessage({ t: 'fail', id: m.id }); }
    });
  }
};
