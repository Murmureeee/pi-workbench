import { z } from 'zod'

import { directoryRoundSchema } from './directory-write.js'

/** Startup configuration, independent of browser view caching. Terminals are a reserved budget
 * until M4 supplies a real PTY allocator; this schema does not claim terminal enforcement.
 */
export const resourceLimitsSchema = z.strictObject({
  kernels: z.number().int().min(1).max(32).default(3),
  modelTasks: z.number().int().min(1).max(16).default(1),
  terminals: z.number().int().min(1).max(64).default(6),
  idleMs: z.number().int().min(1).max(86400000).default(300000),
})
export type ResourceLimits = z.infer<typeof resourceLimitsSchema>

export const resourceSnapshotSchema = z.strictObject({
  version: z.literal(1),
  source: z.literal('real-sdk/local-fixture'),
  realProviderEnabled: z.literal(false),
  limits: resourceLimitsSchema,
  modelTasks: z.number().int().nonnegative(),
  terminalEnforcement: z.literal('reserved-until-M4'),
  viewCacheIndependent: z.literal(true),
  kernels: z.array(
    z.strictObject({
      sessionId: z.uuid(),
      epoch: z.uuid(),
      state: z.string(),
      pid: z.number().int().positive().optional(),
      pins: z.number().int().nonnegative(),
      lastUsedAt: z.number(),
      waitingApproval: z.boolean(),
      retiring: z.boolean(),
    }),
  ),
  queue: z.array(
    z.strictObject({
      id: z.uuid(),
      sessionId: z.uuid(),
      kind: z.enum(['kernel', 'model']),
      stage: z.enum(['queued', 'acquiring-kernel', 'running']),
      position: z.number().int().nonnegative(),
      reason: z.enum([
        'kernel-limit',
        'model-limit',
        'directory-busy',
        'starting-kernel',
        'running',
      ]),
      directoryOwner: directoryRoundSchema.nullable().optional(),
      cancellable: z.literal(true),
    }),
  ),
})
export type ResourceSnapshot = z.infer<typeof resourceSnapshotSchema>
