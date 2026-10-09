import { defineConfig } from '@playwright/test';

/** Checks against the real YouTube (network, changes on their side) with the store build: run by hand, not in test:all. */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.live.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
});
