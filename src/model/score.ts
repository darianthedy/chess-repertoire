/**
 * Engine scores, and what they mean for a repertoire.
 *
 * Two ideas are kept apart deliberately:
 *
 *   * A **score** is what the engine says about a position. Stored White-POV,
 *     because a bar that flips meaning with the side to move is unreadable.
 *   * A **loss** is what choosing one move instead of the best one costs. It is
 *     always measured in win percentage, never in centipawns — see `winPct`.
 */

import type { Side } from './types';

export type Score =
  | { kind: 'cp'; cp: number }
  /** Positive = the side to move mates in n; negative = gets mated in n. */
  | { kind: 'mate'; mate: number };

/**
 * Centipawn stand-in for mate, for ordering and bar rendering only. Large
 * enough to dominate any real evaluation, finite so arithmetic stays total.
 */
const MATE_CP = 12800;

/**
 * UCI reports scores from the side to move's point of view. Everything above
 * this layer works in White-POV, so conversion happens once, here, at the edge.
 */
export function toWhitePov(score: Score, turn: Side): Score {
  if (turn === 'w') return score;
  return score.kind === 'cp'
    ? { kind: 'cp', cp: -score.cp }
    : { kind: 'mate', mate: -score.mate };
}

/** White-POV score as a number, for comparison and bar geometry. */
export function scoreValue(score: Score): number {
  if (score.kind === 'cp') return score.cp;
  // Nearer mates rank ahead of distant ones, and mate-in-0 never occurs.
  return score.mate > 0
    ? MATE_CP - score.mate * 10
    : -MATE_CP - score.mate * 10;
}

/** "+0.42", "-1.30", "M4", "-M2", "0.00". */
export function formatScore(score: Score): string {
  if (score.kind === 'mate') {
    return score.mate > 0 ? `M${score.mate}` : `-M${Math.abs(score.mate)}`;
  }
  const pawns = score.cp / 100;
  if (Math.abs(pawns) < 0.005) return '0.00';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`;
}

/**
 * White's expected score, 0–100.
 *
 * The logistic constant is Lichess's, fitted against real game outcomes. This
 * conversion is the whole reason move quality is judged here rather than on raw
 * centipawns: +0.9 → +0.3 is a real error in an equal position, while
 * +9.0 → +8.4 is the same centipawn swing and means nothing. Win percentage
 * compresses the second and keeps the first.
 */
export function winPct(score: Score): number {
  if (score.kind === 'mate') return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.cp)) - 1);
}

/**
 * White's share of the eval bar, 0–1, clamped so a decisive advantage still
 * leaves a sliver of the losing colour visible rather than a blank rectangle.
 */
export function barFraction(score: Score): number {
  if (score.kind === 'mate') return score.mate > 0 ? 0.97 : 0.03;
  const raw = winPct(score) / 100;
  return Math.min(0.97, Math.max(0.03, raw));
}

/**
 * How much win percentage `played` gave up against `best`, from the mover's
 * point of view. Never negative: a move that "beats" the best line is a
 * search artefact (different depths, different bounds), not a discovery.
 */
export function lossPct(best: Score, played: Score, mover: Side): number {
  const sign = mover === 'w' ? 1 : -1;
  const delta = (winPct(best) - winPct(played)) * sign;
  return Math.max(0, delta);
}

export type Verdict = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/**
 * Lichess's thresholds. Worth keeping rather than inventing: they are what the
 * numbers next to these words mean to anyone who has used a chess site, and a
 * private scale would silently disagree with every other tool.
 */
export function classify(loss: number): Verdict {
  if (loss < 2) return 'best';
  if (loss < 10) return 'good';
  if (loss < 20) return 'inaccuracy';
  if (loss < 30) return 'mistake';
  return 'blunder';
}

/**
 * A verdict describes how much a move *lost*, which is not the same as which
 * move the engine picked. "Equal best" rather than "Engine choice" because a
 * move can give up nothing measurable and still not be the top line — calling
 * a repertoire move the engine's choice when it isn't is the kind of small lie
 * that makes the whole panel untrustworthy.
 */
export const VERDICT_LABEL: Record<Verdict, string> = {
  best: 'Equal best',
  good: 'Sound',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

/** Whether a verdict is worth surfacing unprompted. */
export function isProblem(verdict: Verdict): boolean {
  return verdict === 'inaccuracy' || verdict === 'mistake' || verdict === 'blunder';
}
