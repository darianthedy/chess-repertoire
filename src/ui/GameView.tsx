import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adoptLine, gameLabel, gameToTree } from '../model/collections';
import { ROOT_FEN } from '../model/fen';
import { parseMovetext } from '../model/pgn';
import { DEFAULT_ENGINE_SETTINGS } from '../model/types';
import { addMove, getNode, tryMove } from '../model/tree';
import type { PathStep } from '../model/tree';
import type {
  AppState,
  EngineSettings,
  MoveEdge,
  Repertoire,
  StoredGame,
} from '../model/types';
import { EnginePanel } from './EnginePanel';
import { EvalBar } from './EvalBar';
import { MoveBoard } from './MoveBoard';
import { useAnalysis, useEngine } from './useEngine';

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

/** One numbered row of the line: the pair of moves, plus where to offer the
 *  continuation choices when the row is the live one. */
interface Row {
  no: number;
  white?: { san: string; index: number };
  black?: { san: string; index: number };
  cont?: 'white' | 'black';
}

interface Props {
  state: AppState;
  game: StoredGame;
  onAdopt: (repertoireId: string, fn: (rep: Repertoire) => Repertoire) => void;
  onEngineChange: (settings: EngineSettings) => void;
  onBack: () => void;
}

/**
 * Read one game and pick lines out of it.
 *
 * The game is converted into a throwaway repertoire so navigation reuses the
 * editor's FEN-keyed walk — variations, transpositions and comments all behave
 * the same, with no second tree implementation to keep in step.
 */
export function GameView({
  state,
  game,
  onAdopt,
  onEngineChange,
  onBack,
}: Props) {
  /**
   * State rather than a memo because moves get grafted on: playing an engine
   * suggestion the game never saw extends this tree, so exploring a
   * refutation works with the same navigation as the game itself.
   * `key={game.id}` in App.tsx resets it when the game changes.
   */
  const [tree, setTree] = useState(() => gameToTree(game));
  const [path, setPath] = useState<PathStep[]>([]);
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /**
   * `fen:san` of moves added by exploring rather than by the game. Kept so the
   * continuation list can say which moves were actually played — a suggestion
   * silently indistinguishable from the game score would be worse than not
   * offering exploration at all.
   */
  const [explored, setExplored] = useState<Set<string>>(() => new Set());

  const settings = state.engine ?? DEFAULT_ENGINE_SETTINGS;

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

  const { engine, status } = useEngine(settings.enabled);
  const { analysis, thinking } = useAnalysis(engine, fen, {
    depth: settings.depth,
    enabled: settings.enabled,
  });

  /** Live repertoires only: a parked one has no opinion worth checking. */
  const liveRepertoires = useMemo(
    () => state.repertoires.filter((r) => r.state !== 'parked'),
    [state.repertoires],
  );

  const play = useCallback(
    (san: string): boolean => {
      setMessage(null);

      const edge = node.moves.find((m) => m.san === san);
      if (edge) {
        setPath((p) => [...p, { san, fen: edge.to }]);
        return true;
      }

      // Off the game score. Graft the move on rather than rejecting it: the
      // engine's improvement is the thing worth walking into, and adding it
      // here means adopting the line into a repertoire also just works.
      const to = tryMove(fen, san);
      if (!to) return false;

      setTree((t) => addMove(t, fen, san, ''));
      setExplored((s) => new Set(s).add(`${fen}:${san}`));
      setPath((p) => [...p, { san, fen: to }]);
      return true;
    },
    [fen, node.moves],
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

  /**
   * The annotation on the move that produced the current position — the game's
   * own comment on where we are, read from the edge we arrived along.
   */
  const currentNote = useMemo(() => {
    if (!path.length) return '';
    const from = path.length > 1 ? path[path.length - 2].fen : ROOT_FEN;
    const san = path[path.length - 1].san;
    return getNode(tree, from).moves.find((m) => m.san === san)?.note ?? '';
  }, [path, tree]);

  /** Annotations on the moves available from here, shown before playing them. */
  const nextNotes = node.moves.filter((m) => m.note);

  /**
   * The line as numbered rows, with the continuation choices sitting in the
   * cell they'd actually occupy — so picking a move reads as continuing the
   * game rather than as consulting a separate list.
   */
  const rows = useMemo(() => {
    const out: Row[] = [];
    path.forEach((step, index) => {
      const entry = { san: step.san, index };
      if (index % 2 === 0) out.push({ no: index / 2 + 1, white: entry });
      else out[out.length - 1].black = entry;
    });
    if (path.length % 2 === 0) out.push({ no: out.length + 1, cont: 'white' });
    else out[out.length - 1].cont = 'black';
    return out;
  }, [path]);

  // Keep the live end of the line in view as it grows past the scroll box.
  const lineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = lineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [path.length]);

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

      <div className="editor__layout editor__layout--stacked">
        <div className="editor__board gameview__board">
          <div className="board-with-bar">
            {settings.enabled && (
              <EvalBar
                score={analysis?.lines[0]?.score ?? null}
                orientation={orientation}
                thinking={thinking}
              />
            )}
            <div className="board-with-bar__board">
              <MoveBoard fen={fen} orientation={orientation} onMove={play} />
            </div>
          </div>
          <div className="editor__nav">
            <button
              onClick={() =>
                setOrientation((o) => (o === 'white' ? 'black' : 'white'))
              }
              title="Flip board"
            >
              ⇅ Flip
            </button>
            <button
              onClick={() =>
                onEngineChange({ ...settings, enabled: !settings.enabled })
              }
              data-on={settings.enabled}
              className="engine__toggle"
              title={
                settings.enabled
                  ? 'Turn the engine off'
                  : 'Analyse with Stockfish (downloads 7 MB the first time)'
              }
            >
              {settings.enabled ? '◉ Engine' : '○ Engine'}
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

        {/* Everything below the board, in the order it's wanted while reading:
            what the game says here, whether to keep it, what the engine
            thinks, and the line itself as the thing you steer with. */}
        <aside className="editor__panel gameview__below">
          <section className="card">
            <h2>Notes</h2>
            {currentNote ? (
              <p className="gameview__note">{currentNote}</p>
            ) : (
              <p className="muted small">
                {path.length
                  ? `No annotation on ${path[path.length - 1].san}.`
                  : 'No annotation on the starting position.'}
              </p>
            )}
            {nextNotes.length > 0 && (
              <ul className="gameview__notes">
                {nextNotes.map((m) => (
                  <li key={m.san}>
                    <button className="moves__san" onClick={() => play(m.san)}>
                      {m.san}
                    </button>
                    <span className="moves__note">{m.note}</span>
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

          {settings.enabled && (
            <EnginePanel
              status={status}
              analysis={analysis}
              thinking={thinking}
              repertoires={liveRepertoires}
              onPlay={play}
              targetDepth={settings.depth}
            />
          )}

          <section className="card">
            <h2>Line</h2>
            <div className="gameline" ref={lineRef}>
              {rows.map((row) => (
                <div key={row.no} className="gameline__row">
                  <span className="gameline__no">{row.no}.</span>
                  <Cell
                    entry={row.white}
                    cont={row.cont === 'white'}
                    span={row.cont === 'white'}
                    last={path.length - 1}
                    onGoTo={(i) => setPath((p) => p.slice(0, i + 1))}
                    moves={node.moves}
                    fen={fen}
                    explored={explored}
                    onPlay={play}
                  />
                  {row.cont !== 'white' && (
                    <Cell
                      entry={row.black}
                      cont={row.cont === 'black'}
                      span={false}
                      last={path.length - 1}
                      onGoTo={(i) => setPath((p) => p.slice(0, i + 1))}
                      moves={node.moves}
                      fen={fen}
                      explored={explored}
                      onPlay={play}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * One half-move slot in the line. Either a move already played — clickable to
 * rewind to it — or, on the live row, the choices for what comes next.
 */
function Cell({
  entry,
  cont,
  span,
  last,
  onGoTo,
  moves,
  fen,
  explored,
  onPlay,
}: {
  entry?: { san: string; index: number };
  cont: boolean;
  /** The continuation sits in White's slot, so let it use Black's too. */
  span: boolean;
  last: number;
  onGoTo: (index: number) => void;
  moves: MoveEdge[];
  fen: string;
  explored: Set<string>;
  onPlay: (san: string) => boolean;
}) {
  if (cont) {
    return (
      <span className="gameline__cell gameline__cont" data-span={span}>
        {moves.length === 0 ? (
          <span className="muted small">end of the game</span>
        ) : (
          moves.map((m) => {
            const yours = explored.has(`${fen}:${m.san}`);
            return (
              <button
                key={m.san}
                className="gameline__next"
                onClick={() => onPlay(m.san)}
                title={
                  yours
                    ? `${m.san} — you added this while exploring; the game did not play it`
                    : m.note || `Play ${m.san}`
                }
                data-yours={yours}
              >
                {m.san}
              </button>
            );
          })
        )}
      </span>
    );
  }

  return (
    <span className="gameline__cell">
      {entry && (
        <button
          className={
            'line__san' + (entry.index === last ? ' line__san--current' : '')
          }
          onClick={() => onGoTo(entry.index)}
        >
          {entry.san}
        </button>
      )}
    </span>
  );
}
