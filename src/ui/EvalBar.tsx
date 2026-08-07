import { barFraction, formatScore } from '../model/score';
import type { Score } from '../model/score';

interface Props {
  /** White-POV. Null while the engine has not reported yet. */
  score: Score | null;
  /** Which way up the board is, so the bar agrees with it. */
  orientation: 'white' | 'black';
  /** Dims the bar while a search is still shallow. */
  thinking?: boolean;
}

/**
 * The vertical eval bar beside the board.
 *
 * White's share fills from whichever end White's pieces are on, so the bar
 * rising always means "the side nearest me is doing well" regardless of which
 * colour is being studied.
 */
export function EvalBar({ score, orientation, thinking }: Props) {
  const fraction = score ? barFraction(score) : 0.5;
  const whitePct = fraction * 100;

  // The label sits on whichever half is currently large enough to hold it.
  const labelAtWhiteEnd = fraction > 0.5;

  return (
    <div
      className="evalbar"
      data-orientation={orientation}
      data-thinking={thinking ? 'yes' : 'no'}
      role="img"
      aria-label={score ? `Evaluation ${formatScore(score)}` : 'Evaluating'}
      title={score ? formatScore(score) : 'Evaluating…'}
    >
      <div className="evalbar__white" style={{ height: `${whitePct}%` }} />
      <span
        className="evalbar__label"
        data-end={labelAtWhiteEnd ? 'white' : 'black'}
      >
        {score ? formatScore(score) : '·'}
      </span>
    </div>
  );
}
