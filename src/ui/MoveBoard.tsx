import { useCallback, useMemo, useState } from 'react';
import type { Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard';
import { chessAt } from '../model/fen';

const SELECTED_STYLE: React.CSSProperties = {
  background: 'rgba(255, 213, 79, 0.55)',
};

// A dot for quiet moves, a ring for captures — so a capture is distinguishable
// from a quiet move at a glance.
const MOVE_DOT_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, rgba(20,20,20,0.28) 18%, transparent 20%)',
};

const CAPTURE_RING_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, transparent 54%, rgba(20,20,20,0.28) 56%, rgba(20,20,20,0.28) 66%, transparent 68%)',
};

interface Props {
  /** Normalized FEN of the position to show. */
  fen: string;
  orientation: 'white' | 'black';
  /** Called with the SAN of a legal move. Return false to reject it. */
  onMove: (san: string) => boolean;
  /** Squares to tint, e.g. the last move played. */
  highlights?: Record<string, React.CSSProperties>;
}

/**
 * A board that reports moves in SAN. Supports both dragging and click-to-move,
 * since drag suits desktop and tapping suits phones.
 */
export function MoveBoard({ fen, orientation, onMove, highlights }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const game = useMemo(() => chessAt(fen), [fen]);

  const legalTargets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    const moves = game.moves({ square: selected as Square, verbose: true });
    return new Map(moves.map((m) => [m.to, m.captured !== undefined]));
  }, [game, selected]);

  const play = useCallback(
    (from: string, to: string): boolean => {
      const probe = chessAt(fen);
      try {
        // Always promote to queen. Underpromotion in an opening repertoire is
        // vanishingly rare; revisit if a line ever actually needs it.
        const move = probe.move({ from, to, promotion: 'q' });
        if (!move) return false;
        setSelected(null);
        return onMove(move.san);
      } catch {
        // chess.js throws on illegal moves rather than returning null.
        return false;
      }
    },
    [fen, onMove],
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      setSelected(null);
      if (!targetSquare) return false;
      return play(sourceSquare, targetSquare);
    },
    [play],
  );

  // Handled on square clicks alone: pieces render inside squares and don't stop
  // propagation, so one handler covers occupied and empty squares, with `piece`
  // telling them apart. Using onPieceClick too would double-fire.
  const onSquareClick = useCallback(
    ({ piece, square }: SquareHandlerArgs) => {
      const isOwnPiece = piece ? piece.pieceType[0] === game.turn() : false;

      if (!selected) {
        if (isOwnPiece) setSelected(square);
        return;
      }
      if (square === selected) {
        setSelected(null);
        return;
      }
      if (legalTargets.has(square)) {
        play(selected, square);
        return;
      }
      // Clicking another of my own pieces re-targets rather than deselecting,
      // which is what you want when you change your mind mid-move.
      setSelected(isOwnPiece ? square : null);
    },
    [game, legalTargets, play, selected],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = { ...highlights };
    if (selected) {
      styles[selected] = { ...styles[selected], ...SELECTED_STYLE };
      for (const [target, isCapture] of legalTargets) {
        styles[target] = {
          ...styles[target],
          ...(isCapture ? CAPTURE_RING_STYLE : MOVE_DOT_STYLE),
        };
      }
    }
    return styles;
  }, [highlights, legalTargets, selected]);

  return (
    <Chessboard
      options={{
        id: 'main-board',
        position: `${fen} 0 1`,
        onPieceDrop,
        onSquareClick,
        squareStyles,
        boardOrientation: orientation,
        animationDurationInMs: 150,
      }}
    />
  );
}
