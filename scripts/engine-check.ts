import {
  auditPosition,
  judgeMove,
  rateFromFollowUp,
  repertoireFor,
  summarise,
} from '../src/model/audit';
import type { Analysis } from '../src/model/engine';
import { Cancelled, Engine, parseInfo, uciToSan } from '../src/model/engine';
import type { Transport } from '../src/model/engine';
import { ROOT_FEN, normalizeFen } from '../src/model/fen';
import { importPgn } from '../src/model/pgn';
import {
  barFraction,
  classify,
  formatScore,
  lossPct,
  scoreValue,
  toWhitePov,
  VERDICT_LABEL,
  winPct,
} from '../src/model/score';
import { makeRepertoire } from '../src/model/seed';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

// --- info parsing ------------------------------------------------------------

const INFO =
  'info depth 20 seldepth 28 multipv 2 score cp -34 nodes 1200000 nps 900000 time 1333 pv e7e5 g1f3 b8c6';
const parsed = parseInfo(INFO);

check('depth read', parsed?.depth === 20);
check('multipv read', parsed?.multipv === 2);
check(
  'centipawn score read',
  parsed?.score?.kind === 'cp' && parsed.score.cp === -34,
);
check(
  'pv runs to end of line',
  parsed?.pv?.join(' ') === 'e7e5 g1f3 b8c6',
  parsed?.pv?.join(' '),
);

// `pv` is variadic and its position is not fixed, so a field appearing after it
// must not be swallowed as a move.
const REORDERED = parseInfo('info multipv 1 pv d2d4 d7d5 score mate 3 depth 9');
check(
  'fields after pv are not eaten as moves',
  REORDERED?.pv?.join(' ') === 'd2d4 d7d5 score mate 3 depth 9',
  'pv consumes the rest of the line, by spec',
);

const MATE = parseInfo('info depth 12 score mate -2 pv h2h3 d8h4');
check('mate score read with sign', MATE?.score?.kind === 'mate' && MATE.score.mate === -2);

check(
  'bounded scores are flagged',
  parseInfo('info depth 5 score cp 900 lowerbound pv e2e4')?.bound === 'lower',
);
check('non-info lines rejected', parseInfo('bestmove e2e4 ponder e7e5') === null);

// --- UCI to SAN --------------------------------------------------------------

check(
  'uci moves replay as SAN',
  uciToSan(ROOT_FEN, ['e2e4', 'e7e5', 'g1f3']).join(' ') === 'e4 e5 Nf3',
  uciToSan(ROOT_FEN, ['e2e4', 'e7e5', 'g1f3']).join(' '),
);

check(
  'promotion suffix handled',
  uciToSan('8/P7/8/7k/8/8/8/K7 w - -', ['a7a8q']).join(' ') === 'a8=Q',
  uciToSan('8/P7/8/7k/8/8/8/K7 w - -', ['a7a8q']).join(' '),
);

// Stockfish truncates PVs at the transposition table, so a tail that will not
// replay is normal and must degrade to a shorter PV rather than throwing.
check(
  'illegal tail truncates instead of throwing',
  uciToSan(ROOT_FEN, ['e2e4', 'h7h8', 'g1f3']).join(' ') === 'e4',
);

// --- score maths -------------------------------------------------------------

check(
  'black-POV score flips to white-POV',
  scoreValue(toWhitePov({ kind: 'cp', cp: 50 }, 'b')) === -50,
);
check(
  'white-POV score is left alone',
  scoreValue(toWhitePov({ kind: 'cp', cp: 50 }, 'w')) === 50,
);
check(
  'mate flips sign too',
  formatScore(toWhitePov({ kind: 'mate', mate: 3 }, 'b')) === '-M3',
);

check('equal position formats as 0.00', formatScore({ kind: 'cp', cp: 0 }) === '0.00');
check('advantage formats with sign', formatScore({ kind: 'cp', cp: 137 }) === '+1.37');
check('mate formats as M', formatScore({ kind: 'mate', mate: 4 }) === 'M4');

check('nearer mate outranks distant mate',
  scoreValue({ kind: 'mate', mate: 2 }) > scoreValue({ kind: 'mate', mate: 8 }));
check('being mated is worse than any centipawn score',
  scoreValue({ kind: 'mate', mate: -9 }) < scoreValue({ kind: 'cp', cp: -5000 }));

check('equal position is 50%', Math.abs(winPct({ kind: 'cp', cp: 0 }) - 50) < 0.001);
check('mate is 100%', winPct({ kind: 'mate', mate: 1 }) === 100);
check('bar never fully empties', barFraction({ kind: 'mate', mate: -1 }) > 0);

// The reason move quality is judged on win percentage and not centipawns: the
// same 60cp swing is a real error near equality and nothing at all in a
// completely won position.
const nearEqual = lossPct({ kind: 'cp', cp: 90 }, { kind: 'cp', cp: 30 }, 'w');
const alreadyWon = lossPct({ kind: 'cp', cp: 900 }, { kind: 'cp', cp: 840 }, 'w');
check(
  'equal centipawn swings weigh differently by position',
  nearEqual > alreadyWon * 4,
  `${nearEqual.toFixed(1)}% vs ${alreadyWon.toFixed(1)}%`,
);

// For Black, a *lower* white-POV score is the better outcome.
check(
  'loss is measured from the mover\'s side',
  lossPct({ kind: 'cp', cp: -90 }, { kind: 'cp', cp: -30 }, 'b') > 5,
);
check(
  'a move better than "best" never scores negative loss',
  lossPct({ kind: 'cp', cp: 30 }, { kind: 'cp', cp: 90 }, 'w') === 0,
);

check('small loss is best', classify(1) === 'best');
check('20% loss is a mistake', classify(20) === 'mistake');
check('30% loss is a blunder', classify(30) === 'blunder');

// --- protocol driver ---------------------------------------------------------

/** A scripted engine: replies to UCI commands the way Stockfish would. */
function fakeTransport(): Transport & { sent: string[]; emit: (l: string) => void } {
  let handler: (line: string) => void = () => {};
  const sent: string[] = [];

  return {
    sent,
    emit: (line: string) => handler(line),
    send(command: string) {
      sent.push(command);
      if (command === 'uci') queueMicrotask(() => handler('uciok'));
      if (command === 'isready') queueMicrotask(() => handler('readyok'));
    },
    onLine(fn) {
      handler = fn;
    },
    terminate() {},
  };
}

const t = fakeTransport();
const engine = new Engine(t);
await engine.ready();
check('boot handshake completes', t.sent.includes('uci') && t.sent.includes('isready'));

const pending = engine.analyse(ROOT_FEN, { depth: 10, multiPv: 2 });
await new Promise((r) => setTimeout(r, 0));

check(
  'multipv is configured before searching',
  t.sent.indexOf('setoption name MultiPV value 2') < t.sent.indexOf('go depth 10'),
);
check(
  'hash is cleared between positions so results are reproducible',
  t.sent.includes('ucinewgame'),
);

t.emit('info depth 10 multipv 1 score cp 28 pv e2e4 e7e5');
t.emit('info depth 10 multipv 2 score cp 20 pv d2d4 d7d5');
// A bounded score would flash a bogus evaluation on the bar for one frame.
t.emit('info depth 11 multipv 1 score cp 2000 lowerbound pv g1f3');
t.emit('bestmove e2e4');

const result: Analysis = await pending;
check('lines collected in multipv order', result.lines.map((l) => l.san[0]).join(',') === 'e4,d4');
check('bounded line discarded', result.depth === 10, `depth=${result.depth}`);
check('completion flagged', result.complete);

// Regression: a depth iteration must not be blended with the one before it.
//
// Stockfish restarts `multipv 1..N` at every depth, and mid-iteration the new
// ranking is only partly written over the old. Merging the two produced
// duplicate moves and more rows than MultiPV asked for — which React then
// rendered with colliding keys and silently dropped.
{
  const t3 = fakeTransport();
  const e4 = new Engine(t3);
  await e4.ready();

  const widths: number[] = [];
  const req = e4.analyse(ROOT_FEN, {
    depth: 12,
    multiPv: 3,
    onUpdate: (a) => widths.push(a.lines.length),
  });
  await new Promise((r) => setTimeout(r, 0));

  t3.emit('info depth 10 multipv 1 score cp 30 pv e2e4 e7e5');
  t3.emit('info depth 10 multipv 2 score cp 25 pv d2d4 d7d5');
  t3.emit('info depth 10 multipv 3 score cp 20 pv g1f3 d7d5');
  // Depth 11 begins, and its first line happens to repeat depth 10's second.
  t3.emit('info depth 11 multipv 1 score cp 28 pv d2d4 g8f6');
  t3.emit('info depth 11 multipv 2 score cp 26 pv e2e4 c7c5');
  t3.emit('info depth 11 multipv 3 score cp 18 pv c2c4 e7e6');
  t3.emit('bestmove d2d4');

  const iter = await req;
  const sans = iter.lines.map((l) => l.san[0]);
  check('no more lines than MultiPV asked for', sans.length === 3, sans.join(','));
  check('no duplicated moves across iterations', new Set(sans).size === sans.length, sans.join(','));
  check('the deepest complete iteration wins', sans.join(',') === 'd4,e4,c4', sans.join(','));
  check('all lines come from one depth', iter.lines.every((l) => l.depth === 11));
  // The panel must never shrink mid-search: going 3 rows → 1 row → 3 rows is a
  // visible flicker on every deepening.
  check('the visible line count never shrinks', widths.every((w, i) => i === 0 || w >= widths[i - 1]), widths.join(','));

  e4.dispose();
}

// A user clicking quickly through a game must not wait on positions they have
// already left.
const afterE4Fen = normalizeFen(
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
);
const stale = engine.analyse(ROOT_FEN, { depth: 20 });
const fresh = engine.analyse(afterE4Fen, { depth: 20 });
let staleRejected = false;
stale.catch((e) => { staleRejected = e instanceof Cancelled; });
await new Promise((r) => setTimeout(r, 0));
t.emit('info depth 20 multipv 1 score cp 15 pv e7e5');
t.emit('bestmove e7e5');
await fresh;
check('superseded analysis is cancelled, not resolved', staleRejected);

// Regression: aborting must not release the queue slot early.
//
// The engine keeps searching until it answers `bestmove`. Issuing the next
// `ucinewgame` before that answer traps the WASM build outright with
// `RuntimeError: unreachable` — which is exactly what the browser did before
// this was fixed, and is invisible to any test that only checks resolution.
{
  const t2 = fakeTransport();
  const e2 = new Engine(t2);
  await e2.ready();

  const controller = new AbortController();
  const aborted = e2.analyse(ROOT_FEN, { depth: 30, signal: controller.signal });
  let abortRejected = false;
  aborted.catch((err) => { abortRejected = err instanceof Cancelled; });
  await new Promise((r) => setTimeout(r, 0));

  const beforeAbort = t2.sent.length;
  controller.abort();
  await new Promise((r) => setTimeout(r, 0));

  check(
    'abort asks the engine to stop',
    t2.sent.slice(beforeAbort).includes('stop'),
  );
  check(
    'abort does not reject before the engine confirms it stopped',
    !abortRejected,
  );

  // A second request must not have touched the engine yet either.
  const queued = e2.analyse(afterE4Fen, { depth: 12 });
  await new Promise((r) => setTimeout(r, 0));
  check(
    'the next position is not set up while the old search is still running',
    !t2.sent.slice(beforeAbort).includes('position fen ' + afterE4Fen + ' 0 1'),
    t2.sent.slice(beforeAbort).join(' | '),
  );

  // Now the engine reports in, and everything unblocks in order.
  t2.emit('bestmove e2e4');
  await new Promise((r) => setTimeout(r, 0));
  check('the aborted request rejects once the engine has stopped', abortRejected);

  await new Promise((r) => setTimeout(r, 0));
  t2.emit('info depth 12 multipv 1 score cp 20 pv e7e5');
  t2.emit('bestmove e7e5');
  const queuedResult = await queued;
  check(
    'the queued request then runs normally',
    queuedResult.lines[0]?.san[0] === 'e5',
    queuedResult.lines[0]?.san.join(' '),
  );

  // Tearing down mid-search must not strand an awaiting caller forever.
  const e3 = new Engine(fakeTransport());
  await e3.ready();
  const orphan = e3.analyse(ROOT_FEN, { depth: 30 });
  let orphanSettled = false;
  orphan.catch(() => { orphanSettled = true; });
  await new Promise((r) => setTimeout(r, 0));
  e3.dispose();
  await new Promise((r) => setTimeout(r, 0));
  check('disposing settles an in-flight search', orphanSettled);
}

// --- repertoire cross-reference ----------------------------------------------

let rep = makeRepertoire('slot-black', 'Caro-Kann', 'b');
rep = importPgn(rep, '1. e4 c6 2. d4 d5', ROOT_FEN).rep;

const afterE4 = normalizeFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');

const analysis: Analysis = {
  fen: afterE4,
  depth: 20,
  complete: true,
  lines: [
    { multipv: 1, depth: 20, score: { kind: 'cp', cp: 20 }, san: ['e5', 'Nf3'] },
    { multipv: 2, depth: 20, score: { kind: 'cp', cp: 26 }, san: ['c6', 'd4'] },
    { multipv: 3, depth: 20, score: { kind: 'cp', cp: 34 }, san: ['e6', 'd4'] },
  ],
};

const audit = auditPosition(analysis, rep);
check('book move is recognised among engine lines', audit.candidates[1].inBook);
check('non-book engine lines stay unflagged', !audit.candidates[0].inBook);
check('best book move identified', audit.bookBest?.san === 'c6', audit.bookBest?.san);
check('engine first choice not being in book is reported', !audit.bookHasEngineChoice);

// c6 at +0.26 vs e5 at +0.20, from Black's side: a small real loss.
check(
  'book move loss measured from black\'s side',
  (audit.bookBest?.loss ?? 0) > 0 && (audit.bookBest?.loss ?? 0) < 5,
  `${audit.bookBest?.loss.toFixed(2)}%`,
);
check('a near-tie is not called a mistake', audit.bookBest?.verdict === 'good' || audit.bookBest?.verdict === 'best');

// A book move outside the top N is unrated, not condemned.
let wide = makeRepertoire('slot-black', 'Scandinavian', 'b');
wide = importPgn(wide, '1. e4 d5', ROOT_FEN).rep;
const wideAudit = auditPosition(analysis, wide);
check(
  'book move outside multipv is unrated rather than judged bad',
  wideAudit.unratedBookMoves.join(',') === 'd5' && wideAudit.bookBest === undefined,
);
check(
  'unrated book moves are described honestly',
  summarise(wideAudit).includes('outside the engine'),
  summarise(wideAudit),
);

// judgeMove: the drill / game-review question.
const played = judgeMove(audit, 'e6');
check('a played non-book move is flagged as such', !played.inBook);
check('the book alternative is offered for contrast', played.bookAlternative?.san === 'c6');
check('the engine choice is named', played.engineBest === 'e5');

const unranked = judgeMove(audit, 'Nf6');
check(
  'an unranked move gets no verdict rather than a bad one',
  unranked.verdict === undefined && unranked.loss === undefined,
);

// "Within 2% of the best move" is not "is the best move", and labelling a
// repertoire move as the engine's pick when it isn't undermines the panel.
check('only the actual top line is marked as the engine choice', judgeMove(audit, 'e5').isTop);
check('a near-equal alternative is not marked as the engine choice', !judgeMove(audit, 'c6').isTop);
check('"best" is labelled as equal-best, not as the engine choice',
  VERDICT_LABEL.best === 'Equal best', VERDICT_LABEL.best);

// A book move outside MultiPV can still be rated, by searching the position
// after it — which is the only way a mistake review can say what the book move
// was actually worth.
const followUp = rateFromFollowUp(wideAudit, 'd5', { kind: 'cp', cp: 24 });
check('an unranked book move can be rated from a follow-up search',
  followUp.verdict !== undefined, `${followUp.verdict} −${followUp.loss?.toFixed(1)}%`);
check('a follow-up rating is never presented as the engine choice', !followUp.isTop);
check('a barely-worse book move is not condemned',
  followUp.verdict === 'best' || followUp.verdict === 'good', followUp.verdict);

// And a genuinely bad one still is.
const badFollowUp = rateFromFollowUp(wideAudit, 'd5', { kind: 'cp', cp: 320 });
check('a genuinely losing book move is called out',
  badFollowUp.verdict === 'mistake' || badFollowUp.verdict === 'blunder',
  `${badFollowUp.verdict} −${badFollowUp.loss?.toFixed(1)}%`);

// Agreement is the common case and should read as one short sentence.
const agreeing: Analysis = { ...analysis, lines: [analysis.lines[1], analysis.lines[0]] };
check(
  'agreement is stated plainly',
  summarise(auditPosition(agreeing, rep)).includes("engine's first choice"),
);

// --- repertoire attribution ---------------------------------------------------

check(
  'position is attributed to the repertoire that knows it',
  repertoireFor([rep], afterE4)?.id === rep.id,
);
check(
  'wrong-side repertoires are not attributed',
  repertoireFor([makeRepertoire('slot-white', 'London', 'w')], afterE4) === null,
);
check(
  'parked repertoires are never attributed',
  repertoireFor([{ ...rep, state: 'parked' }], afterE4) === null,
);

engine.dispose();

console.log(failures === 0 ? '\nAll engine checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
