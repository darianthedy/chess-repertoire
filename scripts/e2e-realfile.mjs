/**
 * Import real-world PGN files through the UI.
 *
 * Guards the file-upload path against the shapes that actually turn up:
 * annotated master games with chess.com's [%c_effect ...] markup, comments
 * spanning lines, and deeply nested variations.
 *
 * node scripts/e2e-realfile.mjs <file.pgn> [url]
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// The dev server picks the next free port when 5173 is taken, so allow an
// override rather than silently testing someone else's checkout.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';

const FILE = process.argv[2];
const URL = process.argv[3] ?? BASE;
if (!FILE) {
  console.error('usage: node scripts/e2e-realfile.mjs <file.pgn> [url]');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const buffer = readFileSync(FILE);
const browser = await chromium.launch();
// Phone-sized, since that's where the accept filter hid these files.
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

await page.goto(URL);
await page.waitForSelector('.home');

await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
await page.locator('.card--accent input').fill('Caro-Kann');
await page.locator('.card--accent select').selectOption('b');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.editor');

await page.getByRole('button', { name: 'Import' }).click();

const input = page.locator('.import input[type=file]');
check('file input has no accept filter', (await input.getAttribute('accept')) === null);

await input.setInputFiles({
  name: 'repertoire.pgn',
  mimeType: 'application/octet-stream', // what a phone often reports for .pgn
  buffer,
});

await page.waitForSelector('.import p.small, .import p.error', { timeout: 30000 });

const err = await page.locator('.import p.error').count();
check('file was not rejected', err === 0, err ? await page.locator('.import p.error').textContent() : '');

const msg = await page.locator('.import p.small').last().textContent();
const added = Number(msg.match(/Added (\d+)/)?.[1] ?? 0);
check('a substantial number of moves imported', added > 100, `"${msg}"`);

const title = await page.locator('.editor__title').textContent();
const positions = Number(title.match(/(\d+) positions/)?.[1] ?? 0);
check('positions landed in the tree', positions > 100, `${positions} positions`);

// chess.com markup must not survive into notes. Writes are debounced, so wait
// for the persisted tree to catch up with what the screen already shows rather
// than reading a stale snapshot.
const readState = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        // Read idb-keyval's store directly; importing the module inside the
        // page is fragile across dev and built output.
        const req = indexedDB.open('keyval-store');
        req.onsuccess = () => {
          const tx = req.result.transaction('keyval', 'readonly');
          const g = tx.objectStore('keyval').get('chess-repertoire:state:v1');
          g.onsuccess = () => resolve(g.result ?? null);
          g.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );

let persisted = null;
for (let i = 0; i < 30; i++) {
  persisted = await readState();
  const stored = persisted?.repertoires?.[0]
    ? Object.keys(persisted.repertoires[0].nodes).length - 1
    : -1;
  if (stored >= positions) break;
  await page.waitForTimeout(500);
}
check('tree persisted to IndexedDB', !!persisted?.repertoires?.[0]);

const notes = Object.values(persisted.repertoires[0].nodes).flatMap((n) =>
  n.moves.map((m) => m.note),
);
const withNotes = notes.filter(Boolean);
check(
  'no chess.com markup leaked into notes',
  !withNotes.some((n) => n.includes('[%') || n.includes('c_effect') || n.includes('persistent;')),
  withNotes.find((n) => n.includes('[%')) ?? '',
);
check('human annotations were kept', withNotes.length > 0, `${withNotes.length} notes, e.g. "${withNotes[0] ?? ''}"`);

// The tree has to be drillable, not just large.
await page.getByRole('button', { name: 'Close' }).click();
await page.getByRole('button', { name: '← All repertoires' }).click();
await page.waitForSelector('.home');
const due = Number((await page.locator('.today__count').textContent()).trim());
check('imported tree produces drill cards', due > 0, `${due} due`);

check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nAll real-file checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
