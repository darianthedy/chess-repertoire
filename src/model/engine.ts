/**
 * A UCI client for Stockfish.
 *
 * Split into three pieces so the interesting parts are testable without a
 * browser: line parsing is pure, the protocol driver talks to an abstract
 * `Transport`, and only `workerTransport` touches `Worker`.
 */

import { chessAt, turnOf } from './fen';
import { toWhitePov } from './score';
import type { Score } from './score';

/** Anything that can carry UCI text both ways. A Worker, or a test double. */
export interface Transport {
  send(command: string): void;
  onLine(handler: (line: string) => void): void;
  terminate(): void;
}

/** One principal variation at one depth. */
export interface PvLine {
  /** 1-based; line 1 is the engine's preferred move. */
  multipv: number;
  depth: number;
  /** White-POV. */
  score: Score;
  /** SAN, from the analysed position. Empty if the PV could not be replayed. */
  san: string[];
}

export interface Analysis {
  fen: string;
  depth: number;
  /** Sorted by `multipv`, so `lines[0]` is the engine's choice. */
  lines: PvLine[];
  /** False while still searching; true once `bestmove` has arrived. */
  complete: boolean;
}

export interface AnalyseOptions {
  depth?: number;
  multiPv?: number;
  /** Called on every deeper result, so the UI can fill in as the search runs. */
  onUpdate?: (analysis: Analysis) => void;
  signal?: AbortSignal;
}

/** Parsed fields of one `info` line. Fields absent from the line stay absent. */
export interface InfoLine {
  depth?: number;
  multipv?: number;
  /** Side-to-move POV, exactly as UCI reports it. */
  score?: Score;
  /** Long algebraic, e.g. `e2e4`. */
  pv?: string[];
  /** Set on upper/lowerbound lines, which must not be shown as results. */
  bound?: 'lower' | 'upper';
}

/**
 * Parse a UCI `info` line.
 *
 * Token-scanning rather than regex because the field order is not fixed by the
 * spec and `pv` is variadic — it runs to the end of the line, so it has to be
 * consumed last no matter where it appears.
 */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null;

  const tokens = line.split(/\s+/);
  const info: InfoLine = {};

  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':
        info.depth = Number(tokens[++i]);
        break;
      case 'multipv':
        info.multipv = Number(tokens[++i]);
        break;
      case 'score': {
        const kind = tokens[++i];
        const value = Number(tokens[++i]);
        if (kind === 'cp') info.score = { kind: 'cp', cp: value };
        else if (kind === 'mate') info.score = { kind: 'mate', mate: value };
        break;
      }
      case 'lowerbound':
        info.bound = 'lower';
        break;
      case 'upperbound':
        info.bound = 'upper';
        break;
      case 'pv':
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
    }
  }

  return info;
}

/**
 * Replay long-algebraic UCI moves as SAN from `fen`.
 *
 * Stops at the first move that will not play rather than throwing: a PV is
 * advisory display text, and half of one is more useful than none. This
 * happens legitimately — Stockfish truncates PVs at the transposition table.
 */
export function uciToSan(fen: string, uciMoves: string[]): string[] {
  const chess = chessAt(fen);
  const san: string[] = [];

  for (const uci of uciMoves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    try {
      const move = chess.move({ from, to, promotion });
      if (!move) break;
      san.push(move.san);
    } catch {
      break;
    }
  }

  return san;
}

/** Thrown when analysis is cancelled by a newer request or an abort signal. */
export class Cancelled extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'Cancelled';
  }
}

export const DEFAULT_DEPTH = 18;
export const DEFAULT_MULTI_PV = 3;

/**
 * Drives one Stockfish instance.
 *
 * Only one search may be in flight — a UCI engine has a single position, so
 * overlapping searches are not a thing you can have. Requests therefore queue,
 * and a queued request cancels any earlier one that has not been consumed:
 * when a user clicks through a game quickly, the intermediate positions are of
 * no interest and analysing them would just delay the one they stopped on.
 */
export class Engine {
  private readonly transport: Transport;
  /** Resolves once `uciok`/`readyok` have come back. */
  private readonly booted: Promise<void>;
  private bootDone!: () => void;

  /** Incremented per request; stale handlers compare against it and bail. */
  private generation = 0;
  /** The in-flight search's line handler, if any. */
  private active: ((line: string) => void) | null = null;
  /** Chains requests so `position`/`go` never interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Waiting for a `readyok` that is not the boot one. */
  private pendingSync: (() => void) | null = null;
  private multiPv = 0;
  private booting = true;
  private disposed = false;

  constructor(transport: Transport) {
    this.transport = transport;
    this.booted = new Promise<void>((resolve) => {
      this.bootDone = resolve;
    });

    this.transport.onLine((line) => this.receive(line));
    this.transport.send('uci');
  }

  private receive(line: string): void {
    if (line.startsWith('uciok')) {
      this.transport.send('isready');
      return;
    }
    if (line.startsWith('readyok')) {
      if (this.booting) {
        this.booting = false;
        this.bootDone();
      } else {
        const sync = this.pendingSync;
        this.pendingSync = null;
        sync?.();
      }
      return;
    }
    this.active?.(line);
  }

  /**
   * The `isready`/`readyok` handshake.
   *
   * Not ceremony: `ucinewgame` reallocates the hash table, and issuing it
   * without waiting for `readyok` traps the WASM build outright
   * (`RuntimeError: unreachable`). The UCI spec requires this wait and
   * Stockfish means it.
   */
  private sync(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pendingSync = resolve;
      this.transport.send('isready');
    });
  }

  /** Resolves when the engine has finished loading and is ready to search. */
  ready(): Promise<void> {
    return this.booted;
  }

  /**
   * Analyse `fen`. Resolves with the deepest result reached.
   *
   * Rejects with `Cancelled` if a later `analyse` call supersedes this one or
   * the supplied signal aborts. Callers rendering a position should treat that
   * as "nothing to do", not as an error worth showing.
   */
  analyse(fen: string, options: AnalyseOptions = {}): Promise<Analysis> {
    const {
      depth = DEFAULT_DEPTH,
      multiPv = DEFAULT_MULTI_PV,
      onUpdate,
      signal,
    } = options;

    const mine = ++this.generation;
    // Interrupt whatever is running now. The queue still serialises the actual
    // commands; this only shortens the wait for the search we no longer want.
    if (this.active) this.transport.send('stop');

    const run = async (): Promise<Analysis> => {
      if (this.disposed || mine !== this.generation) throw new Cancelled();
      await this.booted;
      if (mine !== this.generation) throw new Cancelled();

      if (this.multiPv !== multiPv) {
        this.transport.send(`setoption name MultiPV value ${multiPv}`);
        this.multiPv = multiPv;
      }

      const turn = turnOf(fen);

      /**
       * Stockfish reports `multipv 1..N` afresh for each depth iteration, and
       * only a whole iteration is coherent — mid-iteration the new ranking is
       * partly written over the old one, which is where duplicate moves and
       * more lines than MultiPV asked for come from.
       *
       * So the current iteration is accumulated separately and only becomes
       * visible once it is at least as complete as what is already on screen.
       * That gives coherent results without the panel ever shrinking.
       */
      const iteration = new Map<number, PvLine>();
      let iterationDepth = 0;
      let published: PvLine[] = [];
      let publishedDepth = 0;

      const byMultipv = (a: PvLine, b: PvLine) => a.multipv - b.multipv;

      /** Promote the current iteration if it is no thinner than the last. */
      const publish = (): boolean => {
        if (iteration.size < Math.max(published.length, 1)) return false;
        published = [...iteration.values()].sort(byMultipv);
        publishedDepth = iterationDepth;
        return true;
      };

      const snapshot = (complete: boolean): Analysis => ({
        fen,
        depth: publishedDepth,
        lines: published,
        complete,
      });

      if (signal?.aborted) throw new Cancelled();

      // `ucinewgame` before each position: without it the engine reuses hash
      // from an unrelated position, which makes repeated analysis of the same
      // FEN return different depths and makes results non-reproducible. The
      // `sync()` after it is mandatory — see its comment.
      this.transport.send('ucinewgame');
      await this.sync();
      if (mine !== this.generation) throw new Cancelled();

      return await new Promise<Analysis>((resolve, reject) => {
        /**
         * Set when the caller has given up but the engine has not yet stopped.
         *
         * This is the whole reason the promise cannot settle early: the search
         * keeps running in the worker until it answers `bestmove`, and issuing
         * the next `ucinewgame` before that answer traps the WASM build. So an
         * abort sends `stop` and then *waits*, and the queue slot stays held
         * until the engine confirms it is idle.
         */
        let abandoned = false;

        const onAbort = () => {
          abandoned = true;
          this.transport.send('stop');
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        this.active = (line: string) => {
          if (line.startsWith('bestmove')) {
            this.active = null;
            signal?.removeEventListener('abort', onAbort);
            // Superseded searches are reported as cancelled even though they
            // have a usable result: the caller has moved on, and resolving
            // would race a newer answer onto the screen.
            if (abandoned || mine !== this.generation) reject(new Cancelled());
            else {
              // The final iteration usually completes without a deeper one
              // starting to displace it, so promote it before resolving.
              publish();
              // Whatever depth was reached is a real evaluation of the position
              // asked about, so returning it beats reporting failure even when
              // the search was cut short.
              resolve(snapshot(true));
            }
            return;
          }

          const info = parseInfo(line);
          // Bounded scores are search-window artefacts, not evaluations: a
          // lowerbound "+9.0" that settles at +0.2 would flash a won position
          // on the bar for a frame.
          if (!info || info.bound || !info.pv || !info.score) return;
          if (info.depth === undefined) return;

          if (info.depth > iterationDepth) {
            iterationDepth = info.depth;
            iteration.clear();
          } else if (info.depth < iterationDepth) {
            // A straggler from an iteration already superseded.
            return;
          }

          iteration.set(info.multipv ?? 1, {
            multipv: info.multipv ?? 1,
            depth: info.depth,
            score: toWhitePov(info.score, turn),
            san: uciToSan(fen, info.pv),
          });

          if (publish() && !abandoned) onUpdate?.(snapshot(false));
        };

        this.transport.send(`position fen ${fen} 0 1`);
        this.transport.send(`go depth ${depth}`);
      });
    };

    // Swallow the predecessor's rejection so one cancellation cannot break the
    // chain for every request behind it.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Stop the current search without queueing anything new. */
  stop(): void {
    this.generation++;
    if (this.active) this.transport.send('stop');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;

    // Settle any in-flight search before tearing the worker down. Its promise
    // only resolves on `bestmove`, which is never coming once the worker is
    // gone, and a caller awaiting it would hang for the life of the page.
    const inFlight = this.active;
    this.active = null;
    inFlight?.('bestmove (disposed)');
    this.pendingSync?.();
    this.pendingSync = null;

    this.transport.send('quit');
    this.transport.terminate();
  }
}

/** Where `scripts/fetch-engine.mjs` puts the engine, relative to the app base. */
export const ENGINE_PATH = 'engine/stockfish-18-lite-single.js';

/**
 * A Transport backed by the Stockfish worker build.
 *
 * A classic worker, not a module worker: this build installs its own
 * `onmessage` at top level and locates its `.wasm` from `location`, neither of
 * which survives ES-module wrapping.
 */
export function workerTransport(base: string = import.meta.env.BASE_URL): Transport {
  const url = new URL(`${base}${ENGINE_PATH}`, window.location.href);
  const worker = new Worker(url);

  return {
    send: (command) => worker.postMessage(command),
    onLine: (handler) => {
      worker.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data === 'string') handler(event.data);
      });
    },
    terminate: () => worker.terminate(),
  };
}

/** Whether the engine assets were fetched into this build. */
export async function engineAvailable(
  base: string = import.meta.env.BASE_URL,
): Promise<boolean> {
  try {
    const res = await fetch(`${base}${ENGINE_PATH}`, { method: 'HEAD' });
    // The SPA fallback answers 200 with index.html for unknown paths, so the
    // status alone proves nothing — the content type is what distinguishes a
    // real script from the shell.
    return res.ok && !(res.headers.get('content-type') ?? '').includes('html');
  } catch {
    return false;
  }
}
