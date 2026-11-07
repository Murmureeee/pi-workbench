import { z } from 'zod'

import { workspaceEnvironmentTargetSchema } from './workspace-environment.js'

/** Observation metadata, never a file snapshot, execution permit or rollback authority. */
export const directoryRoundSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  cwd: z.string(),
  state: z.enum(['active', 'released', 'interrupted', 'quarantined']),
  startedAt: z.number(),
  checkedAt: z.number(),
  endedAt: z.number().nullable(),
  coverage: z.enum(['bounded', 'limited', 'unavailable']),
  changedPaths: z.array(z.string()).max(32),
  changesTruncated: z.boolean(),
  provenance: z.literal('uncertain'),
  automaticRollback: z.literal(false),
})
export type DirectoryRound = z.infer<typeof directoryRoundSchema>

export const directoryWriteStatusSchema = z.strictObject({
  target: workspaceEnvironmentTargetSchema,
  cwd: z.string(),
  available: z.boolean(),
  owner: directoryRoundSchema.nullable(),
  queue: z
    .array(
      z.strictObject({
        sessionId: z.uuid(),
        turnId: z.uuid(),
        position: z.number().int().positive(),
      }),
    )
    .max(256),
  latest: directoryRoundSchema.nullable(),
})
export type DirectoryWriteStatus = z.infer<typeof directoryWriteStatusSchema>
