import type { CcGame } from './chesscom';
import { colourOf } from './chesscom';
import { ROOT_FEN } from './fen';
import { parseMovetext, splitGames } from './pgn';
import { getNode, tryMove } from './tree';
import type { PathStep } from './tree';
import type { Repertoire } from './types';

/** The first point in a game where play left the repertoire. */
export interface Deviation {
  game: CcGame;
  repertoireId: string;
  /** Position where the book move ran out. */
  fen: string;
  /** Moves leading to it. */
  path: PathStep[];
  /** What was actually played there. */
  playedSan: string;
  /** What the repertoire offered, if anything. */
  expected: string[];
  /** True when I left book; false when my opponent played something new. */
  byMe: boolean;
  /** How many of my moves were in book before this. */
  inBookPlies: number;
}

/** Mainline SAN moves of a game, ignoring clock comments. */
export function gameMoves(pgn: string): string[] {
  const [movetext] = splitGames(pgn);
  if (!movetext) return [];
  return parseMovetext(movetext).map((m) => m.san);
}

/**
 * Walk a game against one repertoire and report where it left book.
 *
 * Returns null when the game followed the repertoire until the tree simply ran
 * out on my own move — that's the repertoire ending, not a deviation. A gap
 * only exists where the tree *had* an opinion and play went elsewhere, or where
 * the opponent played something unanswered.
 */
export function findDeviation(
  rep: Repertoire,
  game: CcGame,
  side: 'w' | 'b',
): Deviation | null {
  const moves = gameMoves(game.pgn);
  const path: PathStep[] = [];
  let fen = ROOT_FEN;
  let inBookPlies = 0;

  for (const san of moves) {
    const node = getNode(rep, fen);
    const edge = node.moves.find((m) => m.san === san);

    if (edge) {
      path.push({ san, fen: edge.to });
      fen = edge.to;
      inBookPlies++;
      continue;
    }

    const myTurn = fen.split(' ')[1] === side;

    // The tree has nothing at all here. If it's my move that's the end of the
    // repertoire rather than a mistake; if it's the opponent's, it's an
    // unanswered move and worth capturing.
    if (node.moves.length === 0 && myTurn) return null;

    return {
      game,
      repertoireId: rep.id,
      fen,
      path,
      playedSan: san,
      expected: node.moves.map((m) => m.san),
      byMe: myTurn,
      inBookPlies,
    };
  }

  return null;
}

/**
 * Attribute a game to a repertoire and find its deviation.
 *
 * A game maps to a side unambiguously, but a side may hold several
 * repertoires. Each is tried and the one the game followed longest wins, since
 * that's the one actually being played; ties break toward `primary`.
 */
export function analyseGame(
  repertoires: Repertoire[],
  game: CcGame,
  username: string,
): Deviation | null {
  const side = colourOf(game, username);
  if (!side) return null;

  const candidates = repertoires.filter(
    (r) => r.side === side && r.state !== 'parked',
  );
  if (!candidates.length) return null;

  let best: Deviation | null = null;
  let bestRep: Repertoire | null = null;

  for (const rep of candidates) {
    const dev = findDeviation(rep, game, side);
    // A repertoire the game never left is a perfect match: nothing to capture.
    if (!dev) return null;

    if (
      !best ||
      dev.inBookPlies > best.inBookPlies ||
      (dev.inBookPlies === best.inBookPlies &&
        rep.state === 'primary' &&
        bestRep?.state !== 'primary')
    ) {
      best = dev;
      bestRep = rep;
    }
  }

  return best;
}

/** Analyse a batch, newest first, dropping games with nothing to report. */
export function analyseGames(
  repertoires: Repertoire[],
  games: CcGame[],
  username: string,
): Deviation[] {
  return games
    .map((g) => analyseGame(repertoires, g, username))
    .filter((d): d is Deviation => d !== null);
}

/**
 * Group deviations by the position they occur in.
 *
 * The same gap usually shows up across several games, and it should be
 * presented — and fixed — once.
 */
export interface DeviationGroup {
  key: string;
  deviation: Deviation;
  count: number;
}

export function groupDeviations(list: Deviation[]): DeviationGroup[] {
  const map = new Map<string, DeviationGroup>();

  for (const dev of list) {
    const key = `${dev.repertoireId}:${dev.fen}:${dev.playedSan}`;
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { key, deviation: dev, count: 1 });
  }

  // Most frequent first: the gap costing the most games is the one to close.
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Replay a path as a move list for display, e.g. "1.d4 d5 2.Nf3". */
export function describePath(path: PathStep[]): string {
  return path
    .map((step, i) =>
      i % 2 === 0 ? `${i / 2 + 1}.${step.san}` : step.san,
    )
    .join(' ');
}

/** Sanity helper: confirm a SAN is legal in a position before offering it. */
export function isLegalHere(fen: string, san: string): boolean {
  return tryMove(fen, san) !== null;
}
