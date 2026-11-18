// Fails the build when a file in dist/ is larger than a static host accepts per file. Cloudflare
// (Workers static assets and Pages) takes up to 25 MiB per file; the deploy fails on anything larger.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 25 * 1024 * 1024;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const tooLarge = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (statSync(path).size > LIMIT) tooLarge.push(path);
  }
};
walk(dist);
if (tooLarge.length) {
  for (const path of tooLarge) console.error(`${relative(dist, path)}: ${(statSync(path).size / 1024 / 1024).toFixed(1)} MiB, over the 25 MiB a file may have on Cloudflare`);
  process.exit(1);
}
