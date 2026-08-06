import { ROOT_FEN } from './fen';
import { getNode, isMyTurn } from './tree';
import type { PathStep } from './tree';
import { cardKey, isDue, NEW_CARD_CAP, DAILY_CAP } from './srs';
import type { AppState, Repertoire } from './types';

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
 * Positions that generate cards: my move, at least one continuation, and inside
 * the repertoire's drill window. Deeper positions stay stored and are still
 * played through during a drill — they're just not graded.
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
      getNode(rep, fen).moves.length > 0,
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
      getNode(rep, fen).moves.length > 0
    ) {
      cardFens.push(fen);
    }
  }

  return { repertoireId: rep.id, steps, cardFens };
}

/**
 * Assemble today's session.
 *
 * Due cards are pooled across every card-generating repertoire and drawn
 * most-overdue-first against one global cap, so adding a repertoire dilutes a
 * fixed budget rather than multiplying the daily workload. Unseen positions are
 * separately capped so a freshly entered repertoire can't crowd out reviews.
 *
 * Lines from different repertoires are then interleaved: drilling one opening
 * to exhaustion feels smoother and remembers worse.
 */
export function buildSession(state: AppState, now: number): DrillLine[] {
  const active = state.repertoires.filter((r) => r.state !== 'parked');

  const dueSeen: { rep: Repertoire; fen: string; dueAt: number }[] = [];
  const dueNew: { rep: Repertoire; fen: string }[] = [];

  for (const rep of active) {
    const depths = depthMap(rep);
    for (const fen of drillableFens(rep, depths)) {
      const card = state.cards[cardKey(rep.id, fen)];
      if (!card) dueNew.push({ rep, fen });
      else if (isDue(card, now)) dueSeen.push({ rep, fen, dueAt: card.dueAt });
    }
  }

  dueSeen.sort((a, b) => a.dueAt - b.dueAt);

  // `trial` repertoires take a reduced share of the new-card budget so an
  // opening still being evaluated can't dominate the session.
  const newBudget = dueNew.filter(
    (n) => n.rep.state !== 'trial',
  ).slice(0, NEW_CARD_CAP);
  const trialBudget = dueNew
    .filter((n) => n.rep.state === 'trial')
    .slice(0, Math.floor(NEW_CARD_CAP / 3));

  const targets = [
    ...dueSeen.map((d) => ({ rep: d.rep, fen: d.fen })),
    ...newBudget,
    ...trialBudget,
  ];

  const covered = new Set<string>();
  const byRep = new Map<string, DrillLine[]>();
  let cardsQueued = 0;

  for (const { rep, fen } of targets) {
    if (cardsQueued >= DAILY_CAP) break;
    if (covered.has(cardKey(rep.id, fen))) continue;

    const line = lineThrough(rep, fen);
    if (!line) continue;

    // One line usually covers several due positions; don't queue them twice.
    for (const f of line.cardFens) covered.add(cardKey(rep.id, f));
    cardsQueued += line.cardFens.length;

    const list = byRep.get(rep.id) ?? [];
    list.push(line);
    byRep.set(rep.id, list);
  }

  return interleave([...byRep.values()]);
}

/** Round-robin across repertoires so consecutive puzzles differ. */
function interleave(groups: DrillLine[][]): DrillLine[] {
  const out: DrillLine[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest; i++) {
    for (const g of groups) if (g[i]) out.push(g[i]);
  }
  return out;
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
