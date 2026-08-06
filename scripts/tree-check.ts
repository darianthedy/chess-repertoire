import { Chess } from 'chess.js';
import { normalizeFen, ROOT_FEN } from '../src/model/fen';
import {
  addMove,
  deleteMove,
  getNode,
  positionCount,
  tryMove,
} from '../src/model/tree';
import { makeRepertoire } from '../src/model/seed';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

// --- 1. en-passant normalization -------------------------------------------
// After 1.Nf3 d5 2.d4, black's ...d5 sets an ep square that no pawn can use.
const a = new Chess();
a.move('Nf3'); a.move('d5'); a.move('d4');
const rawA = a.fen();
// Same position via 1.d4 d5 2.Nf3
const b = new Chess();
b.move('d4'); b.move('d5'); b.move('Nf3');
check(
  'raw FENs differ (move counters / ep)',
  rawA.split(' ').slice(0, 4).join(' ') !== undefined && rawA !== b.fen(),
  `\n      ${rawA}\n      ${b.fen()}`,
);
check('normalized FENs match (transposition collapses)', normalizeFen(rawA) === normalizeFen(b.fen()));

// A real en-passant opportunity must be preserved.
const c = new Chess();
c.move('e4'); c.move('a6'); c.move('e5'); c.move('d5'); // now exd6 e.p. is legal
check('real ep square retained', normalizeFen(c.fen()).endsWith(' d6'), normalizeFen(c.fen()));

// --- 2. transposition lands on one node ------------------------------------
let rep = makeRepertoire('slot-white', 'Test', 'w');
// Route 1: 1.Nf3 d5 2.d4
let f = ROOT_FEN;
for (const san of ['Nf3', 'd5', 'd4']) {
  rep = addMove(rep, f, san, 'x');
  f = tryMove(f, san)!;
}
const afterRoute1 = f;
const countAfterRoute1 = positionCount(rep);

// Route 2: 1.d4 d5 2.Nf3 — the last move should reuse the existing node.
f = ROOT_FEN;
for (const san of ['d4', 'd5', 'Nf3']) {
  rep = addMove(rep, f, san, 'x');
  f = tryMove(f, san)!;
}
check('routes converge on same fen', f === afterRoute1);
check(
  'transposition adds 2 new nodes, not 3',
  positionCount(rep) === countAfterRoute1 + 2,
  `${countAfterRoute1} -> ${positionCount(rep)}`,
);

// --- 3. isMine derived from side to move -----------------------------------
const rootEdges = getNode(rep, ROOT_FEN).moves;
check('white repertoire: root moves are mine', rootEdges.every((m) => m.isMine));
const afterNf3 = tryMove(ROOT_FEN, 'Nf3')!;
check(
  "opponent replies marked not mine",
  getNode(rep, afterNf3).moves.every((m) => !m.isMine),
);

// --- 4. delete keeps transposition-reachable nodes --------------------------
// Delete 1.Nf3. The converged position is still reachable via 1.d4, so it must
// survive; only the nodes unique to the Nf3 route should go.
const before = positionCount(rep);
const afterDelete = deleteMove(rep, ROOT_FEN, 'Nf3');
check('1.Nf3 edge removed', !getNode(afterDelete, ROOT_FEN).moves.some((m) => m.san === 'Nf3'));
check(
  'converged node survives via other route',
  afterDelete.nodes[afterRoute1] !== undefined,
);
check(
  'orphans collected',
  positionCount(afterDelete) < before,
  `${before} -> ${positionCount(afterDelete)}`,
);
check(
  'node unique to deleted route is gone',
  afterDelete.nodes[tryMove(ROOT_FEN, 'Nf3')!] === undefined,
);

// --- 5. duplicate add is a no-op -------------------------------------------
const dup = addMove(rep, ROOT_FEN, 'd4', 'again');
check('duplicate SAN not added twice', getNode(dup, ROOT_FEN).moves.filter((m) => m.san === 'd4').length === 1);

// --- 6. illegal move rejected ----------------------------------------------
check('illegal move returns null', tryMove(ROOT_FEN, 'e5') === null);
check('illegal move leaves tree unchanged', positionCount(addMove(rep, ROOT_FEN, 'e5', '')) === positionCount(rep));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
