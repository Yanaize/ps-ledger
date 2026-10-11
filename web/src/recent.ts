const KEY = 'ps-ledger-recent';

export type RecentGame = {
  conceptId: string;
  title: string;
  coverUrl: string | null;
  at: string;
};

export function readRecent(): RecentGame[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentGame[]) : [];
    return Array.isArray(list) ? list.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(game: Omit<RecentGame, 'at'>): void {
  const next = [
    { ...game, at: new Date().toISOString() },
    ...readRecent().filter((g) => g.conceptId !== game.conceptId),
  ].slice(0, 8);
  localStorage.setItem(KEY, JSON.stringify(next));
}
