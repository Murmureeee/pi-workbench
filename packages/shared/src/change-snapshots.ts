import { z } from 'zod'

/** File-version metadata only. Neither a saved reference nor a completed round proves
 * exclusive authorship or grants permission to restore anything in a workspace. */
export const fileSnapshotSchema = z
  .strictObject({
    status: z.enum(['pending', 'ready', 'failed', 'unavailable']),
    reference: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    capturedAt: z.number().int().nonnegative().nullable(),
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    excluded: z.number().int().nonnegative(),
    exclusions: z.array(z.strictObject({ path: z.string(), reason: z.string() })).max(32),
    diagnostic: z.string().nullable(),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.status === 'ready' && (!snapshot.reference || snapshot.capturedAt === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Saved file versions require a durable reference and capture time',
      })
    }
  })
export const changeRoundSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  cwd: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  outcome: z.enum(['active', 'completed', 'failed', 'aborted', 'interrupted']),
  baseline: fileSnapshotSchema,
  final: fileSnapshotSchema,
  provenance: z.literal('uncertain'),
  automaticRollback: z.literal(false),
})
export const changeHistoryQuerySchema = z.strictObject({
  sessionId: z.uuid(),
  before: z.coerce.number().int().positive().optional(),
})
export const changeHistorySchema = z.strictObject({
  sessionId: z.uuid(),
  rounds: z.array(changeRoundSchema).max(20),
  next: z.number().int().positive().nullable(),
})
export type FileSnapshot = z.infer<typeof fileSnapshotSchema>
export type ChangeRound = z.infer<typeof changeRoundSchema>
