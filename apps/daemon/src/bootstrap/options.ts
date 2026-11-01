// @env node
import type { DaemonOptions } from './types.js'

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

export function readOptions(env: NodeJS.ProcessEnv = process.env): DaemonOptions {
  if (env.PIW_KERNEL && env.PIW_KERNEL !== 'fake') {
    throw new Error('Only the offline fake kernel is available in OPS-01')
  }
  const port = Number(env.PIW_PORT || 4317)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid PIW_PORT')
  }
  return {
    port,
    dataDir: resolve(
      env.PIW_DATA_DIR ||
        join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'PiWorkbench'),
    ),
  }
}
