// Fetch the Stockfish WASM build into public/engine/.
//
// Why fetched rather than depended on: the `stockfish` npm package ships every
// build variant including two 113 MB full-NNUE binaries, so the tarball is
// ~167 MB. Adding it to package.json would cost that on every `npm ci` for two
// files totalling 7.3 MB. Why fetched rather than committed: 7.3 MB of binary
// in git history for an asset that is byte-identical to a pinned npm artifact.
//
// The build variant is `lite-single`:
//   * `lite`   — the small NNUE net. Full strength needs a 113 MB net for
//                perhaps 40 Elo, which is meaningless for judging openings.
//   * `single` — single-threaded, so no SharedArrayBuffer, so no COOP/COEP
//                headers. GitHub Pages cannot set headers, and faking them with
//                a second service worker would fight the PWA's own. This is the
//                constraint that picks the variant, not a performance choice.
//
// Downloads are hash-checked: this is a 7 MB binary the app then executes.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '18.0.8';

const FILES = [
  {
    name: 'stockfish-18-lite-single.js',
    sha256: '5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391',
  },
  {
    name: 'stockfish-18-lite-single.wasm',
    sha256: 'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1',
  },
];

// unpkg only. jsdelivr refuses this package outright ("size exceeded the
// configured limit of 150 MB"), so it isn't a usable fallback.
const base = `https://unpkg.com/stockfish@${VERSION}/bin`;

const outDir = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'public',
  'engine',
);

function digest(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function existing(path, sha256) {
  try {
    const buf = await readFile(path);
    return digest(buf) === sha256 ? buf : null;
  } catch {
    return null;
  }
}

async function fetchOne({ name, sha256 }) {
  const path = join(outDir, name);

  if (await existing(path, sha256)) {
    console.log(`engine: ${name} present`);
    return;
  }

  const url = `${base}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const got = digest(buf);
  if (got !== sha256) {
    // Refuse rather than warn. A mismatch means the pinned artifact changed
    // under us, and this file is executed by every user of the app.
    throw new Error(
      `${name}: sha256 mismatch\n  expected ${sha256}\n  got      ${got}`,
    );
  }

  await writeFile(path, buf);
  console.log(`engine: ${name} fetched (${(buf.length / 1e6).toFixed(1)} MB)`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const file of FILES) await fetchOne(file);
}

main().catch((err) => {
  console.error(`engine: ${err.message}`);
  // Non-fatal by design. The app treats a missing engine as "analysis
  // unavailable" and everything else keeps working, so a CDN outage must not
  // block a build whose actual purpose is drilling openings offline.
  process.exit(0);
});
