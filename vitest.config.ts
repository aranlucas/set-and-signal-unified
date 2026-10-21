import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ experimental: { newConfig: true } })],
        test: { name: 'worker', include: ['tests/worker.test.ts'] },
      },
      // Live deployment checks; run explicitly with `npm run smoke`.
      { test: { name: 'smoke', include: ['tests/smoke.test.ts'], environment: 'node', testTimeout: 30_000 } },
    ],
  },
});
