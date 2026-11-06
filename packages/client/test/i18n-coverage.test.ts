// German coverage report. Run with:  I18N_REPORT=1 npx vitest run test/i18n-coverage.test.ts
// Plays computer-only wars, translates every feed line and radio call for every power, scans the
// simulation's error texts, and prints everything still in English. Without I18N_REPORT it only
// checks a short war so the normal test run stays fast.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, describeEvent, drainEvents, step, TICK_DT, NUM_FACTIONS, type GameState } from '@riskrts/shared';
import { DE } from '../src/i18n/de';
import { missing, tx, withLang } from '../src/i18n';
import { dispatchFor, sitrep } from '../src/audio/dispatches';

const REPORT = !!process.env.I18N_REPORT;

function play(seed: number, seconds: number, seen: Set<string>) {
  const g: GameState = createGame({ seed, humans: [], fx: false });
  const memo = Array.from({ length: NUM_FACTIONS }, () => ({}));
  for (let i = 0; i < seconds / TICK_DT; i++) {
    step(g, TICK_DT);
    for (const e of drainEvents(g)) for (let f = 0; f < NUM_FACTIONS; f++) {
      const d = describeEvent(g, e, f); if (d) { seen.add(d.text); tx(d.text); }
      try { const r = dispatchFor(g, e, f); if (r) seen.add(r.say); } catch { /* radio needs nothing else */ }
    }
    if (i % 200 === 0) for (let f = 0; f < NUM_FACTIONS; f++) { try { sitrep(g, f, memo[f] as never); } catch { /* ignore */ } }
    if (g.over) break;
  }
}

/** Template literals and plain strings returned as errors by the simulation, as dictionary keys. */
function errorTemplates(): string[] {
  const dir = join(__dirname, '../../shared/src/sim'), out = new Set<string>();
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/return\s+(?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)\s*;/g)) {
      let s = m[1] ?? m[2]; if (!s || !/[a-z]{3} [a-z]/i.test(s)) continue;
      let n = 0; s = s.replace(/\$\{[^}]*\}/g, () => `{${n++}}`).replace(/\\'/g, "'");
      out.add(s);
    }
  }
  return [...out];
}

describe('German coverage', () => {
  it('translates what the simulation says', () => {
    withLang('de', () => {
      missing.clear(); const seen = new Set<string>();
      const seeds = REPORT ? [1, 2, 3, 4, 5, 6] : [1];
      for (const s of seeds) { try { play(s, REPORT ? 1500 : 120, seen); } catch (e) { console.warn(`seed ${s}: simulation error`, e); } }
      const errs = errorTemplates().filter(k => !(k in DE));
      const miss = [...missing];
      if (REPORT) {
        console.log(`\n${seen.size} distinct lines seen, ${miss.length} untranslated:\n` + miss.sort().map(s => '  ' + s).join('\n'));
        console.log(`\n${errs.length} error templates not in the dictionary (check by hand, some are built from parts):\n` + errs.map(s => '  ' + s).join('\n'));
      }
      expect(seen.size).toBeGreaterThan(0);
    });
  });
});
