/**
 * End-to-end: a position holding two moves of my own is played for me.
 *
 * The branch point is not a question — it is setup. The drill plays my move
 * there and the opponent's reply, without input, and stops at my next move,
 * which is where the actual recall happens. Which branch it takes follows the
 * puzzle's target, not a fixed preference.
 *
 * node scripts/e2e-ambiguous.mjs [url]
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

// 1.d4 d5 and now either 2.Nf3 or 2.c4 — both mine, each with its own
// continuation so both branches carry a card of their own.
const PGN = `[Event "Branch point"]
[Result "*"]

1. d4 d5 2. Nf3 (2. c4 e6 3. Nc3) Nf6 3. Bf4 *
`;

/** The two branches, keyed by the square my auto-played move lands on. */
const BRANCHES = {
  f3: { san: 'Nf3', reply: 'f6', next: ['c1', 'f4'], nextSan: 'Bf4' },
  c4: { san: 'c4', reply: 'e6', next: ['b1', 'c3'], nextSan: 'Nc3' },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

const move = async (from, to) => {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
};

const occupied = (square) =>
  page.evaluate(
    (s) => !!document.querySelector(`[data-square="${s}"] svg`),
    square,
  );

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

// --- build the tree ---------------------------------------------------------
await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
await page.locator('.card--accent input').fill('Branchy');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');

await page.getByRole('button', { name: 'Import' }).click();
await page.locator('.import textarea').fill(PGN);
await page.getByRole('button', { name: 'Import PGN' }).click();
await page.waitForSelector('.import p.small', { timeout: 10000 });
await page.getByRole('button', { name: 'Close' }).click();

// Both of my moves really are in the tree at the same position.
await page.locator('.line__next', { hasText: 'd4' }).first().click();
await page.locator('.line__next', { hasText: 'd5' }).first().click();
const branchMoves = (await page.locator('.line__next').allTextContents()).sort();
check(
  'two moves of mine sit at the branch point',
  branchMoves.join(' ') === 'Nf3 c4',
  `[${branchMoves.join(' ')}]`,
);

await page.getByRole('button', { name: '← All repertoires' }).click();
await page.waitForSelector('.home');

// --- the branch point is not a card ----------------------------------------
// Root (1.d4), and one position in each branch (3.Bf4 and 3.Nc3). The position
// after 1.d4 d5 is not among them: it has no single right answer to schedule.
const dueText = (await page.locator('.today__count').textContent()).trim();
check('the ambiguous position generates no card', dueText === '3', `showed "${dueText}"`);

await page.getByRole('button', { name: 'Start drilling' }).click();
await page.waitForSelector('.drill');

// The auto-played status is on screen for one reply interval, so sample it
// rather than racing a single read.
await page.evaluate(() => {
  window.__status = [];
  window.__statusTimer = setInterval(() => {
    const el = document.querySelector('.drill__status');
    if (!el) return;
    const text = el.innerText.trim();
    if (text && window.__status.at(-1) !== text) window.__status.push(text);
  }, 40);
});

/**
 * Walk one puzzle: play 1.d4, let the branch point play itself, then answer the
 * one move that is actually being asked. Returns which branch was taken.
 */
const walkPuzzle = async () => {
  await waitForStartPosition();
  await page.waitForSelector('.drill__status:has-text("Your move")', { timeout: 8000 });
  await move('d2', 'd4');

  // From here to my next move, nothing is clicked: my move at the branch point
  // and the opponent's reply both have to arrive on their own.
  await page.waitForFunction(
    () => {
      const on = (s) => !!document.querySelector(`[data-square="${s}"] svg`);
      return (on('f3') && on('f6')) || (on('c4') && on('e6'));
    },
    undefined,
    { timeout: 10000 },
  );

  const branch = (await occupied('f3')) ? BRANCHES.f3 : BRANCHES.c4;
  check(
    `the branch point played itself (${branch.san}) and the reply followed`,
    await occupied(branch.reply),
  );

  await page.waitForSelector('.drill__status:has-text("Your move")', { timeout: 8000 });
  const asked = await page.locator('.drill__status').innerText();
  check(
    `the drill stops at my next move, not the branch point`,
    asked.includes('Your move'),
    `"${asked.replace(/\n/g, ' | ')}"`,
  );

  await move(...branch.next);
  await page.waitForSelector('.drill__status:has-text("End of line")', { timeout: 8000 });
  check(`${branch.nextSan} was the move under test and it was accepted`, true);
  return branch.san;
};

const first = await walkPuzzle();

// Nothing was ever marked wrong: a stored move of mine is never a miss.
const tally = (await page.locator('.drill__bar .small').textContent()).trim();
check('no move was graded wrong', /·\s*(\d+)\/\1$/.test(tally), `showed "${tally}"`);

// --- the auto-played move is announced, not silent -------------------------
const log = await page.evaluate(() => window.__status);
check(
  'the auto-played choice is shown while it happens',
  log.some((t) => t.includes('Your choice here')),
  `[${log.join(' | ')}]`,
);
check(
  'and it names the move it played',
  log.some((t) => t.includes(`Your choice here — playing ${first}`)),
  `[${log.filter((t) => t.includes('Your choice')).join(' | ')}]`,
);

// --- the branch follows the puzzle, not a fixed preference -----------------
// The line just walked put its cards in the recent window, so the next draw has
// to come from the other branch — and the walk has to follow it there.
await page.getByRole('button', { name: 'Next puzzle' }).click();
const second = await walkPuzzle();
check(
  'the next puzzle walks the other branch',
  second !== first,
  `${first} then ${second}`,
);

await page.getByRole('button', { name: '← End session' }).click();
await page.waitForSelector('.drill--done', { timeout: 8000 });
const doneText = await page.locator('.drill--done').innerText();
check(
  'both puzzles counted and none were missed',
  doneText.includes('4 / 4 correct') && doneText.includes('2 puzzles'),
  `"${doneText.replace(/\n/g, ' | ').slice(0, 90)}"`,
);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nAll ambiguous-position e2e checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
