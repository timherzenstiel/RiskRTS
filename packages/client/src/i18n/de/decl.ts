// Powers in German, by every English form the simulation uses (name, short name, "the ..." form and
// its capitalised sentence-start variant). Most powers read best as plain country names, which need
// no article and do not change with case. The Ottoman Empire keeps its article and declines.
import type { Case } from '../index';

type Forms = Record<Case, string>;
const same = (s: string): Forms => ({ nom: s, gen: s, dat: s, acc: s });
const OT: Forms = { nom: 'das Osmanische Reich', gen: 'des Osmanischen Reiches', dat: 'dem Osmanischen Reich', acc: 'das Osmanische Reich' };

const powers: [string[], Forms][] = [
  [['British Empire', 'the British Empire', 'The British Empire', 'Britain'], same('Großbritannien')],
  [['French Republic', 'the French Republic', 'The French Republic', 'France'], same('Frankreich')],
  [['Russian Empire', 'the Russian Empire', 'The Russian Empire', 'Russia'], same('Russland')],
  [['German Empire', 'the German Empire', 'The German Empire', 'Germany'], same('Deutschland')],
  [['Austria-Hungary', 'Austria'], same('Österreich-Ungarn')],
  [['Ottoman Empire', 'the Ottoman Empire', 'The Ottoman Empire', 'Ottomans'], OT],
  [['United States', 'the United States', 'The United States', 'America'], same('Amerika')],
];

export const DECL: Record<string, Forms> = {};
for (const [keys, f] of powers) for (const k of keys) DECL[k] = f;
// German forms map to themselves, so a name that was already translated can still be declined.
for (const [, f] of powers) DECL[f.nom] = f;
