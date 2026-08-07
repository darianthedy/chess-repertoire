import { ROOT_FEN } from './fen';
import { getNode, isMyTurn } from './tree';
import type { PathStep } from './tree';
import { cardKey, DAY, isDue } from './srs';
import type { AppState, CardState, Repertoire } from './types';

/** One puzzle: a root-to-leaf walk through a repertoire. */
export interface DrillLine {
  repertoireId: string;
  steps: PathStep[];
  /** Positions in this line that carry SM-2 cards (my move, within active depth). */
  cardFens: string[];
}

/**
 * Shortest distance in ply from the root to every reachable position.
 *
 * Shortest rather than any path because the tree is a DAG once transpositions
 * collapse: a position's depth should be how soon it can actually arise, not
 * how long the route that happened to create it was.
 */
export function depthMap(rep: Repertoire): Record<string, number> {
  const depths: Record<string, number> = { [ROOT_FEN]: 0 };
  const queue = [ROOT_FEN];

  while (queue.length) {
    const fen = queue.shift() as string;
    const d = depths[fen];
    for (const edge of getNode(rep, fen).moves) {
      if (depths[edge.to] === undefined) {
        depths[edge.to] = d + 1;
        queue.push(edge.to);
      }
    }
  }
  return depths;
}

/**
 * A position where I've stored more than one move of my own.
 *
 * Every edge leaving a position where it's my turn is mine — tree.ts derives
 * `isMine` from the turn rather than asking — so "more than one continuation"
 * is exactly "more than one move I would play here". There is no single right
 * answer to test, so the drill plays one of them for me instead of grading a
 * choice I deliberately left open (PRODUCT.md §6, F3).
 */
export function isAmbiguous(rep: Repertoire, fen: string): boolean {
  return isMyTurn(rep, fen) && getNode(rep, fen).moves.length > 1;
}

/**
 * Positions that generate cards: my move, exactly one continuation, and inside
 * the repertoire's drill window. Deeper positions stay stored and are still
 * played through during a drill — they're just not graded.
 *
 * Requiring exactly one continuation is what keeps ambiguous positions out of
 * the schedule entirely: a card that can never be answered would sit in
 * `dueCount` forever, and drawing a puzzle at one would only ask a question
 * with several right answers.
 */
export function drillableFens(
  rep: Repertoire,
  depths = depthMap(rep),
): string[] {
  const maxPly = rep.activeDepth * 2;
  return Object.keys(depths).filter(
    (fen) =>
      depths[fen] < maxPly &&
      isMyTurn(rep, fen) &&
      getNode(rep, fen).moves.length === 1,
  );
}

/** Breadth-first path from the root to a target position. */
function pathToTarget(rep: Repertoire, target: string): PathStep[] | null {
  if (target === ROOT_FEN) return [];

  const parent: Record<string, { fen: string; san: string }> = {};
  const seen = new Set([ROOT_FEN]);
  const queue = [ROOT_FEN];

  while (queue.length) {
    const fen = queue.shift() as string;
    for (const edge of getNode(rep, fen).moves) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      parent[edge.to] = { fen, san: edge.san };
      if (edge.to === target) {
        const steps: PathStep[] = [];
        let cur = target;
        while (cur !== ROOT_FEN) {
          const p = parent[cur];
          steps.unshift({ san: p.san, fen: cur });
          cur = p.fen;
        }
        return steps;
      }
      queue.push(edge.to);
    }
  }
  return null;
}

/**
 * Extend a position forward to the end of a line, taking the first continuation
 * at each branch. Other branches aren't skipped — they surface as their own
 * lines when their own cards fall due.
 */
function walkToLeaf(rep: Repertoire, from: string): PathStep[] {
  const steps: PathStep[] = [];
  const seen = new Set([from]);
  let cur = from;

  for (;;) {
    const edge = getNode(rep, cur).moves[0];
    // Transpositions make this a graph, so a cycle is possible in principle.
    if (!edge || seen.has(edge.to)) break;
    seen.add(edge.to);
    steps.push({ san: edge.san, fen: edge.to });
    cur = edge.to;
  }
  return steps;
}

/** Build a full root-to-leaf line passing through `target`. */
export function lineThrough(
  rep: Repertoire,
  target: string,
  depths = depthMap(rep),
): DrillLine | null {
  const prefix = pathToTarget(rep, target);
  if (prefix === null) return null;

  const steps = [...prefix, ...walkToLeaf(rep, target)];
  const maxPly = rep.activeDepth * 2;

  const cardFens: string[] = [];
  // The root is a drillable position too when I move first.
  const positions = [ROOT_FEN, ...steps.map((s) => s.fen)];
  for (const fen of positions) {
    const d = depths[fen];
    if (
      d !== undefined &&
      d < maxPly &&
      isMyTurn(rep, fen) &&
      getNode(rep, fen).moves.length === 1
    ) {
      cardFens.push(fen);
    }
  }

  return { repertoireId: rep.id, steps, cardFens };
}

/**
 * Weighting for one repertoire: least-recently-drilled comes up most.
 *
 * Idle time saturates after a week — past that, "ages ago" and "even longer
 * ago" are the same thing, and letting the ratio grow without bound would make
 * a long-untouched repertoire monopolise the session.
 */
const IDLE_SATURATION = 7 * DAY;

/** Floor and ceiling of the repertoire draw weight, so nothing is unreachable. */
const MIN_REP_WEIGHT = 1;
const MAX_REP_WEIGHT = 8;

/**
 * How many recently drilled positions to keep out of the draw, so a short
 * session doesn't loop over the same handful of puzzles.
 */
export const RECENT_MEMORY = 24;

interface Pool {
  rep: Repertoire;
  weight: number;
  fens: { fen: string; weight: number }[];
}

/**
 * Draw weight for one position.
 *
 * Unseen and overdue positions dominate, but a well-known position never drops
 * to zero: drilling is now open-ended, so "nothing left today" isn't an answer
 * the picker is allowed to give.
 */
function cardWeight(card: CardState | undefined, now: number): number {
  if (!card) return 4;
  if (card.dueAt <= now) {
    return 4 + Math.min((now - card.dueAt) / DAY, 20);
  }
  // Not due yet: weight rises as the due date approaches, measured against the
  // card's own interval so a 200-day card isn't treated like a 2-day one.
  const remaining = (card.dueAt - now) / DAY;
  const span = Math.max(card.interval, 1);
  return Math.max(0.25, 3 * (1 - remaining / span));
}

/** Draw weight for one repertoire: idle time, halved while on trial. */
function repWeight(rep: Repertoire, lastDrilled: number, now: number): number {
  const idle = Math.min(Math.max(now - lastDrilled, 0), IDLE_SATURATION);
  const w =
    MIN_REP_WEIGHT +
    (MAX_REP_WEIGHT - MIN_REP_WEIGHT) * (idle / IDLE_SATURATION);
  // An opening still being evaluated shouldn't take an equal share of practice.
  return rep.state === 'trial' ? w / 2 : w;
}

/** Every drillable position, grouped by repertoire, minus anything skipped. */
function pools(state: AppState, now: number, skip: Set<string>): Pool[] {
  const out: Pool[] = [];
  for (const rep of state.repertoires) {
    if (rep.state === 'parked') continue;
    const fens = drillableFens(rep)
      .filter((fen) => !skip.has(cardKey(rep.id, fen)))
      .map((fen) => ({
        fen,
        weight: cardWeight(state.cards[cardKey(rep.id, fen)], now),
      }));
    if (!fens.length) continue;
    out.push({
      rep,
      weight: repWeight(rep, state.lastDrilled[rep.id] ?? 0, now),
      fens,
    });
  }
  return out;
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rand: () => number): T {
  const total = items.reduce((sum, t) => sum + weight(t), 0);
  let r = rand() * total;
  for (const item of items) {
    r -= weight(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Draw the next puzzle. Endless by design — there is no session queue and no
 * daily cap, so drilling starts whenever and runs until it's stopped.
 *
 * The draw is two-stage: repertoire first, then position within it. Picking
 * across one flat list would hand the session to whichever repertoire has the
 * most positions; picking the repertoire first is what makes the
 * least-recently-drilled weighting mean anything.
 */
export function pickLine(
  state: AppState,
  now: number,
  recent: string[] = [],
  rand: () => number = Math.random,
): DrillLine | null {
  const skipped = pools(state, now, new Set(recent));
  // Falling back to the full set matters for a small repertoire, where the
  // recent window can swallow every position there is.
  const available = skipped.length ? skipped : pools(state, now, new Set());
  if (!available.length) return null;

  const pool = weightedPick(available, (p) => p.weight, rand);
  const target = weightedPick(pool.fens, (f) => f.weight, rand);
  return lineThrough(pool.rep, target.fen);
}

/** Record that a repertoire was just drilled, for the recency weighting. */
export function touchRepertoire(
  state: AppState,
  repertoireId: string,
  now: number,
): AppState {
  return {
    ...state,
    lastDrilled: { ...state.lastDrilled, [repertoireId]: now },
  };
}

/**
 * Whether there is anything at all to drill. Not the same question as "is
 * anything due": drilling no longer waits for due dates, so the only thing that
 * can stop a session starting is an empty repertoire.
 */
export function canDrill(state: AppState): boolean {
  return state.repertoires.some(
    (r) => r.state !== 'parked' && drillableFens(r).length > 0,
  );
}

/** How many cards are due right now, for the home screen. */
export function dueCount(state: AppState, now: number): number {
  let count = 0;
  for (const rep of state.repertoires) {
    if (rep.state === 'parked') continue;
    for (const fen of drillableFens(rep)) {
      if (isDue(state.cards[cardKey(rep.id, fen)], now)) count++;
    }
  }
  return count;
}
