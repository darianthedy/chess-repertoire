import { ROOT_FEN } from '../src/model/fen';
import { importPgn, parseMovetext, splitGames, studyId } from '../src/model/pgn';
import { makeRepertoire } from '../src/model/seed';
import { getNode, positionCount, tryMove } from '../src/model/tree';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

const sans = (rep: ReturnType<typeof makeRepertoire>, fen: string) =>
  getNode(rep, fen).moves.map((m) => m.san).sort().join(' ');

// ------------------------------------------------------------- parsing -----
const simple = parseMovetext('1. e4 c6 2. d4 d5');
check('mainline parsed', simple.map((m) => m.san).join(' ') === 'e4 c6 d4 d5', simple.map((m) => m.san).join(' '));

const withVar = parseMovetext('1. e4 c6 (1... e5 2. Nf3) 2. d4');
check('mainline unaffected by a variation', withVar.map((m) => m.san).join(' ') === 'e4 c6 d4');
check('variation attaches to the move it replaces', withVar[1].variations.length === 1, `on ${withVar[1].san}`);
check('variation contents parsed', withVar[1].variations[0].map((m) => m.san).join(' ') === 'e5 Nf3');

const nested = parseMovetext('1. e4 c6 (1... e5 2. Nf3 (2. Bc4) 2... Nc6) 2. d4');
check('nested variation parsed', nested[1].variations[0][1].variations[0][0].san === 'Bc4');

const annotated = parseMovetext('1. e4! c6?! {solid and sound} 2. d4 $14 d5+');
check('decorations stripped from SAN', annotated.map((m) => m.san).join(' ') === 'e4 c6 d4 d5', annotated.map((m) => m.san).join(' '));
check('comment captured on its move', annotated[1].comment === 'solid and sound', `"${annotated[1].comment}"`);

// --------------------------------------------------------- game splitting ---
const twoChapters = `[Event "Chapter 1"]
[Result "*"]

1. d4 d5 2. Nf3 *

[Event "Chapter 2"]
[Result "*"]

1. d4 Nf6 2. Bf4 *
`;
check('study chapters split into games', splitGames(twoChapters).length === 2, `${splitGames(twoChapters).length}`);

// --------------------------------------------------------------- import ----
let rep = makeRepertoire('slot-vs-e4', 'Caro', 'b');
const caro = `[Event "Caro-Kann"]

1. e4 c6 {my move} (1... e5 {the open game} 2. Nf3) 2. d4 d5 3. Nc3 (3. e5 Bf5) 3... dxe4 *`;

const r1 = importPgn(rep, caro, ROOT_FEN);
rep = r1.rep;
check('import added moves', r1.added > 0, `added=${r1.added}`);
check('import rejected nothing', r1.rejected === 0, `rejected=${r1.rejected}`);

const afterE4 = tryMove(ROOT_FEN, 'e4')!;
check('both replies to 1.e4 present', sans(rep, afterE4) === 'c6 e5', sans(rep, afterE4));

const afterD5 = tryMove(tryMove(tryMove(afterE4, 'c6')!, 'd4')!, 'd5')!;
check('both White third moves present', sans(rep, afterD5) === 'Nc3 e5', sans(rep, afterD5));

const c6Edge = getNode(rep, afterE4).moves.find((m) => m.san === 'c6')!;
check('comment became the note', c6Edge.note === 'my move', `"${c6Edge.note}"`);
check('note applied to the right move', getNode(rep, afterE4).moves.find((m) => m.san === 'e5')!.note === 'the open game');

// isMine is derived from side to move, so an imported Black repertoire marks
// Black's moves as mine and White's as the opponent's.
check('imported Black moves are mine', c6Edge.isMine === true);
check('imported White moves are the opponent\'s', getNode(rep, ROOT_FEN).moves[0].isMine === false);

// ------------------------------------------------------------ idempotence --
const before = positionCount(rep);
const r2 = importPgn(rep, caro, ROOT_FEN);
check('re-import adds nothing', positionCount(r2.rep) === before, `${before} -> ${positionCount(r2.rep)}`);
check('re-import reports moves as existing', r2.added === 0 && r2.existing > 0, `added=${r2.added} existing=${r2.existing}`);

// ------------------------------------------------- notes are not clobbered --
let noted = makeRepertoire('slot-white', 'London', 'w');
noted = importPgn(noted, '1. d4 {imported note}', ROOT_FEN).rep;
const reimported = importPgn(noted, '1. d4 {different note}', ROOT_FEN).rep;
check(
  'existing note survives re-import',
  getNode(reimported, ROOT_FEN).moves[0].note === 'imported note',
  `"${getNode(reimported, ROOT_FEN).moves[0].note}"`,
);

// -------------------------------------------------------- malformed input --
const bad = importPgn(makeRepertoire('s', 'x', 'w'), '1. d4 d5 2. Qh8 Nf6', ROOT_FEN);
check('illegal move counted as rejected', bad.rejected === 1, `rejected=${bad.rejected}`);
check('legal prefix still imported', bad.added === 2, `added=${bad.added}`);

// ------------------------------------------------------------- study ids ---
check('study id from full URL', studyId('https://lichess.org/study/abcd1234') === 'abcd1234');
check('study id from chapter URL', studyId('https://lichess.org/study/abcd1234/xyz98765') === 'abcd1234');
check('study id from bare id', studyId('abcd1234') === 'abcd1234');
check('non-study input rejected', studyId('https://example.com') === null);

// ------------------------------------------- chess.com download handling ---
import { gamesFromPgn } from '../src/model/chesscom';
import { looksLikeGames, splitGamesWithHeaders } from '../src/model/pgn';

const CC_DOWNLOAD = `[Event "Live Chess"]
[Site "Chess.com"]
[White "darianthedy"]
[Black "rival"]
[Result "1-0"]
[WhiteElo "1000"]
[TimeControl "600"]
[Termination "darianthedy won"]
[Link "https://www.chess.com/game/live/1"]

1. d4 {[%clk 0:09:59.9]} 1... d5 {[%clk 0:09:58.1]} 2. Nf3 {[%clk 0:09:55]} 1-0

[Event "Live Chess"]
[Site "Chess.com"]
[White "rival2"]
[Black "darianthedy"]
[Result "0-1"]
[BlackElo "1010"]
[TimeControl "600"]
[Termination "darianthedy won"]

1. e4 {[%clk 0:09:59]} 1... c6 {[%clk 0:09:58]} 0-1`;

check('headers parsed per game', splitGamesWithHeaders(CC_DOWNLOAD)[0].headers.White === 'darianthedy');
check('multi-line movetext joined', splitGamesWithHeaders(CC_DOWNLOAD).length === 2);

// Clock annotations must not survive as notes.
let clocked = makeRepertoire('slot-white', 'X', 'w');
clocked = importPgn(clocked, '1. d4 {[%clk 0:09:59.9]} d5 {[%clk 0:09:58]}', ROOT_FEN).rep;
check(
  'clock comments do not become notes',
  getNode(clocked, ROOT_FEN).moves[0].note === '',
  `"${getNode(clocked, ROOT_FEN).moves[0].note}"`,
);

// A real comment alongside a clock is kept.
let mixed = makeRepertoire('slot-white', 'X', 'w');
mixed = importPgn(mixed, '1. d4 {[%clk 0:09:59] the London move}', ROOT_FEN).rep;
check(
  'real comment survives alongside a clock',
  getNode(mixed, ROOT_FEN).moves[0].note === 'the London move',
  `"${getNode(mixed, ROOT_FEN).moves[0].note}"`,
);

// The mainline must sit first among a position's continuations: drill lines
// and the game viewer both follow the first edge.
let ordered = makeRepertoire('slot-vs-e4', 'Caro', 'b');
ordered = importPgn(ordered, '1. e4 c6 (1... e5 2. Nf3) (1... d5) 2. d4', ROOT_FEN).rep;
const afterE4Ordered = tryMove(ROOT_FEN, 'e4')!;
check(
  'mainline is the first continuation, not a variation',
  getNode(ordered, afterE4Ordered).moves[0].san === 'c6',
  getNode(ordered, afterE4Ordered).moves.map((m) => m.san).join(' '),
);

check('a chess.com download is recognised as games', looksLikeGames(CC_DOWNLOAD) === true);
check(
  'a repertoire is not mistaken for games',
  looksLikeGames('[Event "London"]\n[Result "*"]\n\n1. d4 d5 (1... Nf6) 2. Nf3 *') === false,
);
check('bare movetext is not mistaken for games', looksLikeGames('1. d4 d5 2. Nf3') === false);

const fromFile = gamesFromPgn(CC_DOWNLOAD);
check('games extracted from a downloaded file', fromFile.length === 2, `${fromFile.length}`);
check('player names carried through', fromFile.some((g) => g.white === 'darianthedy'));
check('game link carried through', fromFile.some((g) => g.url.includes('chess.com/game')));

console.log(failures === 0 ? '\nAll PGN checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
