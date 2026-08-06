import { useCallback, useState } from 'react';
import { useAppState } from './useAppState';
import { Editor } from './ui/Editor';
import { RepertoireList } from './ui/RepertoireList';
import './App.css';

/**
 * Phase 1 — tree, editor, notes, persistence.
 *
 * Drilling is Phase 2. Everything here is about owning a repertoire: entering
 * it, annotating it, and getting it back out again as JSON.
 */
export default function App() {
  const { state, setState, updateRepertoire } = useAppState();
  const [openId, setOpenId] = useState<string | null>(null);

  const onChange = useCallback(
    (fn: Parameters<typeof updateRepertoire>[1]) => {
      if (openId) updateRepertoire(openId, fn);
    },
    [openId, updateRepertoire],
  );

  if (!state) {
    return (
      <main className="app">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const open = state.repertoires.find((r) => r.id === openId) ?? null;

  return (
    <main className="app">
      {open ? (
        <Editor rep={open} onChange={onChange} onBack={() => setOpenId(null)} />
      ) : (
        <RepertoireList state={state} setState={setState} onOpen={setOpenId} />
      )}
    </main>
  );
}
