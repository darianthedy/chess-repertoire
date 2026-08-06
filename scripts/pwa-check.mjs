/**
 * Verify the built app is installable and works offline, served from a
 * subpath so it matches how GitHub Pages hosts it.
 *
 * node scripts/pwa-check.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const PREFIX = '/chess-repertoire';
const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = 5199;

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (!path.startsWith(PREFIX)) {
    res.writeHead(404).end('not found');
    return;
  }
  path = path.slice(PREFIX.length) || '/';
  if (path === '/') path = '/index.html';

  try {
    const file = join(ROOT, normalize(path));
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // No caching, so the test measures the service worker rather than the
      // HTTP cache.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(PORT, r));
const base = `http://localhost:${PORT}${PREFIX}/`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

await page.goto(base);
await page.waitForSelector('.home');
check('app loads from a subpath', true);

// --- manifest ---------------------------------------------------------------
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
check('manifest is linked', !!manifestHref, manifestHref ?? '');

const manifest = await page.evaluate(async (href) => {
  const res = await fetch(href);
  return res.ok ? res.json() : null;
}, manifestHref);

check('manifest fetches and parses', !!manifest);
check('has a name', manifest?.name === 'Chess Repertoire', manifest?.name);
check('display is standalone', manifest?.display === 'standalone', manifest?.display);
check('has 192 and 512 icons', manifest?.icons?.length >= 2, `${manifest?.icons?.length} icons`);
check(
  'has a maskable icon',
  manifest?.icons?.some((i) => i.purpose === 'maskable'),
);

const iconStatuses = await page.evaluate(
  async (icons) =>
    Promise.all(
      icons.map(async (i) => {
        const res = await fetch(i.src);
        return `${i.src}:${res.status}`;
      }),
    ),
  manifest.icons,
);
check(
  'every icon resolves from the subpath',
  iconStatuses.every((s) => s.endsWith(':200')),
  iconStatuses.join(' '),
);

// --- service worker ---------------------------------------------------------
const swReady = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, active: !!reg.active };
});
check('service worker activates', swReady.active);
check(
  'service worker scope is the subpath',
  swReady.scope.endsWith('/chess-repertoire/'),
  swReady.scope,
);

// --- offline ----------------------------------------------------------------
await page.waitForTimeout(600); // let precaching settle
await context.setOffline(true);
await page.reload();
await page.waitForSelector('.home', { timeout: 10000 });
check('app still loads with the network offline', true);

const drillable = await page.locator('.today').count();
check('offline shell is functional, not a stub', drillable === 1);

await context.setOffline(false);
check('no runtime errors', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll PWA checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
