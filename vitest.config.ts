import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/daemon/test/**/*.test.ts'],
    testTimeout: 20000,
  },
})
