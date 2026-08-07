import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROOT_FEN } from '../model/fen';
import { lineThrough, pickLine, RECENT_MEMORY } from '../model/lines';
import type { DrillLine } from '../model/lines';
import { cardKey, CORRECT, newCard, schedule, WRONG } from '../model/srs';
import { getNode, isMyTurn } from '../model/tree';
import { DEFAULT_ENGINE_SETTINGS } from '../model/types';
import type { AppState, Repertoire } from '../model/types';
import { MoveBoard } from './MoveBoard';
import { SessionReview } from './SessionReview';
import type { Mistake } from './SessionReview';

/** Pause before the opponent replies, so a move is seen rather than teleporting. */
const REPLY_MS = 450;
/** How long a correct move's note stays up before moving on. */
const ADVANCE_MS = 550;
/** Puzzles to put between a miss and its retry, so the answer isn't just echoed. */
const RETRY_GAP = 3;
/** Ceiling on lines waiting to be retried, so a bad run can't build a backlog. */
const MAX_RETRIES = 10;

type Feedback =
  | { kind: 'none' }
  | { kind: 'right'; note: string }
  | { kind: 'wrong'; san: string; note: string };

interface Props {
  state: AppState;
  /** The puzzle to open on, drawn before the drill mounts. */
  first: DrillLine;
  onGrade: (repertoireId: string, fen: string, correct: boolean) => void;
  onDrilled: (repertoireId: string) => void;
  onDone: () => void;
}

/**
 * The drill loop. Open-ended: puzzles are drawn one at a time and the session
 * runs until it's stopped, rather than being a queue assembled up front.
 */
export function Drill({ state, first, onGrade, onDrilled, onDone }: Props) {
  const [line, setLine] = useState<DrillLine>(first);
  const [ply, setPly] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });
  const [finished, setFinished] = useState(false);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  /** Puzzles completed so far, for the counter and the retry spacing. */
  const [solved, setSolved] = useState(0);
  /** Cards already graded in this line, so a retry can't double-count. */
  const graded = useRef<Set<string>>(new Set());
  /**
   * Missed lines waiting to come round again, each held back a few puzzles —
   * the relearning step, without a fixed session to append to.
   */
  const retries = useRef<{ line: DrillLine; readyAt: number }[]>([]);
  /** Recently drawn card keys, kept out of the next draws. */
  const recent = useRef<string[]>([]);
  /**
   * Whether anything was missed in the line being walked. State rather than a
   * ref because the end-of-line button label depends on it — a ref wouldn't
   * re-render, and the button would claim nothing was queued for retry.
   */
  const [missed, setMissed] = useState(false);
  /** The repertoire whose recency has already been recorded for this line. */
  const touched = useRef<string | null>(null);
  /**
   * Positions missed this session, recorded as they happen but never acted on
   * until the session is over. Nothing here touches the engine — see
   * SessionReview for why analysis has to wait.
   */
  const [mistakes, setMistakes] = useState<Mistake[]>([]);

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

  // Record that this repertoire has just come up, so the picker's
  // least-recently-drilled weighting rotates away from it for a while.
  useEffect(() => {
    if (touched.current === line.repertoireId) return;
    touched.current = line.repertoireId;
    onDrilled(line.repertoireId);
    recent.current = [
      ...line.cardFens.map((f) => cardKey(line.repertoireId, f)),
      ...recent.current,
    ].slice(0, RECENT_MEMORY);
  }, [line, onDrilled]);

  // Opponent replies, and my own moves that sit past the drill window, play
  // themselves. Deep theory is still seen in context — just not graded.
  useEffect(() => {
    if (finished || atEnd) return;
    if (myMove && isGraded) return;
    const t = setTimeout(advance, REPLY_MS);
    return () => clearTimeout(t);
  }, [advance, atEnd, finished, isGraded, myMove, ply]);

  const nextLine = useCallback(() => {
    const count = solved + 1;
    if (missed && retries.current.length < MAX_RETRIES) {
      retries.current.push({ line, readyAt: count + RETRY_GAP });
    }

    // A retry that has waited long enough comes first; otherwise draw fresh.
    const due = retries.current.findIndex((r) => r.readyAt <= count);
    const next =
      due >= 0
        ? retries.current.splice(due, 1)[0].line
        : pickLine(state, Date.now(), recent.current);

    graded.current = new Set();
    setMissed(false);
    setSolved(count);

    if (!next) {
      setFinished(true);
      return;
    }
    touched.current = null;
    setLine(next);
    setPly(0);
    setFeedback({ kind: 'none' });
  }, [line, missed, solved, state]);

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

      // Recorded for the end-of-session review. Same position missed twice
      // (once on the retry pass) is still one thing to look at.
      setMistakes((prev) =>
        prev.some((m) => m.fen === fen && m.playedSan === san)
          ? prev
          : [
              ...prev,
              {
                repertoireId: rep.id,
                fen,
                path: line.steps.slice(0, ply),
                playedSan: san,
                expectedSan: expected.san,
                note: edge?.note ?? '',
              },
            ],
      );
      return false;
    },
    [
      advance,
      atEnd,
      divergence,
      expected,
      fen,
      finished,
      grade,
      isGraded,
      line.steps,
      myMove,
      ply,
      rep,
    ],
  );

  const plan = atEnd ? getNode(rep, fen).plan : undefined;

  if (finished) {
    const total = tally.right + tally.wrong;
    return (
      <div className="drill drill--done">
        <h1>Session complete</h1>
        <p className="drill__score">
          {tally.right} / {total} correct
        </p>
        <p className="muted small">
          {solved} {solved === 1 ? 'puzzle' : 'puzzles'}
        </p>

        {/* Only now. During the session an eval on screen would let you reason
            your way to the move instead of recalling it. Since the drill is
            open-ended, this screen is reached by choosing to stop — which
            makes it the natural place for it, rather than a queue running dry. */}
        <SessionReview
          mistakes={mistakes}
          repertoires={state.repertoires}
          settings={state.engine ?? DEFAULT_ENGINE_SETTINGS}
        />

        <button className="primary" onClick={onDone}>
          Back to repertoires
        </button>
      </div>
    );
  }

  return (
    <div className="drill">
      <header className="drill__bar">
        <button
          className="link"
          onClick={() => {
            // A line walked to its end counts, even if "Next puzzle" was never
            // pressed — stopping there is finishing it, not abandoning it.
            if (atEnd) setSolved((s) => s + 1);
            setFinished(true);
          }}
        >
          ← End session
        </button>
        {/* No repertoire or opening name: working out what this is forms part
            of the exercise, exactly as it does at a real board. The count runs
            up rather than down — the session ends when I say so. */}
        <span className="muted small">
          Puzzle {solved + 1} · {tally.right}/{tally.right + tally.wrong}
        </span>
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
              Next puzzle
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
