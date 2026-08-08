import { get, set } from 'idb-keyval';
import { bareSan } from './san';
import { initialState } from './seed';
import { emptyNodes } from './tree';
import { DEFAULT_ENGINE_SETTINGS } from './types';
import type { AppState, EngineSettings, Repertoire } from './types';

const KEY = 'chess-repertoire:state:v1';

export async function loadState(): Promise<AppState> {
  try {
    const raw = await get<unknown>(KEY);
    if (!raw) return initialState();
    return parseState(raw);
  } catch {
    // A corrupt or unreadable store must not brick the app. Worst case the
    // user re-imports their last JSON export.
    return initialState();
  }
}

export async function saveState(state: AppState): Promise<void> {
  await set(KEY, state);
}

/**
 * Validate an unknown blob into AppState.
 *
 * Deliberately lenient about extra fields and strict about structure: this is
 * the entry point for hand-edited and older exports, and silently accepting a
 * malformed tree would corrupt the store rather than fail loudly.
 */
export function parseState(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Not an object');
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.slots) || !Array.isArray(obj.repertoires)) {
    throw new Error('Missing slots or repertoires');
  }

  const slots = obj.slots.map((s, i) => {
    const o = s as Record<string, unknown>;
    if (typeof o?.id !== 'string' || typeof o?.name !== 'string') {
      throw new Error(`Bad slot at index ${i}`);
    }
    return {
      id: o.id,
      name: o.name,
      order: typeof o.order === 'number' ? o.order : i,
    };
  });

  const repertoires = obj.repertoires.map((r, i) => parseRepertoire(r, i));

  // Cards and streak arrived in Phase 2; exports predating it load with an
  // empty review history rather than failing.
  const cards =
    typeof obj.cards === 'object' && obj.cards !== null
      ? (obj.cards as AppState['cards'])
      : {};

  // Drill recency arrived with open-ended drilling; older exports load as
  // "never drilled", which simply means everything is equally overdue.
  const lastDrilled: Record<string, number> = {};
  if (typeof obj.lastDrilled === 'object' && obj.lastDrilled !== null) {
    for (const [id, at] of Object.entries(obj.lastDrilled)) {
      if (typeof at === 'number') lastDrilled[id] = at;
    }
  }

  const s = obj.streak as Record<string, unknown> | undefined;
  const streak =
    s && typeof s.count === 'number' && typeof s.lastDate === 'string'
      ? { count: s.count, lastDate: s.lastDate }
      : null;

  const chesscomUsername =
    typeof obj.chesscomUsername === 'string' ? obj.chesscomUsername : undefined;

  // Collections arrived after cards; older exports load without them.
  const collections = Array.isArray(obj.collections)
    ? (obj.collections as AppState['collections']).filter(
        (c) => c && typeof c.id === 'string' && Array.isArray(c.games),
      )
    : [];

  // Engine settings arrived last; older exports load with it switched off,
  // which is also the default for a fresh install.
  const e = obj.engine as Record<string, unknown> | undefined;
  const engine: EngineSettings = {
    enabled: e?.enabled === true,
    depth:
      typeof e?.depth === 'number' && e.depth >= 6 && e.depth <= 30
        ? e.depth
        : DEFAULT_ENGINE_SETTINGS.depth,
  };

  return {
    version: 1,
    slots,
    repertoires,
    collections,
    cards,
    streak,
    lastDrilled,
    chesscomUsername,
    engine,
  };
}

function parseRepertoire(raw: unknown, index: number): Repertoire {
  const o = raw as Record<string, unknown>;
  if (typeof o?.id !== 'string' || typeof o?.name !== 'string') {
    throw new Error(`Bad repertoire at index ${index}`);
  }

  const nodes =
    typeof o.nodes === 'object' && o.nodes !== null
      ? bareSans(o.nodes as Repertoire['nodes'])
      : emptyNodes();

  return {
    id: o.id,
    slotId: typeof o.slotId === 'string' ? o.slotId : '',
    name: o.name,
    side: o.side === 'b' ? 'b' : 'w',
    state:
      o.state === 'primary' ||
      o.state === 'trial' ||
      o.state === 'parked' ||
      o.state === 'active'
        ? o.state
        : 'active',
    activeDepth: typeof o.activeDepth === 'number' ? o.activeDepth : 8,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    nodes,
  };
}

/**
 * Heal SAN written before it was canonicalised. Moves entered on the board used
 * to be stored as chess.js spells them (`Bxf7+`) while imported PGN was stored
 * bare, so a checking move could be unmatchable by the very move that produced
 * it. Cheap enough to run on every load, and it keeps old exports usable.
 */
function bareSans(nodes: Repertoire['nodes']): Repertoire['nodes'] {
  const healed: Repertoire['nodes'] = {};
  for (const [fen, node] of Object.entries(nodes)) {
    healed[fen] = {
      ...node,
      moves: Array.isArray(node?.moves)
        ? node.moves.map((m) => ({ ...m, san: bareSan(m.san) }))
        : [],
    };
  }
  return healed;
}

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

/** Trigger a download of the current state as a timestamped JSON file. */
export function downloadJson(state: AppState): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([exportJson(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chess-repertoire-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
