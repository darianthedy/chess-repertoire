import { useCallback, useEffect, useRef, useState } from 'react';
import { auditPosition, judgeMove, rateFromFollowUp } from '../model/audit';
import type { MoveVerdict, PositionAudit } from '../model/audit';
import { Cancelled, DEFAULT_MULTI_PV } from '../model/engine';
import { describePath } from '../model/deviation';
import { formatScore, VERDICT_LABEL } from '../model/score';
import { tryMove } from '../model/tree';
import type { PathStep } from '../model/tree';
import type { EngineSettings, Repertoire } from '../model/types';
import { EvalBar } from './EvalBar';
import { MoveBoard } from './MoveBoard';
import { useEngine } from './useEngine';

/** A position missed during a session. Recorded live; analysed only afterwards. */
export interface Mistake {
  repertoireId: string;
  fen: string;
  /** How the position was reached, for naming the line. */
  path: PathStep[];
  /** What I played. */
  playedSan: string;
  /** What the repertoire wanted. */
  expectedSan: string;
  /** The note attached to the expected move. */
  note: string;
}

interface Props {
  mistakes: Mistake[];
  repertoires: Repertoire[];
  settings: EngineSettings;
}

interface Result {
  audit: PositionAudit;
  played: MoveVerdict;
  expected: MoveVerdict;
}

/**
 * Post-session analysis of the moves that were missed.
 *
 * Deliberately *not* available during the session. A drill is a recall test,
 * and an evaluation on screen turns it into a reading test — you would work
 * backwards from the bar to the move instead of remembering it, and the card
 * would be graded on the wrong skill. Once the session is scored, that risk is
 * gone and the same numbers become the most useful thing on the page.
 *
 * Analysis is also opt-in with a button rather than automatic: finishing a
 * session should not silently start a 7 MB download and a minute of CPU.
 */
export function SessionReview({ mistakes, repertoires, settings }: Props) {
  const [started, setStarted] = useState(false);
  const [results, setResults] = useState<Map<string, Result>>(new Map());
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(false);

  const { engine, status } = useEngine(started);
  /** Guards against React re-running the batch on an unrelated re-render. */
  const ran = useRef(false);

  useEffect(() => {
    if (!engine || ran.current) return;
    ran.current = true;

    let cancelled = false;

    void (async () => {
      for (const mistake of mistakes) {
        if (cancelled) return;
        try {
          // Sequential, not parallel: there is one engine, and analysing the
          // first mistake fully beats having five half-done.
          const analysis = await engine.analyse(mistake.fen, {
            depth: settings.depth,
            multiPv: DEFAULT_MULTI_PV,
          });
          if (cancelled) return;

          const rep =
            repertoires.find((r) => r.id === mistake.repertoireId) ?? null;
          const audit = auditPosition(analysis, rep);

          const played = judgeMove(audit, mistake.playedSan);
          let expected = judgeMove(audit, mistake.expectedSan);

          // The book move is the number this whole screen exists to show, so
          // it gets a second search when MultiPV didn't reach it. Worth the
          // extra second here — unlike browsing, this runs once, on a handful
          // of positions, with nobody waiting on a keystroke.
          if (expected.verdict === undefined) {
            const after = tryMove(mistake.fen, mistake.expectedSan);
            if (after) {
              // One ply shallower, so the two searches see the same horizon.
              const followUp = await engine.analyse(after, {
                depth: Math.max(1, settings.depth - 1),
                multiPv: 1,
              });
              const score = followUp.lines[0]?.score;
              if (score) expected = rateFromFollowUp(audit, mistake.expectedSan, score);
            }
          }
          if (cancelled) return;

          setResults((prev) =>
            new Map(prev).set(key(mistake), { audit, played, expected }),
          );
        } catch (err) {
          if (err instanceof Cancelled) return;
          if (!cancelled) setFailed(true);
        }
        if (!cancelled) setDone((n) => n + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engine, mistakes, repertoires, settings.depth]);

  const start = useCallback(() => setStarted(true), []);

  if (!mistakes.length) return null;

  return (
    <section className="card review">
      <h2>
        {mistakes.length} missed position{mistakes.length === 1 ? '' : 's'}
      </h2>

      {!started ? (
        <>
          <p className="muted small">
            Run the engine over them to see how much each miss actually cost —
            some are a whole tempo, some are nothing.
          </p>
          <button className="primary" onClick={start}>
            Analyse mistakes
          </button>
        </>
      ) : status === 'unavailable' ? (
        <p className="muted small">
          Engine files aren't in this build. Run <code>npm run engine</code> and
          reload.
        </p>
      ) : (
        <>
          <p className="muted small" aria-live="polite">
            {status === 'loading'
              ? 'Loading Stockfish — about 7 MB, once.'
              : `Analysed ${done} of ${mistakes.length}${failed ? ' (some failed)' : ''}`}
          </p>
          <ul className="review__list">
            {mistakes.map((m) => (
              <MistakeCard
                key={key(m)}
                mistake={m}
                result={results.get(key(m))}
                side={
                  repertoires.find((r) => r.id === m.repertoireId)?.side ?? 'w'
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function key(m: Mistake): string {
  return `${m.repertoireId}:${m.fen}:${m.playedSan}`;
}

function MistakeCard({
  mistake,
  result,
  side,
}: {
  mistake: Mistake;
  result?: Result;
  side: 'w' | 'b';
}) {
  const { audit, played, expected } = result ?? {};

  return (
    <li className="review__item">
      <div className="review__board">
        <EvalBar
          score={audit?.candidates[0]?.score ?? null}
          orientation={side === 'w' ? 'white' : 'black'}
          thinking={!result}
        />
        <div className="review__boardinner">
          <MoveBoard
            fen={mistake.fen}
            orientation={side === 'w' ? 'white' : 'black'}
            onMove={() => false}
          />
        </div>
      </div>

      <div className="review__detail">
        <p className="muted small">{describePath(mistake.path) || 'From the start'}</p>

        <p className="review__line">
          <span className="review__label">You played</span>
          <strong>{mistake.playedSan}</strong>
          <Cost verdict={played} />
        </p>

        <p className="review__line">
          <span className="review__label">Your book</span>
          <strong>{mistake.expectedSan}</strong>
          <Cost verdict={expected} />
        </p>

        {mistake.note && <p className="moves__note">{mistake.note}</p>}

        {audit && audit.candidates[0] && (
          <p className="muted small">
            Engine: {audit.candidates[0].san}{' '}
            {formatScore(audit.candidates[0].score)} at depth {audit.depth}
            {/* The interesting case for a repertoire: the miss was fine and the
                book move is the questionable one. */}
            {expected?.verdict &&
              expected.verdict !== 'best' &&
              expected.verdict !== 'good' &&
              played?.verdict &&
              (played.verdict === 'best' || played.verdict === 'good') &&
              ' — your move was better than your book here.'}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * What a move cost. Silent when the engine did not rank it: with MultiPV 3
 * most legal moves are unranked, and "unranked" is not "bad".
 */
function Cost({ verdict }: { verdict?: MoveVerdict }) {
  if (!verdict) return <span className="muted small"> · analysing…</span>;
  if (verdict.loss === undefined || verdict.verdict === undefined) {
    return <span className="muted small"> · outside the engine's top lines</span>;
  }
  return (
    <span className="engine__verdict" data-verdict={verdict.verdict}>
      {verdict.isTop ? 'Engine choice' : VERDICT_LABEL[verdict.verdict]}
      {verdict.loss >= 2 ? ` −${verdict.loss.toFixed(0)}%` : ''}
    </span>
  );
}
