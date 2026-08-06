import { chessAt, normalizeFen, ROOT_FEN } from './fen';
import type { MoveEdge, Repertoire, TreeNode } from './types';

/** A position reached along a line, with the move that led to it. */
export interface PathStep {
  san: string;
  fen: string;
}

export function emptyNodes(): Record<string, TreeNode> {
  return { [ROOT_FEN]: { fen: ROOT_FEN, moves: [] } };
}

export function getNode(rep: Repertoire, fen: string): TreeNode {
  return rep.nodes[fen] ?? { fen, moves: [] };
}

/** Whether it's my move in this position, given the side I play here. */
export function isMyTurn(rep: Repertoire, fen: string): boolean {
  return fen.split(' ')[1] === rep.side;
}

/**
 * Try to play `san` from `fen`. Returns the resulting normalized FEN, or null
 * if the move is illegal.
 */
export function tryMove(fen: string, san: string): string | null {
  const chess = chessAt(fen);
  try {
    const move = chess.move(san);
    if (!move) return null;
    return normalizeFen(chess.fen());
  } catch {
    return null;
  }
}

/**
 * Add an edge. Returns a new Repertoire; existing edges with the same SAN are
 * left untouched so re-adding a known move is a no-op rather than a duplicate.
 */
export function addMove(
  rep: Repertoire,
  fromFen: string,
  san: string,
  note: string,
): Repertoire {
  const toFen = tryMove(fromFen, san);
  if (!toFen) return rep;

  const from = getNode(rep, fromFen);
  if (from.moves.some((m) => m.san === san)) return rep;

  const edge: MoveEdge = {
    san,
    // Derived, never asked: if it's my turn in this position, it's my move.
    // Making this an explicit toggle would only create a way to get it wrong.
    isMine: isMyTurn(rep, fromFen),
    note,
    to: toFen,
  };

  return {
    ...rep,
    nodes: {
      ...rep.nodes,
      [fromFen]: { ...from, fen: fromFen, moves: [...from.moves, edge] },
      // Only create the destination if it's genuinely new — a transposition
      // must land on the existing node and keep its continuations.
      ...(rep.nodes[toFen] ? {} : { [toFen]: { fen: toFen, moves: [] } }),
    },
  };
}

export function updateNote(
  rep: Repertoire,
  fromFen: string,
  san: string,
  note: string,
): Repertoire {
  const from = getNode(rep, fromFen);
  return {
    ...rep,
    nodes: {
      ...rep.nodes,
      [fromFen]: {
        ...from,
        moves: from.moves.map((m) => (m.san === san ? { ...m, note } : m)),
      },
    },
  };
}

export function setPlan(
  rep: Repertoire,
  fen: string,
  plan: string,
): Repertoire {
  const node = getNode(rep, fen);
  return {
    ...rep,
    nodes: {
      ...rep.nodes,
      [fen]: { ...node, fen, plan: plan.trim() ? plan : undefined },
    },
  };
}

/**
 * Remove an edge, then drop every node no longer reachable from the root.
 *
 * Reachability is the right test rather than deleting the subtree outright:
 * with transpositions, a position under the deleted move may still be reachable
 * by another route, and must survive.
 */
export function deleteMove(
  rep: Repertoire,
  fromFen: string,
  san: string,
): Repertoire {
  const from = getNode(rep, fromFen);
  const pruned: Repertoire = {
    ...rep,
    nodes: {
      ...rep.nodes,
      [fromFen]: { ...from, moves: from.moves.filter((m) => m.san !== san) },
    },
  };
  return collectGarbage(pruned);
}

function collectGarbage(rep: Repertoire): Repertoire {
  const reachable = new Set<string>();
  const queue = [ROOT_FEN];

  while (queue.length) {
    const fen = queue.pop() as string;
    if (reachable.has(fen)) continue;
    reachable.add(fen);
    for (const edge of getNode(rep, fen).moves) queue.push(edge.to);
  }

  const nodes: Record<string, TreeNode> = {};
  for (const fen of reachable) {
    if (rep.nodes[fen]) nodes[fen] = rep.nodes[fen];
  }
  nodes[ROOT_FEN] ??= { fen: ROOT_FEN, moves: [] };

  return { ...rep, nodes };
}

/** Total positions in the tree, excluding the root. */
export function positionCount(rep: Repertoire): number {
  return Math.max(0, Object.keys(rep.nodes).length - 1);
}

/** Positions where it's my move — the ones that will become drill cards. */
export function myPositionCount(rep: Repertoire): number {
  return Object.keys(rep.nodes).filter(
    (fen) => isMyTurn(rep, fen) && getNode(rep, fen).moves.length > 0,
  ).length;
}
