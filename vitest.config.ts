import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    /**
     * The engine and account suites are integration tests: each drives a whole
     * game — join, start, several graded rounds, settlement — through the real
     * services against the in-memory store. Individually they take a couple of
     * seconds, but the files run in parallel and the default 5s ceiling turns
     * ordinary scheduling contention into a failure that looks like a bug.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
