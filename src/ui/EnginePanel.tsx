import { useMemo } from 'react';
import { auditPosition, repertoireFor, summarise } from '../model/audit';
import type { Candidate } from '../model/audit';
import type { Analysis } from '../model/engine';
import { formatScore, VERDICT_LABEL } from '../model/score';
import type { Repertoire } from '../model/types';
import type { EngineStatus } from './useEngine';

interface Props {
  status: EngineStatus;
  analysis: Analysis | null;
  thinking: boolean;
  /** Live repertoires to cross-reference against. */
  repertoires: Repertoire[];
  /** Play a suggested move on the board, when the position allows it. */
  onPlay?: (san: string) => boolean;
  /** Depth the search was asked for, so partial results read as partial. */
  targetDepth: number;
}

/**
 * Engine output, read against the repertoire rather than presented raw.
 *
 * The ordering is deliberate: the repertoire verdict comes first, because
 * "does my book hold up here" is the question, and the raw lines come second
 * as the evidence for it.
 */
export function EnginePanel({
  status,
  analysis,
  thinking,
  repertoires,
  onPlay,
  targetDepth,
}: Props) {
  const rep = useMemo(
    () => (analysis ? repertoireFor(repertoires, analysis.fen) : null),
    [analysis, repertoires],
  );

  const audit = useMemo(
    () => (analysis ? auditPosition(analysis, rep) : null),
    [analysis, rep],
  );

  if (status === 'unavailable') {
    return (
      <section className="card">
        <h2>Engine</h2>
        <p className="muted small">
          Engine files aren't in this build. Run <code>npm run engine</code> and
          reload.
        </p>
      </section>
    );
  }

  if (status === 'loading') {
    return (
      <section className="card">
        <h2>Engine</h2>
        <p className="muted small">
          Loading Stockfish — about 7 MB, once. Cached afterwards, including
          offline.
        </p>
      </section>
    );
  }

  return (
    // The analysed FEN is exposed so a test can tell "this panel is about the
    // position on the board" from "this panel has not caught up yet" — the two
    // are indistinguishable from the rendered text, and confusing them makes a
    // test silently assert against the previous position.
    <section className="card" data-fen={analysis?.fen ?? ''}>
      <h2>
        Engine
        <span className="muted small engine__depth">
          {audit ? `depth ${audit.depth}` : 'starting'}
          {thinking && audit && audit.depth < targetDepth ? '…' : ''}
        </span>
      </h2>

      {!audit || !audit.candidates.length ? (
        <p className="muted small">Thinking…</p>
      ) : (
        <>
          <p className="engine__summary" data-agrees={audit.bookHasEngineChoice}>
            {summarise(audit, rep?.name)}
          </p>

          <ul className="engine__lines">
            {audit.candidates.map((c) => (
              <Line key={c.san} candidate={c} onPlay={onPlay} />
            ))}
          </ul>

          {audit.unratedBookMoves.length > 0 && (
            <p className="muted small">
              Also in book, outside the engine's top {audit.candidates.length}:{' '}
              {audit.unratedBookMoves.join(', ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Line({
  candidate,
  onPlay,
}: {
  candidate: Candidate;
  onPlay?: (san: string) => boolean;
}) {
  const { san, score, continuation, inBook, loss, verdict, note } = candidate;

  return (
    <li className="engine__line" data-inbook={inBook}>
      <div className="engine__head">
        <span className="engine__score">{formatScore(score)}</span>
        <button
          className="engine__san"
          onClick={() => onPlay?.(san)}
          disabled={!onPlay}
          title={onPlay ? `Play ${san}` : undefined}
        >
          {san}
        </button>
        {inBook && (
          <span className="engine__tag" title="This move is in your repertoire">
            book
          </span>
        )}
        {/* Only worth a badge when it says something: labelling the engine's
            own first choice "Engine choice" is noise. */}
        {loss >= 2 && (
          <span className="engine__verdict" data-verdict={verdict}>
            {VERDICT_LABEL[verdict]} −{loss.toFixed(0)}%
          </span>
        )}
      </div>
      {continuation.length > 0 && (
        <p className="engine__pv">{continuation.slice(0, 8).join(' ')}</p>
      )}
      {note && <p className="engine__note">{note}</p>}
    </li>
  );
}
