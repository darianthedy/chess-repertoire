import { useMemo, useState } from 'react';
import {
  EMPTY_FILTER,
  filterGames,
  firstMoves,
  gameLabel,
  gameOpening,
} from '../model/collections';
import type { AppState, Collection } from '../model/types';

interface Props {
  state: AppState;
  collection: Collection;
  onOpenGame: (gameId: string) => void;
  onReview: (collectionId: string) => void;
  onBack: () => void;
}

/** Browse the games in one collection, filter them, and open one to read. */
export function CollectionView({
  state,
  collection,
  onOpenGame,
  onReview,
  onBack,
}: Props) {
  const [filter, setFilter] = useState(EMPTY_FILTER);

  const games = useMemo(
    () => filterGames(collection.games, filter),
    [collection.games, filter],
  );
  const moves = useMemo(() => firstMoves(collection.games), [collection.games]);

  // Only worth offering game review when the games are actually mine.
  const mine = useMemo(() => {
    const handle = (state.chesscomUsername ?? '').toLowerCase();
    if (!handle) return 0;
    return collection.games.filter(
      (g) =>
        (g.headers.White ?? '').toLowerCase() === handle ||
        (g.headers.Black ?? '').toLowerCase() === handle,
    ).length;
  }, [collection.games, state.chesscomUsername]);

  return (
    <div className="games">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          ← Games
        </button>
        <div className="editor__title">
          <strong>{collection.name}</strong>
          <span className="muted"> · {collection.games.length} games</span>
        </div>
      </header>

      <section className="card">
        <p className="small" style={{ margin: 0 }}>
          {mine > 0
            ? `${mine} of these are yours. `
            : 'Played these yourself? '}
          <button className="link" onClick={() => onReview(collection.id)}>
            Find repertoire gaps →
          </button>
        </p>
      </section>

      <section className="card">
        <div className="row">
          <input
            value={filter.text}
            placeholder="Search player, event, ECO…"
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          />
        </div>
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <select
            value={filter.firstMove}
            onChange={(e) => setFilter({ ...filter, firstMove: e.target.value })}
          >
            <option value="">any first move</option>
            {moves.map((m) => (
              <option key={m} value={m}>
                1.{m}
              </option>
            ))}
          </select>
          <select
            value={filter.result}
            onChange={(e) =>
              setFilter({
                ...filter,
                result: e.target.value as typeof filter.result,
              })
            }
          >
            <option value="">any result</option>
            <option value="1-0">1-0</option>
            <option value="0-1">0-1</option>
            <option value="1/2-1/2">½-½</option>
          </select>
        </div>
      </section>

      <section className="gaps">
        <h2>
          {games.length} game{games.length === 1 ? '' : 's'}
          {games.length !== collection.games.length && (
            <span className="muted"> of {collection.games.length}</span>
          )}
        </h2>

        <ul className="gaps__list">
          {games.map((g) => (
            <li key={g.id}>
              <button className="gamerow" onClick={() => onOpenGame(g.id)}>
                <span className="gamerow__players">
                  {gameLabel(g)}
                  <span className="muted"> {g.headers.Result ?? ''}</span>
                </span>
                <span className="gamerow__opening">{gameOpening(g)}</span>
                <span className="muted small">
                  {[g.headers.ECO, g.headers.Event, g.headers.Date]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
