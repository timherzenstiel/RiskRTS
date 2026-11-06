// Front commanders (design-command §2.5): traits and invented names per power. The names are made up from common first names
// and surnames of each country; they are not meant to be, and should not be read as, real persons.

export type TraitKey = 'off' | 'meth' | 'def' | 'caut' | 'insp' | 'care' | 'intel' | 'eng' | 'pol' | 'slow';
export interface TraitDef { name: string; desc: string }
export const TRAITS: Record<TraitKey, TraitDef> = {
  off: { name: 'Offensive spirit', desc: 'Proposes attacks at 1.2× our strength instead of 1.5×' },
  meth: { name: 'Methodical', desc: 'Proposes attacks only with a clear margin (1.8×), keeps two corps in reserve' },
  def: { name: 'Defensive genius', desc: 'Asks for trenches and wire on every border that is not safe, wants 20 % more men on the line' },
  caut: { name: 'Cautious', desc: 'Asks to fall back sooner (below 0.7×), sends spare corps back only with a wide margin' },
  insp: { name: 'Inspiring', desc: 'His corps regain morale faster (+3 per week)' },
  care: { name: 'Careless', desc: 'Proposes attacks at 1.3×, never asks to fall back, keeps no reserve' },
  intel: { name: 'Intelligence officer', desc: 'Wants a fresh report on every hostile border each week; his patrols and flights are caught half as often' },
  eng: { name: 'Engineer', desc: 'Trenches and wire he asks for cost 25 % less' },
  pol: { name: 'Political', desc: 'Has friends at home: every request of his you deny adds 1 war weariness' },
  slow: { name: 'Slow', desc: 'Looks at his front half as often, so he shifts corps and asks for things later' },
};
/** Traits a three-star general loses (design-play §3.2). */
export const BAD_TRAITS: TraitKey[] = ['care', 'pol', 'slow'];
export const TRAIT_KEYS = Object.keys(TRAITS) as TraitKey[];

/** Traits each power's officer corps leans to (drawn twice as often). British Empire, France, Russia, Germany, Austria-Hungary, Ottomans, United States. */
export const TRAIT_BIAS: TraitKey[][] = [['caut', 'intel'], ['def', 'meth'], ['off', 'care'], ['meth', 'intel'], ['caut', 'care'], ['def', 'insp'], ['off', 'insp']];

const FIRST: string[][] = [
  ['Arthur', 'Henry', 'Edward', 'Charles', 'Walter', 'Frederick', 'Hugh', 'Reginald', 'Percy', 'Lionel'],
  ['Henri', 'Louis', 'Émile', 'Gaston', 'Lucien', 'Marcel', 'Auguste', 'Raoul', 'Théodore', 'Armand'],
  ['Pyotr', 'Nikolai', 'Ivan', 'Sergei', 'Dmitri', 'Mikhail', 'Konstantin', 'Fyodor', 'Grigori', 'Vasili'],
  ['Friedrich', 'Otto', 'Karl', 'Wilhelm', 'Ludwig', 'Hermann', 'Ernst', 'Gustav', 'Heinrich', 'Max'],
  ['Franz', 'Johann', 'Anton', 'Rudolf', 'Viktor', 'Josef', 'Ferdinand', 'Ladislaus', 'Stefan', 'Emil'],
  ['Ahmet', 'Mehmet', 'Hasan', 'Ali', 'Mustafa', 'Hüseyin', 'Osman', 'Halil', 'Rıza', 'Selim'],
  ['John', 'William', 'George', 'James', 'Thomas', 'Robert', 'Samuel', 'Frank', 'Harold', 'Clarence'],
];
const LAST: string[][] = [
  ['Ashworth', 'Blakeney', 'Carrington', 'Dunmore', 'Fenwick', 'Hargreave', 'Kingsley', 'Morland', 'Pemberton', 'Thursby'],
  ['Arnaud', 'Bertrand', 'Castaing', 'Delorme', 'Fauvel', 'Garnier', 'Lescure', 'Marchand', 'Rouvier', 'Vautrin'],
  ['Arsenyev', 'Belinsky', 'Dolgov', 'Gromov', 'Karpov', 'Lebedev', 'Morozov', 'Orlov', 'Sokolov', 'Volkov'],
  ['von Albeck', 'Brenner', 'von Eschau', 'Hartwig', 'von Kessel', 'Lindau', 'von Möllen', 'Reinhardt', 'Steinitz', 'Wendt'],
  ['von Aichinger', 'Baranyi', 'Csánky', 'Dworak', 'Hollan', 'Kovář', 'von Lehner', 'Novak', 'Szalay', 'Wurmbrand'],
  ['Bey', 'Kaya', 'Demir', 'Aydın', 'Yıldız', 'Çelik', 'Şahin', 'Arslan', 'Öztürk', 'Doğan'],
  ['Bancroft', 'Calloway', 'Dearborn', 'Ellery', 'Hastings', 'Lowell', 'Merritt', 'Prescott', 'Thayer', 'Whitcomb'],
];
const RANK = ['Gen.', 'Gén.', 'Gen.', 'Gen.', 'GdI', 'Paşa', 'Gen.'];

/** A commander's name from two numbers in 0..1 (drawn from the game's random stream). */
export function commanderName(f: number, a: number, b: number): string {
  const F = FIRST[f] ?? FIRST[6], L = LAST[f] ?? LAST[6];
  const first = F[Math.floor(a * F.length) % F.length], last = L[Math.floor(b * L.length) % L.length];
  return f === 5 ? `${first} ${last === 'Bey' ? 'Bey' : last + ' ' + RANK[5]}` : `${RANK[f] ?? 'Gen.'} ${first} ${last}`;
}

/** Generals each power starts with (British Empire, France, Russia, Germany, Austria-Hungary, Ottomans, United States). */
export const START_GENERALS = [2, 3, 4, 3, 3, 3, 2];

/** Two different traits, biased to the power's leanings. `pick` returns a number in 0..1. */
export function commanderTraits(f: number, pick: () => number): [TraitKey, TraitKey] {
  const pool = [...TRAIT_KEYS, ...(TRAIT_BIAS[f] ?? [])];
  const a = pool[Math.floor(pick() * pool.length) % pool.length];
  const rest = pool.filter(k => k !== a);
  return [a, rest[Math.floor(pick() * rest.length) % rest.length]];
}
