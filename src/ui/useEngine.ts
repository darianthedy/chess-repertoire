import { useEffect, useRef, useState } from 'react';
import {
  Cancelled,
  DEFAULT_MULTI_PV,
  Engine,
  engineAvailable,
  workerTransport,
} from '../model/engine';
import type { Analysis } from '../model/engine';

export type EngineStatus =
  /** Never asked for. */
  | 'off'
  /** Downloading 7 MB of WASM, or booting it. */
  | 'loading'
  | 'ready'
  /** Assets missing from this build, or the worker failed to start. */
  | 'unavailable';

/**
 * Own one Stockfish instance for as long as it is switched on.
 *
 * Creation is deliberately lazy and disposal is eager: the engine is a 7 MB
 * download and a busy worker, and most sessions here are drilling, which never
 * wants it. Nothing is fetched until `enabled` first goes true.
 */
export function useEngine(enabled: boolean): {
  engine: Engine | null;
  status: EngineStatus;
} {
  const [status, setStatus] = useState<EngineStatus>('off');
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }

    let cancelled = false;
    let created: Engine | null = null;
    setStatus('loading');

    // Probe before constructing the Worker: a missing asset surfaces as an
    // opaque worker error otherwise, which reads as a bug rather than as the
    // "run npm run engine" that it is.
    void engineAvailable().then(async (ok) => {
      if (cancelled) return;
      if (!ok) {
        setStatus('unavailable');
        return;
      }

      try {
        created = new Engine(workerTransport());
        await created.ready();
        if (cancelled) {
          created.dispose();
          return;
        }
        setEngine(created);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    });

    return () => {
      cancelled = true;
      created?.dispose();
      setEngine(null);
    };
  }, [enabled]);

  return { engine, status };
}

export interface AnalysisState {
  analysis: Analysis | null;
  /** True while a search for the current position is still running. */
  thinking: boolean;
}

/**
 * Keep an analysis of `fen` current.
 *
 * Results stream in as the search deepens rather than appearing at the end, so
 * the bar settles visibly instead of hanging blank for a second. The previous
 * analysis is cleared on every position change: showing the last position's
 * evaluation next to a new board is worse than showing nothing.
 */
export function useAnalysis(
  engine: Engine | null,
  fen: string,
  options: { depth: number; multiPv?: number; enabled?: boolean },
): AnalysisState {
  const { depth, multiPv = DEFAULT_MULTI_PV, enabled = true } = options;
  const [state, setState] = useState<AnalysisState>({
    analysis: null,
    thinking: false,
  });

  // Held in a ref so a stream of `onUpdate` callbacks cannot resurrect a
  // superseded position's results after the effect has moved on.
  const generation = useRef(0);

  useEffect(() => {
    if (!engine || !enabled) {
      setState({ analysis: null, thinking: false });
      return;
    }

    const mine = ++generation.current;
    const controller = new AbortController();
    setState({ analysis: null, thinking: true });

    engine
      .analyse(fen, {
        depth,
        multiPv,
        signal: controller.signal,
        onUpdate: (analysis) => {
          if (mine === generation.current) setState({ analysis, thinking: true });
        },
      })
      .then((analysis) => {
        if (mine === generation.current) setState({ analysis, thinking: false });
      })
      .catch((err) => {
        // Cancellation is the expected outcome of clicking through moves, not
        // a failure worth reporting.
        if (err instanceof Cancelled) return;
        if (mine === generation.current) {
          setState({ analysis: null, thinking: false });
        }
      });

    return () => controller.abort();
  }, [depth, enabled, engine, fen, multiPv]);

  return state;
}
