import { useCallback, useState } from 'react';
import { buildSession } from './model/lines';
import type { DrillLine } from './model/lines';
import { bumpStreak } from './model/srs';
import { useAppState } from './useAppState';
import { applyGrade, Drill } from './ui/Drill';
import { Editor } from './ui/Editor';
import { RepertoireList } from './ui/RepertoireList';
import './App.css';

/**
 * Phase 2 — drilling.
 *
 * Three screens, no router: the repertoire list, the tree editor, and a drill
 * session. Deep links aren't wanted here (a puzzle shouldn't be shareable or
 * resumable by URL), so a mode flag is enough.
 */
export default function App() {
  const { state, setState, updateRepertoire } = useAppState();
  const [openId, setOpenId] = useState<string | null>(null);
  const [session, setSession] = useState<DrillLine[] | null>(null);

  const onChange = useCallback(
    (fn: Parameters<typeof updateRepertoire>[1]) => {
      if (openId) updateRepertoire(openId, fn);
    },
    [openId, updateRepertoire],
  );

  const onGrade = useCallback(
    (repertoireId: string, fen: string, correct: boolean) => {
      setState((s) =>
        s ? applyGrade(s, repertoireId, fen, correct, Date.now()) : s,
      );
    },
    [setState],
  );

  const startSession = useCallback(() => {
    if (!state) return;
    const lines = buildSession(state, Date.now());
    if (lines.length) setSession(lines);
  }, [state]);

  const endSession = useCallback(() => {
    // The streak counts a day on which a session was actually run, whether or
    // not the queue was emptied — showing up is the habit being tracked.
    setState((s) => (s ? { ...s, streak: bumpStreak(s.streak, Date.now()) } : s));
    setSession(null);
  }, [setState]);

  if (!state) {
    return (
      <main className="app">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (session) {
    return (
      <main className="app">
        <Drill
          state={state}
          lines={session}
          onGrade={onGrade}
          onDone={endSession}
        />
      </main>
    );
  }

  const open = state.repertoires.find((r) => r.id === openId) ?? null;

  return (
    <main className="app">
      {open ? (
        <Editor rep={open} onChange={onChange} onBack={() => setOpenId(null)} />
      ) : (
        <RepertoireList
          state={state}
          setState={setState}
          onOpen={setOpenId}
          onStartSession={startSession}
        />
      )}
    </main>
  );
}
