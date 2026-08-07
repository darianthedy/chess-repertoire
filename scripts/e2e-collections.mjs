/**
 * Games collection: save a PGN library, browse and filter it, read one game,
 * and hand-pick a single line into a repertoire.
 *
 * node scripts/e2e-collections.mjs <file.pgn> [url]
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// The dev server picks the next free port when 5173 is taken, so allow an
// override rather than silently testing someone else's checkout.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';

const FILE = process.argv[2];
const URL = process.argv[3] ?? BASE;
if (!FILE) {
  console.error('usage: node scripts/e2e-collections.mjs <file.pgn> [url]');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const buffer = readFileSync(FILE);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

await page.goto(URL);
await page.waitForSelector('.home');

// A repertoire to pick lines into.
await page.getByRole('button', { name: '+ Add repertoire' }).nth(1).click();
await page.locator('.card--accent input').fill('Caro-Kann');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');
await page.getByRole('button', { name: '← All repertoires' }).click();

// --- save the collection ----------------------------------------------------
await page.getByRole('button', { name: 'Games' }).click();
await page.waitForSelector('.games');
await page.locator('.games input[type=file]').setInputFiles({
  name: 'master-games.pgn',
  mimeType: 'application/octet-stream',
  buffer,
});
await page.waitForSelector('.gamerow', { timeout: 30000 });

const title = await page.locator('.editor__title').textContent();
const total = Number(title.match(/(\d+) games/)?.[1] ?? 0);
check('collection saved with its games', total > 1, `${total} games`);

const rows = await page.locator('.gamerow').count();
check('games listed', rows === total, `${rows} rows`);

const firstRow = await page.locator('.gamerow').first().innerText();
check('rows show players', /–/.test(firstRow), `"${firstRow.split('\n')[0]}"`);
check('rows show the opening moves', /1\.\w/.test(firstRow), `"${firstRow.split('\n')[1] ?? ''}"`);

// --- filter by first move ---------------------------------------------------
const options = await page.locator('.games select').first().locator('option').allTextContents();
check('first-move filter is populated from the file', options.length > 1, options.join(' '));

const e4Option = options.find((o) => o === '1.e4');
if (e4Option) {
  await page.locator('.games select').first().selectOption({ label: '1.e4' });
  const filtered = await page.locator('.gamerow').count();
  check('filtering by 1.e4 narrows the list', filtered > 0 && filtered <= total, `${filtered} of ${total}`);
  const openings = await page.locator('.gamerow__opening').allTextContents();
  check('every filtered game starts 1.e4', openings.every((o) => o.startsWith('1.e4')), openings[0]);
  await page.locator('.games select').first().selectOption('');
}

// --- read a game ------------------------------------------------------------
await page.locator('.gamerow').first().click();
await page.waitForSelector('.editor__layout');
check('game viewer opens', true);

// Step forward a few moves.
for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next →' }).click();
const walked = await page.locator('.line__san').allTextContents();
check('stepping through the game works', walked.length === 6, `[${walked.join(' ')}]`);

// --- hand-pick that line into the repertoire --------------------------------
await page.locator('.card--accent select').selectOption({ index: 1 });
await page.getByRole('button', { name: 'Add line' }).click();
await page.waitForSelector('.card--accent p.small:not(.muted)', { timeout: 10000 });
const msg = await page.locator('.card--accent p.small').last().textContent();
check('line adopted into the repertoire', /Added \d+ moves/.test(msg), `"${msg}"`);

// --- and only that line -----------------------------------------------------
await page.getByRole('button', { name: '← Back to collection' }).click();
await page.getByRole('button', { name: '← Games' }).click();
await page.getByRole('button', { name: '← All repertoires' }).click();
await page.waitForSelector('.home');

const repText = await page.locator('.rep').first().innerText();
const positions = Number(repText.match(/(\d+) positions/)?.[1] ?? 0);
check(
  'only the picked line was taken, not the whole file',
  positions === walked.length,
  `${positions} positions from a ${total}-game file`,
);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nAll collection checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
