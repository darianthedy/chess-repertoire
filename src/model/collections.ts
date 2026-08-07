import type { CcGame } from './chesscom';
import { ROOT_FEN } from './fen';
import { mergeMoves, parseMovetext, splitGamesWithHeaders } from './pgn';
import { newId } from './seed';
import { emptyNodes, getNode } from './tree';
import type { Collection, Repertoire, StoredGame } from './types';

/** Build a collection from PGN text. */
export function collectionFromPgn(
  name: string,
  pgn: string,
  source: Collection['source'],
): Collection {
  const games: StoredGame[] = splitGamesWithHeaders(pgn).map((g) => ({
    id: newId(),
    headers: g.headers,
    movetext: g.movetext,
  }));

  return { id: newId(), name, source, addedAt: Date.now(), games };
}

export function collectionFromChesscom(
  name: string,
  games: CcGame[],
): Collection {
  const stored: StoredGame[] = games.flatMap((g) =>
    splitGamesWithHeaders(g.pgn).map((parsed) => ({
      id: newId(),
      headers: { ...parsed.headers, Link: g.url },
      movetext: parsed.movetext,
    })),
  );

  return {
    id: newId(),
    name,
    source: 'chesscom',
    addedAt: Date.now(),
    games: stored,
  };
}

/**
 * Turn one game into a throwaway repertoire so the viewer can walk it with the
 * same FEN-keyed navigation the editor uses — variations, transpositions and
 * notes all behave identically, with no second tree implementation.
 */
export function gameToTree(game: StoredGame): Repertoire {
  const shell: Repertoire = {
    id: `game-${game.id}`,
    slotId: '',
    name: gameLabel(game),
    side: 'w',
    state: 'parked',
    activeDepth: 99,
    createdAt: 0,
    nodes: emptyNodes(),
  };
  const { rep } = mergeMoves(shell, ROOT_FEN, parseMovetext(game.movetext));
  return rep;
}

export function gameLabel(game: StoredGame): string {
  const w = game.headers.White ?? '?';
  const b = game.headers.Black ?? '?';
  return `${w} – ${b}`;
}

/** First few moves, for recognising a game at a glance in a list. */
export function gameOpening(game: StoredGame, plies = 6): string {
  const sans = parseMovetext(game.movetext)
    .slice(0, plies)
    .map((m) => m.san);
  return sans
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san))
    .join(' ');
}

/**
 * Present a collection as game records for deviation analysis. Only the tags
 * the walker reads are re-emitted, alongside the movetext.
 */
export function gamesFromCollection(collection: Collection): CcGame[] {
  return collection.games.map((g) => ({
    url: g.headers.Link ?? '',
    pgn: `[White "${g.headers.White ?? ''}"]\n[Black "${g.headers.Black ?? ''}"]\n\n${g.movetext}`,
    timeClass: g.headers.TimeControl ?? '',
    rules: 'chess',
    white: g.headers.White ?? '',
    black: g.headers.Black ?? '',
    endTime: 0,
  }));
}

/** Colour a player had in a game, by case-insensitive name match. */
export function sideOf(game: StoredGame, player: string): 'w' | 'b' | null {
  const p = player.trim().toLowerCase();
  if (!p) return null;
  if ((game.headers.White ?? '').toLowerCase() === p) return 'w';
  if ((game.headers.Black ?? '').toLowerCase() === p) return 'b';
  return null;
}

export interface GameFilter {
  /** Substring match across players, event and ECO. */
  text: string;
  /** Only games whose first move matches, e.g. "e4". */
  firstMove: string;
  result: '' | '1-0' | '0-1' | '1/2-1/2';
}

export const EMPTY_FILTER: GameFilter = { text: '', firstMove: '', result: '' };

export function firstMoveOf(game: StoredGame): string {
  return parseMovetext(game.movetext)[0]?.san ?? '';
}

export function filterGames(
  games: StoredGame[],
  filter: GameFilter,
): StoredGame[] {
  const text = filter.text.trim().toLowerCase();

  return games.filter((g) => {
    if (filter.result && g.headers.Result !== filter.result) return false;
    if (filter.firstMove && firstMoveOf(g) !== filter.firstMove) return false;
    if (!text) return true;

    const haystack = [
      g.headers.White,
      g.headers.Black,
      g.headers.Event,
      g.headers.ECO,
      g.headers.Date,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
}

/** Distinct first moves in a collection, for the filter control. */
export function firstMoves(games: StoredGame[]): string[] {
  const set = new Set<string>();
  for (const g of games) {
    const san = firstMoveOf(g);
    if (san) set.add(san);
  }
  return [...set].sort();
}

/**
 * Copy a line out of a viewed game into a repertoire, carrying its comments as
 * notes. Only the moves actually walked through are taken — that's the point of
 * hand-picking rather than merging a whole file.
 */
export function adoptLine(
  target: Repertoire,
  source: Repertoire,
  sans: string[],
): { rep: Repertoire; added: number } {
  let rep = target;
  let fen = ROOT_FEN;
  let added = 0;

  for (const san of sans) {
    const edge = getNode(source, fen).moves.find((m) => m.san === san);
    if (!edge) break;

    const before = Object.keys(rep.nodes).length;
    const { rep: next } = mergeMoves(rep, fen, [
      { san, comment: edge.note || undefined, variations: [] },
    ]);
    rep = next;
    if (Object.keys(rep.nodes).length > before) added++;
    fen = edge.to;
  }

  return { rep, added };
}
