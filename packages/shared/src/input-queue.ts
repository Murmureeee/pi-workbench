import { z } from 'zod'

import { queueRecordSchema } from './history-contracts.js'

export const inputQueueCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('enqueue'),
    id: z.uuid(),
    kind: z.enum(['steer', 'follow-up']),
    text: z.string().trim().min(1).max(16000),
    turnId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal('edit'),
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(16000),
  }),
  z.strictObject({
    action: z.literal('cancel'),
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    action: z.literal('resume'),
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
  }),
])
export const inputQueueSchema = z.strictObject({
  sessionId: z.uuid(),
  activeTurnId: z.uuid().nullable(),
  records: z.array(queueRecordSchema).max(256),
})
export type InputQueueCommand = z.infer<typeof inputQueueCommandSchema>
export type InputQueueRecord = z.infer<typeof queueRecordSchema>
