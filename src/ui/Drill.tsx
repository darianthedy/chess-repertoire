import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROOT_FEN } from '../model/fen';
import { lineThrough } from '../model/lines';
import type { DrillLine } from '../model/lines';
import { cardKey, CORRECT, newCard, schedule, WRONG } from '../model/srs';
import { getNode, isMyTurn } from '../model/tree';
import type { AppState, Repertoire } from '../model/types';
import { MoveBoard } from './MoveBoard';

/** Pause before the opponent replies, so a move is seen rather than teleporting. */
const REPLY_MS = 450;
/** How long a correct move's note stays up before moving on. */
const ADVANCE_MS = 550;

type Feedback =
  | { kind: 'none' }
  | { kind: 'right'; note: string }
  | { kind: 'wrong'; san: string; note: string };

interface Props {
  state: AppState;
  lines: DrillLine[];
  onGrade: (repertoireId: string, fen: string, correct: boolean) => void;
  onDone: () => void;
}

export function Drill({ state, lines, onGrade, onDone }: Props) {
  /**
   * The session queue. A line containing a missed move is appended once at the
   * end, so a lapse is retried today rather than only tomorrow — the standard
   * relearning step. Retries are marked so they can't re-queue endlessly.
   */
  const [queue, setQueue] = useState<(DrillLine & { retry?: boolean })[]>(lines);
  const [lineIdx, setLineIdx] = useState(0);
  const [ply, setPly] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });
  const [finished, setFinished] = useState(false);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  /** Cards already graded in this line, so a retry can't double-count. */
  const graded = useRef<Set<string>>(new Set());
  /**
   * Whether anything was missed in the line being walked. State rather than a
   * ref because the end-of-line button label depends on it — a ref wouldn't
   * re-render, and the button would claim "Finish" with a retry still queued.
   */
  const [missed, setMissed] = useState(false);
  /** The line currently being walked; may be swapped mid-line on a divergence. */
  const [line, setLine] = useState<DrillLine>(lines[0]);

  const rep = useMemo(
    () => state.repertoires.find((r) => r.id === line.repertoireId) as Repertoire,
    [line.repertoireId, state.repertoires],
  );

  const fen = ply === 0 ? ROOT_FEN : line.steps[ply - 1].fen;
  const expected = line.steps[ply];
  const atEnd = !expected;
  const myMove = rep && isMyTurn(rep, fen);

  /** Graded positions are mine, in-window, and carrying a card in this line. */
  const isGraded = line.cardFens.includes(fen);

  const advance = useCallback(() => {
    setFeedback({ kind: 'none' });
    setPly((p) => p + 1);
  }, []);

  // Opponent replies, and my own moves that sit past the drill window, play
  // themselves. Deep theory is still seen in context — just not graded.
  useEffect(() => {
    if (finished || atEnd) return;
    if (myMove && isGraded) return;
    const t = setTimeout(advance, REPLY_MS);
    return () => clearTimeout(t);
  }, [advance, atEnd, finished, isGraded, myMove, ply]);

  /** True when finishing this line will append a retry to the queue. */
  const willRequeue = missed && !queue[lineIdx]?.retry;

  const nextLine = useCallback(() => {
    const current = queue[lineIdx];
    // Re-queue a missed line once, at the end of the session.
    const pending = willRequeue ? [...queue, { ...current, retry: true }] : queue;

    graded.current = new Set();
    setMissed(false);

    if (lineIdx + 1 >= pending.length) {
      setFinished(true);
      return;
    }
    setQueue(pending);
    setLine(pending[lineIdx + 1]);
    setLineIdx((i) => i + 1);
    setPly(0);
    setFeedback({ kind: 'none' });
  }, [lineIdx, queue, willRequeue]);

  const grade = useCallback(
    (correct: boolean) => {
      const key = cardKey(rep.id, fen);
      if (!correct) setMissed(true);
      if (graded.current.has(key)) return;
      graded.current.add(key);
      onGrade(rep.id, fen, correct);
      setTally((t) => ({
        right: t.right + (correct ? 1 : 0),
        wrong: t.wrong + (correct ? 0 : 1),
      }));
    },
    [fen, onGrade, rep],
  );

  /**
   * A move that isn't this line's move may still be correct: with alternatives
   * in one slot, the move I choose is what selects the repertoire. Look for
   * another live repertoire in the same slot that plays it here, and if found,
   * continue the puzzle in that repertoire's tree.
   */
  const divergence = useCallback(
    (san: string): DrillLine | null => {
      for (const other of state.repertoires) {
        if (other.id === rep.id || other.state === 'parked') continue;
        if (other.slotId !== rep.slotId || other.side !== rep.side) continue;
        const edge = getNode(other, fen).moves.find(
          (m) => m.san === san && m.isMine,
        );
        if (!edge) continue;
        const rest = lineThrough(other, edge.to);
        if (!rest) continue;
        return {
          repertoireId: other.id,
          steps: [...line.steps.slice(0, ply), { san, fen: edge.to }, ...rest.steps.slice(
            rest.steps.findIndex((s) => s.fen === edge.to) + 1,
          )],
          cardFens: rest.cardFens,
        };
      }
      return null;
    },
    [fen, line.steps, ply, rep, state.repertoires],
  );

  const onMove = useCallback(
    (san: string): boolean => {
      if (finished || atEnd || !myMove) return false;

      if (san === expected.san) {
        const edge = getNode(rep, fen).moves.find((m) => m.san === san);
        if (isGraded) grade(true);
        setFeedback({ kind: 'right', note: edge?.note ?? '' });
        setTimeout(advance, ADVANCE_MS);
        return true;
      }

      const swapped = divergence(san);
      if (swapped) {
        if (isGraded) grade(true);
        setFeedback({ kind: 'right', note: '' });
        setLine(swapped);
        setTimeout(advance, ADVANCE_MS);
        return true;
      }

      // Wrong. Show the answer with its reason, then carry on from the correct
      // move — restarting would only replay what I already knew.
      const edge = getNode(rep, fen).moves.find((m) => m.san === expected.san);
      if (isGraded) grade(false);
      setFeedback({ kind: 'wrong', san: expected.san, note: edge?.note ?? '' });
      return false;
    },
    [advance, atEnd, divergence, expected, fen, finished, grade, isGraded, myMove, rep],
  );

  const plan = atEnd ? getNode(rep, fen).plan : undefined;
  const progress = `${lineIdx + 1} / ${queue.length}`;

  if (finished) {
    const total = tally.right + tally.wrong;
    return (
      <div className="drill drill--done">
        <h1>Session complete</h1>
        <p className="drill__score">
          {tally.right} / {total} correct
        </p>
        <button className="primary" onClick={onDone}>
          Back to repertoires
        </button>
      </div>
    );
  }

  return (
    <div className="drill">
      <header className="drill__bar">
        <button className="link" onClick={onDone}>
          ← End session
        </button>
        {/* No repertoire or opening name: working out what this is forms part
            of the exercise, exactly as it does at a real board. */}
        <span className="muted small">{progress}</span>
      </header>

      <div className="drill__board">
        <MoveBoard
          fen={fen}
          orientation={rep.side === 'w' ? 'white' : 'black'}
          onMove={onMove}
          highlights={
            feedback.kind === 'wrong'
              ? { [fen]: { background: 'rgba(214, 69, 69, 0.18)' } }
              : undefined
          }
        />
      </div>

      <div className="drill__status" data-kind={feedback.kind}>
        {feedback.kind === 'right' && (
          <>
            <strong>Correct</strong>
            {feedback.note && <span className="drill__note">{feedback.note}</span>}
          </>
        )}
        {feedback.kind === 'wrong' && (
          <>
            <strong>{feedback.san}</strong>
            {feedback.note && <span className="drill__note">{feedback.note}</span>}
            <button className="primary" onClick={advance}>
              Continue
            </button>
          </>
        )}
        {feedback.kind === 'none' && !atEnd && (
          <span className="muted">
            {myMove && isGraded ? 'Your move' : '…'}
          </span>
        )}
        {atEnd && (
          <>
            <strong>End of line</strong>
            {plan ? (
              <span className="drill__note">{plan}</span>
            ) : (
              <span className="muted small">No plan recorded for this line.</span>
            )}
            <button className="primary" onClick={nextLine}>
              {lineIdx + 1 >= queue.length + (willRequeue ? 1 : 0)
                ? 'Finish'
                : 'Next puzzle'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Apply a grade to state — exported so the reducer stays next to the loop. */
export function applyGrade(
  state: AppState,
  repertoireId: string,
  fen: string,
  correct: boolean,
  now: number,
): AppState {
  const key = cardKey(repertoireId, fen);
  const card = state.cards[key] ?? newCard(now);
  return {
    ...state,
    cards: {
      ...state.cards,
      [key]: schedule(card, correct ? CORRECT : WRONG, now),
    },
  };
}
