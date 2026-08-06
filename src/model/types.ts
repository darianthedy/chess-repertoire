/**
 * Core data model.
 *
 * Nothing about which openings are played is encoded here or anywhere else in
 * source — slots and repertoires are user data, per docs/PRODUCT.md §5.
 */

export type Side = 'w' | 'b';

/**
 * `primary` — the default weapon for its slot; full card intake.
 * `active`  — an alternative in regular rotation; full card intake.
 * `trial`   — being evaluated; capped intake, excluded from streak math.
 * `parked`  — retained and exportable, generates no cards.
 */
export type RepertoireState = 'primary' | 'active' | 'trial' | 'parked';

/** The situation a repertoire answers. User-editable data, not schema. */
export interface Slot {
  id: string;
  name: string;
  order: number;
}

/** An edge out of a position: one candidate move. */
export interface MoveEdge {
  san: string;
  /** True when this is my repertoire move, false when it's an opponent option. */
  isMine: boolean;
  /**
   * The "why". Required on my own moves — a move without a reason evaporates
   * under pressure (PRODUCT.md §5). Optional on opponent moves.
   */
  note: string;
  /** Normalized FEN of the resulting position. */
  to: string;
}

export interface TreeNode {
  /** Normalized FEN (placement, turn, castling, ep) — see fen.ts. */
  fen: string;
  moves: MoveEdge[];
  /**
   * Terminal plan for a line ending here: "castle short, play ...c5, pressure
   * the d-file". A line ends at a plan, not a move count (PRODUCT.md §6).
   */
  plan?: string;
}

export interface Repertoire {
  id: string;
  slotId: string;
  name: string;
  /** Which side I play in this repertoire. */
  side: Side;
  state: RepertoireState;
  /**
   * Drill window, in full moves. Positions deeper than this are stored and
   * visible but generate no SRS cards. Storage depth itself is unlimited.
   */
  activeDepth: number;
  createdAt: number;
  /** The tree, keyed by normalized FEN. Always contains the root position. */
  nodes: Record<string, TreeNode>;
}

/** SM-2 state for one drillable position. */
export interface CardState {
  ease: number;
  /** Days until the next review. */
  interval: number;
  reps: number;
  dueAt: number;
  lapses: number;
}

export interface AppState {
  version: 1;
  slots: Slot[];
  repertoires: Repertoire[];
  /**
   * Scheduling state, keyed `${repertoireId}:${fen}`. Kept outside the tree so
   * editing a repertoire never disturbs review history, and so a position with
   * no entry here is simply "new".
   */
  cards: Record<string, CardState>;
  /** Consecutive days with a completed session. */
  streak: { count: number; lastDate: string } | null;
}
