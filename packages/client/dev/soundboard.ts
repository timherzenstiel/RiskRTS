// Dev soundboard: audition every battle sound, ambience bed, signal cue and radio dispatch outside the game.
// Open /dev/soundboard.html on the dev server (npm run dev).
import { FORMATION, UNIT_TYPES, createGame, emptyUnits, frontsOf, step, updateSupplyLines, world, type Battle, type GameEvent, type GameState } from '@riskrts/shared';
import { Sfx, type Stinger } from '../src/audio/sfx';
import { Radio } from '../src/audio/radio';
import { Neural, type VoiceMode } from '../src/audio/voice';
import { dispatchFor, frontReport, homeReport, type Dispatch } from '../src/audio/dispatches';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const W = world(), byName = (n: string) => W.regions.findIndex(r => r.name === n);
const reg = (n: string, fb: number) => { const i = byName(n); return i >= 0 ? i : fb; };
const me = 1;

/** A real little war: France (1) attacks Germany (3) with a corps, so situation reports have a battle to talk about. */
function war(): { g: GameState; b: Battle | null } {
  const g = createGame({ seed: 21, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; }
  const A = reg('France', 0), B = reg('Germany', 1);
  g.regions[A].owner = me; g.regions[A].home = me; g.regions[B].owner = 3; g.regions[B].home = 3;
  g.regions[A].units = { ...emptyUnits(), inf: 14, mg: 3, art: 4 }; g.regions[B].units = { ...emptyUnits(), inf: 10, mg: 3, art: 2 };
  for (const r of [g.regions[A], g.regions[B]]) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men;
  updateSupplyLines(g);
  g.regions[A].deploy = 1; g.regions[A].fr = { [B]: { u: { ...g.regions[A].units, plane: 0 }, n: 7, ord: 2, ready: g.time } };
  g.regions[B].deploy = 1; g.regions[B].fr = { [A]: { u: { ...g.regions[B].units, plane: 0 }, n: 12, ord: 0, since: g.time } };
  for (let i = 0; i < 20 * 90 && !frontsOf(g, B).length; i++) step(g, .05);
  return { g, b: frontsOf(g, B)[0] ?? null };
}
let sim = war();
const g = sim.g;

let dist = 14, hw = 8;
const listen = () => { const hh = .344 * dist; hw = hh * Math.max(.5, innerWidth / innerHeight); Sfx.listen(0, 0, dist, hh, hw); };
const rx = () => (Math.random() * 2 - 1) * hw * .9, rz = () => (Math.random() - .5) * 3;
const wake = () => { Sfx.init(); listen(); };

const shots: Record<string, () => void> = {
  rifle: () => Sfx.shot('inf', rx(), rz()),
  mg: () => Sfx.shot('mg', rx(), rz()),
  tank: () => Sfx.shot('tank', rx(), rz()),
  gun: () => { const x = rx(), tx = -x * .6; Sfx.gun(x, 0, tx, 0, 1.4); setTimeout(() => Sfx.boom(tx, 0, 1), 1400); },
  heavy: () => { const x = rx(), tx = -x * .6; Sfx.gun(x, 0, tx, 0, 2, 1.6); setTimeout(() => Sfx.boom(tx, 0, 1.5), 2000); },
  boom: () => Sfx.boom(rx(), rz(), 1.3),
  flak: () => Sfx.flak(rx(), rz()),
  distant: () => Sfx.rumble(.9, rx() * 3, 0),
  strafe: () => Sfx.shot('plane', rx(), rz()),
  charge: () => Sfx.charge(rx() * .5, 0),
};

let barrage = 0;
/** 12 s of fighting; `n` shots per tick: 1 a skirmish, 4 a big battle (the massed-fire bed comes up). */
function skirmish(n: number) {
  wake(); clearInterval(barrage); const end = performance.now() + 12000;
  if (!ambOn) setAmb(true);
  barrage = window.setInterval(() => {
    if (performance.now() > end) { clearInterval(barrage); return; }
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      if (r < .5) shots.rifle(); else if (r < .75) shots.mg(); else if (r < .83) shots.gun(); else if (r < .93) shots.boom(); else shots.tank();
    }
  }, 90);
}

let ambOn = false, raf = 0;
const val = (id: string) => Number(($(id) as HTMLInputElement).value);
function tick() {
  dist = val('#zoom'); listen();
  Sfx.level(val('#battles'), dist);
  const t = performance.now() / 1000;
  Sfx.engines(val('#tanks'), Math.sin(t * .3) * .6, val('#planes'), Math.sin(t * .9) * .9);
  raf = requestAnimationFrame(tick);
}
function setAmb(on: boolean) {
  wake(); ambOn = on; cancelAnimationFrame(raf);
  if (on) tick(); else Sfx.hush();
  $('#amb').setAttribute('aria-pressed', String(on)); $('#amb').textContent = on ? 'Stop the front' : 'Start the front';
}

const R = (n: string, fb: number) => reg(n, fb);
const B = sim.b?.region ?? R('Germany', 0);
const events: Record<string, GameEvent> = {
  declare: { k: 'start' },
  attack: { k: 'battleStart', region: B, attacker: me, defender: 3 },
  defend: { k: 'battleStart', region: R('Iberia', 0), attacker: 3, defender: me },
  overtop: { k: 'overTop', faction: me, region: B },
  firstline: { k: 'firstLine', faction: me, def: 3, region: B, from: R('France', 0), hold: false },
  surrender: { k: 'surrender', faction: 3, region: B, n: 3 },
  air: { k: 'air', faction: 3, from: 0, to: R('France', 0), units: 3 },
  cut: { k: 'cut', faction: me, region: R('Maghreb', 0) },
  massing: { k: 'massing', faction: 3, region: B, to: R('France', 0), owner: me },
  convoy: { k: 'convoyLost', faction: me, zone: 0, ships: 2, men: 900, by: 'uboat' },
  taken: { k: 'battleEnd', region: R('Poland', 0), winner: me, prev: 3, sides: [me, 3], capital: false, holdouts: -1 },
  lost: { k: 'battleEnd', region: R('Iberia', 0), winner: 3, prev: me, sides: [me, 3], capital: false, holdouts: -1 },
  capital: { k: 'battleEnd', region: B, winner: me, prev: 3, sides: [me, 3], capital: true, holdouts: -1 },
  eliminated: { k: 'eliminated', faction: 5 },
  win: { k: 'over', winner: me },
};

function show(d: Dispatch) { $('#wire').textContent = d.say; $('#wire').classList.remove('tick'); void $('#wire').offsetWidth; $('#wire').classList.add('tick'); }

/** Situation report from the running battle (advanced 20 s each press), from either side. */
function sitrep(side: number) {
  wake();
  if (!sim.b || sim.b.ended) sim = war();
  for (let i = 0; i < 20 * 20 && sim.b && !sim.b.ended; i++) step(sim.g, .05);
  if (!sim.b || sim.b.ended) { sim = war(); for (let i = 0; i < 20 * 10; i++) step(sim.g, .05); }
  const d = sim.b && !sim.b.ended ? frontReport(sim.g, sim.b, side, {}) : homeReport(sim.g, side);
  if (!d) return; show(d); Radio.reset(); Radio.send(d, 200);
}

function voiceUi() {
  const s = $('#vstate'); const m = Radio.mode;
  s.textContent = m !== 'neural' ? '' : Neural.state === 'ready' ? 'Neural voice ready' : Neural.state === 'loading' ? `Loading neural voice… ${Math.round(Neural.progress * 100)}%` : Neural.state === 'error' ? 'Neural voice failed: using the browser voice' : 'Neural voice loads on first sound';
  document.querySelectorAll<HTMLButtonElement>('[data-vm]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vm === m)));
}

function boot() {
  document.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach(b => b.addEventListener('click', () => { wake(); shots[b.dataset.shot!](); }));
  document.querySelectorAll<HTMLButtonElement>('[data-st]').forEach(b => b.addEventListener('click', () => { wake(); Sfx.stinger(b.dataset.st as Stinger); }));
  document.querySelectorAll<HTMLButtonElement>('[data-ev]').forEach(b => b.addEventListener('click', () => {
    wake(); const e = events[b.dataset.ev!]; const d = dispatchFor(g, e, me); if (!d) return;
    show(d); Radio.reset(); Radio.event(g, e, me);
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-vm]').forEach(b => b.addEventListener('click', () => { wake(); Radio.setMode(b.dataset.vm as VoiceMode); voiceUi(); }));
  $('#sit-atk').addEventListener('click', () => sitrep(me));
  $('#sit-def').addEventListener('click', () => sitrep(3));
  $('#skirmish').addEventListener('click', () => skirmish(1));
  $('#battle').addEventListener('click', () => skirmish(4));
  $('#amb').addEventListener('click', () => setAmb(!ambOn));
  for (const id of ['#battles', '#zoom', '#tanks', '#planes']) { const i = $(id) as HTMLInputElement, o = $(id + '-v'); const f = () => { o.textContent = i.value; }; i.addEventListener('input', f); f(); }
  Neural.onState = voiceUi; voiceUi();
}
boot();
(window as unknown as { __sfx: unknown }).__sfx = { Sfx, Radio, Neural, shots, events, sitrep };
