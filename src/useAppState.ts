import { useCallback, useEffect, useRef, useState } from 'react';
import { loadState, saveState } from './model/storage';
import type { AppState, Repertoire } from './model/types';

/**
 * Loads state from IndexedDB once, then persists on every change.
 *
 * Writes are debounced because the editor mutates state on each keystroke in a
 * note field, and IndexedDB writes of the whole blob are not free.
 */
export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    loadState().then(setState);
  }, []);

  useEffect(() => {
    if (!state) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void saveState(state);
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [state]);

  const updateRepertoire = useCallback(
    (id: string, fn: (rep: Repertoire) => Repertoire) => {
      setState((s) =>
        s
          ? {
              ...s,
              repertoires: s.repertoires.map((r) => (r.id === id ? fn(r) : r)),
            }
          : s,
      );
    },
    [],
  );

  return { state, setState, updateRepertoire };
}
