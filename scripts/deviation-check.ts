import type { CcGame } from '../src/model/chesscom';
import { colourOf } from '../src/model/chesscom';
import {
  analyseGame,
  describePath,
  findDeviation,
  gameMoves,
  groupDeviations,
} from '../src/model/deviation';
import { ROOT_FEN } from '../src/model/fen';
import { importPgn } from '../src/model/pgn';
import { makeRepertoire } from '../src/model/seed';
import type { Repertoire } from '../src/model/types';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

const game = (pgn: string, white = 'darian', black = 'rival'): CcGame => ({
  url: 'https://chess.com/game/1',
  pgn,
  timeClass: 'rapid',
  rules: 'chess',
  white,
  black,
  endTime: 1,
});

// Chess.com PGNs carry headers and per-move clock comments.
const REAL_SHAPE = `[Event "Live Chess"]
[Site "Chess.com"]
[White "darian"]
[Black "rival"]
[Result "1-0"]

1. d4 {[%clk 0:09:59.9]} d5 {[%clk 0:09:58]} 2. Nf3 {[%clk 0:09:55]} Nf6 {[%clk 0:09:50]} 3. Bg5 {[%clk 0:09:44]} 1-0`;

check(
  'chess.com PGN reduced to mainline SAN',
  gameMoves(REAL_SHAPE).join(' ') === 'd4 d5 Nf3 Nf6 Bg5',
  gameMoves(REAL_SHAPE).join(' '),
);

// --- repertoire: 1.d4 d5 2.Nf3 Nf6 3.Bf4 -----------------------------------
let white = makeRepertoire('slot-white', 'London', 'w');
white = importPgn(white, '1. d4 d5 2. Nf3 Nf6 3. Bf4 c5', ROOT_FEN).rep;

// I played Bg5 instead of my own Bf4 — my deviation.
const mine = findDeviation(white, game(REAL_SHAPE), 'w')!;
check('deviation found', !!mine);
check('deviation attributed to me', mine.byMe === true);
check('deviating move reported', mine.playedSan === 'Bg5', mine.playedSan);
check('repertoire move offered as expected', mine.expected.join(' ') === 'Bf4', mine.expected.join(' '));
check('path recorded up to the deviation', describePath(mine.path) === '1.d4 d5 2.Nf3 Nf6', describePath(mine.path));
check('in-book ply count', mine.inBookPlies === 4, `${mine.inBookPlies}`);

// --- opponent novelty -------------------------------------------------------
const novelty = game(`[White "darian"]

1. d4 d5 2. Nf3 e6 *`);
const theirs = findDeviation(white, novelty, 'w')!;
check('opponent novelty detected', theirs.byMe === false);
check('unanswered opponent move reported', theirs.playedSan === 'e6', theirs.playedSan);
check('no expected moves where the tree is silent', theirs.expected.join(' ') === 'Nf6', theirs.expected.join(' '));

// --- game that stays in book to the end of the tree --------------------------
const inBook = game(`[White "darian"]

1. d4 d5 2. Nf3 Nf6 3. Bf4 c5 4. e3 Nc6 *`);
check(
  'running out of tree on my own move is not a deviation',
  findDeviation(white, inBook, 'w') === null,
);

// --- colour detection --------------------------------------------------------
check('colour detected for White', colourOf(game('1. d4 *'), 'darian') === 'w');
check('colour detected for Black', colourOf(game('1. d4 *', 'rival', 'darian'), 'darian') === 'b');
check('username matching is case-insensitive', colourOf(game('1. d4 *', 'Darian'), 'darian') === 'w');
check('non-participant returns null', colourOf(game('1. d4 *'), 'someone') === null);

// --- routing across repertoires ---------------------------------------------
let caro = makeRepertoire('slot-vs-e4', 'Caro', 'b');
caro = importPgn(caro, '1. e4 c6 2. d4 d5', ROOT_FEN).rep;
let kid = makeRepertoire('slot-vs-d4', 'KID', 'b');
kid = importPgn(kid, '1. d4 Nf6 2. c4 g6', ROOT_FEN).rep;

const asBlack = game(`[White "rival"]

1. e4 c6 2. d4 d5 3. Nc3 dxe4 *`, 'rival', 'darian');
const routed = analyseGame([white, caro, kid], asBlack, 'darian')!;
check('game routed to the repertoire it followed longest', routed.repertoireId === caro.id);
check('routed deviation is the opponent move', routed.playedSan === 'Nc3', routed.playedSan);

// A White repertoire must not be considered for a game played as Black.
check(
  'wrong-side repertoires excluded',
  analyseGame([white], asBlack, 'darian') === null,
);

// Parked repertoires are ignored.
check(
  'parked repertoires excluded',
  analyseGame([{ ...caro, state: 'parked' } as Repertoire], asBlack, 'darian') === null,
);

// --- grouping ----------------------------------------------------------------
const repeated = [asBlack, asBlack, novelty].map((g, i) =>
  analyseGame([white, caro, kid], g, 'darian', ) ?? null,
).filter((d): d is NonNullable<typeof d> => d !== null);
const groups = groupDeviations(repeated);
check('identical gaps collapse into one group', groups.length === 2, `${groups.length} groups`);
check('most frequent gap ranked first', groups[0].count === 2, `count=${groups[0].count}`);

console.log(failures === 0 ? '\nAll deviation checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
