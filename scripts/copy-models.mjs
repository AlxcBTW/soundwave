// Copies the Basic Pitch model into public/ so it can be fetched at runtime (web and desktop).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@spotify', 'basic-pitch', 'model');
const dst = join(root, 'public', 'models', 'basic-pitch');
if (!existsSync(src)) {
  console.warn('basic-pitch model not found; skipping copy');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
