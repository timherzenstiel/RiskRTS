#!/usr/bin/env node
// Builds the game's sample bank from raw recordings.
//
//   assets/sfx-src/<category>/*.wav|flac|mp3|ogg|aiff  →  packages/client/public/sfx/<category>-N.mp3 + manifest.json
//
// One-shots are trimmed of leading/trailing silence, made mono, capped in length, faded out and loudness-normalised.
// Loops (categories ending in -loop) keep stereo, get a crossfade baked in so they loop without a click, and are capped at 20 s.
// Needs ffmpeg on the PATH. Usage: node tools/sfx/import.mjs [srcDir] [outDir]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = resolve(process.argv[2] ?? join(root, 'assets/sfx-src'));
const out = resolve(process.argv[3] ?? join(root, 'packages/client/public/sfx'));

/** Category → [max length in s, loudness target in LUFS]. Must match SAMPLE_KINDS in packages/client/src/audio/sfx.ts. */
const KINDS = {
  'rifle': [1.2, -16], 'rifle-far': [2, -20], 'mg': [3, -16], 'mg-far': [3.5, -20],
  'gun': [3, -14], 'gun-far': [4, -20], 'heavy': [4.5, -13], 'whistle': [3, -20],
  'impact': [3, -14], 'impact-far': [4, -20], 'flak': [2, -18], 'tank-gun': [2.5, -15],
  'bullet': [1, -22], 'whistle-officer': [1.6, -18], 'cheer': [5, -18],
  'tank-loop': [20, -22], 'plane-loop': [20, -22], 'battle-loop': [20, -20], 'wind-loop': [20, -26],
};
const AUDIO = /\.(wav|flac|mp3|ogg|oga|opus|aif|aiff|m4a)$/i;

try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.error('ffmpeg not found on the PATH.'); process.exit(1); }
if (!existsSync(src)) { console.error(`No source folder ${src}. Create it with one sub-folder per category:\n  ${Object.keys(KINDS).join(', ')}`); process.exit(1); }

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.mp3') || f === 'manifest.json') rmSync(join(out, f));

const manifest = {};
let total = 0;
for (const dir of readdirSync(src).sort()) {
  const p = join(src, dir); if (!statSync(p).isDirectory()) continue;
  if (!(dir in KINDS)) { console.warn(`skip ${dir}/: not a category (${Object.keys(KINDS).join(', ')})`); continue; }
  const [max, lufs] = KINDS[dir], loop = dir.endsWith('-loop');
  const files = readdirSync(p).filter(f => AUDIO.test(f)).sort();
  files.forEach((f, i) => {
    const name = `${dir}-${i + 1}.mp3`, dst = join(out, name);
    const filters = loop
      // crossfade the tail into the head: take max+2 s, overlap the last 2 s with the first 2 s
      // (the file is read twice: the body from 2 s on, and its first 2 s faded in at the end, so the end runs into the start)
      ? `[0:a]atrim=2:${max + 2},asetpts=PTS-STARTPTS[body];[1:a]atrim=0:2,asetpts=PTS-STARTPTS[head];[body][head]acrossfade=d=2:c1=tri:c2=tri,loudnorm=I=${lufs}:TP=-2:LRA=11`
      : ['silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005', 'areverse', 'silenceremove=start_periods=1:start_threshold=-55dB', 'areverse',
         `atrim=0:${max}`, `afade=t=out:st=${Math.max(0, max - .25).toFixed(2)}:d=0.25`, `loudnorm=I=${lufs}:TP=-1.5:LRA=11`].join(',');
    const args = ['-y', '-loglevel', 'error', '-i', join(p, f), ...(loop ? ['-i', join(p, f)] : []), '-filter_complex', filters, '-ac', loop ? '2' : '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', loop ? '128k' : '96k', dst];
    try {
      execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
      (manifest[dir] ??= []).push(name); total += statSync(dst).size;
      console.log(`${dir}/${f} → ${name}`);
    } catch { console.warn(`failed: ${dir}/${f}`); }
  });
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`\n${Object.values(manifest).flat().length} samples, ${(total / 1048576).toFixed(1)} MB → ${out}`);
