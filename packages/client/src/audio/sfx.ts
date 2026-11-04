// Synthesised sound: no audio files, everything comes from noise bursts and oscillators.
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

class SfxEngine {
  ctx: AudioContext | null = null; on = true;
  private last: Record<string, number> = {};
  private master!: GainNode; private amb: GainNode | null = null; private buf!: AudioBuffer;

  /** Must be called from a user gesture the first time. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const c = this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.master = c.createGain(); this.master.gain.value = .55; this.master.connect(c.destination);
      const n = c.sampleRate * 2; this.buf = c.createBuffer(1, n, c.sampleRate); const d = this.buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource(); s.buffer = this.buf; s.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
      this.amb = c.createGain(); this.amb.gain.value = .02; s.connect(f); f.connect(this.amb); this.amb.connect(this.master); s.start();
    } catch { this.ctx = null; }
  }
  private ok(k: string, gap: number) { const t = performance.now(); if (!this.ctx || !this.on || this.ctx.state !== 'running') return false; if (t - (this.last[k] || 0) < gap) return false; this.last[k] = t; return true; }
  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.buf; s.playbackRate.value = .8 + Math.random() * .5;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0008, t + dur); s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + .05);
  }
  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0008, t + dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
  }
  shot(v = 1) { if (this.ok('shot', 55)) this.burst(.08, 1500 + Math.random() * 1400, .8, .1 * v); }
  cannon() { if (this.ok('cannon', 140)) { this.burst(.5, 260, .5, .34, 'lowpass'); this.tone(90, 38, .4, .3); } }
  boom(s = 1) { if (this.ok('boom', 90)) { this.burst(.7, 200, .4, .4 * Math.min(1.4, s), 'lowpass'); this.tone(60, 28, .6, .35); } }
  rumble(v = 1) { if (this.ok('rumble', 300)) this.burst(.8, 140, .4, .1 * v, 'lowpass'); }
  chime() { if (this.ok('chime', 500)) { this.tone(660, 660, .5, .07); setTimeout(() => this.ctx && this.tone(990, 990, .6, .06), 110); } }
  horn() { if (this.ok('horn', 2500)) this.tone(196, 176, .7, .07, 'sawtooth'); }
  click() { if (this.ok('click', 40)) this.tone(540, 380, .07, .05, 'triangle'); }
  deny() { if (this.ok('deny', 150)) this.tone(180, 120, .14, .06, 'square'); }
  /** Background battle rumble, scaled by how many battles are running and how close the camera is. */
  level(battles: number, dist: number) { if (this.amb) this.amb.gain.value = lerp(this.amb.gain.value, .015 + Math.min(.07, battles * .012) * (1 - smooth(30, 160, dist) * .5), .05); }
}
export const Sfx = new SfxEngine();
