// Copies runtime assets from packages into public/ so they can be fetched (web and desktop):
// the Basic Pitch model and the Draco decoder the 3D stage is compressed with.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@spotify', 'basic-pitch', 'model');
const dst = join(root, 'public', 'models', 'basic-pitch');
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
} else console.warn('basic-pitch model not found; skipping copy');

const draco = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const dracoDst = join(root, 'public', 'draco');
if (existsSync(draco)) {
  mkdirSync(dracoDst, { recursive: true });
  cpSync(draco, dracoDst, { recursive: true });
} else console.warn('draco decoder not found; skipping copy');
