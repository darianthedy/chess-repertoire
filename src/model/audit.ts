/**
 * Engine analysis read against a repertoire.
 *
 * A bare eval bar answers "what does Stockfish think of this position", which
 * is not a question this app has. The questions it does have are:
 *
 *   * Does my book move here survive contact with an engine?
 *   * The game played something not in my book — was that an improvement I
 *     should steal, or a mistake I should be able to punish?
 *   * I got this drill position wrong. How wrong?
 *
 * All three are the same computation: score the candidate moves in a position,
 * then say which of them my repertoire holds.
 */

import type { Analysis } from './engine';
import { turnOf } from './fen';
import { classify, lossPct, scoreValue } from './score';
import type { Score, Verdict } from './score';
import { getNode } from './tree';
import type { Repertoire, Side } from './types';

/** One candidate move in a position, judged and cross-referenced. */
export interface Candidate {
  san: string;
  /** White-POV score of the position after this move. */
  score: Score;
  /** Continuation after this move, SAN, excluding the move itself. */
  continuation: string[];
  /** Win percentage given up against the engine's best, from the mover's side. */
  loss: number;
  verdict: Verdict;
  /** True when the repertoire lists this move as mine. */
  inBook: boolean;
  /** The note stored against it, when it is in book. */
  note?: string;
}

/** What the engine and a repertoire jointly say about one position. */
export interface PositionAudit {
  fen: string;
  /** Whose move it is. */
  mover: Side;
  depth: number;
  /** Best first, engine order. */
  candidates: Candidate[];
  /**
   * Book moves the engine's top lines never mentioned. Absence from a MultiPV
   * list is weak evidence — it means "not top N", not "bad" — so these are
   * reported as unrated rather than folded in with a guessed score.
   */
  unratedBookMoves: string[];
  /** The best-scoring book move, when at least one was rated. */
  bookBest?: Candidate;
  /** True when the engine's own first choice is already in the repertoire. */
  bookHasEngineChoice: boolean;
}

/**
 * Cross-reference an analysis against a repertoire.
 *
 * `rep` may be null — for a collection game with no matching repertoire, the
 * cross-reference is simply empty and the scores still stand on their own.
 */
export function auditPosition(
  analysis: Analysis,
  rep: Repertoire | null,
): PositionAudit {
  const { fen } = analysis;
  const mover = turnOf(fen);

  const bookMoves = rep
    ? getNode(rep, fen).moves.filter((m) => m.isMine)
    : [];
  const bookBySan = new Map(bookMoves.map((m) => [m.san, m]));

  // Engine order, not score order: with MultiPV the engine has already sorted
  // these, and at mixed depths re-sorting on score can put a shallow line first.
  //
  // Deduplicated by first move as a belt-and-braces measure. The engine layer
  // publishes whole depth iterations precisely so this cannot happen, but a
  // repeated move here would render as two rows with the same React key and
  // silently drop one of them, which is a far worse failure than a short list.
  const seen = new Set<string>();
  const rated = analysis.lines.filter((l) => {
    if (!l.san.length || seen.has(l.san[0])) return false;
    seen.add(l.san[0]);
    return true;
  });
  const best = rated[0];

  const candidates: Candidate[] = rated.map((line) => {
    const san = line.san[0];
    const edge = bookBySan.get(san);
    const loss = best ? lossPct(best.score, line.score, mover) : 0;

    return {
      san,
      score: line.score,
      continuation: line.san.slice(1),
      loss,
      verdict: classify(loss),
      inBook: edge !== undefined,
      note: edge?.note || undefined,
    };
  });

  const rankedSans = new Set(candidates.map((c) => c.san));
  const unratedBookMoves = bookMoves
    .map((m) => m.san)
    .filter((san) => !rankedSans.has(san));

  const bookRated = candidates.filter((c) => c.inBook);
  const bookBest = bookRated.length
    ? bookRated.reduce((a, b) =>
        // Compare from the mover's side: for Black, a lower White-POV score is
        // the better move.
        (mover === 'w' ? scoreValue(b.score) > scoreValue(a.score)
                       : scoreValue(b.score) < scoreValue(a.score))
          ? b
          : a,
      )
    : undefined;

  return {
    fen,
    mover,
    depth: analysis.depth,
    candidates,
    unratedBookMoves,
    bookBest,
    bookHasEngineChoice: candidates[0]?.inBook ?? false,
  };
}

/**
 * The repertoire a position belongs to, if any.
 *
 * Prefers one that actually contains the position over one that merely plays
 * the right colour, because the whole point is to compare against the book
 * that has an opinion here. Ties break toward `primary`.
 */
export function repertoireFor(
  repertoires: Repertoire[],
  fen: string,
): Repertoire | null {
  const mover = turnOf(fen);
  const live = repertoires.filter((r) => r.state !== 'parked');

  const knows = live.filter(
    (r) => r.side === mover && getNode(r, fen).moves.some((m) => m.isMine),
  );
  if (knows.length) {
    return knows.find((r) => r.state === 'primary') ?? knows[0];
  }

  // The position is off-book. Still worth naming the repertoire that owns the
  // colour, so the panel can say "not in <name>" instead of staying silent.
  const bySide = live.filter((r) => r.side === mover);
  return bySide.find((r) => r.state === 'primary') ?? bySide[0] ?? null;
}

/** How a move actually played compares with the book and the engine. */
export interface MoveVerdict {
  san: string;
  /** True when the repertoire lists this as one of my moves here. */
  inBook: boolean;
  /** True only when this is literally the engine's first choice. */
  isTop: boolean;
  /** Present when the engine ranked it. */
  loss?: number;
  verdict?: Verdict;
  /** The engine's own choice, for contrast. */
  engineBest?: string;
  /** The best book move, when the played move was not it. */
  bookAlternative?: Candidate;
}

/**
 * Judge one specific move in an audited position — the move a game played, or
 * the move I chose in a drill.
 *
 * A move the engine did not rank gets no verdict rather than a bad one. With
 * MultiPV 3, everything from the fourth-best move down is unranked, and most
 * of those are perfectly reasonable.
 */
export function judgeMove(audit: PositionAudit, san: string): MoveVerdict {
  const ranked = audit.candidates.find((c) => c.san === san);
  const inBook =
    ranked?.inBook ?? audit.unratedBookMoves.includes(san);

  return {
    san,
    inBook,
    isTop: audit.candidates[0]?.san === san,
    loss: ranked?.loss,
    verdict: ranked?.verdict,
    engineBest: audit.candidates[0]?.san,
    bookAlternative:
      audit.bookBest && audit.bookBest.san !== san ? audit.bookBest : undefined,
  };
}

/**
 * Rate a move the MultiPV list never reached, using a separate search of the
 * position it leads to.
 *
 * Needed because "outside the engine's top 3" is a fine thing to say while
 * browsing, but useless in a mistake review: there the book move's cost is the
 * one number worth having, and leaving it blank next to a rated mistake reads
 * as "your repertoire is wrong" when it means nothing of the sort. Searching
 * the child position is the honest way to get it — a real search of that line,
 * not an extrapolation.
 *
 * `scoreAfter` must be White-POV and come from a search one ply shallower than
 * the parent's, so the two are comparable.
 */
export function rateFromFollowUp(
  audit: PositionAudit,
  san: string,
  scoreAfter: Score,
): MoveVerdict {
  const best = audit.candidates[0];
  const loss = best ? lossPct(best.score, scoreAfter, audit.mover) : 0;

  return {
    san,
    inBook: audit.unratedBookMoves.includes(san),
    // A move the top-N list never reached is by definition not the top line.
    isTop: false,
    loss,
    verdict: classify(loss),
    engineBest: best?.san,
    bookAlternative:
      audit.bookBest && audit.bookBest.san !== san ? audit.bookBest : undefined,
  };
}

/**
 * One line-summary of what the engine adds to a repertoire's opinion here.
 *
 * Written as the answer to "should I change anything", because that is the only
 * reason to have turned the engine on. Positions where book and engine agree
 * say so plainly and briefly — that is the common case and it needs no essay.
 */
export function summarise(audit: PositionAudit, repName?: string): string {
  const book = repName ? `in ${repName}` : 'in your repertoire';

  if (!audit.candidates.length) return 'No engine lines yet.';

  if (audit.bookHasEngineChoice) {
    return `Your book move is the engine's first choice.`;
  }

  if (!audit.bookBest) {
    if (audit.unratedBookMoves.length) {
      return `Your move ${audit.unratedBookMoves.join('/')} is outside the engine's top ${audit.candidates.length} — playable, but not confirmed here.`;
    }
    return `Nothing ${book} for this position. Engine prefers ${audit.candidates[0].san}.`;
  }

  const { bookBest } = audit;
  const engine = audit.candidates[0];

  if (bookBest.verdict === 'best' || bookBest.verdict === 'good') {
    return `${bookBest.san} holds up — ${bookBest.loss.toFixed(1)}% behind ${engine.san}, which is noise at this depth.`;
  }

  return `${bookBest.san} gives up ${bookBest.loss.toFixed(1)}% against ${engine.san}. Worth a look.`;
}
