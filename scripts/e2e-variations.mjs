/**
 * End-to-end: reading a repertoire as a list of lines, then editing one.
 *
 * Covers the whole path the feature exists for — open a repertoire, see what's
 * in it, filter it, pick a line, change a move inside it, and see the list
 * reflect the change.
 *
 * node scripts/e2e-variations.mjs [url]
 */
import { chromium } from 'playwright';

// The dev server picks the next free port when 5173 is taken, so allow an
// override rather than silently testing someone else's checkout.
const URL = process.argv[2] ?? process.env.E2E_BASE ?? 'http://localhost:5173/';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const PGN = `[Event "London"]
[Result "*"]

1. d4 d5 2. Nf3 Nf6 3. Bf4 (3. c4 e6) 3... c5 4. e3 *

[Event "vs KID"]
[Result "*"]

1. d4 Nf6 2. Bf4 g6 3. Nf3 Bg7 *
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

await page.goto(URL);
await page.waitForSelector('.home');

// --- a new repertoire opens straight onto the board -------------------------
await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
await page.locator('.card--accent input').fill('London');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');
check('a new repertoire skips the empty line list', true);

await page.getByRole('button', { name: 'Import' }).click();
await page.locator('.import textarea').fill(PGN);
await page.getByRole('button', { name: 'Import PGN' }).click();
await page.waitForSelector('.import p.small', { timeout: 10000 });
await page.getByRole('button', { name: '← All repertoires' }).click();
await page.waitForSelector('.home');

// --- opening an existing repertoire lands on its lines ----------------------
await page.locator('.rep__open').first().click();
await page.waitForSelector('.vars');

const lines = await page.locator('.var__moves').allTextContents();
check('every stored line is listed', lines.length === 3, `${lines.length}: ${JSON.stringify(lines)}`);
check(
  'lines read as numbered movetext',
  lines.includes('1.d4 d5 2.Nf3 Nf6 3.Bf4 c5 4.e3'),
  JSON.stringify(lines),
);
check(
  'the sideline from the PGN variation is its own line',
  lines.includes('1.d4 d5 2.Nf3 Nf6 3.c4 e6'),
  JSON.stringify(lines),
);
check(
  'exactly one line is flagged as the main line',
  (await page.locator('.var .tag', { hasText: 'main line' }).count()) === 1,
);
check(
  'unfinished lines are flagged as having no plan',
  (await page.locator('.var .var__noplan').count()) === 3,
);

// --- naming a line from the list -------------------------------------------
const kid = page.locator('.vars__row', { hasText: '1.d4 Nf6 2.Bf4 g6 3.Nf3 Bg7' });
await kid.getByRole('button', { name: '+ Name' }).click();
await kid.locator('.var__naming input').fill('KID setup');
await kid.getByRole('button', { name: 'Save' }).click();
check(
  'the name shows on the line it was given to',
  (await kid.locator('.var__name').textContent()) === 'KID setup',
);
check(
  'naming one line leaves the others unnamed',
  (await page.locator('.var__name').count()) === 1,
  `${await page.locator('.var__name').count()}`,
);

// --- filtering --------------------------------------------------------------
await page.locator('.vars__filters input[type=text]').fill('KID set');
check(
  'the filter finds a line by its name',
  (await page.locator('.var').count()) === 1,
  `${await page.locator('.var').count()}`,
);

await page.locator('.vars__filters input[type=text]').fill('c4');
check(
  'filter narrows to matching lines',
  (await page.locator('.var').count()) === 1,
  `${await page.locator('.var').count()}`,
);
await page.locator('.vars__filters input[type=text]').fill('');

// --- picking a line opens it at its end, ready to annotate ------------------
await page
  .locator('.var', { hasText: '1.d4 Nf6 2.Bf4 g6 3.Nf3 Bg7' })
  .click();
await page.waitForSelector('.editor__layout');
const shownLine = (await page.locator('.line').textContent()).replace(/\s+/g, ' ');
check(
  'the editor opens on the chosen line',
  shownLine.includes('Bg7'),
  `"${shownLine}"`,
);
check(
  'the terminal plan box is right there',
  (await page.locator('.editor__plan').count()) === 1,
);
check(
  'the editor shows the name already given to this line',
  (await page.locator('.editor__name').inputValue()) === 'KID setup',
);

// Renaming from the editor is the same field, and lands in the same place.
await page.locator('.editor__name').fill('King’s Indian setup');

await page.locator('.editor__plan').fill('castle short, hit d4 with ...c5');
await page.getByRole('button', { name: '← Lines' }).click();
await page.waitForSelector('.vars');
check(
  'the plan written in the editor shows on the line',
  (await page.locator('.var__plan').count()) === 1 &&
    (await page.locator('.var__plan').textContent()).includes('hit d4'),
);
check(
  'that line no longer counts as unfinished',
  (await page.locator('.var .var__noplan').count()) === 2,
);
check(
  'the rename done in the editor shows on the line',
  (await page.locator('.var__name').textContent()) === 'King’s Indian setup',
  await page.locator('.var__name').textContent(),
);

// --- replacing a move inside an existing line -------------------------------
await page.locator('.var', { hasText: '3.c4 e6' }).click();
await page.waitForSelector('.editor__layout');
// Step back to the position c4 was played *from*, where it's a continuation.
await page.getByRole('button', { name: '← Back' }).click();
await page.getByRole('button', { name: '← Back' }).click();

await page
  .locator('.line__choice', { hasText: 'c4' })
  .getByTitle('Replace this move with a different one')
  .click();
await page.waitForSelector('.replacing');
check('replace mode announces what it is replacing', true);

// Play g3 in place of c4. Discarding 3...e6 with it needs confirming.
page.once('dialog', (d) => d.accept());
await page.locator('[data-square="g2"]').click();
await page.locator('[data-square="g3"]').click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '← Lines' }).click();
await page.waitForSelector('.vars');
const after = await page.locator('.var__moves').allTextContents();
check(
  'the replaced move is gone from the list',
  !after.some((l) => l.includes('3.c4')),
  JSON.stringify(after),
);
check(
  'the replacement took its place in the same line',
  after.some((l) => l.startsWith('1.d4 d5 2.Nf3 Nf6 3.g3')),
  JSON.stringify(after),
);
check(
  'the other lines are untouched',
  after.length === 3 && after.some((l) => l.includes('3.Nf3 Bg7')),
  JSON.stringify(after),
);

// --- promoting a sideline to the main line ----------------------------------
await page.locator('.var', { hasText: '3.g3' }).click();
await page.waitForSelector('.editor__layout');
await page.getByRole('button', { name: '« Start' }).click();
// The branch is after 1.d4, so step into it before reordering the replies.
await page.locator('.line__next', { hasText: 'd4' }).click();
await page
  .locator('.line__choice', { hasText: 'Nf6' })
  .getByTitle('Make this the main line')
  .click();
await page.getByRole('button', { name: '← Lines' }).click();
await page.waitForSelector('.vars');
const mainRow = await page
  .locator('.var', { has: page.locator('.tag', { hasText: 'main line' }) })
  .locator('.var__moves')
  .textContent();
check(
  'promoting a move moves the main-line flag',
  mainRow.startsWith('1.d4 Nf6'),
  `"${mainRow}"`,
);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(
  failures === 0 ? '\nAll variation checks passed.' : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
