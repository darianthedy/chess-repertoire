import { Chess } from 'chess.js';

/**
 * Reduce a FEN to the parts that define a *position* for repertoire purposes.
 *
 * Two things are dropped:
 *
 * 1. Halfmove clock and fullmove number. These depend on the path taken to
 *    reach a position, so leaving them in would defeat the whole point of
 *    keying by FEN — transpositions would land on different nodes.
 *
 * 2. The en-passant target square, *unless* an en-passant capture is actually
 *    legal. chess.js sets that field after any pawn double-move, whether or not
 *    a capture is available, which is the single most common cause of two
 *    genuinely identical positions failing to match.
 */
export function normalizeFen(fen: string): string {
  const [placement, turn, castling, ep] = fen.split(' ');

  if (ep === '-') return `${placement} ${turn} ${castling} -`;

  let epIsReal = false;
  try {
    epIsReal = new Chess(fen)
      .moves({ verbose: true })
      .some((m) => m.flags.includes('e'));
  } catch {
    // Unparseable FEN: fall back to keeping the field as given rather than
    // silently merging positions that might differ.
    epIsReal = true;
  }

  return `${placement} ${turn} ${castling} ${epIsReal ? ep : '-'}`;
}

/** Normalized FEN of the standard starting position — the root of every tree. */
export const ROOT_FEN = normalizeFen(new Chess().fen());

/**
 * A Chess instance for a normalized FEN. Move counters are re-added as
 * placeholders since chess.js requires a complete six-field FEN.
 */
export function chessAt(normalized: string): Chess {
  return new Chess(`${normalized} 0 1`);
}

/** 'w' or 'b' — whose turn it is in a normalized FEN. */
export function turnOf(normalized: string): 'w' | 'b' {
  return normalized.split(' ')[1] === 'b' ? 'b' : 'w';
}
