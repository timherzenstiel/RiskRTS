// Synthesised sound: no audio files, everything comes from noise, oscillators and a generated reverb.
//
// Graph:  sources -> per-sound out() chain (gain, distance low-pass, stereo pan)
//           -> battle bus / ambience bus / ui bus / radio bus -> master -> compressor -> speakers
//         Battle and ambience also feed a shared "open field" reverb (long tail + hill echo).
// The radio (radio.ts) ducks the battle and ambience buses while a dispatch is on air.

type Bus = 'war' | 'amb' | 'ui' | 'radio';
export type ShotKind = 'inf' | 'mg' | 'art' | 'tank' | 'plane' | 'pill' | 'fort' | 'flak' | 'bunk';
export type Stinger = 'over-the-top' | 'alarm' | 'siren' | 'victory' | 'held' | 'lost' | 'capital-taken' | 'capital-lost'
  | 'toll' | 'declare' | 'orders' | 'triumph' | 'taps' | 'cleared';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const MAX_VOICES = 70;

interface Listener { x: number; z: number; dist: number; hh: number; hw: number; wrap: number }
interface Loop { src: AudioBufferSourceNode[]; g: GainNode; pan?: StereoPannerNode; f?: BiquadFilterNode; osc?: OscillatorNode[] }

class SfxEngine {
  ctx: AudioContext | null = null;
  /** Master on/off (menu → Sound). */
  on = true;
  private last: Record<string, number> = {};
  private voices = 0;
  private master!: GainNode;
  private bus = {} as Record<Bus, GainNode>;
  private revIn!: GainNode;
  private white!: AudioBuffer; private brown!: AudioBuffer;
  private L: Listener = { x: 0, z: 0, dist: 70, hh: 24, hw: 40, wrap: 0 };
  private loops: { wind?: Loop; front?: Loop; tanks?: Loop; planes?: Loop; clank?: number } = {};
  private drumT = 0; private lastLevel = 0;
  /** Runs once, inside the first user gesture (the radio uses it to unlock speech on iOS). */
  onInit: (() => void) | null = null;

  /** Must be called from a user gesture the first time (browsers keep audio locked until then). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const c = this.ctx = new AC();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .25;
      this.master = c.createGain(); this.master.gain.value = 1; this.master.connect(comp); comp.connect(c.destination);
      for (const b of ['war', 'amb', 'ui', 'radio'] as Bus[]) { const g = this.bus[b] = c.createGain(); g.connect(this.master); }
      this.bus.war.gain.value = .9; this.bus.amb.gain.value = .9; this.bus.ui.gain.value = .55; this.bus.radio.gain.value = 1;
      this.white = this.noise(2, false); this.brown = this.noise(3, true);
      const rev = c.createConvolver(); rev.buffer = this.impulse(2.8); this.revIn = c.createGain(); this.revIn.gain.value = .6;
      const revOut = c.createGain(); revOut.gain.value = .55; this.revIn.connect(rev); rev.connect(revOut); revOut.connect(this.bus.war);
      this.startBeds();
    } catch { this.ctx = null; }
    try { this.onInit?.(); } catch { /* speech unavailable */ }
  }

  // ---------------------------------------------------------------- building blocks

  private noise(sec: number, brown: boolean) {
    const c = this.ctx!, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    }
    return b;
  }

  /** Outdoor reverb: a quick hill slap-back around 0.3 s, then a long rolling decay. */
  private impulse(sec: number) {
    const c = this.ctx!, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate), sr = c.sampleRate;
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch), echo = Math.floor(sr * (ch ? .31 : .27));
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = Math.random() * 2 - 1; lp = lp + (w - lp) * (.25 - .2 * (t / sec));
        d[i] = lp * Math.pow(1 - t / sec, 2.6) * (t < .02 ? t / .02 : 1) * .7;
        if (i >= echo && i < echo + sr * .12) d[i] += (Math.random() * 2 - 1) * .32 * Math.exp(-(i - echo) / (sr * .03));
      }
    }
    return b;
  }

  private ok(k: string, gap: number) {
    const t = performance.now(); if (!this.ctx || !this.on || this.ctx.state !== 'running') return false;
    if (t - (this.last[k] || 0) < gap) return false; this.last[k] = t; return true;
  }
  private get live() { return !!this.ctx && this.on && this.ctx.state === 'running'; }

  /** World position -> stereo pan, loudness and muffling, relative to what the camera is looking at. */
  private place(x: number, z: number) {
    const L = this.L; let dx = x - L.x; if (L.wrap) { if (dx > L.wrap) dx -= 2 * L.wrap; if (dx < -L.wrap) dx += 2 * L.wrap; }
    const ux = dx / L.hw, uz = (z - L.z) / L.hh, d = Math.hypot(ux, uz);
    const near = 1 - smooth(5, 34, L.dist) * .75;
    return { pan: clamp(ux, -1, 1) * .8, g: near / (1 + d * d * 1.6), lp: 15000 / (1 + d * 2.4 + smooth(8, 40, L.dist) * 2) };
  }

  /** Output chain for one sound. Disconnects itself after `life` seconds. */
  private out(life: number, x?: number, z?: number, rev = .3, bus: Bus = 'war', vol = 1): GainNode {
    const c = this.ctx!, g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass';
    let gain = vol, pan = 0;
    if (x !== undefined && z !== undefined) { const p = this.place(x, z); gain *= p.g; pan = p.pan; f.frequency.value = p.lp; } else f.frequency.value = 16000;
    g.gain.value = gain; g.connect(f);
    let tail: AudioNode = f;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; f.connect(p); tail = p; }
    tail.connect(this.bus[bus]);
    let send: GainNode | null = null;
    if (rev > 0) { send = c.createGain(); send.gain.value = rev; tail.connect(send); send.connect(this.revIn); }
    this.voices++;
    setTimeout(() => { this.voices--; try { tail.disconnect(); send?.disconnect(); } catch { /* already gone */ } }, (life + .4) * 1000);
    return g;
  }
  private full() { return this.voices > MAX_VOICES; }

  /** Filtered noise hit. */
  private hit(to: AudioNode, t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', buf = this.white, rate = 1, attack = .002, sweep?: number) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate * rand(.85, 1.15);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(.0005, t + attack + dur);
    s.connect(f); f.connect(g); g.connect(to); s.start(t, Math.random() * (buf.duration - dur - .1)); s.stop(t + attack + dur + .05);
  }

  /** Pitched blip with a pitch glide. */
  private tone(to: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', attack = .003) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(.0005, t + attack + dur);
    o.connect(g); g.connect(to); o.start(t); o.stop(t + attack + dur + .05);
  }

  private loop(bus: Bus, buf: AudioBuffer, freq: number, q: number, type: BiquadFilterType = 'bandpass', rev = 0): Loop {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g);
    let tail: AudioNode = g, pan: StereoPannerNode | undefined;
    if (c.createStereoPanner) { pan = c.createStereoPanner(); g.connect(pan); tail = pan; }
    tail.connect(this.bus[bus]);
    if (rev) { const r = c.createGain(); r.gain.value = rev; tail.connect(r); r.connect(this.revIn); }
    s.start(0, Math.random() * buf.duration);
    return { src: [s], g, pan, f };
  }

  private startBeds() {
    const c = this.ctx!;
    // wind over the map, stronger when zoomed out; its filter drifts so it gusts
    this.loops.wind = this.loop('amb', this.white, 420, .6);
    // the low growl of the front: brown noise, swells with the number of battles
    this.loops.front = this.loop('amb', this.brown, 160, .5, 'lowpass', .3);
    // tank engines: two detuned saws through a low-pass, plus track clatter scheduled in level()
    const tk = this.loop('war', this.brown, 140, .7, 'lowpass', .15); tk.f!.frequency.value = 260;
    tk.osc = [30, 44.5].map(fr => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const g = c.createGain(); g.gain.value = .35; o.connect(g); g.connect(tk.f!); o.start(); return o; });
    this.loops.tanks = tk;
    // biplane rotary engines: beating saws, chopped by a propeller-rate tremolo
    const pl = this.loop('war', this.white, 700, .4, 'lowpass', .2); const trem = c.createGain(); trem.gain.value = .6;
    pl.f!.disconnect(); pl.f!.connect(trem); trem.connect(pl.g);
    const lfo = c.createOscillator(); lfo.frequency.value = 23; const lg = c.createGain(); lg.gain.value = .4; lfo.connect(lg); lg.connect(trem.gain); lfo.start();
    pl.osc = [98, 101.5, 196].map((fr, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const g = c.createGain(); g.gain.value = i === 2 ? .08 : .22; o.connect(g); g.connect(pl.f!); o.start(); return o; });
    pl.osc.push(lfo);
    this.loops.planes = pl;
  }

  private set(p: AudioParam, v: number, tc = .25) { if (this.ctx) p.setTargetAtTime(v, this.ctx.currentTime, tc); }

  // ---------------------------------------------------------------- camera / ambience (called every frame)

  /** Where the camera looks: focus point, zoom distance, visible half height/width in world units, and the map's half width (for date-line wrap). */
  listen(x: number, z: number, dist: number, hh: number, hw: number, wrap = 0) { const L = this.L; L.x = x; L.z = z; L.dist = dist; L.hh = hh; L.hw = hw; L.wrap = wrap; }

  /** Ambience for the whole front: wind, the low growl of war, and distant drumfire on the horizon. */
  level(battles: number, dist: number) {
    if (!this.ctx) return;
    const now = performance.now(), dt = Math.min(.1, (now - (this.lastLevel || now)) / 1000); this.lastLevel = now;
    const on = this.live ? 1 : 0, far = smooth(15, 120, dist), { wind, front } = this.loops;
    if (wind) {
      const gust = .5 + .5 * Math.sin(now / 3100) * Math.sin(now / 1700 + 1);
      this.set(wind.g.gain, on * (.018 + far * .05) * (.6 + gust * .6), .6); this.set(wind.f!.frequency, 300 + gust * 500, .8);
      if (wind.pan) this.set(wind.pan.pan, Math.sin(now / 5300) * .5, 1);
    }
    if (front) this.set(front.g.gain, on * (.03 + Math.min(.16, battles * .03)) * (.55 + far * .45), .8);
    // distant guns: a few per second when the front is busy, panned somewhere across the horizon
    if (on && battles > 0) {
      this.drumT -= dt * Math.min(5, battles * .9) * (.6 + far * .6);
      if (this.drumT <= 0) { this.drumT = rand(.4, 1.6); this.distantGun(rand(-.9, .9), rand(.4, 1) * (.5 + far * .5)); }
    }
  }

  /** Silence every ambience and engine bed until the next level() / engines() call. */
  hush() { for (const l of Object.values(this.loops)) if (l && typeof l === 'object') this.set(l.g.gain, 0, .3); }

  /** Engine noise of tanks and aircraft on screen. Counts are in view; pan is -1..1. */
  engines(tanks: number, tankPan: number, planes: number, planePan: number) {
    const { tanks: tk, planes: pl } = this.loops; if (!tk || !pl || !this.ctx) return;
    const on = this.live ? 1 : 0, near = 1 - smooth(5, 34, this.L.dist) * .8;
    const tg = on * Math.min(1, Math.sqrt(tanks / 6)) * .14 * near, pg = on * Math.min(1, Math.sqrt(planes / 5)) * .1 * (.4 + near * .6);
    this.set(tk.g.gain, tg, .4); this.set(pl.g.gain, pg, .4);
    if (tk.pan) this.set(tk.pan.pan, clamp(tankPan, -1, 1) * .7, .5);
    if (pl.pan) this.set(pl.pan.pan, clamp(planePan, -1, 1) * .8, .3);
    const t = this.ctx.currentTime;
    if (pl.osc) for (let i = 0; i < 3; i++) pl.osc[i].frequency.setTargetAtTime([98, 101.5, 196][i] * (1 + Math.sin(t * .7 + i) * .03), t, .3);
    // track clatter: random metallic ticks while tanks are moving in view
    // (fed into the engine bed's gain, so it follows its level and pan)
    if (tg > .01 && Math.random() < .35) this.hit(tk.g, t, .03, rand(1800, 3200), 9, .8, 'bandpass');
  }

  // ---------------------------------------------------------------- battle sounds (world positions)

  /** One shot from a unit. Rifles crack, machine guns rattle a short burst, tank guns bark. */
  shot(kind: ShotKind, x: number, z: number, air = false) {
    if (!this.live || this.full()) return;
    const c = this.ctx!, t = c.currentTime;
    if (kind === 'mg' || kind === 'pill' || kind === 'bunk' || kind === 'plane') {
      if (!this.ok('mg', 110)) return;
      const n = 3 + Math.floor(Math.random() * 4), sp = rand(.06, .075), o = this.out(n * sp + .3, x, z, .35, 'war', kind === 'plane' ? .7 : 1);
      for (let i = 0; i < n; i++) { const ti = t + i * sp + rand(0, .006); this.hit(o, ti, .012, 4200, .7, .4, 'highpass'); this.hit(o, ti, .055, rand(650, 850), 1.3, .62); }
    } else if (kind === 'tank') {
      if (!this.ok('tank', 120)) return;
      const o = this.out(.8, x, z, .45);
      this.hit(o, t, .02, 3000, .7, .35, 'highpass'); this.hit(o, t, .4, 900, .7, .4, 'lowpass', this.white, 1, .002, 180); this.tone(o, t, 140, 50, .25, .35);
    } else {
      if (!this.ok('rifle', air ? 70 : 45)) return;
      const o = this.out(.5, x, z, .4, 'war', air ? .6 : 1);
      this.hit(o, t, .018, 3200, .6, .5, 'highpass'); this.hit(o, t, .11, rand(900, 1500), 1.1, .38); this.tone(o, t, 190, 80, .05, .18);
    }
  }

  /** A field gun or emplacement fires: a deep report, then (when the flight is long enough to hear) the shell's whistle at the landing spot. */
  gun(x: number, z: number, tx?: number, tz?: number, flightSec = 0) {
    if (!this.live || this.full() || !this.ok('gun', 130)) return;
    const c = this.ctx!, t = c.currentTime, o = this.out(1.6, x, z, .7);
    this.hit(o, t, .03, 2200, .6, .45, 'highpass');
    this.tone(o, t, 95, 32, .55, .55); this.tone(o, t, 48, 26, .7, .35, 'triangle');
    this.hit(o, t, 1.1, 500, .6, .5, 'lowpass', this.brown, 1, .004, 120);
    if (tx !== undefined && tz !== undefined && flightSec > .45 && Math.random() < .7 && this.ok('whistle', 260)) this.whistle(tx, tz, t + Math.max(0, flightSec - Math.min(1.3, flightSec * .85)), Math.min(1.3, flightSec * .85));
  }

  /** Incoming shell: a falling whistle that cuts off right before the impact. */
  private whistle(x: number, z: number, t0: number, len: number) {
    const c = this.ctx!, o = this.out(t0 - c.currentTime + len + .2, x, z, .25, 'war', .9), f0 = rand(2000, 2600), f1 = f0 * rand(.3, .4);
    const osc = c.createOscillator(), g = c.createGain(); osc.frequency.setValueAtTime(f0, t0); osc.frequency.exponentialRampToValueAtTime(f1, t0 + len);
    g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.09, t0 + len - .05); g.gain.linearRampToValueAtTime(0, t0 + len);
    osc.connect(g); g.connect(o); osc.start(t0); osc.stop(t0 + len + .05);
    this.hit(o, t0, len, f0 * .8, 6, .05, 'bandpass', this.white, 1, len * .9, f1 * .8);
  }

  /** Shell impact or a vehicle going up. `s` ~ 1 is a field-gun shell. */
  boom(x: number, z: number, s = 1) {
    if (!this.live || this.full() || !this.ok('boom', 80)) return;
    const c = this.ctx!, t = c.currentTime, k = clamp(s, .4, 1.6), o = this.out(2.2, x, z, .8);
    this.hit(o, t, .04, 1600, .5, .5 * k, 'highpass');
    this.tone(o, t, 80, 26, .8 * k, .6 * k); this.tone(o, t + .01, 40, 22, 1, .35 * k, 'triangle');
    this.hit(o, t, 1.4 * k, 900, .5, .55 * k, 'lowpass', this.brown, 1, .003, 110);
    this.hit(o, t + .02, .5, 2200, .5, .12 * k, 'bandpass', this.white, 1, .01, 500);
    // dirt and stones raining back down
    for (let i = 0, n = 3 + Math.floor(Math.random() * 5); i < n; i++) this.hit(o, t + rand(.25, 1.1), .02, rand(2500, 5000), 1.5, rand(.03, .08) * k, 'bandpass');
  }

  /** Anti-aircraft shell bursting overhead. */
  flak(x: number, z: number) {
    if (!this.live || this.full() || !this.ok('flak', 120)) return;
    const c = this.ctx!, t = c.currentTime, o = this.out(1, x, z, .6, 'war', .8);
    this.hit(o, t, .015, 3000, .6, .3, 'highpass'); this.hit(o, t, .35, 520, 1.6, .4, 'bandpass', this.white, 1, .002, 260); this.tone(o, t, 240, 110, .18, .2);
  }

  /** A battle far away on the operations map: a muffled thud. Optional world position for panning. */
  rumble(v = 1, x?: number, z?: number) {
    if (!this.live || this.full() || !this.ok('rumble', 220)) return;
    const pan = x !== undefined && z !== undefined ? this.place(x, z).pan : rand(-.6, .6);
    this.distantGun(pan, clamp(v, .1, 1));
  }

  private distantGun(pan: number, v: number) {
    if (!this.live || this.full()) return;
    const c = this.ctx!, t = c.currentTime, o = this.out(2, undefined, undefined, .9, 'amb', v * .5);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = rand(220, 420); f.connect(o);
    let into: AudioNode = f; if (p) { p.pan.value = pan; p.connect(f); into = p; }
    this.tone(into, t, rand(60, 80), 24, 1.1, .5); this.hit(into, t, rand(1, 1.8), 300, .5, .6, 'lowpass', this.brown, 1, .01, 90);
    // sometimes a ripple: the rest of the battery a moment later
    if (Math.random() < .3) for (let i = 1; i < 3; i++) this.hit(into, t + i * rand(.25, .5), rand(.8, 1.3), 260, .5, .4, 'lowpass', this.brown, 1, .01, 80);
  }

  // ---------------------------------------------------------------- interface

  /** Relay click for buttons and selection. */
  click() { if (!this.ok('click', 40)) return; const t = this.ctx!.currentTime, o = this.out(.1, undefined, undefined, 0, 'ui'); this.hit(o, t, .008, 3800, .8, .25, 'highpass'); this.tone(o, t, 1700, 900, .02, .1, 'triangle'); }
  /** Metal clunk of a sidebar tab or switch plate. */
  clunk() { if (!this.ok('clunk', 60)) return; const t = this.ctx!.currentTime, o = this.out(.25, undefined, undefined, .04, 'ui', .8); this.hit(o, t, .05, 420, 1.4, .5, 'bandpass', this.brown); this.tone(o, t, 210, 150, .06, .14, 'square'); this.hit(o, t + .012, .01, 3200, 1, .12, 'highpass'); }
  /** Ratchet of the barrage lever: a few quick clicks. */
  ratchet() { if (!this.ok('ratchet', 120)) return; const t = this.ctx!.currentTime, o = this.out(.35, undefined, undefined, .03, 'ui', .8); for (let k = 0; k < 4; k++) this.hit(o, t + k * .028, .006, 2600 - k * 200, 2, .3, 'bandpass'); this.tone(o, t + .1, 180, 120, .05, .12, 'square'); }
  /** Teletype chatter for a new dispatch on the ticker. */
  teletype() { if (!this.ok('teletype', 900)) return; const t = this.ctx!.currentTime, o = this.out(.6, undefined, undefined, .02, 'ui', .45); for (let k = 0; k < 7; k++) this.hit(o, t + k * .045 + Math.random() * .015, .005, 3000 + Math.random() * 1500, 1.5, .18, 'bandpass'); }
  /** Rubber stamp on an order: march, air strike, assault. */
  order() { if (!this.ok('order', 90)) return; const t = this.ctx!.currentTime, o = this.out(.3, undefined, undefined, .05, 'ui'); this.hit(o, t, .09, 260, .7, .9, 'lowpass', this.brown); this.hit(o, t, .012, 2600, .8, .25, 'highpass'); this.tone(o, t, 130, 70, .08, .3); }
  /** Field-telephone buzzer: the order was refused. */
  deny() {
    if (!this.ok('deny', 150)) return; const c = this.ctx!, t = c.currentTime, o = this.out(.4, undefined, undefined, 0, 'ui', .5);
    const osc = c.createOscillator(), am = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(); osc.type = 'square'; osc.frequency.value = 155; lfo.frequency.value = 28; lg.gain.value = .5; am.gain.value = .5;
    lfo.connect(lg); lg.connect(am.gain); osc.connect(am); const e = c.createGain(); e.gain.setValueAtTime(.12, t); e.gain.setValueAtTime(.12, t + .16); e.gain.linearRampToValueAtTime(0, t + .2); am.connect(e); e.connect(o);
    osc.start(t); lfo.start(t); osc.stop(t + .22); lfo.stop(t + .22);
  }
  /** Supply convoy: a quick telegraph sounder click-clack and a small bell. Kept soft, it comes every few seconds. */
  supply() {
    if (!this.ok('supply', 500)) return; const t = this.ctx!.currentTime, o = this.out(1.2, undefined, undefined, .1, 'ui', .7);
    for (const [dt, f] of [[0, 2400], [.09, 1800], [.2, 2400], [.27, 1800]] as const) this.hit(o, t + dt, .02, f, 4, .2, 'bandpass');
    this.bell(o, t + .38, 1320, .9, .08);
  }

  // ---------------------------------------------------------------- stingers (one-off musical / signal cues)

  private brass(to: AudioNode, t: number, f: number, dur: number, gain: number) {
    const c = this.ctx!, lp = c.createBiquadFilter(), g = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(f * 5, t + .05); lp.frequency.exponentialRampToValueAtTime(f * 3, t + dur);
    gain *= 1.8; g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(gain, t + .035); g.gain.setValueAtTime(gain * .8, t + dur * .7); g.gain.exponentialRampToValueAtTime(.0005, t + dur + .12);
    vib.frequency.value = 5.5; vg.gain.value = f * .006; vib.connect(vg);
    for (const [type, mul, gv] of [['sawtooth', 1, .6], ['square', 1.002, .3], ['sawtooth', .5, .2]] as const) {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f * mul; og.gain.value = gv; vg.connect(o.frequency);
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + .2);
    }
    vib.start(t); vib.stop(t + dur + .2); lp.connect(g); g.connect(to);
  }
  private bell(to: AudioNode, t: number, f: number, dur: number, gain: number) {
    for (const [m, gv, d] of [[.5, .5, 1.4], [1, 1, 1], [1.19, .45, .7], [1.5, .35, .6], [2, .3, .5], [2.76, .18, .35], [4.07, .1, .2]]) this.tone(to, t, f * m, f * m * .998, dur * d, gain * gv, 'sine', .002);
  }
  private drum(to: AudioNode, t: number, gain: number) { this.tone(to, t, 110, 55, .5, gain); this.hit(to, t, .35, 400, .6, gain * .8, 'lowpass', this.brown); this.hit(to, t, .12, 1600, 1, gain * .25, 'bandpass'); }
  private trill(to: AudioNode, t: number, dur: number, gain: number) {
    const c = this.ctx!, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.frequency.value = 2950; lfo.frequency.value = 34; lg.gain.value = 260; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(gain, t + .02); g.gain.setValueAtTime(gain, t + dur - .04); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(to); o.start(t); lfo.start(t); o.stop(t + dur + .02); lfo.stop(t + dur + .02);
    this.hit(to, t, dur, 3000, 3, gain * .25, 'bandpass', this.white, 1, .01);
  }
  private siren(to: AudioNode, t: number, dur: number, gain: number) {
    const c = this.ctx!, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o2.type = 'triangle';
    for (const x of [o, o2]) { x.frequency.setValueAtTime(220, t); x.frequency.exponentialRampToValueAtTime(640, t + dur * .55); x.frequency.exponentialRampToValueAtTime(300, t + dur); }
    o2.detune.value = 1200; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * .4); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(to); o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
  }

  /** Play a signal or musical cue. Most go through the reverb so they sound like they come from across the lines. */
  stinger(kind: Stinger) {
    if (!this.live || !this.ok('st-' + kind, kind === 'over-the-top' ? 2500 : 1200)) return;
    const t = this.ctx!.currentTime + .02, o = this.out(7, undefined, undefined, .5, 'ui', 1.2);
    // bugle notes: the harmonic series of a B-flat bugle
    const G4 = 392, C5 = 523.25, E5 = 659.25, G5 = 784, C4 = 261.6, Eb4 = 311.1, G3 = 196;
    const tune = (notes: [number, number][], gap = .02, gain = .09) => { let at = t; for (const [f, d] of notes) { this.brass(o, at, f, d, gain); at += d + gap; } return at; };
    switch (kind) {
      case 'over-the-top': this.trill(o, t, .45, .07); this.trill(o, t + .6, .8, .08); break;
      case 'alarm': for (let i = 0; i < 14; i++) this.bell(o, t + i * .055, 1750, .25, .06); break;
      case 'siren': this.siren(o, t, 2.4, .08); break;
      case 'victory': tune([[G4, .13], [C5, .13], [E5, .13], [G5, .55]]); break;
      case 'held': tune([[C5, .12], [E5, .12], [G5, .4]], .02, .075); break;
      case 'cleared': tune([[E5, .12], [G5, .35]], .02, .06); break;
      case 'lost': this.drum(o, t, .25); this.drum(o, t + .45, .2); tune([[G4, .5], [Eb4, .5], [C4, 1]], .05, .07); break;
      case 'capital-taken': { const e = tune([[G4, .12], [G4, .12], [C5, .12], [E5, .12], [G5, .3], [E5, .14], [G5, .7]]); this.bell(o, e, 660, 2.5, .07); break; }
      case 'capital-lost': for (let i = 0; i < 3; i++) this.bell(o, t + i * 1.6, 220, 3, .13); this.drum(o, t, .25); break;
      case 'toll': this.bell(o, t, 196, 3.5, .14); break;
      case 'declare': { for (let i = 0; i < 8; i++) this.drum(o, t + i * .09, .08 + i * .015); tune([[G3, .2], [C4, .2], [E5 / 2, .2], [G4, .5], [E5 / 2, .2], [G4, .8]], .03, .09); break; }
      case 'orders': for (const [dt, d] of [[0, .08], [.13, .25], [.43, .08], [.56, .08]]) this.tone(o, t + dt, 720, 720, d, .13, 'sine', .004); break;
      case 'triumph': { const e = tune([[C5, .15], [E5, .15], [G5, .3], [E5, .15], [G5, .3], [C5 * 2, .9]], .02, .1); this.bell(o, e - .5, 523, 3, .08); this.bell(o, e + .3, 784, 3, .06); break; }
      case 'taps': tune([[G4, .35], [G4, .2], [C5, 1.2], [G4, .35], [C5, .2], [E5, 1.4]], .1, .07); break;
    }
  }

  // ---------------------------------------------------------------- radio support (used by radio.ts)

  /** Lower battle and ambience while a dispatch is on air. */
  duck(on: boolean) { if (!this.ctx) return; this.set(this.bus.war.gain, on ? .35 : .9, .15); this.set(this.bus.amb.gain, on ? .4 : .9, .15); }

  /** Start the radio carrier: squelch, hiss and crackle, optionally the sounds of the front behind the speaker. Returns a stop function. */
  radioOpen(front: number): (() => void) | null {
    if (!this.live) return null;
    const c = this.ctx!, t = c.currentTime, bus = this.bus.radio;
    // telephone-band filter everything on the line passes through
    const band = c.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1400; band.Q.value = .8;
    const shelf = c.createBiquadFilter(); shelf.type = 'highpass'; shelf.frequency.value = 350; band.connect(shelf); shelf.connect(bus);
    const line = c.createGain(); line.gain.value = 1; line.connect(band);
    // squelch open
    this.hit(bus, t, .12, 2500, .8, .2, 'bandpass'); this.tone(bus, t, 1200, 1200, .03, .05, 'square');
    const hiss = c.createBufferSource(); hiss.buffer = this.white; hiss.loop = true; const hg = c.createGain();
    hg.gain.setValueAtTime(0, t); hg.gain.linearRampToValueAtTime(.045, t + .1); hiss.connect(hg); hg.connect(line); hiss.start(t, Math.random());
    // slow fading of the carrier, like a distant transmitter
    const fade = c.createOscillator(), fg = c.createGain(); fade.frequency.value = .35; fg.gain.value = .015; fade.connect(fg); fg.connect(hg.gain); fade.start(t);
    let alive = true;
    const crackle = () => {
      if (!alive || !this.ctx) return; const n = this.ctx.currentTime;
      if (Math.random() < .6) this.hit(line, n, rand(.004, .02), rand(1500, 4000), 1, rand(.05, .2), 'bandpass');
      if (front > 0 && Math.random() < .25 * front) {
        const r = Math.random();
        if (r < .5) this.hit(line, n, .09, rand(900, 1400), 1.2, .25 * front);
        else if (r < .8) for (let i = 0; i < 4; i++) { this.hit(line, n + i * .07, .05, 800, 1.3, .2 * front); }
        else { this.tone(line, n, 90, 40, .6, .4 * front); this.hit(line, n, .8, 600, .6, .5 * front, 'lowpass', this.brown); }
      }
      setTimeout(crackle, rand(60, 180));
    };
    crackle();
    return () => {
      alive = false; if (!this.ctx) return; const e = this.ctx.currentTime;
      hg.gain.cancelScheduledValues(e); hg.gain.setValueAtTime(hg.gain.value, e); hg.gain.linearRampToValueAtTime(0, e + .08);
      this.hit(bus, e, .18, 2000, .7, .22, 'bandpass'); // squelch tail "kssht"
      hiss.stop(e + .2); fade.stop(e + .2); setTimeout(() => { try { line.disconnect(); band.disconnect(); shelf.disconnect(); } catch { /* gone */ } }, 600);
    };
  }

  /** Morse on the radio line: '.' and '-' with spaces between letters. */
  morse(code: string, wpm = 22) {
    if (!this.live) return 0;
    const c = this.ctx!, dot = 1.2 / wpm, f = 760, o = this.out(code.length * dot * 3 + .5, undefined, undefined, 0, 'radio', .9);
    let t = c.currentTime + .05;
    for (const ch of code) {
      if (ch === ' ') { t += dot * 2; continue; }
      const d = ch === '-' ? dot * 3 : dot, g = c.createGain(), osc = c.createOscillator(); osc.frequency.value = f; osc.type = 'sine';
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .004); g.gain.setValueAtTime(.07, t + d - .004); g.gain.linearRampToValueAtTime(0, t + d);
      osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + d + .01); t += d + dot;
    }
    return t - c.currentTime;
  }
}

export const Sfx = new SfxEngine();
