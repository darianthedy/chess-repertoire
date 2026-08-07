import { ROOT_FEN } from '../src/model/fen';
import { makeRepertoire } from '../src/model/seed';
import {
  addMove,
  getNode,
  positionCount,
  positionsLostByRemoving,
  promoteMove,
  replaceMove,
  setLineName,
  setPlan,
  tryMove,
} from '../src/model/tree';
import { listVariations, variationText } from '../src/model/variations';
import type { Repertoire } from '../src/model/types';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

/** Add a whole line from the root, returning the repertoire and its end FEN. */
function line(rep: Repertoire, sans: string[]): [Repertoire, string] {
  let fen = ROOT_FEN;
  for (const san of sans) {
    rep = addMove(rep, fen, san, '');
    fen = tryMove(fen, san)!;
  }
  return [rep, fen];
}

// --- 1. one line in, one variation out --------------------------------------
let rep = makeRepertoire('slot-white', 'Test', 'w');
let end: string;
[rep, end] = line(rep, ['d4', 'd5', 'Bf4']);

let list = listVariations(rep);
check('single line yields one variation', list.variations.length === 1);
check(
  'movetext is numbered correctly',
  variationText(list.variations[0].steps) === '1.d4 d5 2.Bf4',
  variationText(list.variations[0].steps),
);
check('only line is the main line', list.variations[0].main);
check('no plan yet', list.variations[0].plan === undefined);

rep = setPlan(rep, end, 'squeeze the c-file');
check(
  'plan surfaces on the variation',
  listVariations(rep).variations[0].plan === 'squeeze the c-file',
);

// --- 1b. naming a line ------------------------------------------------------
check('no name until one is given', listVariations(rep).variations[0].name === undefined);

rep = setLineName(rep, end, '  Jobava London  ');
check(
  'name surfaces on the variation, trimmed',
  listVariations(rep).variations[0].name === 'Jobava London',
  `${listVariations(rep).variations[0].name}`,
);
check(
  'naming leaves the plan alone',
  listVariations(rep).variations[0].plan === 'squeeze the c-file',
);
check(
  'clearing a name drops it rather than storing whitespace',
  setLineName(rep, end, '   ').nodes[end].name === undefined,
);
check(
  'naming changes nothing structural',
  positionCount(setLineName(rep, end, 'x')) === positionCount(rep),
);

// --- 2. a branch splits into two variations ---------------------------------
// A second black reply to 1.d4 branches at ply 1; both lines are listed, and
// only the one taking the first edge at every branch is the main line.
[rep] = line(rep, ['d4', 'Nf6', 'Bf4']);
list = listVariations(rep);
check('branch produces two variations', list.variations.length === 2, `${list.variations.length}`);
check(
  'exactly one is flagged main',
  list.variations.filter((v) => v.main).length === 1,
);
check(
  'main line is the first-listed branch',
  list.variations.find((v) => v.main)?.id === 'd4 d5 Bf4',
  list.variations.find((v) => v.main)?.id,
);
// The name lives on the line's own terminal position, so a sibling sharing a
// prefix must not inherit it.
check(
  'a name belongs to one line, not its neighbours',
  list.variations.find((v) => v.id === 'd4 d5 Bf4')?.name === 'Jobava London' &&
    list.variations.find((v) => v.id === 'd4 Nf6 Bf4')?.name === undefined,
);

// --- 3. promoting flips which line is main ----------------------------------
const afterD4 = tryMove(ROOT_FEN, 'd4')!;
const promoted = promoteMove(rep, afterD4, 'Nf6');
check(
  'promote moves the edge to the front',
  getNode(promoted, afterD4).moves[0].san === 'Nf6',
);
check(
  'main line follows the promotion',
  listVariations(promoted).variations.find((v) => v.main)?.id === 'd4 Nf6 Bf4',
);
check(
  'promote changes order only, not content',
  positionCount(promoted) === positionCount(rep) &&
    listVariations(promoted).variations.length === 2,
);

// --- 4. annotation counts ---------------------------------------------------
// Only my own moves count toward the annotated tally: a note on an opponent
// move is useful context but isn't a move I'm being graded on recalling.
let noted = makeRepertoire('slot-white', 'Noted', 'w');
noted = addMove(noted, ROOT_FEN, 'd4', 'take the centre');
noted = addMove(noted, afterD4, 'd5', 'the main reply');
const afterD5 = tryMove(afterD4, 'd5')!;
noted = addMove(noted, afterD5, 'Bf4', '');
const nv = listVariations(noted).variations[0];
check('counts my moves only', nv.mine === 2, `mine=${nv.mine}`);
check('counts my annotated moves only', nv.noted === 1, `noted=${nv.noted}`);

// --- 5. replace keeps the slot and drops what only it reached ---------------
let swap = makeRepertoire('slot-white', 'Swap', 'w');
[swap] = line(swap, ['d4', 'd5', 'Bf4', 'Nf6', 'e3']);
[swap] = line(swap, ['Nf3']);
const beforeSwap = positionCount(swap);
const afterBf4Path = tryMove(tryMove(afterD4, 'd5')!, 'Bf4')!;

check(
  'lost count covers the whole unique tail',
  positionsLostByRemoving(swap, afterD5, 'Bf4') === 3,
  `${positionsLostByRemoving(swap, afterD5, 'Bf4')}`,
);

const swapped = replaceMove(swap, afterD5, 'Bf4', 'c4');
check(
  'old move gone',
  !getNode(swapped, afterD5).moves.some((m) => m.san === 'Bf4'),
);
check('new move present', getNode(swapped, afterD5).moves.some((m) => m.san === 'c4'));
check(
  'replacement keeps the old slot position',
  getNode(swapped, afterD5).moves[0].san === 'c4',
);
check(
  'tail only reachable through the old move is dropped',
  swapped.nodes[afterBf4Path] === undefined,
);
check(
  'net effect is -3 +1 positions',
  positionCount(swapped) === beforeSwap - 3 + 1,
  `${beforeSwap} -> ${positionCount(swapped)}`,
);
check(
  'unrelated line untouched',
  getNode(swapped, ROOT_FEN).moves.some((m) => m.san === 'Nf3'),
);
check(
  'illegal replacement is a no-op',
  replaceMove(swap, afterD5, 'Bf4', 'Qh8') === swap,
);
check(
  'replacing with an existing sibling deletes rather than duplicating',
  getNode(
    replaceMove(
      line(swap, ['d4', 'd5', 'Nf3'])[0],
      afterD5,
      'Bf4',
      'Nf3',
    ),
    afterD5,
  ).moves.filter((m) => m.san === 'Nf3').length === 1,
);

// --- 6. transpositions terminate --------------------------------------------
// Nf3/d4 and d4/Nf3 converge. Enumeration must not loop, and the shared tail
// must appear under each route that reaches it.
let trans = makeRepertoire('slot-white', 'Trans', 'w');
[trans] = line(trans, ['Nf3', 'd5', 'd4', 'Nf6']);
[trans] = line(trans, ['d4', 'd5', 'Nf3', 'Nf6']);
const tv = listVariations(trans);
check('transposing tree enumerates', tv.variations.length === 2, `${tv.variations.length}`);
check('no truncation on a small tree', !tv.truncated);
check(
  'both routes reach the shared tail',
  tv.variations.every((v) => v.steps[v.steps.length - 1].san === 'Nf6'),
);

// --- 7. the cap holds -------------------------------------------------------
const capped = listVariations(trans, 1);
check('cap limits the list', capped.variations.length === 1);
check('cap is reported', capped.truncated);

// --- 8. an empty repertoire has no variations -------------------------------
check(
  'empty tree lists nothing',
  listVariations(makeRepertoire('slot-white', 'Empty', 'w')).variations
    .length === 0,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
