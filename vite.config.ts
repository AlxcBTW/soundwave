import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only endpoint: the chart debug view posts its annotations here and they are written to
 * debug-annotations/<song>.json in the project (gitignored), one file per song.
 */
function debugAnnotations(): Plugin {
  return {
    name: 'festival-debug-annotations',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__debug/annotations', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { songId: string; songTitle: string; annotations: unknown[] };
            const slug = `${data.songTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'song';
            const dir = join(server.config.root, 'debug-annotations');
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `${slug}-${String(data.songId).slice(0, 8)}.json`);
            writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), ...data }, null, 2));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ path: `debug-annotations/${basename(file)}` }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

/**
 * Lets the page use threads (SharedArrayBuffer), which the stem model needs to run at a bearable
 * speed on a processor. A host serving the built game has to send the same two headers.
 */
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [react(), debugAnnotations()],
  clearScreen: false,
  preview: { headers: isolation },
  server: {
    port: 5173,
    strictPort: true,
    headers: isolation,
    // The ML service's virtualenv, the Rust build output and the test audio hold tens of
    // thousands of files the app never imports; watching them slows every dev start.
    // The built stage files are left out too: a change under public/ reloads the whole page, and
    // rebuilding the stage rewrites them one after another (refresh by hand to see a new build).
    watch: { ignored: ['**/ml-service/.venv/**', '**/src-tauri/target/**', '**/local-audio/**', '**/debug-annotations/**', '**/public/stage/**'] },
  },
  // Only index.html is an entry. By default every .html under the project is scanned for
  // dependencies (including stray ones in the virtualenv), and the page waits for that scan.
  // The analysis worker loads these lazily; bundling them up front avoids a reload mid-analysis.
  // ONNX Runtime in the build that loads its script and WebAssembly file from public/ort (see
  // scripts/copy-models.mjs) instead of carrying them inside the bundle.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  optimizeDeps: { entries: ['index.html'], include: ['@tensorflow/tfjs', '@spotify/basic-pitch', 'fft.js'], exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
