import { ROOT_FEN } from '../src/model/fen';
import {
  canDrill,
  depthMap,
  drillableFens,
  dueCount,
  isAmbiguous,
  lineThrough,
  pickLine,
  touchRepertoire,
} from '../src/model/lines';
import type { DrillLine } from '../src/model/lines';
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
  collections: [],
  cards: {},
  streak: null,
  lastDrilled: {},
};

check('dueCount counts both repertoires', dueCount(state, NOW) === 3 + 2, `${dueCount(state, NOW)}`);
check('a stocked repertoire is drillable', canDrill(state));

// ------------------------------------------------------------- picker ------
// A deterministic stand-in for Math.random, so weighted draws can be asserted.
const fixed = (v: number) => () => v;

check('picker returns a line', pickLine(state, NOW) !== null);

// Nothing is due — every card was just reviewed far into the future — and the
// picker must still produce puzzles: drilling is open-ended now.
const allFresh: AppState = {
  ...state,
  cards: Object.fromEntries(
    [white, black].flatMap((r) =>
      drillableFens(r).map((f) => [
        cardKey(r.id, f),
        { ...newCard(NOW), interval: 30, dueAt: NOW + 30 * DAY },
      ]),
    ),
  ),
};
check('nothing due, but drilling continues', dueCount(allFresh, NOW) === 0 && pickLine(allFresh, NOW) !== null);

// Least-recently-drilled bias: white was drilled just now, black a week ago,
// so a draw at the bottom of the weight range still lands on black.
const lru: AppState = {
  ...state,
  lastDrilled: { [white.id]: NOW, [black.id]: NOW - 7 * DAY },
};
let blackDraws = 0;
for (let i = 0; i < 200; i++) {
  if (pickLine(lru, NOW, [], fixed(i / 200))?.repertoireId === black.id) blackDraws++;
}
check(
  'the least recently drilled repertoire comes up more often',
  blackDraws > 120,
  `${blackDraws}/200 draws`,
);
check(
  'the recently drilled one still appears',
  blackDraws < 200,
  `${200 - blackDraws}/200 draws`,
);

// touchRepertoire is what keeps that rotation moving during a session.
const touched = touchRepertoire(lru, black.id, NOW);
check('touchRepertoire records the draw', touched.lastDrilled[black.id] === NOW);
check('touchRepertoire leaves other repertoires alone', touched.lastDrilled[white.id] === NOW);

// A branching repertoire, so a draw's *target* is observable: 1.d4 d5 then
// either 2.Nf3 (walked by default) or 2.c4, which only appears when the picker
// aims at a position inside it.
let branchy = makeRepertoire('slot-white', 'Branchy', 'w');
branchy = addLine(branchy, ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4']);
const afterD5 = tryMove(tryMove(ROOT_FEN, 'd4')!, 'd5')!;
branchy = addMove(branchy, afterD5, 'c4', '');
const afterC4 = tryMove(afterD5, 'c4')!;
branchy = addMove(branchy, afterC4, 'e6', '');
const afterE6 = tryMove(afterC4, 'e6')!;
branchy = addMove(branchy, afterE6, 'Nc3', '');

const branchState: AppState = { ...state, repertoires: [branchy] };
const inBranch = (l: DrillLine | null) => !!l && l.cardFens.includes(afterE6);

// Recently drilled positions are skipped while alternatives remain.
let branchAfterSkip = 0;
for (let i = 0; i < 50; i++) {
  if (inBranch(pickLine(branchState, NOW, [cardKey(branchy.id, afterE6)], fixed(i / 50)))) {
    branchAfterSkip++;
  }
}
check('recent positions are skipped when others are free', branchAfterSkip === 0, `${branchAfterSkip}/50`);
check(
  'the recent window never starves the picker',
  pickLine(
    branchState,
    NOW,
    drillableFens(branchy).map((f) => cardKey(branchy.id, f)),
  ) !== null,
);

// Overdue positions outweigh well-known ones inside a repertoire.
const skewed: AppState = {
  ...branchState,
  cards: Object.fromEntries(
    drillableFens(branchy).map((f) => [
      cardKey(branchy.id, f),
      f === afterE6
        ? { ...newCard(NOW), dueAt: NOW - 30 * DAY }
        : { ...newCard(NOW), interval: 60, dueAt: NOW + 60 * DAY },
    ]),
  ),
};
let sawOverdue = 0;
for (let i = 0; i < 200; i++) {
  if (inBranch(pickLine(skewed, NOW, [], fixed(i / 200)))) sawOverdue++;
}
check('overdue positions are favoured', sawOverdue > 150, `${sawOverdue}/200`);

// Parked repertoires generate nothing.
const parked: AppState = {
  ...state,
  repertoires: [{ ...white, state: 'parked' }, { ...black, state: 'parked' }],
};
check('parked repertoires produce no cards', dueCount(parked, NOW) === 0);
check('parked repertoires produce no puzzles', pickLine(parked, NOW) === null);
check('parked repertoires are not drillable', !canDrill(parked));

// Scheduled-ahead cards drop out of the due count until they come round again.
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

// -------------------------------------------------- ambiguous positions -----
// `branchy` holds two moves of my own after 1.d4 d5 — either 2.Nf3 or 2.c4.
// Both are mine, so there is no single right answer to ask for: the drill plays
// one and grades neither, but still walks the line through it.
check('a position with two of my moves is ambiguous', isAmbiguous(branchy, afterD5));
check('a position with one of my moves is not', !isAmbiguous(branchy, ROOT_FEN));
check('a position where I am not to move is not', !isAmbiguous(branchy, afterC4));

const branchDrillable = drillableFens(branchy);
check(
  'ambiguous positions do not generate cards',
  !branchDrillable.includes(afterD5),
  `${branchDrillable.length} drillable`,
);
check('the unambiguous ones still do', branchDrillable.length === 3, `${branchDrillable.length}`);

// Auto-played, not skipped: the line still passes through the position, and
// every position after it is graded as usual.
const ambLine = lineThrough(branchy, ROOT_FEN)!;
check(
  'the line still walks through the ambiguous position',
  ambLine.steps.map((s) => s.san).join(' ') === 'd4 d5 Nf3 Nf6 Bf4',
  ambLine.steps.map((s) => s.san).join(' '),
);
check('but does not card it', !ambLine.cardFens.includes(afterD5));
check('while still carding the rest of the line', ambLine.cardFens.length === 2, `${ambLine.cardFens.length}`);

// The branch the walk did not take is not orphaned: its own deeper cards pull
// a line through it.
const otherBranch = lineThrough(branchy, afterE6)!;
check(
  'the other branch is still reachable',
  otherBranch.steps.map((s) => s.san).slice(0, 4).join(' ') === 'd4 d5 c4 e6',
  otherBranch.steps.map((s) => s.san).join(' '),
);

check(
  'ambiguous positions are not counted as due',
  dueCount(branchState, NOW) === 3,
  `${dueCount(branchState, NOW)}`,
);
check('the repertoire still drills its unambiguous positions', canDrill(branchState));

console.log(failures === 0 ? '\nAll drill checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
