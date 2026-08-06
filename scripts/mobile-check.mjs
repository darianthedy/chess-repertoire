/**
 * Checks the app for horizontal overflow at phone widths, and that no form
 * control is small enough to trigger focus-zoom on iOS.
 *
 * Run against a dev server: node scripts/mobile-check.mjs [url]
 */
import { chromium, devices } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const VIEWPORTS = [
  { name: 'iPhone SE', width: 320, height: 568 },
  { name: 'iPhone 12', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
];

let failures = 0;
const report = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const overflow = (page) =>
  page.evaluate(() => {
    const de = document.documentElement;
    const wide = [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className || '-'}`);
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, wide };
  });

const smallControls = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        size: parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter((c) => c.size < 16),
  );

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    ...devices['iPhone 12'],
    viewport: { width: vp.width, height: vp.height },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForSelector('.home', { timeout: 10000 });

  // --- home screen ---
  let o = await overflow(page);
  report(
    `${vp.name} home: no horizontal overflow`,
    o.scrollWidth <= o.clientWidth + 1,
    `${o.scrollWidth} vs ${o.clientWidth}${o.wide.length ? ' — ' + o.wide.join(', ') : ''}`,
  );

  // --- create a repertoire and open the editor ---
  await page.getByRole('button', { name: '+ Add repertoire' }).first().click();
  await page.locator('.card--accent input').fill('Overflow Test');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForSelector('.editor', { timeout: 10000 });

  o = await overflow(page);
  report(
    `${vp.name} editor: no horizontal overflow`,
    o.scrollWidth <= o.clientWidth + 1,
    `${o.scrollWidth} vs ${o.clientWidth}${o.wide.length ? ' — ' + o.wide.join(', ') : ''}`,
  );

  // --- play a few moves so the line strip and continuations are populated ---
  for (const [from, to] of [
    ['d2', 'd4'],
    ['d7', 'd5'],
    ['g1', 'f3'],
    ['g8', 'f6'],
    ['c1', 'f4'],
  ]) {
    await page.locator(`[data-square="${from}"]`).click();
    await page.locator(`[data-square="${to}"]`).click();
  }
  await page.waitForTimeout(300);

  const moveCount = await page.locator('.line__san').count();
  report(`${vp.name} five moves registered`, moveCount === 5, `${moveCount} in line`);

  o = await overflow(page);
  report(
    `${vp.name} editor with moves: no horizontal overflow`,
    o.scrollWidth <= o.clientWidth + 1,
    `${o.scrollWidth} vs ${o.clientWidth}${o.wide.length ? ' — ' + o.wide.join(', ') : ''}`,
  );

  // --- font sizes on controls (iOS focus-zoom threshold is 16px) ---
  // Step back one move: the final position is a leaf, so it shows the plan box
  // rather than a continuations list with note editors.
  await page.getByRole('button', { name: '← Back' }).click();
  await page.locator('.moves__item button[title="Edit note"]').first().click();
  await page.waitForTimeout(150);
  const small = await smallControls(page);
  report(
    `${vp.name} all controls >= 16px (no focus zoom)`,
    small.length === 0,
    small.length ? JSON.stringify(small) : '',
  );

  await page.screenshot({ path: `/tmp/shot-${vp.width}.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll mobile checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
