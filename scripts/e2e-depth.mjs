/**
 * Depth box editing. The box used to commit `Number(value) || 1` on every
 * keystroke, so clearing it to type a new number wrote 1 to the repertoire and
 * the controlled input echoed that 1 straight back — "12" came out as "112".
 *
 * node scripts/e2e-depth.mjs [url]
 */
import { chromium } from 'playwright';

// The dev server picks the next free port when 5173 is taken, so allow an
// override rather than silently testing someone else's checkout.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';
const URL = process.argv[2] ?? BASE;

let failures = 0;
const check = (l, ok, x = '') => { console.log(`${ok?'PASS':'FAIL'}  ${l}${x?'  '+x:''}`); if(!ok) failures++; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

await p.goto(URL);
await p.waitForSelector('.home');

await p.getByRole('button', { name: '+ Add repertoire' }).first().click();
await p.locator('.card--accent input').fill('Depth Test');
await p.getByRole('button', { name: 'Create' }).click();
await p.waitForSelector('.editor');
await p.getByRole('button', { name: '← All repertoires' }).click();
await p.waitForSelector('.home');

const box = p.locator('.rep .depth input').first();
check('new repertoire starts at the seed depth', await box.inputValue() === '8', await box.inputValue());

// --- the reported bug: an emptied box snapped back to 1 ---
const clear = async (el) => { await el.click(); await el.press('Control+a'); await el.press('Backspace'); };
await clear(box);
check('box stays empty while editing', await box.inputValue() === '', `"${await box.inputValue()}"`);
await box.type('12');
check('typed value is not prefixed by a stray 1', await box.inputValue() === '12', await box.inputValue());
await box.blur();
check('value survives blur', await box.inputValue() === '12', await box.inputValue());

// Reaches the model, not just component state. Writes are debounced 300ms.
await p.waitForTimeout(700);
await p.reload();
await p.waitForSelector('.home');
const box2 = p.locator('.rep .depth input').first();
check('value survives reload', await box2.inputValue() === '12', await box2.inputValue());

// --- blur settles anything half-typed or out of range ---
await clear(box2);
await box2.blur();
check('empty + blur restores the saved value', await box2.inputValue() === '12', await box2.inputValue());

await clear(box2);
await box2.type('99');
await box2.blur();
check('above max clamps to 40', await box2.inputValue() === '40', await box2.inputValue());

await clear(box2);
await box2.type('0');
await box2.blur();
check('below min clamps to 1', await box2.inputValue() === '1', await box2.inputValue());

check('no page errors', errors.length === 0, errors.join(' | '));

await b.close();
console.log(failures === 0 ? '\nAll depth checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
