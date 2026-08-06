import { useCallback, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard';
import './App.css';

type Orientation = 'white' | 'black';

const SELECTED_STYLE: React.CSSProperties = {
  background: 'rgba(255, 213, 79, 0.55)',
};

// A dot for quiet moves, a ring for captures — the standard visual grammar,
// so a capture is distinguishable from a quiet move at a glance.
const MOVE_DOT_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, rgba(20,20,20,0.28) 18%, transparent 20%)',
};

const CAPTURE_RING_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, transparent 54%, rgba(20,20,20,0.28) 56%, rgba(20,20,20,0.28) 66%, transparent 68%)',
};

/**
 * Phase 0 — skeleton.
 *
 * A legal-move-enforcing board with a move list. No repertoire tree, no
 * storage, no drilling — those are Phase 1 and 2. The only job here is to
 * prove the chess.js <-> react-chessboard wiring works and to establish the
 * shape everything else builds on.
 */
export default function App() {
  // chess.js Chess instances are mutable, so FEN is the source of truth for
  // rendering and each move is applied to a fresh instance.
  const [fen, setFen] = useState(() => new Chess().fen());
  const [history, setHistory] = useState<string[]>([]);
  const [orientation, setOrientation] = useState<Orientation>('white');
  // Origin square of an in-progress click-to-move. Null when nothing is picked up.
  const [selected, setSelected] = useState<string | null>(null);

  const game = useMemo(() => new Chess(fen), [fen]);

  // Legal destinations from the selected square, keyed by target square so the
  // click handler can both validate a destination and know if it's a capture.
  const legalTargets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    // react-chessboard hands back plain strings; chess.js wants its Square union.
    const moves = game.moves({ square: selected as Square, verbose: true });
    return new Map(moves.map((m) => [m.to, m.captured !== undefined]));
  }, [game, selected]);

  const applyMove = useCallback(
    (from: string, to: string): boolean => {
      const next = new Chess(fen);
      try {
        // Always promote to queen for now; underpromotion is a Phase 1 concern.
        const move = next.move({ from, to, promotion: 'q' });
        if (!move) return false;
        setFen(next.fen());
        setHistory((h) => [...h, move.san]);
        setSelected(null);
        return true;
      } catch {
        // chess.js throws on illegal moves rather than returning null.
        return false;
      }
    },
    [fen],
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      setSelected(null);
      if (!targetSquare) return false;
      return applyMove(sourceSquare, targetSquare);
    },
    [applyMove],
  );

  /**
   * Click-to-move. Handled entirely on square clicks — pieces sit inside
   * squares and don't stop propagation, so this fires for empty squares and
   * occupied ones alike, with `piece` telling them apart.
   */
  const onSquareClick = useCallback(
    ({ piece, square }: SquareHandlerArgs) => {
      // Whether this square holds a piece belonging to the side to move.
      const isOwnPiece = piece
        ? piece.pieceType[0] === game.turn()
        : false;

      if (!selected) {
        if (isOwnPiece) setSelected(square);
        return;
      }

      if (square === selected) {
        setSelected(null);
        return;
      }

      if (legalTargets.has(square)) {
        applyMove(selected, square);
        return;
      }

      // Clicking another of my own pieces re-targets rather than deselecting,
      // which is what you want when you change your mind mid-move.
      setSelected(isOwnPiece ? square : null);
    },
    [applyMove, game, legalTargets, selected],
  );

  const squareStyles = useMemo(() => {
    if (!selected) return {};
    const styles: Record<string, React.CSSProperties> = {
      [selected]: SELECTED_STYLE,
    };
    for (const [target, isCapture] of legalTargets) {
      styles[target] = isCapture ? CAPTURE_RING_STYLE : MOVE_DOT_STYLE;
    }
    return styles;
  }, [legalTargets, selected]);

  const reset = useCallback(() => {
    setFen(new Chess().fen());
    setHistory([]);
    setSelected(null);
  }, []);

  const undo = useCallback(() => {
    const remaining = history.slice(0, -1);
    const next = new Chess();
    for (const san of remaining) next.move(san);
    setFen(next.fen());
    setHistory(remaining);
    setSelected(null);
  }, [history]);

  const status = game.isCheckmate()
    ? `Checkmate — ${game.turn() === 'w' ? 'Black' : 'White'} wins`
    : game.isStalemate()
      ? 'Stalemate'
      : game.isDraw()
        ? 'Draw'
        : `${game.turn() === 'w' ? 'White' : 'Black'} to move${
            game.inCheck() ? ' — check' : ''
          }`;

  // Pair SAN moves into numbered full moves for display.
  const pairs = history.reduce<string[][]>((acc, san, i) => {
    if (i % 2 === 0) acc.push([san]);
    else acc[acc.length - 1].push(san);
    return acc;
  }, []);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Chess Repertoire</h1>
        <p className="app__phase">Phase 0 — skeleton</p>
      </header>

      <div className="app__layout">
        <div className="board">
          <Chessboard
            options={{
              id: 'main-board',
              position: fen,
              onPieceDrop,
              onSquareClick,
              squareStyles,
              boardOrientation: orientation,
              animationDurationInMs: 150,
            }}
          />
        </div>

        <aside className="panel">
          <p className="panel__status">{status}</p>

          <div className="panel__controls">
            <button
              onClick={() => {
                setOrientation((o) => (o === 'white' ? 'black' : 'white'));
                setSelected(null);
              }}
            >
              Flip
            </button>
            <button onClick={undo} disabled={history.length === 0}>
              Undo
            </button>
            <button onClick={reset} disabled={history.length === 0}>
              Reset
            </button>
          </div>

          {history.length === 0 ? (
            <p className="panel__empty">Drag a piece to begin.</p>
          ) : (
            <ol className="moves">
              {pairs.map((pair, i) => (
                <li key={i} className="moves__row">
                  <span className="moves__num">{i + 1}.</span>
                  <span className="moves__san">{pair[0]}</span>
                  <span className="moves__san">{pair[1] ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </main>
  );
}
