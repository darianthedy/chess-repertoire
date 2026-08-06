import { useCallback, useMemo, useState } from 'react';
import { ROOT_FEN } from '../model/fen';
import {
  addMove,
  deleteMove,
  getNode,
  isMyTurn,
  positionCount,
  setPlan,
  tryMove,
  updateNote,
} from '../model/tree';
import type { PathStep } from '../model/tree';
import type { Repertoire } from '../model/types';
import { MoveBoard } from './MoveBoard';

interface Props {
  rep: Repertoire;
  onChange: (fn: (rep: Repertoire) => Repertoire) => void;
  onBack: () => void;
}

export function Editor({ rep, onChange, onBack }: Props) {
  const [path, setPath] = useState<PathStep[]>([]);
  const [draftNote, setDraftNote] = useState('');
  const [editingSan, setEditingSan] = useState<string | null>(null);

  const fen = path.length ? path[path.length - 1].fen : ROOT_FEN;
  const node = getNode(rep, fen);
  const myTurn = isMyTurn(rep, fen);

  const navigateTo = useCallback((steps: PathStep[]) => {
    setPath(steps);
    setDraftNote('');
    setEditingSan(null);
  }, []);

  /**
   * Playing a move adds it and walks into it, with no confirmation step.
   *
   * Notes are optional, so a form gating every move would be friction with
   * nothing behind it — and entering a repertoire means doing this hundreds of
   * times. Annotate afterwards from the continuations list; remove a mistake
   * with the ✕ there.
   */
  const handleMove = useCallback(
    (san: string): boolean => {
      const existing = node.moves.find((m) => m.san === san);
      if (existing) {
        navigateTo([...path, { san, fen: existing.to }]);
        return true;
      }
      const to = tryMove(fen, san);
      if (!to) return false;
      onChange((r) => addMove(r, fen, san, ''));
      navigateTo([...path, { san, fen: to }]);
      return true;
    },
    [fen, navigateTo, node.moves, onChange, path],
  );

  const pairs = useMemo(() => groupIntoPairs(path), [path]);

  return (
    <div className="editor">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          ← All repertoires
        </button>
        <div className="editor__title">
          <strong>{rep.name}</strong>
          <span className="muted">
            {' '}
            · {rep.side === 'w' ? 'White' : 'Black'} · {positionCount(rep)}{' '}
            positions
          </span>
        </div>
      </header>

      <div className="editor__layout">
        <div className="editor__board">
          <MoveBoard
            fen={fen}
            orientation={rep.side === 'w' ? 'white' : 'black'}
            onMove={handleMove}
          />
          <div className="editor__nav">
            <button onClick={() => navigateTo([])} disabled={!path.length}>
              ⏮ Start
            </button>
            <button
              onClick={() => navigateTo(path.slice(0, -1))}
              disabled={!path.length}
            >
              ← Back
            </button>
          </div>
        </div>

        <aside className="editor__panel">
          <section className="card">
            <h2>Line</h2>
            {path.length === 0 ? (
              <p className="muted small">
                Starting position. Play a move on the board to begin the tree.
              </p>
            ) : (
              <div className="line">
                {pairs.map((pair, i) => (
                  <span key={i} className="line__pair">
                    <span className="muted">{i + 1}.</span>
                    {pair.map((step) => (
                      <button
                        key={step.index}
                        className={
                          'line__san' +
                          (step.index === path.length - 1
                            ? ' line__san--current'
                            : '')
                        }
                        onClick={() =>
                          navigateTo(path.slice(0, step.index + 1))
                        }
                      >
                        {step.san}
                      </button>
                    ))}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="card">
              <h2>
                Continuations
                <span className="muted">
                  {' '}
                  · {myTurn ? 'my move' : "opponent's move"}
                </span>
              </h2>
              {node.moves.length === 0 ? (
                <p className="muted small">
                  Nothing yet. Play a move on the board to add one.
                </p>
              ) : (
                <ul className="moves">
                  {node.moves.map((m) => (
                    <li key={m.san} className="moves__item">
                      <div className="moves__head">
                        <button
                          className="moves__san"
                          onClick={() =>
                            navigateTo([...path, { san: m.san, fen: m.to }])
                          }
                        >
                          {m.san}
                        </button>
                        <button
                          className="icon"
                          title="Edit note"
                          onClick={() => {
                            setEditingSan(
                              editingSan === m.san ? null : m.san,
                            );
                            setDraftNote(m.note);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="icon icon--danger"
                          title="Delete this move and everything after it"
                          onClick={() => {
                            if (
                              confirm(
                                `Delete ${m.san} and any lines only reachable through it?`,
                              )
                            ) {
                              onChange((r) => deleteMove(r, fen, m.san));
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      {editingSan === m.san ? (
                        <div className="moves__edit">
                          <textarea
                            rows={2}
                            autoFocus
                            value={draftNote}
                            placeholder={
                              m.isMine
                                ? 'Why this move? e.g. stops Bg4, keeps e5 available'
                                : 'e.g. the critical test'
                            }
                            onChange={(e) => setDraftNote(e.target.value)}
                          />
                          <div className="row">
                            <button
                              className="primary"
                              onClick={() => {
                                onChange((r) =>
                                  updateNote(r, fen, m.san, draftNote.trim()),
                                );
                                setEditingSan(null);
                              }}
                            >
                              Save
                            </button>
                            <button onClick={() => setEditingSan(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        m.note && <p className="moves__note">{m.note}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </section>

          {node.moves.length === 0 && path.length > 0 && (
            <section className="card">
              <h2>Plan</h2>
              <p className="muted small">
                This line ends here. A line ends at a plan, not a move count.
              </p>
              <textarea
                rows={3}
                placeholder="e.g. castle short, play ...c5, pressure the d-file"
                value={node.plan ?? ''}
                onChange={(e) =>
                  onChange((r) => setPlan(r, fen, e.target.value))
                }
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

interface IndexedStep extends PathStep {
  index: number;
}

/** Group a path into numbered full moves for display. */
function groupIntoPairs(path: PathStep[]): IndexedStep[][] {
  return path.reduce<IndexedStep[][]>((acc, step, index) => {
    const entry = { ...step, index };
    if (index % 2 === 0) acc.push([entry]);
    else acc[acc.length - 1].push(entry);
    return acc;
  }, []);
}
