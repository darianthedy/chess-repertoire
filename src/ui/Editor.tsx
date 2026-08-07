import { useCallback, useMemo, useState } from 'react';
import { ROOT_FEN } from '../model/fen';
import {
  fetchStudyPgn,
  importPgn,
  looksLikeGames,
  looksLikePgn,
} from '../model/pgn';
import type { ImportResult } from '../model/pgn';
import {
  addMove,
  deleteMove,
  getNode,
  isMyTurn,
  positionCount,
  positionsLostByRemoving,
  promoteMove,
  replaceMove,
  setLineName,
  setPlan,
  tryMove,
  updateNote,
} from '../model/tree';
import type { PathStep } from '../model/tree';
import type { Repertoire } from '../model/types';
import { LinePanel } from './LinePanel';
import { MoveBoard } from './MoveBoard';

interface Props {
  rep: Repertoire;
  onChange: (fn: (rep: Repertoire) => Repertoire) => void;
  onBack: () => void;
  /** Where `onBack` goes, so the trail back out reads honestly. */
  backLabel?: string;
  /** Open directly at a position — used when fixing a gap found in a game. */
  initialPath?: PathStep[];
}

export function Editor({
  rep,
  onChange,
  onBack,
  backLabel = '← All repertoires',
  initialPath,
}: Props) {
  const [path, setPath] = useState<PathStep[]>(initialPath ?? []);
  // The move being swapped out, if any. The replacement is played on the board
  // rather than typed, so illegal choices can't be expressed in the first place.
  const [replacing, setReplacing] = useState<string | null>(null);
  // Defaults to the side I play here, which is right almost always — but a
  // repertoire is also worth looking at from the opponent's side when working
  // out why a move is annoying to face.
  const [flipped, setFlipped] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [studyUrl, setStudyUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const fen = path.length ? path[path.length - 1].fen : ROOT_FEN;
  const node = getNode(rep, fen);
  const myTurn = isMyTurn(rep, fen);

  const navigateTo = useCallback((steps: PathStep[]) => {
    setPath(steps);
    setReplacing(null);
  }, []);

  /**
   * The move that produced this position, looked up from the position before
   * it. Annotating is done standing on a move rather than pointing at it from
   * the parent: it's the position you're judging, and it's already on screen.
   */
  const parentFen = path.length > 1 ? path[path.length - 2].fen : ROOT_FEN;
  const currentSan = path.length ? path[path.length - 1].san : null;
  const currentEdge = currentSan
    ? getNode(rep, parentFen).moves.find((m) => m.san === currentSan)
    : undefined;

  /**
   * Playing a move adds it and walks into it, with no confirmation step.
   *
   * Notes are optional, so a form gating every move would be friction with
   * nothing behind it — and entering a repertoire means doing this hundreds of
   * times. Annotate afterwards in the Notes panel, which is already pointed at
   * the move you just played; remove a mistake with the ✕ in the line.
   */
  const handleMove = useCallback(
    (san: string): boolean => {
      const to = tryMove(fen, san);
      if (!to) return false;

      if (replacing) {
        // Playing the move that's already there is how you back out.
        if (san !== replacing) {
          // Only reachable through the old move, so only this much is at risk —
          // a position that transposes in elsewhere survives and isn't counted.
          const lost = positionsLostByRemoving(rep, fen, replacing);
          if (
            lost > 1 &&
            !confirm(
              `Replace ${replacing} with ${san}? ${lost - 1} position${
                lost === 2 ? '' : 's'
              } after ${replacing} are reachable no other way and will be deleted.`,
            )
          ) {
            return false;
          }
          onChange((r) => replaceMove(r, fen, replacing, san));
        }
        navigateTo([...path, { san, fen: to }]);
        return true;
      }

      const existing = node.moves.find((m) => m.san === san);
      if (existing) {
        navigateTo([...path, { san, fen: existing.to }]);
        return true;
      }
      onChange((r) => addMove(r, fen, san, ''));
      navigateTo([...path, { san, fen: to }]);
      return true;
    },
    [fen, navigateTo, node.moves, onChange, path, rep, replacing],
  );

  /** Notes on the moves available from here, readable before walking into one. */
  const nextNotes = useMemo(
    () => node.moves.filter((m) => m.note),
    [node.moves],
  );

  const report = useCallback((r: ImportResult) => {
    onChange(() => r.rep);
    setImportMsg(
      `Added ${r.added} move${r.added === 1 ? '' : 's'}` +
        (r.existing ? `, ${r.existing} already present` : '') +
        (r.rejected ? `, ${r.rejected} could not be played` : ''),
    );
    // Jump back to the root: the imported tree is most likely elsewhere, and
    // leaving the board deep in an unrelated line is disorienting.
    setPath([]);
  }, [onChange]);

  const runImport = useCallback(
    (text: string, onDone: () => void) => {
      setImportErr(null);
      setImportMsg(null);

      if (!text.trim()) {
        setImportErr('That file is empty.');
        return;
      }
      if (!looksLikePgn(text)) {
        setImportErr(
          "That doesn't look like PGN — no move numbers or tags found. If it's a .zip or .cbv, unpack it first.",
        );
        return;
      }

      // Games and repertoires are both PGN but mean opposite things. Importing
      // games would add every move both players made — including the opponent's
      // openings from games played with the other colour — so refuse and point
      // at the screen that does the right thing with them.
      if (looksLikeGames(text)) {
        setImportErr(
          'That looks like played games, not a repertoire. Importing it would add your opponents’ moves as your own. Use "Review games" on the home screen instead — it compares games against this repertoire and shows where they left book.',
        );
        return;
      }

      try {
        report(importPgn(rep, text, ROOT_FEN));
        onDone();
      } catch (e) {
        setImportErr(e instanceof Error ? e.message : 'Could not parse that PGN');
      }
    },
    [rep, report],
  );

  const doImportText = useCallback(
    () => runImport(pgnText, () => setPgnText('')),
    [pgnText, runImport],
  );

  const doImportFile = useCallback(
    async (file: File) => {
      runImport(await file.text(), () => {});
    },
    [runImport],
  );

  const doImportStudy = useCallback(async () => {
    setImportErr(null);
    setImportMsg(null);
    setBusy(true);
    try {
      const pgn = await fetchStudyPgn(studyUrl);
      report(importPgn(rep, pgn, ROOT_FEN));
      setStudyUrl('');
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : 'Could not fetch that study');
    } finally {
      setBusy(false);
    }
  }, [rep, report, studyUrl]);

  return (
    <div className="editor">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          {backLabel}
        </button>
        <div className="editor__title">
          <strong>{rep.name}</strong>
          <span className="muted">
            {' '}
            · {rep.side === 'w' ? 'White' : 'Black'} · {positionCount(rep)}{' '}
            positions
          </span>
        </div>
        <button onClick={() => setImportOpen((o) => !o)}>
          {importOpen ? 'Close' : 'Import'}
        </button>
      </header>

      {importOpen && (
        <section className="card card--accent import">
          <h2>Import into this repertoire</h2>
          <p className="muted small">
            Merged into the existing tree — nothing is replaced, and notes you've
            written are kept. Variations and comments are preserved.
          </p>

          <label className="field">
            <span>Lichess study URL or id</span>
            <div className="row">
              <input
                value={studyUrl}
                placeholder="https://lichess.org/study/xxxxxxxx"
                onChange={(e) => setStudyUrl(e.target.value)}
              />
              <button
                className="primary"
                onClick={() => void doImportStudy()}
                disabled={busy || !studyUrl.trim()}
              >
                {busy ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
          </label>

          <label className="field">
            <span>…or upload a .pgn file</span>
            {/* No `accept` filter on purpose: mobile pickers grey out .pgn
                because the OS doesn't know the type. Any file is accepted and
                the contents are validated instead. */}
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImportFile(f);
                e.target.value = '';
              }}
            />
          </label>

          <label className="field">
            <span>…or paste PGN</span>
            <textarea
              rows={5}
              value={pgnText}
              placeholder="1. d4 d5 2. Nf3 Nf6 3. Bf4 (3. c4 e6) 3... c5"
              onChange={(e) => setPgnText(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={doImportText}
            disabled={!pgnText.trim()}
          >
            Import PGN
          </button>

          {importMsg && <p className="small">{importMsg}</p>}
          {importErr && <p className="error">{importErr}</p>}
        </section>
      )}

      {replacing && (
        <p className="card card--accent small replacing">
          Replacing <strong>{replacing}</strong> — play its replacement on the
          board.{' '}
          <button className="link" onClick={() => setReplacing(null)}>
            Cancel
          </button>
        </p>
      )}

      <div className="editor__layout editor__layout--stacked">
        <div className="editor__board">
          <MoveBoard
            fen={fen}
            orientation={
              (rep.side === 'w') !== flipped ? 'white' : 'black'
            }
            onMove={handleMove}
          />
          <div className="editor__nav">
            <button onClick={() => navigateTo([])} disabled={!path.length}>
              « Start
            </button>
            <button
              onClick={() => navigateTo(path.slice(0, -1))}
              disabled={!path.length}
            >
              ← Back
            </button>
            <button onClick={() => setFlipped((f) => !f)} title="Flip board">
              ⇅ Flip
            </button>
          </div>
        </div>

        {/* Everything below the board in reading order: what this move is
            for, what the line as a whole is for, and the line itself as the
            thing you steer with. */}
        <aside className="editor__panel">
          <section className="card">
            <h2>Notes</h2>
            {currentSan && currentEdge ? (
              <>
                <p className="muted small">
                  On <strong>{currentSan}</strong> — the move you're standing on.
                </p>
                <textarea
                  rows={3}
                  className="notes__edit"
                  value={currentEdge.note}
                  placeholder={
                    currentEdge.isMine
                      ? 'Why this move? e.g. stops Bg4, keeps e5 available'
                      : 'e.g. the critical test'
                  }
                  onChange={(e) =>
                    onChange((r) =>
                      updateNote(r, parentFen, currentSan, e.target.value),
                    )
                  }
                />
              </>
            ) : (
              <p className="muted small">
                Starting position — play a move on the board, then annotate it
                here.
              </p>
            )}
            {nextNotes.length > 0 && (
              <ul className="notes__ahead">
                {nextNotes.map((m) => (
                  <li key={m.san}>
                    <button
                      className="moves__san"
                      onClick={() =>
                        navigateTo([...path, { san: m.san, fen: m.to }])
                      }
                    >
                      {m.san}
                    </button>
                    <span className="moves__note">{m.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {node.moves.length === 0 && path.length > 0 && (
            <section className="card">
              <h2>This line</h2>
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  className="editor__name"
                  placeholder="e.g. Jobava London, Exchange Slav"
                  value={node.name ?? ''}
                  onChange={(e) =>
                    onChange((r) => setLineName(r, fen, e.target.value))
                  }
                />
              </label>
              <h2>Plan</h2>
              <p className="muted small">
                This line ends here. A line ends at a plan, not a move count.
              </p>
              <textarea
                rows={3}
                className="editor__plan"
                placeholder="e.g. castle short, play ...c5, pressure the d-file"
                value={node.plan ?? ''}
                onChange={(e) => onChange((r) => setPlan(r, fen, e.target.value))}
              />
            </section>
          )}

          <LinePanel
            path={path}
            onGoTo={(i) => navigateTo(path.slice(0, i + 1))}
            hint={myTurn ? 'my move' : "opponent's move"}
            stackCont
          >
            {node.moves.length === 0 ? (
              <span className="muted small">
                Play a move on the board to add one.
              </span>
            ) : (
              node.moves.map((m, i) => (
                <span key={m.san} className="line__choice">
                  <button
                    className="line__next"
                    onClick={() =>
                      navigateTo([...path, { san: m.san, fen: m.to }])
                    }
                    title={m.note || `Go to ${m.san}`}
                  >
                    {m.san}
                  </button>
                  {/* Outside the SAN button on purpose: the badge is a
                      property of the row, not part of the move's name. */}
                  {i === 0 && node.moves.length > 1 && (
                    <span className="tag">main</span>
                  )}
                  {i > 0 && (
                    <button
                      className="icon"
                      title="Make this the main line"
                      onClick={() => onChange((r) => promoteMove(r, fen, m.san))}
                    >
                      ↑
                    </button>
                  )}
                  <button
                    className="icon"
                    title="Replace this move with a different one"
                    onClick={() =>
                      setReplacing(replacing === m.san ? null : m.san)
                    }
                  >
                    ⇄
                  </button>
                  <button
                    className="icon icon--danger"
                    title="Delete this move and everything after it"
                    onClick={() => {
                      const lost = positionsLostByRemoving(rep, fen, m.san);
                      if (
                        confirm(
                          `Delete ${m.san}? ${lost} position${
                            lost === 1 ? '' : 's'
                          } are reachable no other way and will go with it.`,
                        )
                      ) {
                        onChange((r) => deleteMove(r, fen, m.san));
                      }
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))
            )}
          </LinePanel>
        </aside>
      </div>
    </div>
  );
}
