import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.mjs',
      'packages/**/*.test.ts',
      'apps/daemon/test/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
    ],
    testTimeout: 20000,
  },
})
