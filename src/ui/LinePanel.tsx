import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PathStep } from '../model/tree';

/** One numbered row of the line: the pair of moves, plus a marker for where
 *  the continuation choices belong when the row is the live one. */
interface Row {
  no: number;
  white?: { san: string; index: number };
  black?: { san: string; index: number };
  cont?: 'white' | 'black';
}

interface Props {
  path: PathStep[];
  /** Rewind to the position after the move at `index`. */
  onGoTo: (index: number) => void;
  /** Said about the live end of the line, e.g. whose move it is. */
  hint?: string;
  /**
   * One choice per row. Worth it when each choice carries its own controls,
   * where a wrap would leave buttons floating next to the wrong move.
   */
  stackCont?: boolean;
  /**
   * What is offered where the line runs out — rendered into the cell the next
   * move would occupy, so choosing one reads as continuing the line rather
   * than as consulting a list beside it.
   */
  children: ReactNode;
}

/**
 * The line walked so far and the ways it can continue, as one thing.
 *
 * They were two panels describing one sequence, which meant reading the line
 * in one place and steering it in another. Here the continuation sits in the
 * cell it would actually occupy, and the box scrolls rather than growing, so a
 * long line never pushes the board out of reach.
 */
export function LinePanel({ path, onGoTo, hint, stackCont, children }: Props) {
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
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [path.length]);

  const last = path.length - 1;
  const cont =
    'line__cell line__cont' + (stackCont ? ' line__cont--stack' : '');

  return (
    <section className="card">
      <h2>
        Line
        {hint && <span className="muted"> · {hint}</span>}
      </h2>
      <div className="line" ref={box}>
        {rows.map((row) => (
          <div key={row.no} className="line__row">
            <span className="line__no">{row.no}.</span>
            {row.cont === 'white' ? (
              // Nothing is going in Black's cell on this row, so let the
              // choices use it rather than wrap inside half the width.
              <span className={cont + ' line__cont--span'}>{children}</span>
            ) : (
              <Played entry={row.white} last={last} onGoTo={onGoTo} />
            )}
            {row.cont === 'black' && (
              <span className={cont}>{children}</span>
            )}
            {!row.cont && <Played entry={row.black} last={last} onGoTo={onGoTo} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A move already played, clickable to rewind to it. */
function Played({
  entry,
  last,
  onGoTo,
}: {
  entry?: { san: string; index: number };
  last: number;
  onGoTo: (index: number) => void;
}) {
  return (
    <span className="line__cell">
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
