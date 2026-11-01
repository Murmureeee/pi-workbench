import { z } from 'zod'

export const historyPageSize = 100
export const historyPreviewBytes = 64 * 1024
export const turnBindingSchema = z.strictObject({
  version: z.literal(1),
  sessionId: z.uuid(),
  epoch: z.uuid(),
  turnId: z.uuid(),
  messageId: z.string().min(1),
})
const identity = {
  id: z.uuid(),
  sessionId: z.uuid(),
  epoch: z.uuid(),
  turnId: z.uuid(),
  source: z.enum(['workbench', 'synthetic-fixture']),
}
export const queueRecordSchema = z.strictObject({
  ...identity,
  kind: z.enum(['steer', 'follow-up']),
  position: z.number().int().nonnegative(),
  text: z.string(),
  status: z.enum(['queued', 'held', 'delivered', 'cancelled']),
})
export const approvalRecordSchema = z.strictObject({
  ...identity,
  decision: z.enum(['pending', 'allowed', 'denied', 'cancelled', 'invalidated']),
  parameters: z.record(z.string(), z.unknown()),
  reason: z.string(),
})
export const changeReferenceSchema = z.strictObject({
  ...identity,
  reference: z.string().min(1),
})
export const historyMessageSchema = z.strictObject({
  id: z.string(),
  epoch: z.uuid(),
  nativeEntryId: z.string(),
  turnId: z.uuid().nullable(),
  role: z.enum(['user', 'assistant', 'toolResult']),
  text: z.string(),
  bytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  origin: z.enum(['sdk-jsonl', 'interrupted-checkpoint']),
  outcome: z.string().nullable(),
  error: z.string().nullable(),
})
export const historyDiagnosticSchema = z.strictObject({
  id: z.string(),
  source: z.enum(['sdk-jsonl', 'inflight', 'index']),
  code: z.string(),
  message: z.string(),
  line: z.number().int().nonnegative(),
  exportable: z.boolean(),
})
export const historyPageSchema = z.strictObject({
  sessionId: z.uuid(),
  source: z.enum(['real-sdk/local-fixture', 'synthetic-ipc-fixture']),
  messages: z.array(historyMessageSchema).max(historyPageSize),
  nextCursor: z.string().nullable(),
  diagnostics: z.array(historyDiagnosticSchema),
  queue: z.array(queueRecordSchema),
  approvals: z.array(approvalRecordSchema.extend({ executable: z.literal(false) })),
  changes: z.array(changeReferenceSchema),
  canResume: z.literal(false),
})
export type HistoryPage = z.infer<typeof historyPageSchema>
export type HistoryMessage = z.infer<typeof historyMessageSchema>
export type HistoryDiagnostic = z.infer<typeof historyDiagnosticSchema>
export type TurnBinding = z.infer<typeof turnBindingSchema>
