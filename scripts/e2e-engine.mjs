// End-to-end against the real Stockfish WASM build. Needs `npm run dev`.
//
// Worth doing as a browser test rather than only in engine-check.ts: everything
// that can go wrong with a WASM worker — asset paths, the classic-vs-module
// worker distinction, SharedArrayBuffer requirements — is invisible to a unit
// test and fatal in production.

import { chromium } from 'playwright';

// The dev server picks the next free port when 5173 is taken, so allow an
// override rather than failing confusingly against someone else's app.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';

let failures = 0;
const check = (l, ok, x = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`);
  if (!ok) failures++;
};

const PGN = `[Event "Test"]
[White "Kasparov"]
[Black "Karpov"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await p.goto(BASE);
await p.waitForSelector('.home');

// A Black repertoire answering 1.e4 with the Caro-Kann, so the engine panel has
// a book to cross-reference against.
await p.getByRole('button', { name: '+ Add repertoire' }).nth(1).click();
await p.locator('.card--accent input').fill('Caro-Kann');
await p.locator('.card--accent select').selectOption('b');
await p.getByRole('button', { name: 'Create' }).click();
await p.waitForSelector('.editor');
await p.getByRole('button', { name: 'Import' }).click();
// Kept to a single move so the drill later in this test is one short line.
await p.locator('.import textarea').fill('1. e4 c6');
await p.getByRole('button', { name: 'Import PGN' }).click();
await p.waitForSelector('.import p.small');
await p.getByRole('button', { name: '← All repertoires' }).click();

// --- the engine must be off until asked for -----------------------------------

await p.getByRole('button', { name: 'Games' }).click();
await p.locator('.games input[type=file]').setInputFiles({
  name: 'g.pgn',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(PGN),
});
await p.waitForSelector('.gamerow', { timeout: 30000 });
await p.locator('.gamerow').first().click();
await p.waitForSelector('.editor__layout');

check('no eval bar before the engine is turned on', (await p.locator('.evalbar').count()) === 0);
check('no engine download before the engine is turned on',
  !(await p.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('stockfish')))));

// --- turn it on ---------------------------------------------------------------

await p.getByRole('button', { name: /Engine/ }).click();
await p.waitForSelector('.evalbar', { timeout: 60000 });
await p.waitForSelector('.engine__line', { timeout: 60000 });

const bar = await p.locator('.evalbar__label').first().innerText();
check('eval bar shows a score', /^[+\-−]?\d|^0\.00|^M/.test(bar), bar);

// The starting position is roughly equal; a bar that is wildly lopsided means
// the side-to-move POV conversion is wrong.
const startCp = parseFloat(bar.replace('−', '-'));
check('start position evaluated as roughly equal', Math.abs(startCp) < 1.0, bar);

// --- the repertoire cross-reference, which is the point -----------------------

const panelFen = () =>
  p.locator('.editor__panel .card[data-fen]').getAttribute('data-fen');

/**
 * Wait for the panel to be analysing a *new* position at a useful depth.
 *
 * Waiting for lines to appear is not enough: the previous position's lines are
 * still on screen for a frame after a move, so a test that only waits for
 * content silently asserts against the position it just left.
 */
async function freshAnalysis(previousFen, minDepth) {
  await p.waitForFunction(
    ([prev, d]) => {
      const panel = document.querySelector('.editor__panel .card[data-fen]');
      const fen = panel?.getAttribute('data-fen') ?? '';
      if (!fen || fen === prev) return false;
      const match = /depth (\d+)/.exec(
        document.querySelector('.engine__depth')?.textContent ?? '',
      );
      return match !== null && Number(match[1]) >= d;
    },
    [previousFen, minDepth],
    { timeout: 60000 },
  );
}

// Walk to the position after 1.e4, where the Caro-Kann has an opinion.
const startFen = await panelFen();
await p.getByRole('button', { name: 'Next →' }).click();
// Deep enough that the move ordering has settled.
await freshAnalysis(startFen, 14);

const afterE4 = await panelFen();
check('the panel followed the board to the new position', afterE4 !== startFen);
check('it is black to move there', / b /.test(afterE4), afterE4);

const rows = await p.locator('.engine__line').count();
const uniqueSans = new Set(await p.locator('.engine__san').allInnerTexts());
check('multipv returns the requested number of lines', rows === 3, `${rows} rows`);
check('every line offers a distinct move', uniqueSans.size === rows, [...uniqueSans].join(','));

const sans = await p.locator('.engine__san').allInnerTexts();
check('engine offers candidate moves for black', sans.length > 1, sans.join(', '));

const booked = await p.locator('.engine__line[data-inbook="true"] .engine__san').allInnerTexts();
const unrated = (await p.locator('.card', { hasText: 'Also in book' }).count()) > 0;
check(
  'the repertoire move is cross-referenced against the engine',
  booked.includes('c6') || unrated,
  `book-tagged: ${booked.join(',') || 'none'}; listed as unrated: ${unrated}`,
);

const summary = await p.locator('.engine__summary').innerText();
check('a repertoire-aware summary is shown', summary.length > 10, summary);
check(
  'the summary talks about the book, not just the position',
  /book|repertoire|engine/i.test(summary),
  summary,
);

// --- playing an engine suggestion off the game score --------------------------

const before = await p.locator('.line__san').count();
await p.locator('.engine__line .engine__san').first().click();
await p.waitForFunction((n) => document.querySelectorAll('.line__san').length > n, before, { timeout: 10000 });
check('an engine suggestion can be walked into even off the game score',
  (await p.locator('.line__san').count()) === before + 1);

// --- the toggle is remembered -------------------------------------------------

// There is no router, so a reload lands back on the home screen and the game
// has to be navigated to again from there.
await p.reload();
await p.waitForSelector('.home', { timeout: 30000 });
await p.getByRole('button', { name: 'Games' }).click();
await p.locator('.rep__open').first().click();
await p.waitForSelector('.gamerow', { timeout: 30000 });
await p.locator('.gamerow').first().click();
await p.waitForSelector('.editor__layout');
check('engine toggle survives a reload', (await p.locator('.evalbar').count()) === 1);

// --- the engine must stay out of a drill, then show up at the end -------------
//
// This is the whole point of the split: an evaluation on screen mid-session
// turns a recall test into a reading test, so the bar must be absent while
// drilling and present once the session is scored.

await p.reload();
await p.waitForSelector('.home', { timeout: 30000 });
await p.getByRole('button', { name: 'Start drilling' }).click();
await p.waitForSelector('.drill', { timeout: 10000 });

const move = async (from, to) => {
  await p.locator(`[data-square="${from}"]`).click();
  await p.locator(`[data-square="${to}"]`).click();
};

let sawBoard = false;
let playedWrong = false;
let evalBarDuringDrill = 0;
let enginePanelDuringDrill = 0;

for (let i = 0; i < 40; i++) {
  if (await p.locator('.drill--done').count()) break;

  // Sampled on every turn of the loop, not just once: the bar must be absent
  // for the whole session, including while feedback is on screen.
  evalBarDuringDrill += await p.locator('.evalbar').count();
  enginePanelDuringDrill += await p.locator('.engine__lines').count();

  if (await p.getByRole('button', { name: 'Continue' }).count()) {
    await p.getByRole('button', { name: 'Continue' }).click();
  } else if (await p.getByRole('button', { name: /Next puzzle|Finish/ }).count()) {
    await p.getByRole('button', { name: /Next puzzle|Finish/ }).click();
  } else if ((await p.locator('.drill__status .muted').innerText().catch(() => '')) === 'Your move') {
    sawBoard = true;
    // Miss it deliberately the first time, then play the book move so the
    // session can finish.
    if (!playedWrong) {
      playedWrong = true;
      await move('e7', 'e5');
    } else {
      await move('c7', 'c6');
    }
  }
  await p.waitForTimeout(250);
}

check('the drill actually asked for a move', sawBoard);
check('no eval bar at any point during the drill', evalBarDuringDrill === 0, `${evalBarDuringDrill} sightings`);
check('no engine panel at any point during the drill', enginePanelDuringDrill === 0);

// --- but the review is there once it is over ----------------------------------

await p.waitForSelector('.drill--done', { timeout: 20000 });
check('the session ends with a review of what was missed',
  (await p.locator('.review').count()) === 1);
check('analysis is opt-in rather than automatic',
  (await p.getByRole('button', { name: 'Analyse mistakes' }).count()) === 1);
check('nothing is analysed until asked', (await p.locator('.evalbar').count()) === 0);

await p.getByRole('button', { name: 'Analyse mistakes' }).click();
await p.waitForSelector('.review__item .engine__verdict', { timeout: 90000 });

const reviewText = await p.locator('.review').innerText();
check('the review shows the move played', /You played\s+e5/.test(reviewText), reviewText.slice(0, 200));
check('the review shows the book move', /Your book\s+c6/.test(reviewText), reviewText.slice(0, 200));
check('the review evaluates the position', (await p.locator('.review .evalbar').count()) >= 1);

await b.close();
console.log(failures === 0 ? '\nAll engine e2e checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
