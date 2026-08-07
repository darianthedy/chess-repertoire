import { useRef, useState } from 'react';
import { defaultSideForSlot, makeRepertoire } from '../model/seed';
import { dueCount } from '../model/lines';
import { downloadJson, parseState } from '../model/storage';
import { myPositionCount, positionCount } from '../model/tree';
import type { AppState, Repertoire, RepertoireState, Side } from '../model/types';

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState | null>>;
  /** Open an existing repertoire — its lines, so it can be read before edited. */
  onOpen: (id: string) => void;
  /**
   * Open a repertoire that has just been created. Straight to the board, not the
   * line list: a new tree has no lines to read, and an empty screen between
   * "Create" and the first move is pure friction.
   */
  onCreate: (id: string) => void;
  onStartSession: () => void;
  onReviewGames: () => void;
}

const STATES: RepertoireState[] = ['primary', 'active', 'trial', 'parked'];

export function RepertoireList({
  state,
  setState,
  onOpen,
  onCreate,
  onStartSession,
  onReviewGames,
}: Props) {
  const due = dueCount(state, Date.now());
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [side, setSide] = useState<Side>('w');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const slots = [...state.slots].sort((a, b) => a.order - b.order);

  const create = (slotId: string) => {
    if (!name.trim()) return;
    const rep = makeRepertoire(slotId, name.trim(), side);
    setState((s) => (s ? { ...s, repertoires: [...s.repertoires, rep] } : s));
    setName('');
    setAddingTo(null);
    onCreate(rep.id);
  };

  const patch = (id: string, fields: Partial<Repertoire>) => {
    setState((s) =>
      s
        ? {
            ...s,
            repertoires: s.repertoires.map((r) =>
              r.id === id ? { ...r, ...fields } : r,
            ),
          }
        : s,
    );
  };

  const remove = (rep: Repertoire) => {
    if (!confirm(`Delete "${rep.name}" and its entire tree? Export first if unsure.`)) return;
    setState((s) =>
      s ? { ...s, repertoires: s.repertoires.filter((r) => r.id !== rep.id) } : s,
    );
  };

  const importFile = async (file: File) => {
    try {
      const parsed = parseState(JSON.parse(await file.text()));
      // Replace wholesale rather than merging: merging trees needs conflict
      // rules that don't exist yet, and silently half-merging would be worse
      // than making the user re-import deliberately.
      if (
        !confirm(
          `Replace all current data with this file?\n\n${parsed.repertoires.length} repertoire(s) will be loaded.`,
        )
      )
        return;
      setState(parsed);
      setImportError(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not read file');
    }
  };

  return (
    <div className="home">
      <header className="home__head">
        <div>
          <h1>Chess Repertoire</h1>
          {state.streak && state.streak.count > 0 && (
            <p className="muted small">
              {state.streak.count} day streak · last drilled{' '}
              {state.streak.lastDate}
            </p>
          )}
        </div>
        <div className="row">
          <button onClick={() => downloadJson(state)}>Export JSON</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {importError && <p className="error">Import failed: {importError}</p>}

      {/* The one number that matters. No dashboards — the question is only
          ever "did I do it today". */}
      <section className="today">
        <div>
          <strong className="today__count">{due}</strong>
          <span className="muted small"> due today</span>
        </div>
        <div className="row">
          <button onClick={onReviewGames}>Games</button>
          <button className="primary" onClick={onStartSession} disabled={!due}>
            {due ? 'Start drilling' : 'Nothing due'}
          </button>
        </div>
      </section>

      {slots.map((slot) => {
        const reps = state.repertoires.filter((r) => r.slotId === slot.id);
        return (
          <section key={slot.id} className="slot">
            <div className="slot__head">
              <h2>{slot.name}</h2>
              <button
                className="link"
                onClick={() => {
                  setAddingTo(addingTo === slot.id ? null : slot.id);
                  setSide(defaultSideForSlot(slot.id));
                  setName('');
                }}
              >
                + Add repertoire
              </button>
            </div>

            {addingTo === slot.id && (
              <div className="card card--accent">
                <label className="field">
                  <span>Name</span>
                  <input
                    autoFocus
                    value={name}
                    placeholder="e.g. London System"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && create(slot.id)}
                  />
                </label>
                <label className="field">
                  <span>I play</span>
                  <select
                    value={side}
                    onChange={(e) => setSide(e.target.value as Side)}
                  >
                    <option value="w">White</option>
                    <option value="b">Black</option>
                  </select>
                </label>
                <div className="row">
                  <button
                    className="primary"
                    onClick={() => create(slot.id)}
                    disabled={!name.trim()}
                  >
                    Create
                  </button>
                  <button onClick={() => setAddingTo(null)}>Cancel</button>
                </div>
              </div>
            )}

            {reps.length === 0 ? (
              <p className="muted small">Empty.</p>
            ) : (
              <ul className="reps">
                {reps.map((rep) => (
                  <li key={rep.id} className="rep">
                    <button className="rep__open" onClick={() => onOpen(rep.id)}>
                      <strong>{rep.name}</strong>
                      <span className="muted small">
                        {rep.side === 'w' ? 'White' : 'Black'} ·{' '}
                        {positionCount(rep)} positions · {myPositionCount(rep)}{' '}
                        of mine
                      </span>
                    </button>
                    <div className="rep__meta">
                      <select
                        value={rep.state}
                        title="Repertoire state"
                        onChange={(e) =>
                          patch(rep.id, {
                            state: e.target.value as RepertoireState,
                          })
                        }
                      >
                        {STATES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <label className="depth" title="Drill window, in full moves">
                        depth
                        <input
                          type="number"
                          min={1}
                          max={40}
                          value={rep.activeDepth}
                          onChange={(e) =>
                            patch(rep.id, {
                              activeDepth: Math.max(
                                1,
                                Number(e.target.value) || 1,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        className="icon icon--danger"
                        title="Delete repertoire"
                        onClick={() => remove(rep)}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
