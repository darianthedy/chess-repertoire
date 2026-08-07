import { useCallback, useState } from 'react';
import { fetchRecentGames } from '../model/chesscom';
import {
  collectionFromChesscom,
  collectionFromPgn,
} from '../model/collections';
import { looksLikePgn } from '../model/pgn';
import type { AppState } from '../model/types';

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState | null>>;
  onOpen: (collectionId: string) => void;
  onBack: () => void;
}

/**
 * The library: saved PGN collections to read and pick from.
 *
 * Deliberately separate from repertoires. A collection is source material —
 * master games, an opening book, my own games — and merging a whole file into a
 * repertoire is almost always wrong, because one file usually spans several
 * openings and both colours.
 */
export function Collections({ state, setState, onOpen, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState(state.chesscomUsername ?? '');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteName, setPasteName] = useState('');

  const add = useCallback(
    (collection: ReturnType<typeof collectionFromPgn>) => {
      if (!collection.games.length) {
        setError('No games found in that PGN');
        return;
      }
      setState((s) =>
        s ? { ...s, collections: [collection, ...s.collections] } : s,
      );
      setError(null);
      onOpen(collection.id);
    },
    [onOpen, setState],
  );

  const addFile = useCallback(
    async (file: File) => {
      setError(null);
      const text = await file.text();
      if (!looksLikePgn(text)) {
        setError("That doesn't look like PGN — no move numbers or tags found.");
        return;
      }
      add(collectionFromPgn(file.name.replace(/\.pgn$/i, ''), text, 'file'));
    },
    [add],
  );

  const addChesscom = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const games = await fetchRecentGames(handle, 2);
      if (!games.length) throw new Error('No recent games found');
      setState((s) => (s ? { ...s, chesscomUsername: handle.trim() } : s));
      add(collectionFromChesscom(`${handle.trim()} — recent games`, games));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach chess.com');
    } finally {
      setBusy(false);
    }
  }, [add, handle, setState]);

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete the collection "${name}"? Repertoires are unaffected.`))
      return;
    setState((s) =>
      s ? { ...s, collections: s.collections.filter((c) => c.id !== id) } : s,
    );
  };

  return (
    <div className="games">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          ← All repertoires
        </button>
        <div className="editor__title">
          <strong>Games</strong>
        </div>
      </header>

      <section className="card">
        <h2>Add a collection</h2>

        <label className="field">
          <span>Upload a PGN file</span>
          {/* No accept filter: mobile pickers hide .pgn, which the OS doesn't
              recognise. Contents are validated instead. */}
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addFile(f);
              e.target.value = '';
            }}
          />
        </label>

        <label className="field">
          <span>…or pull your recent chess.com games</span>
          <div className="row">
            <input
              value={handle}
              placeholder="chess.com username"
              onChange={(e) => setHandle(e.target.value)}
            />
            <button
              onClick={() => void addChesscom()}
              disabled={busy || !handle.trim()}
            >
              {busy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
        </label>

        <button className="link" onClick={() => setPasteOpen((p) => !p)}>
          {pasteOpen ? '– paste PGN instead' : '+ paste PGN instead'}
        </button>
        {pasteOpen && (
          <>
            <label className="field">
              <span>Name</span>
              <input
                value={pasteName}
                placeholder="e.g. Caro-Kann model games"
                onChange={(e) => setPasteName(e.target.value)}
              />
            </label>
            <textarea
              rows={4}
              value={pasteText}
              placeholder="Paste one or more games…"
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <button
                className="primary"
                disabled={!pasteText.trim()}
                onClick={() =>
                  add(
                    collectionFromPgn(
                      pasteName.trim() || 'Pasted games',
                      pasteText,
                      'paste',
                    ),
                  )
                }
              >
                Save collection
              </button>
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </section>

      <section className="gaps">
        <h2>
          {state.collections.length} collection
          {state.collections.length === 1 ? '' : 's'}
        </h2>
        {state.collections.length === 0 ? (
          <p className="muted small">
            Nothing saved yet. Collections are source material — read them, then
            pick individual lines into a repertoire.
          </p>
        ) : (
          <ul className="reps">
            {state.collections.map((c) => (
              <li key={c.id} className="rep">
                <button className="rep__open" onClick={() => onOpen(c.id)}>
                  <strong>{c.name}</strong>
                  <span className="muted small">
                    {c.games.length} game{c.games.length === 1 ? '' : 's'} ·{' '}
                    {c.source}
                  </span>
                </button>
                <button
                  className="icon icon--danger"
                  title="Delete collection"
                  onClick={() => remove(c.id, c.name)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
