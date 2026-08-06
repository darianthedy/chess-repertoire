import { useCallback, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { PieceDropHandlerArgs } from 'react-chessboard';
import './App.css';

type Orientation = 'white' | 'black';

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

  const game = useMemo(() => new Chess(fen), [fen]);

  const applyMove = useCallback(
    (from: string, to: string): boolean => {
      const next = new Chess(fen);
      try {
        // Always promote to queen for now; underpromotion is a Phase 1 concern.
        const move = next.move({ from, to, promotion: 'q' });
        if (!move) return false;
        setFen(next.fen());
        setHistory((h) => [...h, move.san]);
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
      if (!targetSquare) return false;
      return applyMove(sourceSquare, targetSquare);
    },
    [applyMove],
  );

  const reset = useCallback(() => {
    setFen(new Chess().fen());
    setHistory([]);
  }, []);

  const undo = useCallback(() => {
    const remaining = history.slice(0, -1);
    const next = new Chess();
    for (const san of remaining) next.move(san);
    setFen(next.fen());
    setHistory(remaining);
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
              boardOrientation: orientation,
              animationDurationInMs: 150,
            }}
          />
        </div>

        <aside className="panel">
          <p className="panel__status">{status}</p>

          <div className="panel__controls">
            <button
              onClick={() =>
                setOrientation((o) => (o === 'white' ? 'black' : 'white'))
              }
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
