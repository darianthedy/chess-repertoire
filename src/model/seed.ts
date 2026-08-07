import { emptyNodes } from './tree';
import type { AppState, Repertoire, Side, Slot } from './types';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * The default slots are a *structural partition* of the game — every game ever
 * played falls into exactly one — not a statement about which openings are
 * played. They are ordinary editable data; the app must never assume this set.
 */
export const DEFAULT_SLOTS: Slot[] = [
  { id: 'slot-white', name: 'White', order: 0 },
  { id: 'slot-vs-e4', name: 'Black vs 1.e4', order: 1 },
  { id: 'slot-vs-d4', name: 'Black vs 1.d4', order: 2 },
  { id: 'slot-vs-side', name: 'Black vs sidelines', order: 3 },
];

/** Default side for a seeded slot; a fallback only, always overridable. */
export function defaultSideForSlot(slotId: string): Side {
  return slotId === 'slot-white' ? 'w' : 'b';
}

export function initialState(): AppState {
  return {
    version: 1,
    slots: DEFAULT_SLOTS,
    repertoires: [],
    collections: [],
    cards: {},
    streak: null,
  };
}

export function makeRepertoire(
  slotId: string,
  name: string,
  side: Side,
): Repertoire {
  return {
    id: newId(),
    slotId,
    name,
    side,
    state: 'active',
    // Starting drill window. Storage depth is unlimited and independent.
    activeDepth: 8,
    createdAt: Date.now(),
    nodes: emptyNodes(),
  };
}
