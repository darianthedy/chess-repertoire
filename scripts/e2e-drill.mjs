/**
 * End-to-end drill loop: build a repertoire through the UI, then drill it and
 * assert the grading, the automatic opponent replies, and the wrong-answer
 * behaviour.
 *
 * node scripts/e2e-drill.mjs [url]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5173/';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

const move = async (from, to) => {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
};

/**
 * Wait for a square to be occupied. A correct move advances immediately and the
 * reply auto-plays ~450ms later, so waiting on status text alone races: the old
 * "Your move" is still in the DOM immediately after a click.
 */
const waitForPieceOn = (square) =>
  page.waitForFunction(
    (s) => !!document.querySelector(`[data-square="${s}"] svg`),
    square,
    { timeout: 10000 },
  );

/**
 * Wait for the board to be back at the starting position.
 *
 * Needed between puzzles: squares occupied at the end of one line may also be
 * occupied at the point being waited for in the next, so waiting on a single
 * square can pass against the previous puzzle's stale board.
 */
const waitForStartPosition = () =>
  page.waitForFunction(
    () =>
      !!document.querySelector('[data-square="d2"] svg') &&
      !document.querySelector('[data-square="d4"] svg'),
    undefined,
    { timeout: 10000 },
  );

await page.goto(URL);
await page.waitForSelector('.home');

// --- build a repertoire: 1.d4 d5 2.Nf3 Nf6 3.Bf4 ---------------------------
await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
await page.locator('.card--accent input').fill('London');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');

for (const [f, t] of [
  ['d2', 'd4'],
  ['d7', 'd5'],
  ['g1', 'f3'],
  ['g8', 'f6'],
  ['c1', 'f4'],
]) {
  await move(f, t);
}
check('five moves entered', (await page.locator('.line__san').count()) === 5);

// Annotate the first move so the drill has a note to surface.
await page.getByRole('button', { name: '« Start' }).click();
await page.locator('.moves__item button[title="Edit note"]').first().click();
await page.locator('.moves__edit textarea').fill('Queen pawn, heading for the London setup');
await page.getByRole('button', { name: 'Save' }).click();

await page.getByRole('button', { name: '← All repertoires' }).click();
await page.waitForSelector('.home');

// --- home screen ------------------------------------------------------------
const dueText = await page.locator('.today__count').textContent();
check('three cards due', dueText.trim() === '3', `showed "${dueText.trim()}"`);

await page.getByRole('button', { name: 'Start drilling' }).click();
await page.waitForSelector('.drill');

// No opening name anywhere on the drill screen.
const drillText = await page.locator('.drill').innerText();
check('repertoire name is hidden during drilling', !drillText.includes('London'), drillText.replace(/\n/g, ' | ').slice(0, 70));

await page.waitForSelector('.drill__status:has-text("Your move")');

// --- correct move ----------------------------------------------------------
await move('d2', 'd4');
// A correct move never stops the loop: no "Correct", no acknowledgement — the
// note rides along beside the opponent's reply.
await page.waitForSelector('.drill__status[data-kind="note"]', { timeout: 5000 });
const noteShown = await page.locator('.drill__note').textContent();
check('the move note is surfaced', noteShown.includes('London setup'), `"${noteShown}"`);
const afterCorrect = await page.locator('.drill__status').innerText();
check('correct move is not announced', !/correct/i.test(afterCorrect), `"${afterCorrect.replace(/\n/g, ' | ')}"`);

// The opponent should reply on its own, with no interaction.
await waitForPieceOn('d5');
check('opponent replied automatically', true);
await page.waitForSelector('.drill__status:has-text("Your move")', { timeout: 6000 });

// --- wrong move ------------------------------------------------------------
await move('b1', 'c3'); // not the repertoire move (Nf3)
await page.waitForSelector('.drill__status[data-kind="wrong"]', { timeout: 5000 });
const wrongText = await page.locator('.drill__status').innerText();
check('wrong move shows the correct answer', wrongText.includes('Nf3'), `"${wrongText.replace(/\n/g, ' | ')}"`);
check('wrong move offers Continue rather than restarting', wrongText.includes('Continue'));

await page.getByRole('button', { name: 'Continue' }).click();

// --- finish the line -------------------------------------------------------
await page.waitForSelector('.drill__status:has-text("Your move")', { timeout: 8000 });
await move('c1', 'f4');
await page.waitForSelector('.drill__status:has-text("End of line")', { timeout: 8000 });
check('line ends and reports end of line', true);

// Drilling is open-ended: there is always another puzzle, never a "Finish".
const endText = await page.locator('.drill__status').innerText();
check(
  'the line ends by offering another puzzle',
  endText.includes('Next puzzle') && !endText.includes('Finish'),
  `"${endText.replace(/\n/g, ' | ')}"`,
);

await page.getByRole('button', { name: 'Next puzzle' }).click();
await page.waitForSelector('.drill__status', { timeout: 8000 });
const progress = await page.locator('.drill__bar .small').textContent();
check(
  'the counter runs up rather than down',
  /^Puzzle 2\b/.test(progress.trim()),
  `showed "${progress.trim()}"`,
);

// Replay the line correctly, this time including the move that was missed.
await waitForStartPosition();
await page.waitForSelector('.drill__status:has-text("Your move")', { timeout: 8000 });
await move('d2', 'd4');
await waitForPieceOn('d5'); // opponent has replied; my turn again
await move('g1', 'f3');
await waitForPieceOn('f3');
check('the previously missed move is accepted on the next pass', true);

await waitForPieceOn('f6'); // ...Nf6 played automatically
await move('c1', 'f4');
await page.waitForSelector('.drill__status:has-text("End of line")', { timeout: 8000 });
const finalText = await page.locator('.drill__status').innerText();
check(
  'the session keeps going with everything answered',
  finalText.includes('Next puzzle'),
  `"${finalText.replace(/\n/g, ' | ')}"`,
);

// Ending is the user's call, not the queue's.
await page.getByRole('button', { name: '← End session' }).click();
await page.waitForSelector('.drill--done', { timeout: 8000 });
const doneText = await page.locator('.drill--done').innerText();
check(
  'ending shows the session summary',
  doneText.includes('Session complete') && /\d+ puzzles?/.test(doneText),
  `"${doneText.replace(/\n/g, ' | ')}"`,
);
await page.getByRole('button', { name: 'Back to repertoires' }).click();
await page.waitForSelector('.home');

// --- scheduling actually persisted ----------------------------------------
const dueAfter = (await page.locator('.today__count').textContent()).trim();
check('graded cards leave the due queue', Number(dueAfter) < 3, `now ${dueAfter} due`);

const streak = await page.locator('.home__head .small').textContent().catch(() => '');
check('streak recorded', /1 day streak/.test(streak ?? ''), `"${streak}"`);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nAll drill e2e checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
