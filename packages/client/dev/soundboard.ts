// Dev soundboard: audition every battle sound, ambience bed, signal cue and radio dispatch outside the game.
// Bundle with: npx esbuild dev/soundboard.ts --bundle --format=iife --outfile=<out.js>
import { world, type GameEvent, type GameState } from '@riskrts/shared';
import { Sfx, type Stinger } from '../src/audio/sfx';
import { Radio, dispatchFor } from '../src/audio/radio';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const W = world(), byName = (n: string) => W.regions.findIndex(r => r.name === n);
const reg = (n: string, fb: number) => { const i = byName(n); return i >= 0 ? i : fb; };
// A stand-in game where we play France (faction 1) and own every region; enough for dispatchFor.
const me = 1, g = { regions: W.regions.map(() => ({ owner: me })) } as unknown as GameState;

let dist = 14, hw = 8;
const listen = () => { const hh = .344 * dist; hw = hh * Math.max(.5, innerWidth / innerHeight); Sfx.listen(0, 0, dist, hh, hw); };
const rx = () => (Math.random() * 2 - 1) * hw * .9, rz = () => (Math.random() - .5) * 3;
const wake = () => { Sfx.init(); listen(); };

const shots: Record<string, () => void> = {
  rifle: () => Sfx.shot('inf', rx(), rz()),
  mg: () => Sfx.shot('mg', rx(), rz()),
  tank: () => Sfx.shot('tank', rx(), rz()),
  gun: () => { const x = rx(), tx = -x * .6; Sfx.gun(x, 0, tx, 0, 1.4); setTimeout(() => Sfx.boom(tx, 0, 1), 1400); },
  boom: () => Sfx.boom(rx(), rz(), 1.3),
  flak: () => Sfx.flak(rx(), rz()),
  distant: () => Sfx.rumble(.9, rx() * 3, 0),
  strafe: () => Sfx.shot('plane', rx(), rz()),
};

let barrage = 0;
function skirmish() {
  wake(); clearInterval(barrage); const end = performance.now() + 12000;
  barrage = window.setInterval(() => {
    if (performance.now() > end) { clearInterval(barrage); return; }
    const r = Math.random();
    if (r < .45) shots.rifle(); else if (r < .7) shots.mg(); else if (r < .8) shots.gun(); else if (r < .9) shots.boom(); else shots.tank();
  }, 90);
}

// ambience loop
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
const events: Record<string, GameEvent> = {
  declare: { k: 'start' },
  attack: { k: 'battleStart', region: R('Germany', 0), attacker: me, defender: 3 },
  defend: { k: 'battleStart', region: R('Iberia', 0), attacker: 3, defender: me },
  air: { k: 'air', faction: 3, from: 0, to: R('France', 0), units: 3 },
  taken: { k: 'battleEnd', region: R('Poland', 0), winner: me, prev: 3, sides: [me, 3], capital: false, holdouts: -1 },
  lost: { k: 'battleEnd', region: R('Iberia', 0), winner: 3, prev: me, sides: [me, 3], capital: false, holdouts: -1 },
  held: { k: 'battleEnd', region: R('Maghreb', 0), winner: me, prev: me, sides: [me, 3], capital: false, holdouts: -1 },
  capital: { k: 'battleEnd', region: R('Germany', 0), winner: me, prev: 3, sides: [me, 3], capital: true, holdouts: -1 },
  fallen: { k: 'battleEnd', region: R('France', 0), winner: 3, prev: me, sides: [me, 3], capital: true, holdouts: -1 },
  surrender: { k: 'eliminated', faction: 5 },
  orders: { k: 'newOrders', faction: me },
  win: { k: 'over', winner: me },
};

function boot() {
  document.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach(b => b.addEventListener('click', () => { wake(); shots[b.dataset.shot!](); }));
  document.querySelectorAll<HTMLButtonElement>('[data-st]').forEach(b => b.addEventListener('click', () => { wake(); Sfx.stinger(b.dataset.st as Stinger); }));
  document.querySelectorAll<HTMLButtonElement>('[data-ev]').forEach(b => b.addEventListener('click', () => {
    wake(); const e = events[b.dataset.ev!]; const d = dispatchFor(g, e, me); if (!d) return;
    $('#wire').textContent = d.say; $('#wire').classList.remove('tick'); void $('#wire').offsetWidth; $('#wire').classList.add('tick');
    Radio.reset(); Radio.event(g, e, me);
  }));
  $('#skirmish').addEventListener('click', skirmish);
  $('#amb').addEventListener('click', () => setAmb(!ambOn));
  $('#voice').addEventListener('click', () => { Radio.voice = !Radio.voice; $('#voice').setAttribute('aria-pressed', String(Radio.voice)); $('#voice').textContent = Radio.voice ? 'Voice on' : 'Voice off'; });
  for (const id of ['#battles', '#zoom', '#tanks', '#planes']) { const i = $(id) as HTMLInputElement, o = $(id + '-v'); const f = () => { o.textContent = i.value; }; i.addEventListener('input', f); f(); }
}
boot();
(window as unknown as { __sfx: unknown }).__sfx = { Sfx, Radio, shots, events };
