/**
 * End-to-end PGN import: paste a repertoire with variations and confirm it
 * lands in the tree, is navigable, and immediately produces drill cards.
 *
 * node scripts/e2e-import.mjs [url]
 */
import { chromium } from 'playwright';

// The dev server picks the next free port when 5173 is taken, so allow an
// override rather than silently testing someone else's checkout.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';

const URL = process.argv[2] ?? BASE;

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const PGN = `[Event "London System"]
[Result "*"]

1. d4 {queen pawn} d5 2. Nf3 Nf6 3. Bf4 (3. c4 e6) 3... c5 4. e3 *

[Event "London vs King's Indian"]
[Result "*"]

1. d4 Nf6 2. Bf4 g6 3. Nf3 Bg7 *
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

await page.goto(URL);
await page.waitForSelector('.home');

await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
await page.locator('.card--accent input').fill('London');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');

// --- import ----------------------------------------------------------------
await page.getByRole('button', { name: 'Import' }).click();
await page.locator('.import textarea').fill(PGN);
await page.getByRole('button', { name: 'Import PGN' }).click();
await page.waitForSelector('.import p.small', { timeout: 10000 });

const msg = await page.locator('.import p.small').last().textContent();
check('import reports what it added', /Added \d+ moves/.test(msg), `"${msg}"`);
check('import rejected nothing', !msg.includes('could not be played'), `"${msg}"`);

const title = await page.locator('.editor__title').textContent();
check('positions landed in the tree', /\d+ positions/.test(title) && !/ 0 positions/.test(title), `"${title.trim()}"`);

// --- both chapters merged into one tree ------------------------------------
await page.getByRole('button', { name: 'Close' }).click();
const rootMoves = await page.locator('.line__next').allTextContents();
check('single root move after merging two chapters', rootMoves.join(' ') === 'd4', `[${rootMoves.join(' ')}]`);

const rootNote = await page.locator('.notes__ahead .moves__note').first().textContent();
check('PGN comment became a note', rootNote.trim() === 'queen pawn', `"${rootNote.trim()}"`);

// Walk into 1.d4 — both chapters' replies should be present.
await page.locator('.line__next', { hasText: 'd4' }).first().click();
const replies = (await page.locator('.line__next').allTextContents()).sort();
check('both chapters contributed replies to 1.d4', replies.join(' ') === 'Nf6 d5', `[${replies.join(' ')}]`);

// --- variation preserved ---------------------------------------------------
await page.locator('.line__next', { hasText: 'd5' }).first().click();
await page.locator('.line__next', { hasText: 'Nf3' }).first().click();
await page.locator('.line__next', { hasText: 'Nf6' }).first().click();
const third = (await page.locator('.line__next').allTextContents()).sort();
check('variation kept alongside the mainline', third.join(' ') === 'Bf4 c4', `[${third.join(' ')}]`);

// --- idempotence through the UI --------------------------------------------
const positionsBefore = (await page.locator('.editor__title').textContent()).match(/(\d+) positions/)[1];
await page.getByRole('button', { name: 'Import' }).click();
await page.locator('.import textarea').fill(PGN);
await page.getByRole('button', { name: 'Import PGN' }).click();
await page.waitForSelector('.import p.small', { timeout: 10000 });
const msg2 = await page.locator('.import p.small').last().textContent();
check('re-import adds nothing', msg2.includes('Added 0 moves'), `"${msg2}"`);
const positionsAfter = (await page.locator('.editor__title').textContent()).match(/(\d+) positions/)[1];
check('tree size unchanged by re-import', positionsBefore === positionsAfter, `${positionsBefore} -> ${positionsAfter}`);

// --- upload a repertoire file ----------------------------------------------
await page.locator('.import input[type=file]').setInputFiles({
  name: 'repertoire.pgn',
  mimeType: 'application/x-chess-pgn',
  buffer: Buffer.from('1. d4 d5 2. Nf3 Nf6 3. Bf4 Bf5\n'),
});
await page.waitForSelector('.import p.small', { timeout: 10000 });
const uploadMsg = await page.locator('.import p.small').last().textContent();
check('uploading a .pgn file imports it', uploadMsg.includes('Added 1 move'), `"${uploadMsg}"`);

// --- a chess.com game export must be refused --------------------------------
const CC_GAMES = `[Event "Live Chess"]
[Site "Chess.com"]
[White "someone"]
[Black "rival"]
[Result "1-0"]
[WhiteElo "1000"]
[TimeControl "600"]
[Termination "someone won"]

1. e4 {[%clk 0:09:59]} e5 {[%clk 0:09:58]} 2. Nf3 1-0`;

await page.locator('.import textarea').fill(CC_GAMES);
await page.getByRole('button', { name: 'Import PGN' }).click();
await page.waitForSelector('.import p.error', { timeout: 10000 });
const guard = await page.locator('.import p.error').textContent();
check('game exports are refused, not silently imported', guard.includes('played games'), `"${guard.slice(0, 80)}…"`);
check('refusal points at the right screen', guard.includes('Review games'));

const rootAfterGuard = await page.locator('.line__next').allTextContents();
check('refused import left the tree untouched', rootAfterGuard.join(' ') === 'd4', `[${rootAfterGuard.join(' ')}]`);

// --- imported lines are immediately drillable ------------------------------
await page.getByRole('button', { name: 'Close' }).click();
await page.getByRole('button', { name: '← All repertoires' }).click();
await page.waitForSelector('.home');
const due = (await page.locator('.today__count').textContent()).trim();
check('imported positions generate due cards', Number(due) > 0, `${due} due`);

await page.getByRole('button', { name: 'Start drilling' }).click();
await page.waitForSelector('.drill');
await page.waitForSelector('.drill__status:has-text("Your move")', { timeout: 8000 });
await page.locator('[data-square="d2"]').click();
await page.locator('[data-square="d4"]').click();
await page.waitForSelector('.drill__status[data-kind="note"]', { timeout: 5000 });
const noteInDrill = await page.locator('.drill__note').textContent();
check('imported note surfaces during drilling', noteInDrill.includes('queen pawn'), `"${noteInDrill}"`);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nAll import e2e checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
