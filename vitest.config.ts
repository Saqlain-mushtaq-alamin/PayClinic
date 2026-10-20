import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.{ts,tsx}',
      'mocks/**/*.test.ts',
      'scenarios/**/*.test.ts',
      'tests/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '.payclinic-tmp/**'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    environmentMatchGlobs: [['apps/dashboard/**', 'jsdom']],
  },
});
