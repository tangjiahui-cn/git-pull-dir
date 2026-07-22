import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 10000,
    hookTimeout: 30000,
    include: ['test/**/*.test.ts'],
  },
});
