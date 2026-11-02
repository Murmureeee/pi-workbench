import type { ResourceLimits } from '@pi-workbench/shared'

export interface DaemonOptions {
  dataDir: string
  port: number
  development?: boolean
  resourceLimits?: Partial<ResourceLimits>
  /** Explicit existing pi config source; omitted in default offline development/tests. */
  piAgentDir?: string
}
