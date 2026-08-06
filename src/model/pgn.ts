import { addMove, getNode, tryMove, updateNote } from './tree';
import type { Repertoire } from './types';

/**
 * PGN import.
 *
 * chess.js parses PGN but keeps only the mainline — it discards every
 * variation. A repertoire is almost entirely variations, so the movetext is
 * parsed here instead.
 */

export interface PgnMove {
  san: string;
  comment?: string;
  /** Alternatives to this move, branching from the position *before* it. */
  variations: PgnMove[][];
}

type Token =
  | { t: 'san'; v: string }
  | { t: 'comment'; v: string }
  | { t: 'open' }
  | { t: 'close' };

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/**
 * Split a PGN file into per-game movetext blocks.
 *
 * Lichess exports a study as one game per chapter concatenated together, so a
 * single paste routinely holds a dozen games that all belong in one tree.
 */
export function splitGames(pgn: string): string[] {
  const games: string[] = [];
  let current: string[] = [];
  let inMovetext = false;

  for (const line of pgn.split(/\r?\n/)) {
    const trimmed = line.trim();
    const isHeader = trimmed.startsWith('[') && trimmed.endsWith(']');

    if (isHeader && inMovetext) {
      // A header after movetext means the previous game ended.
      games.push(current.join(' '));
      current = [];
      inMovetext = false;
    }
    if (isHeader) continue;
    if (trimmed) inMovetext = true;
    current.push(trimmed);
  }

  const last = current.join(' ').trim();
  if (last) games.push(last);
  return games.filter((g) => g.trim().length > 0);
}

function tokenize(movetext: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < movetext.length) {
    const ch = movetext[i];

    if (ch === ' ' || ch === '\n' || ch === '\t') {
      i++;
    } else if (ch === '{') {
      const end = movetext.indexOf('}', i);
      const stop = end === -1 ? movetext.length : end;
      tokens.push({ t: 'comment', v: movetext.slice(i + 1, stop).trim() });
      i = stop + 1;
    } else if (ch === ';') {
      // Rest-of-line comment.
      const end = movetext.indexOf('\n', i);
      i = end === -1 ? movetext.length : end + 1;
    } else if (ch === '(') {
      tokens.push({ t: 'open' });
      i++;
    } else if (ch === ')') {
      tokens.push({ t: 'close' });
      i++;
    } else if (ch === '$') {
      // NAG: skip the annotation glyph entirely.
      while (i < movetext.length && /\S/.test(movetext[i])) i++;
    } else if (ch === '<' || ch === '>') {
      i++; // reserved by the spec, unused in practice
    } else {
      let j = i;
      while (j < movetext.length && !/[\s(){};]/.test(movetext[j])) j++;
      const word = movetext.slice(i, j);
      i = j;

      if (RESULTS.has(word)) continue;
      // Move numbers: "12." / "12..." — and the bare "..." Lichess emits.
      const san = word.replace(/^\d+\.+/, '').replace(/^\.+/, '');
      if (!san) continue;
      if (/^\d+$/.test(san)) continue;
      tokens.push({ t: 'san', v: stripDecorations(san) });
    }
  }
  return tokens;
}

/** Drop !/?/!? annotations and the check and mate marks, which SAN matching ignores. */
function stripDecorations(san: string): string {
  return san.replace(/[!?]+$/, '').replace(/[+#]+$/, '');
}

/** Parse movetext into a move tree, preserving variations and comments. */
export function parseMovetext(movetext: string): PgnMove[] {
  const tokens = tokenize(movetext);
  let i = 0;

  function sequence(): PgnMove[] {
    const moves: PgnMove[] = [];

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.t === 'close') {
        i++;
        return moves;
      }
      if (token.t === 'open') {
        i++;
        const variation = sequence();
        // A variation replaces the move just read, so it hangs off that move
        // and will be applied at the position preceding it.
        if (moves.length && variation.length) {
          moves[moves.length - 1].variations.push(variation);
        }
        continue;
      }
      if (token.t === 'comment') {
        i++;
        if (moves.length) moves[moves.length - 1].comment = token.v;
        continue;
      }
      i++;
      moves.push({ san: token.v, variations: [] });
    }
    return moves;
  }

  return sequence();
}

export interface ImportResult {
  rep: Repertoire;
  /** Positions added to the tree. */
  added: number;
  /** Moves already present, left untouched. */
  existing: number;
  /** Moves that were illegal in their position — a sign of a malformed file. */
  rejected: number;
}

/**
 * Merge parsed movetext into a repertoire, in place in the tree rather than
 * replacing it. Existing moves keep their notes; PGN comments only fill notes
 * that are empty, so hand-written annotations are never overwritten by an
 * import.
 */
export function mergeMoves(
  rep: Repertoire,
  fen: string,
  moves: PgnMove[],
  stats = { added: 0, existing: 0, rejected: 0 },
): { rep: Repertoire; stats: typeof stats } {
  let current = fen;

  for (const move of moves) {
    // Variations branch from the position *before* this move, so they are
    // merged first, while `current` still points there.
    for (const variation of move.variations) {
      const result = mergeMoves(rep, current, variation, stats);
      rep = result.rep;
    }

    const next = tryMove(current, move.san);
    if (!next) {
      stats.rejected++;
      // The rest of this line is unreachable once a move fails to apply.
      return { rep, stats };
    }

    const already = getNode(rep, current).moves.some((m) => m.san === move.san);
    if (already) {
      stats.existing++;
      if (move.comment) {
        const edge = getNode(rep, current).moves.find(
          (m) => m.san === move.san,
        );
        if (edge && !edge.note) rep = updateNote(rep, current, move.san, move.comment);
      }
    } else {
      rep = addMove(rep, current, move.san, move.comment ?? '');
      stats.added++;
    }

    current = next;
  }

  return { rep, stats };
}

/** Import a whole PGN file (possibly many games) into one repertoire. */
export function importPgn(
  rep: Repertoire,
  pgn: string,
  rootFen: string,
): ImportResult {
  const stats = { added: 0, existing: 0, rejected: 0 };
  let out = rep;

  for (const game of splitGames(pgn)) {
    const moves = parseMovetext(game);
    const result = mergeMoves(out, rootFen, moves, stats);
    out = result.rep;
  }

  return { rep: out, ...stats };
}

/** Pull the study id out of a Lichess URL, or accept a bare id. */
export function studyId(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/lichess\.org\/study\/([A-Za-z0-9]{8})/);
  if (match) return match[1];
  if (/^[A-Za-z0-9]{8}$/.test(trimmed)) return trimmed;
  return null;
}

export async function fetchStudyPgn(input: string): Promise<string> {
  const id = studyId(input);
  if (!id) throw new Error('Not a Lichess study URL or id');

  const res = await fetch(`https://lichess.org/api/study/${id}.pgn`);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'Study not found — is it public?'
        : `Lichess returned ${res.status}`,
    );
  }
  return res.text();
}
