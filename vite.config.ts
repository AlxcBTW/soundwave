import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
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

export default defineConfig({
  plugins: [react(), debugAnnotations()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
