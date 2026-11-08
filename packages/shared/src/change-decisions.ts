import { z } from 'zod'

import { changeDiffQuerySchema } from './change-review.js'
import { changeRoundSchema } from './change-snapshots.js'

const reference = z.string().regex(/^[a-f0-9]{40}$/)
export const changeAcceptSchema = changeDiffQuerySchema.extend({
  baselineReference: reference,
  finalReference: reference,
})
export const changeDecisionSchema = changeAcceptSchema.extend({
  id: z.uuid(),
  decision: z.literal('accepted'),
  source: z.literal('human'),
  actor: z.string().max(512),
  at: z.number().int().nonnegative(),
})
export const changeDecisionsSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  baselineReference: reference,
  finalReference: reference,
  outcome: changeRoundSchema.shape.outcome,
  total: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  files: z
    .array(
      z.strictObject({
        fileId: changeDiffQuerySchema.shape.fileId,
        accepted: changeDecisionSchema.nullable(),
        rollbackId: z.uuid().nullable(),
      }),
    )
    .max(4096),
})
export type ChangeAccept = z.infer<typeof changeAcceptSchema>
