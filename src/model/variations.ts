import { ROOT_FEN } from './fen';
import { getNode } from './tree';
import type { PathStep } from './tree';
import type { Repertoire } from './types';

/**
 * One complete line through a repertoire, root to leaf.
 *
 * The tree is stored FEN-keyed and browsed a node at a time, which is the right
 * shape for entering moves and the wrong one for answering "what's actually in
 * here?". A variation is the same data re-projected into the unit I think in —
 * and the same unit the drill presents (PRODUCT.md §6, F3).
 */
export interface Variation {
  /** Stable identity for list keys: the SAN sequence. */
  id: string;
  steps: PathStep[];
  /** Terminal plan on the final position, if one has been written. */
  plan?: string;
  /** Moves of mine along this line. */
  mine: number;
  /** How many of those carry a note. */
  noted: number;
  /**
   * True when every branch taken was the first listed one — the line the drill
   * walks into when it extends a position forward (see lines.ts walkToLeaf).
   */
  main: boolean;
  /** Ends by transposing back into itself rather than at a genuine leaf. */
  cyclic: boolean;
}

/**
 * Transpositions make the tree a DAG, where the number of distinct root-to-leaf
 * paths can grow exponentially. A cap keeps the list screen bounded; hitting it
 * is reported rather than hidden.
 */
export const VARIATION_CAP = 400;

export interface VariationList {
  variations: Variation[];
  truncated: boolean;
}

/** Every root-to-leaf line, main line first, in tree order. */
export function listVariations(
  rep: Repertoire,
  cap = VARIATION_CAP,
): VariationList {
  const out: Variation[] = [];
  let truncated = false;
  const onPath = new Set<string>([ROOT_FEN]);

  // Entered only with room left in `out`, so a leaf push can never exceed the
  // cap, and the cap is reported only when a branch is genuinely left unwalked.
  const walk = (fen: string, steps: PathStep[], main: boolean) => {
    const { moves } = getNode(rep, fen);
    let advanced = false;
    let cyclic = false;

    for (const edge of moves) {
      // A transposition that re-enters the current path would loop forever.
      if (onPath.has(edge.to)) {
        cyclic = true;
        continue;
      }
      if (out.length >= cap) {
        truncated = true;
        return;
      }
      advanced = true;
      onPath.add(edge.to);
      walk(
        edge.to,
        [...steps, { san: edge.san, fen: edge.to }],
        main && edge === moves[0],
      );
      onPath.delete(edge.to);
    }

    // A leaf, or a node whose only continuations loop back — either way the
    // line stops here. The empty root isn't a variation.
    if (!advanced && steps.length) {
      out.push(summarize(rep, steps, main, cyclic));
    }
  };

  walk(ROOT_FEN, [], true);
  return { variations: out, truncated };
}

function summarize(
  rep: Repertoire,
  steps: PathStep[],
  main: boolean,
  cyclic: boolean,
): Variation {
  let mine = 0;
  let noted = 0;

  for (let i = 0; i < steps.length; i++) {
    const from = i === 0 ? ROOT_FEN : steps[i - 1].fen;
    const edge = getNode(rep, from).moves.find((m) => m.san === steps[i].san);
    if (!edge?.isMine) continue;
    mine++;
    if (edge.note.trim()) noted++;
  }

  return {
    id: steps.map((s) => s.san).join(' '),
    steps,
    plan: rep.nodes[steps[steps.length - 1].fen]?.plan,
    mine,
    noted,
    main,
    cyclic,
  };
}

/** Render a line as numbered movetext: `1.d4 d5 2.Nf3`. */
export function variationText(steps: PathStep[]): string {
  return steps
    .map((step, i) => (i % 2 === 0 ? `${i / 2 + 1}.${step.san}` : step.san))
    .join(' ');
}

/** Depth in full moves, for display. */
export function variationDepth(steps: PathStep[]): number {
  return Math.ceil(steps.length / 2);
}
