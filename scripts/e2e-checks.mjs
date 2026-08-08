/**
 * End-to-end: drilling a line made of checking moves.
 *
 * SAN has two spellings for the same move — `Bxf7` and `Bxf7+` — and grading
 * compares strings. Imported PGN stored the bare form while the board reported
 * the decorated one, so in a line like this one every single check was marked
 * wrong no matter what you played. Drills the whole line through the UI and
 * asserts nothing is ever graded wrong.
 *
 * node scripts/e2e-checks.mjs [url]
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';
const URL = process.argv[2] ?? BASE;

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

// Bird's Defense. 7.Bxf7+, 8.Qh5+ and 9.Qd5+ are all checks.
const PGN = `[Event "Bird's Defense"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nd4 4. Nxd4 exd4 5. O-O a6 6. Bc4 b5 7. Bxf7+ Kxf7 8. Qh5+ g6 9. Qd5+ *
`;

// White's moves, in order. The opponent's replies auto-play.
const MOVES = [
  ['e2', 'e4'],
  ['g1', 'f3'],
  ['f1', 'b5'],
  ['f3', 'd4'],
  ['e1', 'g1'], // O-O
  ['b5', 'c4'],
  ['c4', 'f7'], // Bxf7+
  ['d1', 'h5'], // Qh5+
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

const move = async (from, to) => {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
};

await page.goto(URL);
await page.waitForSelector('.home');

await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
await page.locator('.card--accent input').fill("Bird's Defense");
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');

await page.getByRole('button', { name: 'Import' }).click();
await page.locator('.import textarea').fill(PGN);
await page.getByRole('button', { name: 'Import PGN' }).click();
await page.waitForSelector('.import p.small', { timeout: 10000 });
const msg = (await page.locator('.import p.small').last().textContent()).trim();
check('line imported', /Added \d+ moves/.test(msg) && !msg.includes('could not be played'), `"${msg}"`);

await page.getByRole('button', { name: 'Close' }).click();
await page.getByRole('button', { name: '← All repertoires' }).click();
await page.waitForSelector('.home');
await page.getByRole('button', { name: 'Start drilling' }).click();
await page.waitForSelector('.drill');
await page.waitForSelector('.drill__status:has-text("Your move")');

const graded = [];
for (const [from, to] of MOVES) {
  await move(from, to);
  // Settle: a correct move advances and the reply auto-plays ~450ms later, so
  // the status is only trustworthy once that has happened.
  await page.waitForTimeout(900);
  const kind = await page.locator('.drill__status').getAttribute('data-kind');
  graded.push(`${from}${to}:${kind}`);
  if (kind === 'wrong') break;
}

check(
  'no move in a line of checks is graded wrong',
  !graded.some((g) => g.endsWith(':wrong')),
  graded.join(' '),
);
check('the whole line was played', graded.length === MOVES.length, `${graded.length}/${MOVES.length}`);

// "Puzzle 1 · 8/8" — right out of answered, so the two must agree.
const counter = (await page.locator('.drill header .muted').innerText()).trim();
const [right, asked] = (counter.match(/(\d+)\/(\d+)/) ?? []).slice(1);
check('every answer scored as correct', right === asked && Number(asked) > 0, `"${counter}"`);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nAll checking-move e2e checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
