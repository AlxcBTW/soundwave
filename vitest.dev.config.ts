import { defineConfig } from 'vitest/config';

/** Offline dev tooling (not part of `pnpm test`): analyze local songs and inspect generated charts. */
export default defineConfig({
  test: { environment: 'node', include: ['scripts/dev/**/*.dev.ts'], testTimeout: 900_000 },
});
