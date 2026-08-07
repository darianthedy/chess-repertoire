import { useCallback, useMemo, useState } from 'react';
import { adoptLine, gameLabel, gameToTree } from '../model/collections';
import { ROOT_FEN } from '../model/fen';
import { parseMovetext } from '../model/pgn';
import { getNode } from '../model/tree';
import type { PathStep } from '../model/tree';
import type { AppState, Repertoire, StoredGame } from '../model/types';
import { MoveBoard } from './MoveBoard';

/**
 * Orient a collection game to the side I'd be studying it from: the colour of
 * whichever live repertoire already answers its first move. Falls back to
 * White when nothing matches.
 */
function suggestedOrientation(
  state: AppState,
  game: StoredGame,
): 'white' | 'black' {
  const first = parseMovetext(game.movetext)[0]?.san;
  if (!first) return 'white';

  for (const rep of state.repertoires) {
    if (rep.state === 'parked') continue;
    const plays = getNode(rep, ROOT_FEN).moves.some((m) => m.san === first);
    if (plays) return rep.side === 'w' ? 'white' : 'black';
  }
  return 'white';
}

interface Props {
  state: AppState;
  game: StoredGame;
  onAdopt: (repertoireId: string, fn: (rep: Repertoire) => Repertoire) => void;
  onBack: () => void;
}

/**
 * Read one game and pick lines out of it.
 *
 * The game is converted into a throwaway repertoire so navigation reuses the
 * editor's FEN-keyed walk — variations, transpositions and comments all behave
 * the same, with no second tree implementation to keep in step.
 */
export function GameView({ state, game, onAdopt, onBack }: Props) {
  const tree = useMemo(() => gameToTree(game), [game]);
  const [path, setPath] = useState<PathStep[]>([]);
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Default to the side the game is useful from: if one of my repertoires
   * plays this opening, orient to my colour in it. A Caro-Kann model game is
   * being read for Black's ideas, so showing it from White is the wrong way up.
   */
  const [orientation, setOrientation] = useState<'white' | 'black'>(() =>
    suggestedOrientation(state, game),
  );

  const fen = path.length ? path[path.length - 1].fen : ROOT_FEN;
  const node = getNode(tree, fen);

  const play = useCallback(
    (san: string): boolean => {
      const edge = node.moves.find((m) => m.san === san);
      if (!edge) return false;
      setPath((p) => [...p, { san, fen: edge.to }]);
      setMessage(null);
      return true;
    },
    [node.moves],
  );

  const adopt = useCallback(() => {
    const rep = state.repertoires.find((r) => r.id === target);
    if (!rep || !path.length) return;
    const sans = path.map((s) => s.san);
    const { added } = adoptLine(rep, tree, sans);
    onAdopt(rep.id, (current) => adoptLine(current, tree, sans).rep);
    setMessage(
      added === 0
        ? `Already in ${rep.name} — nothing to add.`
        : `Added ${added} move${added === 1 ? '' : 's'} to ${rep.name}.`,
    );
  }, [onAdopt, path, state.repertoires, target, tree]);

  const pairs = path.reduce<{ san: string; index: number }[][]>(
    (acc, step, index) => {
      const entry = { san: step.san, index };
      if (index % 2 === 0) acc.push([entry]);
      else acc[acc.length - 1].push(entry);
      return acc;
    },
    [],
  );

  return (
    <div className="editor">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          ← Back to collection
        </button>
        <div className="editor__title">
          <strong>{gameLabel(game)}</strong>
          <span className="muted"> · {game.headers.Result ?? ''}</span>
        </div>
      </header>

      <div className="editor__layout">
        <div className="editor__board">
          <MoveBoard fen={fen} orientation={orientation} onMove={play} />
          <div className="editor__nav">
            <button
              onClick={() =>
                setOrientation((o) => (o === 'white' ? 'black' : 'white'))
              }
              title="Flip board"
            >
              ⇅ Flip
            </button>
            <button onClick={() => setPath([])} disabled={!path.length}>
              « Start
            </button>
            <button
              onClick={() => setPath((p) => p.slice(0, -1))}
              disabled={!path.length}
            >
              ← Back
            </button>
            <button
              onClick={() => {
                const next = getNode(tree, fen).moves[0];
                if (next) setPath((p) => [...p, { san: next.san, fen: next.to }]);
              }}
              disabled={node.moves.length === 0}
            >
              Next →
            </button>
          </div>
        </div>

        <aside className="editor__panel">
          <section className="card">
            <h2>Line</h2>
            {path.length === 0 ? (
              <p className="muted small">
                Step through with Next, or play moves on the board.
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
                        onClick={() => setPath((p) => p.slice(0, step.index + 1))}
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
            <h2>Continuations</h2>
            {node.moves.length === 0 ? (
              <p className="muted small">End of the game.</p>
            ) : (
              <ul className="moves">
                {node.moves.map((m) => (
                  <li key={m.san} className="moves__item">
                    <div className="moves__head">
                      <button className="moves__san" onClick={() => play(m.san)}>
                        {m.san}
                      </button>
                    </div>
                    {m.note && <p className="moves__note">{m.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card--accent">
            <h2>Add this line to a repertoire</h2>
            {state.repertoires.length === 0 ? (
              <p className="muted small">Create a repertoire first.</p>
            ) : (
              <>
                <p className="muted small">
                  Copies the {path.length} move{path.length === 1 ? '' : 's'}{' '}
                  you've walked through, with their comments as notes. Nothing
                  else from this game is taken.
                </p>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">choose a repertoire…</option>
                  {state.repertoires.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.side === 'w' ? 'White' : 'Black'})
                    </option>
                  ))}
                </select>
                <div className="row" style={{ marginTop: '0.5rem' }}>
                  <button
                    className="primary"
                    onClick={adopt}
                    disabled={!target || !path.length}
                  >
                    Add line
                  </button>
                </div>
                {message && <p className="small">{message}</p>}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
