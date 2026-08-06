import { useCallback, useState } from 'react';
import { fetchRecentGames } from '../model/chesscom';
import { analyseGames, describePath, groupDeviations } from '../model/deviation';
import type { DeviationGroup } from '../model/deviation';
import type { PathStep } from '../model/tree';
import type { AppState } from '../model/types';

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
