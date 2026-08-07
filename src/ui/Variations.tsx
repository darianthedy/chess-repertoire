import { useMemo, useState } from 'react';
import { positionCount, setLineName } from '../model/tree';
import type { PathStep } from '../model/tree';
import {
  listVariations,
  variationDepth,
  variationText,
  VARIATION_CAP,
} from '../model/variations';
import type { Repertoire } from '../model/types';

interface Props {
  rep: Repertoire;
  /** Open the editor on a line, positioned at its last move. */
  onOpen: (steps: PathStep[]) => void;
  /** Open the editor at the starting position, to begin a new line. */
  onNew: () => void;
  onChange: (fn: (rep: Repertoire) => Repertoire) => void;
  onBack: () => void;
}

/**
 * The landing screen for a repertoire: what's in it, as lines.
 *
 * Opening straight into the board editor answers "add a move" well and "what do
 * I already have?" not at all — the tree is only legible one node at a time.
 * Listing the lines first makes the repertoire readable, and makes editing an
 * existing variation a matter of picking it rather than navigating back to it.
 */
export function Variations({ rep, onOpen, onNew, onChange, onBack }: Props) {
  const [query, setQuery] = useState('');
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  // Keyed by the line's terminal FEN, which is where the name is stored — an id
  // built from the moves would go stale the moment the line is edited.
  const [naming, setNaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const { variations, truncated } = useMemo(
    () => listVariations(rep),
    [rep],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variations.filter((v) => {
      if (unfinishedOnly && v.plan?.trim()) return false;
      if (!q) return true;
      return (
        (v.name ?? '').toLowerCase().includes(q) ||
        variationText(v.steps).toLowerCase().includes(q) ||
        (v.plan ?? '').toLowerCase().includes(q)
      );
    });
  }, [query, unfinishedOnly, variations]);

  const unfinished = variations.filter((v) => !v.plan?.trim()).length;

  const endFen = (v: { steps: PathStep[] }) => v.steps[v.steps.length - 1].fen;

  const saveName = (fen: string) => {
    onChange((r) => setLineName(r, fen, draftName));
    setNaming(null);
  };

  return (
    <div className="variations">
      <header className="editor__bar">
        <button className="link" onClick={onBack}>
          ← All repertoires
        </button>
        <div className="editor__title">
          <strong>{rep.name}</strong>
          <span className="muted">
            {' '}
            · {rep.side === 'w' ? 'White' : 'Black'} · {positionCount(rep)}{' '}
            positions
          </span>
        </div>
        <button className="primary" onClick={onNew}>
          + New line
        </button>
      </header>

      {variations.length === 0 ? (
        <section className="card">
          <h2>No lines yet</h2>
          <p className="muted small">
            Nothing stored in this repertoire. Open the board and play a move to
            start the tree, or import a PGN or Lichess study from there.
          </p>
          <button className="primary" onClick={onNew}>
            Open the board
          </button>
        </section>
      ) : (
        <>
          <section className="card vars__filters">
            <input
              type="text"
              value={query}
              placeholder="Filter by name, moves or plan — e.g. Jobava, Bf4, d-file"
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="vars__toggle">
              <input
                type="checkbox"
                checked={unfinishedOnly}
                onChange={(e) => setUnfinishedOnly(e.target.checked)}
              />
              {/* A line ends at a plan, not a move count (PRODUCT.md §6), so
                  "no plan yet" is the useful definition of unfinished. */}
              <span>
                Only lines with no plan
                {unfinished ? ` (${unfinished})` : ''}
              </span>
            </label>
          </section>

          <p className="muted small vars__count">
            {shown.length} of {variations.length} line
            {variations.length === 1 ? '' : 's'}
            {truncated &&
              ` · stopped at ${VARIATION_CAP} — transpositions make the rest overlap heavily`}
          </p>

          <ul className="vars">
            {shown.map((v) => (
              <li key={v.id} className="vars__row">
                <button className="var" onClick={() => onOpen(v.steps)}>
                  {/* The name leads when there is one: it's how the line is
                      recalled, and the movetext is the detail underneath. */}
                  {v.name && <span className="var__name">{v.name}</span>}
                  <span className="var__moves">{variationText(v.steps)}</span>
                  <span className="var__meta muted small">
                    {v.main && <span className="tag">main line</span>}
                    {v.cyclic && (
                      <span className="tag" title="Ends by transposing back into itself">
                        transposes
                      </span>
                    )}
                    <span>{variationDepth(v.steps)} moves</span>
                    <span>
                      {v.noted}/{v.mine} of mine annotated
                    </span>
                    {v.plan?.trim() ? (
                      <span className="var__plan">plan: {v.plan}</span>
                    ) : (
                      <span className="tag tag--warn">no plan</span>
                    )}
                  </span>
                </button>
                {/* Outside the row button, not inside it: a button can't nest
                    inside a button, and renaming isn't "open this line". */}
                <button
                  className="var__rename"
                  title={v.name ? 'Rename this line' : 'Name this line'}
                  onClick={() => {
                    const fen = endFen(v);
                    setNaming(naming === fen ? null : fen);
                    setDraftName(v.name ?? '');
                  }}
                >
                  {v.name ? 'Rename' : '+ Name'}
                </button>

                {naming === endFen(v) && (
                  <div className="var__naming">
                    <input
                      type="text"
                      autoFocus
                      value={draftName}
                      placeholder="e.g. Jobava London, Exchange Slav"
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveName(endFen(v));
                        if (e.key === 'Escape') setNaming(null);
                      }}
                    />
                    <button
                      className="primary"
                      onClick={() => saveName(endFen(v))}
                    >
                      Save
                    </button>
                    <button onClick={() => setNaming(null)}>Cancel</button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {shown.length === 0 && (
            <p className="muted small">Nothing matches that filter.</p>
          )}
        </>
      )}
    </div>
  );
}
