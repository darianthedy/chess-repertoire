import { useMemo, useState } from 'react';
import { gamesFromCollection } from '../model/collections';
import { analyseGames, describePath, groupDeviations } from '../model/deviation';
import type { PathStep } from '../model/tree';
import type { AppState, Collection } from '../model/types';

/** The player appearing in every game — almost certainly the collection's owner. */
function commonPlayer(games: { white: string; black: string }[]): string {
  const counts = new Map<string, number>();
  for (const g of games) {
    for (const name of new Set([g.white, g.black])) {
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] === games.length ? best[0] : '';
}

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState | null>>;
  collection: Collection;
  onFix: (repertoireId: string, path: PathStep[]) => void;
  onBack: () => void;
}

/**
 * Where a saved collection of my games left my repertoires.
 *
 * This is the loop the app exists for: play, find where the game left book,
 * patch the tree, drill the patch. Collections are built in the library screen;
 * this one only reads them, so there's a single place games come from.
 */
export function Games({ state, setState, collection, onFix, onBack }: Props) {
  const games = useMemo(() => gamesFromCollection(collection), [collection]);
  const [username, setUsername] = useState(
    state.chesscomUsername ||
      commonPlayer(games.map((g) => ({ white: g.white, black: g.black }))),
  );

  const groups = useMemo(() => {
    if (!username.trim()) return null;
    return groupDeviations(analyseGames(state.repertoires, games, username));
  }, [games, state.repertoires, username]);

  const mine = useMemo(
    () =>
      games.filter(
        (g) =>
          g.white.toLowerCase() === username.trim().toLowerCase() ||
          g.black.toLowerCase() === username.trim().toLowerCase(),
      ).length,
    [games, username],
  );

  const repName = (id: string) =>
    state.repertoires.find((r) => r.id === id)?.name ?? 'unknown';

  return (
    <div className="games">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          ← {collection.name}
        </button>
        <div className="editor__title">
          <strong>Repertoire gaps</strong>
        </div>
      </header>

      <section className="card">
        <label className="field">
          <span>Which player are you?</span>
          <input
            value={username}
            placeholder="your username in these games"
            onChange={(e) => {
              setUsername(e.target.value);
              setState((s) =>
                s ? { ...s, chesscomUsername: e.target.value.trim() } : s,
              );
            }}
          />
        </label>
        <p className="muted small">
          {mine} of {games.length} games in this collection are yours.
        </p>
      </section>

      {groups && (
        <section className="gaps">
          <h2>
            {groups.length === 0
              ? 'No gaps found'
              : `${groups.length} gap${groups.length === 1 ? '' : 's'}`}
            <span className="muted"> · {games.length} games scanned</span>
          </h2>

          {groups.length === 0 && (
            <p className="muted small">
              {mine === 0
                ? 'None of these games are yours — check the username above.'
                : 'Every game followed your repertoire, or those openings are not in the app yet.'}
            </p>
          )}

          <ul className="gaps__list">
            {groups.map(({ key, deviation: d, count }) => (
              <li key={key} className="gap">
                <div className="gap__head">
                  <span className="gap__line">
                    {describePath(d.path) || 'start'}
                  </span>
                  {count > 1 && <span className="gap__count">{count} games</span>}
                </div>

                <p className="gap__what">
                  {d.byMe ? (
                    <>
                      You played <strong>{d.playedSan}</strong>
                      {d.expected.length > 0 && (
                        <>
                          {' '}
                          — your repertoire says{' '}
                          <strong>{d.expected.join(' or ')}</strong>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      Opponent played <strong>{d.playedSan}</strong>, which you
                      have no answer to
                    </>
                  )}
                </p>

                <div className="gap__meta">
                  <span className="muted small">{repName(d.repertoireId)}</span>
                  {d.game.url && (
                    <a
                      className="muted small"
                      href={d.game.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view game
                    </a>
                  )}
                  <button onClick={() => onFix(d.repertoireId, d.path)}>
                    Fix in editor
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
