import { z } from 'zod'

const fileId = z.string().regex(/^[a-f0-9]{64}$/)
const digest = fileId.nullable()
const ref = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .nullable()
export const rollbackTargetSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  fileId: fileId.nullable(),
})
export const rollbackCommandSchema = z.strictObject({
  sessionId: z.uuid(),
  operationId: z.uuid(),
  confirmationId: z.uuid(),
  action: z.enum(['confirm', 'confirm-external', 'cancel']),
})
export const rollbackRecordSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  turnId: z.uuid(),
  fileId: fileId.nullable(),
  state: z.enum([
    'prepared',
    'running',
    'succeeded',
    'cancelled',
    'conflict',
    'failed',
    'compensated',
    'needs-recovery',
    'interrupted',
  ]),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  baselineReference: ref,
  finalReference: ref,
  beforeReference: ref,
  afterReference: ref,
  afterSnapshotId: z.uuid().nullable().default(null),
  afterStatus: z.enum(['not-captured', 'ready', 'unavailable']).default('not-captured'),
  attemptReference: ref.default(null),
  externalConfirmed: z.boolean(),
  source: z.literal('human'),
  actor: z.string().max(512),
  diagnostic: z.string().nullable(),
  files: z
    .array(
      z.strictObject({
        fileId,
        path: z.string(),
        current: digest,
        expected: digest,
        target: digest,
        source: z.enum(['tool-observed', 'mixed', 'unknown']),
        conflict: z.boolean(),
        written: z.boolean(),
        compensated: z.boolean(),
        observedAfter: digest.default(null),
        observation: z
          .enum(['not-observed', 'present', 'missing', 'unavailable'])
          .default('not-observed'),
      }),
    )
    .max(4096),
})
export const rollbackPlanSchema = z.strictObject({
  record: rollbackRecordSchema,
  confirmationId: z.uuid(),
})
export type RollbackRecord = z.infer<typeof rollbackRecordSchema>
export type RollbackTarget = z.infer<typeof rollbackTargetSchema>
export type RollbackCommand = z.infer<typeof rollbackCommandSchema>

export const rollbackHistoryQuerySchema = z.strictObject({
  sessionId: z.uuid(),
  before: z.coerce.number().int().positive().optional(),
})
export const rollbackHistorySchema = z.strictObject({
  sessionId: z.uuid(),
  records: z
    .array(
      rollbackRecordSchema.omit({ files: true }).extend({
        totalFiles: z.number().int().nonnegative(),
        paths: z.array(z.string()).max(8),
      }),
    )
    .max(20),
  next: z.number().int().positive().nullable(),
})
