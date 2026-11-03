import { randomUUID } from 'node:crypto'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120000,
    // Each run owns fresh daemon data; a prior hard-ended runner must not leave a live-PID
    // lease collision in a later run. Product data/lease recovery rules remain authoritative.
    env: { PIW_DATA_DIR: `.workbench/e2e-${randomUUID()}` },
  },
})
