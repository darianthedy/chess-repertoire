/**
 * Chess.com integration.
 *
 * The public Published-Data API (api.chess.com/pub) needs no auth and sends
 * `access-control-allow-origin: *`, so it can be called straight from the
 * browser. It exposes profiles, stats and game archives — but nothing
 * resembling a Lichess study, so it is a source of *games*, not repertoires.
 */

export interface CcGame {
  url: string;
  pgn: string;
  timeClass: string;
  rules: string;
  white: string;
  black: string;
  endTime: number;
}

const BASE = 'https://api.chess.com/pub';

function normalizeUser(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?chess\.com\/member\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Monthly archive URLs, oldest first. */
export async function fetchArchives(username: string): Promise<string[]> {
  const user = normalizeUser(username);
  if (!user) throw new Error('Enter a chess.com username');

  const res = await fetch(`${BASE}/player/${encodeURIComponent(user)}/games/archives`);
  if (!res.ok) {
    throw new Error(
      res.status === 404 ? `No chess.com player called "${user}"` : `Chess.com returned ${res.status}`,
    );
  }
  const json = (await res.json()) as { archives?: string[] };
  return json.archives ?? [];
}

/**
 * Games from the most recent `months` archives, newest first.
 *
 * Only standard chess is kept — variants share the archive but can't be walked
 * against a repertoire.
 */
export async function fetchRecentGames(
  username: string,
  months = 2,
): Promise<CcGame[]> {
  const archives = await fetchArchives(username);
  const recent = archives.slice(-Math.max(1, months));

  const pages = await Promise.all(
    recent.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = (await res.json()) as { games?: RawGame[] };
      return json.games ?? [];
    }),
  );

  return pages
    .flat()
    .filter(
      (g): g is RawGame & { pgn: string } =>
        g.rules === 'chess' && typeof g.pgn === 'string',
    )
    .map((g) => ({
      url: g.url,
      pgn: g.pgn,
      timeClass: g.time_class,
      rules: g.rules,
      white: g.white?.username ?? '',
      black: g.black?.username ?? '',
      endTime: g.end_time ?? 0,
    }))
    .sort((a, b) => b.endTime - a.endTime);
}

interface RawGame {
  url: string;
  pgn?: string;
  rules: string;
  time_class: string;
  end_time?: number;
  white?: { username?: string };
  black?: { username?: string };
}

/** Which side the given player had, or null if they weren't in the game. */
export function colourOf(game: CcGame, username: string): 'w' | 'b' | null {
  const user = normalizeUser(username);
  if (game.white.toLowerCase() === user) return 'w';
  if (game.black.toLowerCase() === user) return 'b';
  return null;
}
