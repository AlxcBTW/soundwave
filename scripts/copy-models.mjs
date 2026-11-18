// Copies runtime assets from packages into public/ so they can be fetched (web and desktop):
// the Draco decoder the 3D stage is compressed with, and the ONNX Runtime files. (The models and the
// fonts are in the repository itself: public/models, models/ and src/ui/fonts.)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const draco = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const dracoDst = join(root, 'public', 'draco');
if (existsSync(draco)) {
  mkdirSync(dracoDst, { recursive: true });
  cpSync(draco, dracoDst, { recursive: true });
} else console.warn('draco decoder not found; skipping copy');

// ONNX Runtime (the stem model's engine) starts its threads from its own script, so that script and
// its WebAssembly file are served next to the app, not bundled into it. The WebAssembly file is
// 27 MiB, over what some static hosts accept per file (Cloudflare: 25 MiB), so it is stored
// gzip-compressed (about 7 MiB) and the analysis worker unpacks it (src/analysis/separation/worker.ts).
const ort = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortDst = join(root, 'public', 'ort');
const ORT_WASM = 'ort-wasm-simd-threaded.asyncify.wasm';
if (existsSync(ort)) {
  mkdirSync(ortDst, { recursive: true });
  cpSync(join(ort, 'ort-wasm-simd-threaded.asyncify.mjs'), join(ortDst, 'ort-wasm-simd-threaded.asyncify.mjs'));
  const packed = join(ortDst, `${ORT_WASM}.gz`);
  const source = join(ort, ORT_WASM);
  // Compressing takes a few seconds: only when the runtime changed.
  const cache = join(root, 'node_modules', '.cache', 'soundwave');
  mkdirSync(cache, { recursive: true });
  const stamp = join(cache, `${ORT_WASM}.source-size`);
  const size = String(readFileSync(source).length);
  if (!existsSync(packed) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== size) {
    writeFileSync(packed, gzipSync(readFileSync(source), { level: 9 }));
    writeFileSync(stamp, size);
  }
  // An uncompressed copy from an earlier version would end up in the build.
  rmSync(join(ortDst, ORT_WASM), { force: true });
  rmSync(join(ortDst, `${ORT_WASM}.source-size`), { force: true });
} else console.warn('onnxruntime-web not found; skipping copy');
