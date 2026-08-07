import { useCallback, useState } from 'react';
import { colourOf, fetchRecentGames, gamesFromPgn } from '../model/chesscom';
import { looksLikePgn } from '../model/pgn';
import { analyseGames, describePath, groupDeviations } from '../model/deviation';
import type { DeviationGroup } from '../model/deviation';
import type { PathStep } from '../model/tree';
import type { AppState } from '../model/types';

/** The player appearing in every game — almost certainly the file's owner. */
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
  onFix: (repertoireId: string, path: PathStep[]) => void;
  onBack: () => void;
}

/**
 * Review recent chess.com games against the repertoires and surface the gaps.
 *
 * This is the loop the app exists for: play, find where the game left book,
 * patch the tree, drill the patch. It's the one thing a bought course can't do,
 * because the tree has to be mine for the diff to mean anything.
 */
export function Games({ state, setState, onFix, onBack }: Props) {
  const [username, setUsername] = useState(state.chesscomUsername ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<DeviationGroup[] | null>(null);
  const [scanned, setScanned] = useState(0);

  const review = useCallback(async () => {
    setBusy(true);
    setError(null);
    setGroups(null);
    try {
      const games = await fetchRecentGames(username, 2);
      setScanned(games.length);
      const deviations = analyseGames(state.repertoires, games, username);
      setGroups(groupDeviations(deviations));
      setState((s) => (s ? { ...s, chesscomUsername: username.trim() } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach chess.com');
    } finally {
      setBusy(false);
    }
  }, [setState, state.repertoires, username]);

  const reviewFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setGroups(null);
      try {
        const text = await file.text();
        if (!looksLikePgn(text)) {
          throw new Error(
            "That doesn't look like PGN — no move numbers or tags found.",
          );
        }

        const games = gamesFromPgn(text);
        if (!games.length) throw new Error('No games found in that file');

        // The file knows the players but not which one is me. Prefer the typed
        // handle, otherwise take the name common to every game.
        const handle = username.trim() || commonPlayer(games);
        if (!handle) {
          throw new Error(
            'Enter your chess.com username so I know which side is yours — no single player appears in every game.',
          );
        }

        // A file of other people's games has nothing to say about my openings,
        // and would otherwise report a bland "no gaps found".
        const mine = games.filter((g) => colourOf(g, handle) !== null);
        if (!mine.length) {
          throw new Error(
            `"${handle}" doesn't play in any of these games. This looks like someone else's games — try importing it as a repertoire instead.`,
          );
        }
        setUsername(handle);
        setScanned(games.length);
        setGroups(groupDeviations(analyseGames(state.repertoires, games, handle)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that file');
      } finally {
        setBusy(false);
      }
    },
    [state.repertoires, username],
  );

  const repName = (id: string) =>
    state.repertoires.find((r) => r.id === id)?.name ?? 'unknown';

  return (
    <div className="games">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          ← All repertoires
        </button>
        <div className="editor__title">
          <strong>Review games</strong>
        </div>
      </header>

      <section className="card">
        <label className="field">
          <span>Chess.com username</span>
          <div className="row">
            <input
              value={username}
              placeholder="your chess.com handle"
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && void review()}
            />
            <button
              className="primary"
              onClick={() => void review()}
              disabled={busy || !username.trim()}
            >
              {busy ? 'Reading…' : 'Review'}
            </button>
          </div>
        </label>
        <p className="muted small">
          Reads your last two months of public games. Nothing is uploaded and no
          login is needed.
        </p>

        <label className="field">
          <span>…or upload a PGN you downloaded from chess.com</span>
          {/* No `accept` filter: mobile pickers hide .pgn files, since neither
              iOS nor Android recognises the type. */}
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void reviewFile(f);
              e.target.value = '';
            }}
          />
        </label>

        {error && <p className="error">{error}</p>}
      </section>

      {groups && (
        <section className="gaps">
          <h2>
            {groups.length === 0
              ? 'No gaps found'
              : `${groups.length} gap${groups.length === 1 ? '' : 's'}`}
            <span className="muted"> · {scanned} games scanned</span>
          </h2>

          {groups.length === 0 && (
            <p className="muted small">
              Either every game followed your repertoire, or those openings
              aren't in the app yet.
            </p>
          )}

          <ul className="gaps__list">
            {groups.map(({ key, deviation: d, count }) => (
              <li key={key} className="gap">
                <div className="gap__head">
                  <span className="gap__line">{describePath(d.path) || 'start'}</span>
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
                  <a
                    className="muted small"
                    href={d.game.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    view game
                  </a>
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
