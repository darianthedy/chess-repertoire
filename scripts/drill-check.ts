import { ROOT_FEN } from '../src/model/fen';
import { buildSession, depthMap, drillableFens, dueCount, lineThrough } from '../src/model/lines';
import { makeRepertoire } from '../src/model/seed';
import { cardKey, CORRECT, DAY, newCard, schedule, WRONG } from '../src/model/srs';
import { addMove, tryMove } from '../src/model/tree';
import type { AppState, Repertoire } from '../src/model/types';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

const NOW = 1_700_000_000_000;

/** Add a whole line of SAN moves from the root. */
function addLine(rep: Repertoire, sans: string[]): Repertoire {
  let fen = ROOT_FEN;
  for (const san of sans) {
    rep = addMove(rep, fen, san, '');
    fen = tryMove(fen, san)!;
  }
  return rep;
}

// ---------------------------------------------------------------- SM-2 -----
let c = newCard(NOW);
c = schedule(c, CORRECT, NOW);
check('first correct -> 1 day', c.interval === 1 && c.dueAt === NOW + DAY, `i=${c.interval}`);
check('correct leaves ease at 2.5', Math.abs(c.ease - 2.5) < 1e-9, `ease=${c.ease}`);

c = schedule(c, CORRECT, NOW);
check('second correct -> 6 days', c.interval === 6, `i=${c.interval}`);

c = schedule(c, CORRECT, NOW);
check('third correct -> 6*ease = 15', c.interval === 15, `i=${c.interval}`);

const lapsed = schedule(c, WRONG, NOW);
check('wrong resets interval to 1', lapsed.interval === 1, `i=${lapsed.interval}`);
check('wrong increments lapses', lapsed.lapses === 1);
check('wrong drops ease by 0.32', Math.abs(lapsed.ease - (c.ease - 0.32)) < 1e-9, `ease=${lapsed.ease}`);

let floor = newCard(NOW);
for (let i = 0; i < 20; i++) floor = schedule(floor, WRONG, NOW);
check('ease floors at 1.3', Math.abs(floor.ease - 1.3) < 1e-9, `ease=${floor.ease}`);

// ------------------------------------------------------- tree / depths -----
// White repertoire: 1.d4 d5 2.Nf3 Nf6 3.Bf4
let white = makeRepertoire('slot-white', 'London', 'w');
white = addLine(white, ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4']);

const depths = depthMap(white);
check('root depth 0', depths[ROOT_FEN] === 0);
const afterD4 = tryMove(ROOT_FEN, 'd4')!;
check('after 1.d4 depth 1', depths[afterD4] === 1, `${depths[afterD4]}`);

// My moves are at even ply (0, 2, 4) for White; three of them have continuations.
const drillable = drillableFens(white, depths);
check('white drillable = 3 positions', drillable.length === 3, `${drillable.length}`);
check('all drillable are white-to-move', drillable.every((f) => f.split(' ')[1] === 'w'));

// Depth window: activeDepth 1 => only ply < 2 counts.
const shallow = { ...white, activeDepth: 1 };
check('activeDepth 1 -> only the root', drillableFens(shallow).length === 1, `${drillableFens(shallow).length}`);

// Storage is untouched by the window: the tree still holds every position.
check('narrow window does not shrink the tree', Object.keys(shallow.nodes).length === Object.keys(white.nodes).length);

// ------------------------------------------------------------- lines -------
const line = lineThrough(white, ROOT_FEN)!;
check('line walks to the leaf', line.steps.length === 5, `${line.steps.map((s) => s.san).join(' ')}`);
check('line covers 3 cards', line.cardFens.length === 3, `${line.cardFens.length}`);

const mid = tryMove(tryMove(afterD4, 'd5')!, 'Nf3')!;
const through = lineThrough(white, mid)!;
check('line through a mid position still starts at the root', through.steps[0].san === 'd4');
check('line through a mid position reaches the leaf', through.steps.length === 5);

// ----------------------------------------------------------- session -------
let black = makeRepertoire('slot-vs-e4', 'Caro', 'b');
black = addLine(black, ['e4', 'c6', 'd4', 'd5']);

const state: AppState = {
  version: 1,
  slots: [],
  repertoires: [white, black],
  cards: {},
  streak: null,
};

check('dueCount counts both repertoires', dueCount(state, NOW) === 3 + 2, `${dueCount(state, NOW)}`);

const session = buildSession(state, NOW);
check('session produced lines', session.length >= 2, `${session.length} lines`);
check(
  'session interleaves repertoires',
  session.length < 2 || session[0].repertoireId !== session[1].repertoireId,
  session.map((l) => l.repertoireId.slice(0, 4)).join(' '),
);

// Parked repertoires generate nothing.
const parked: AppState = {
  ...state,
  repertoires: [{ ...white, state: 'parked' }, { ...black, state: 'parked' }],
};
check('parked repertoires produce no cards', dueCount(parked, NOW) === 0);
check('parked repertoires produce no session', buildSession(parked, NOW).length === 0);

// Scheduled-ahead cards drop out of the queue until they come due again.
const scheduled: AppState = {
  ...state,
  cards: Object.fromEntries(
    drillableFens(white).map((f) => [
      cardKey(white.id, f),
      { ...newCard(NOW), dueAt: NOW + 10 * DAY },
    ]),
  ),
};
check('future-dated cards are not due', dueCount(scheduled, NOW) === 2, `${dueCount(scheduled, NOW)}`);
check('and are due again once time passes', dueCount(scheduled, NOW + 11 * DAY) === 5);

// Most-overdue-first ordering.
const [a, b] = drillableFens(white);
const ordered: AppState = {
  ...state,
  repertoires: [white],
  cards: {
    [cardKey(white.id, a)]: { ...newCard(NOW), dueAt: NOW - 1 * DAY },
    [cardKey(white.id, b)]: { ...newCard(NOW), dueAt: NOW - 9 * DAY },
  },
};
const orderedSession = buildSession(ordered, NOW);
check(
  'most-overdue card seeds the first line',
  orderedSession.length > 0 && orderedSession[0].cardFens.includes(b),
  `first line covers ${orderedSession[0]?.cardFens.length} cards`,
);

console.log(failures === 0 ? '\nAll drill checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
