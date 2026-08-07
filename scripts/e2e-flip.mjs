import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
let failures = 0;
const check = (l, ok, x='') => { console.log(`${ok?'PASS':'FAIL'}  ${l}${x?'  '+x:''}`); if(!ok) failures++; };

// Top-left square identifies orientation: a8 when White is at the bottom.
const topLeft = (page) => page.locator('[data-square]').first().getAttribute('data-square');

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,120)));
await p.goto('http://localhost:5173/');
await p.waitForSelector('.home');

// --- editor: a Black repertoire should start from Black's side ---
await p.getByRole('button', { name: '+ Add repertoire' }).nth(1).click();
await p.locator('.card--accent input').fill('Caro-Kann');
await p.locator('.card--accent select').selectOption('b');
await p.getByRole('button', { name: 'Create' }).click();
await p.waitForSelector('.editor');
check('black repertoire opens from black side', await topLeft(p) === 'h1', await topLeft(p));
await p.getByRole('button', { name: '⇅ Flip' }).click();
check('editor flips to white', await topLeft(p) === 'a8', await topLeft(p));
await p.getByRole('button', { name: '⇅ Flip' }).click();
check('editor flips back', await topLeft(p) === 'h1', await topLeft(p));

// Give the Caro repertoire a 1.e4 answer so the viewer can match on it.
await p.getByRole('button', { name: 'Import' }).click();
await p.locator('.import textarea').fill('1. e4 c6 2. d4 d5');
await p.getByRole('button', { name: 'Import PGN' }).click();
await p.waitForSelector('.import p.small');
await p.getByRole('button', { name: '← All repertoires' }).click();

// --- game viewer ---
await p.getByRole('button', { name: 'Games' }).click();
await p.locator('.games input[type=file]').setInputFiles({
  name: 'g.pgn', mimeType: 'application/octet-stream',
  buffer: readFileSync(process.argv[2]),
});
await p.waitForSelector('.gamerow', { timeout: 30000 });
await p.locator('.gamerow').first().click();
await p.waitForSelector('.editor__layout');
check('caro-kann game opens from black side', await topLeft(p) === 'h1', await topLeft(p));
await p.getByRole('button', { name: '⇅ Flip' }).click();
check('viewer flips to white', await topLeft(p) === 'a8', await topLeft(p));

await b.close();
console.log(failures === 0 ? '\nAll flip checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
