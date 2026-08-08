/**
 * SAN is stored in one canonical form: no check/mate marks, no !/? glyphs.
 *
 * The tree is keyed by SAN string equality, so two spellings of the same move
 * must never coexist. PGN imports arrive decorated (`Bxf7+`, `Qh5+!`) and
 * chess.js hands back `move.san` with `+`/`#` attached, while a move typed or
 * clicked in the editor may have neither — comparing those raw would mark a
 * correct checking move wrong. Everything that enters the model goes through
 * `bareSan` first.
 */
export function bareSan(san: string): string {
  return san.trim().replace(/[!?]+$/, '').replace(/[+#]+$/, '');
}
