/**
 * End-to-end game review. The chess.com API is stubbed so the test is
 * deterministic and doesn't depend on a real account or hammer their servers;
 * the request shape is exactly what the live API returns.
 *
 * node scripts/e2e-games.mjs [url]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5173/';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const pgn = (moves, white = 'testuser', black = 'rival') => `[Event "Live Chess"]
[Site "Chess.com"]
[White "${white}"]
[Black "${black}"]
[Result "*"]

${moves} *`;

const GAMES = [
  // I played Bg5; my repertoire says Bf4. Twice, so it should group.
  { id: 1, moves: '1. d4 {[%clk 0:09:59]} d5 2. Nf3 Nf6 3. Bg5' },
  { id: 2, moves: '1. d4 d5 2. Nf3 Nf6 3. Bg5' },
  // Opponent played 2...e6, which the tree has no answer to.
  { id: 3, moves: '1. d4 d5 2. Nf3 e6' },
  // Followed the repertoire to the end of the tree — no gap.
  { id: 4, moves: '1. d4 d5 2. Nf3 Nf6 3. Bf4' },
].map((g) => ({
  url: `https://www.chess.com/game/live/${g.id}`,
  pgn: pgn(g.moves),
  rules: 'chess',
  time_class: 'rapid',
  end_time: 1000 + g.id,
  white: { username: 'testuser' },
  black: { username: 'rival' },
}));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

let archiveHits = 0;
await page.route('**://api.chess.com/**', async (route) => {
  const url = route.request().url();
  if (url.endsWith('/games/archives')) {
    archiveHits++;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        archives: ['https://api.chess.com/pub/player/testuser/games/2026/08'],
      }),
    });
  }
  if (/\/games\/\d{4}\/\d{2}$/.test(url)) {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ games: GAMES }),
    });
  }
  return route.fulfill({ status: 404, body: '{}' });
});

await page.goto(URL);
await page.waitForSelector('.home');

// --- a repertoire to compare against ---------------------------------------
await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
await page.locator('.card--accent input').fill('London');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');
await page.getByRole('button', { name: 'Import' }).click();
await page.locator('.import textarea').fill('1. d4 d5 2. Nf3 Nf6 3. Bf4');
await page.getByRole('button', { name: 'Import PGN' }).click();
await page.waitForSelector('.import p.small');
await page.getByRole('button', { name: '← All repertoires' }).click();

// --- save my games as a collection, then review it ---------------------------
await page.getByRole('button', { name: 'Games' }).click();
await page.waitForSelector('.games');
await page.locator('.games input:not([type=file])').fill('testuser');
await page.getByRole('button', { name: 'Fetch' }).click();
await page.waitForSelector('.gamerow', { timeout: 20000 });
check('chess.com games saved as a collection', (await page.locator('.gamerow').count()) === 4, `${await page.locator('.gamerow').count()} rows`);
check('archives endpoint called', archiveHits === 1, `${archiveHits} calls`);

await page.getByRole('button', { name: 'Find repertoire gaps →' }).click();
await page.waitForSelector('.gaps', { timeout: 15000 });

const heading = await page.locator('.gaps h2').textContent();
check('four games scanned', heading.includes('4 games scanned'), `"${heading}"`);
check('two distinct gaps reported', heading.includes('2 gaps'), `"${heading}"`);

const cards = page.locator('.gap');
check('two gap cards rendered', (await cards.count()) === 2, `${await cards.count()}`);

// Most frequent first: the Bg5 gap happened twice.
const first = await cards.nth(0).innerText();
check('most frequent gap ranked first', first.includes('2 games'), `"${first.replace(/\n/g, ' | ')}"`);
check('my own deviation described', first.includes('You played') && first.includes('Bg5'), `"${first.replace(/\n/g, ' | ')}"`);
check('repertoire move shown as the alternative', first.includes('Bf4'), `"${first.replace(/\n/g, ' | ')}"`);
check('line leading to the gap shown', first.includes('1.d4 d5 2.Nf3 Nf6'), `"${first.replace(/\n/g, ' | ')}"`);

const second = await cards.nth(1).innerText();
check('opponent novelty described differently', second.includes('Opponent played') && second.includes('e6'), `"${second.replace(/\n/g, ' | ')}"`);
check('in-book game produced no gap', (await cards.count()) === 2);

// --- fix in editor -----------------------------------------------------------
await cards.nth(1).getByRole('button', { name: 'Fix in editor' }).click();
await page.waitForSelector('.editor');
// The move list renders as flex items, so textContent carries no whitespace
// between them — compare on the moves themselves.
const moves = await page.locator('.line__san').allTextContents();
check('editor opened at the deviating position', moves.join(' ') === 'd4 d5 Nf3', `[${moves.join(' ')}]`);

// Add the opponent's move and my answer to it.
await page.locator('[data-square="e7"]').click();
await page.locator('[data-square="e6"]').click();
await page.locator('[data-square="c1"]').click();
await page.locator('[data-square="f4"]').click();
const after2 = await page.locator('.line__san').allTextContents();
check('gap patched in the tree', after2.join(' ') === 'd4 d5 Nf3 e6 Bf4', `[${after2.join(' ')}]`);

// --- the gap is gone on re-review -------------------------------------------
await page.getByRole('button', { name: '← All repertoires' }).click();
await page.getByRole('button', { name: 'Games' }).click();
await page.locator('.rep__open').first().click();
await page.waitForSelector('.gamerow');
await page.getByRole('button', { name: 'Find repertoire gaps →' }).click();
await page.waitForSelector('.gaps', { timeout: 15000 });
check('username remembered', (await page.locator('.games input').inputValue()) === 'testuser');
const after = await page.locator('.gaps h2').textContent();
check('patched gap no longer reported', after.includes('1 gap'), `"${after}"`);

// --- the same games from a downloaded file, with no API involved -------------
const FILE_PGN = GAMES.map((g) => g.pgn).join('\n\n');
await page.getByRole('button', { name: /^← /}).click();
await page.getByRole('button', { name: '← Games' }).click();
await page.locator('.games input[type=file]').setInputFiles({
  name: 'chess_com_games.pgn',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(FILE_PGN),
});
await page.waitForSelector('.gamerow', { timeout: 20000 });
check('a downloaded PGN file becomes a collection', (await page.locator('.gamerow').count()) === 4, `${await page.locator('.gamerow').count()} rows`);
await page.getByRole('button', { name: 'Find repertoire gaps →' }).click();
await page.waitForSelector('.gaps', { timeout: 15000 });
const fileHeading = await page.locator('.gaps h2').textContent();
check('gaps found from the uploaded collection', fileHeading.includes('4 games scanned'), `"${fileHeading}"`);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nAll game-review e2e checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
