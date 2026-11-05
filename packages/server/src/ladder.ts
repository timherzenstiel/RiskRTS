// The ranked ladder: Elo per player, updated once when a ranked war ends.
export interface Rating { player: string; name: string; elo: number; games: number }
export const ELO_START = 1200, ELO_K = 32;

/** Expected score of a against b. */
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/**
 * Rate a finished war: the winner (if a human) beats every other human; when a computer power or nobody wins, every human
 * shares the loss equally (no change between them). Returns the updated ratings.
 */
export function rateWar(ladder: Map<string, Rating>, players: [number, string, string][], winner: number | null): Rating[] {
  if (players.length < 2) return [];
  const get = (id: string, name: string) => { let r = ladder.get(id); if (!r) { r = { player: id, name, elo: ELO_START, games: 0 }; ladder.set(id, r); } r.name = name; return r; };
  const rs = players.map(([f, id, name]) => ({ f, r: get(id, name) }));
  const win = rs.find(x => x.f === winner);
  const delta = new Map<string, number>();
  if (win) for (const x of rs) if (x !== win) {
    const e = expected(win.r.elo, x.r.elo), d = ELO_K * (1 - e);
    delta.set(win.r.player, (delta.get(win.r.player) ?? 0) + d); delta.set(x.r.player, (delta.get(x.r.player) ?? 0) - d);
  }
  for (const x of rs) { x.r.elo = Math.round(x.r.elo + (delta.get(x.r.player) ?? 0)); x.r.games++; }
  return rs.map(x => x.r);
}
