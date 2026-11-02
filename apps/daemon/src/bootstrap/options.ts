// @env node
import type { DaemonOptions } from './types.js'

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { resourceLimitsSchema } from '@pi-workbench/shared'

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
    piAgentDir: env.PIW_PI_AGENT_DIR ? resolve(env.PIW_PI_AGENT_DIR) : undefined,
    resourceLimits: resourceLimitsSchema.parse({
      kernels: env.PIW_MAX_KERNELS === undefined ? undefined : Number(env.PIW_MAX_KERNELS),
      modelTasks:
        env.PIW_MAX_MODEL_TASKS === undefined ? undefined : Number(env.PIW_MAX_MODEL_TASKS),
      terminals: env.PIW_MAX_TERMINALS === undefined ? undefined : Number(env.PIW_MAX_TERMINALS),
      idleMs: env.PIW_KERNEL_IDLE_MS === undefined ? undefined : Number(env.PIW_KERNEL_IDLE_MS),
    }),
    dataDir: resolve(
      env.PIW_DATA_DIR ||
        join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'PiWorkbench'),
    ),
  }
}
