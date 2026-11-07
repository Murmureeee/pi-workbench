import { z } from 'zod'

import { changeSourceSchema, changeSourcesQuerySchema } from './change-provenance.js'

const reference = z.string().regex(/^[a-f0-9]{40}$/)
const fileId = z.string().regex(/^[a-f0-9]{64}$/)
const changeFileSchema = z.strictObject({
  id: fileId,
  path: z.string(),
  previousPath: z.string().nullable(),
  kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
  binary: z.boolean(),
  beforeBytes: z.number().int().nonnegative(),
  afterBytes: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  source: changeSourceSchema.shape.source,
  reasons: z.array(z.string()).max(8),
  tools: changeSourceSchema.shape.tools,
  automaticRollback: z.literal(false),
})
export const changeReviewQuerySchema = changeSourcesQuerySchema
export const changeDiffQuerySchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  fileId,
})
export const changeReviewSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  baselineReference: reference.nullable(),
  finalReference: reference.nullable(),
  available: z.boolean(),
  diagnostic: z.string().nullable(),
  files: z.array(changeFileSchema).max(100),
  total: z.number().int().nonnegative(),
  next: z.number().int().nonnegative().nullable(),
  automaticRollback: z.literal(false),
})
const diffLine = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['context', 'add', 'delete', 'note']),
  text: z.string(),
  oldLine: z.number().int().nonnegative().nullable(),
  newLine: z.number().int().nonnegative().nullable(),
})
export const changeDiffSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  fileId,
  baselineReference: reference,
  finalReference: reference,
  file: changeFileSchema,
  diagnostic: z.string().nullable(),
  hunks: z
    .array(z.strictObject({ header: z.string(), lines: z.array(diffLine).max(8000) }))
    .max(2000),
  redacted: z.literal(true),
  automaticRollback: z.literal(false),
})
export type ChangeFile = z.infer<typeof changeFileSchema>
export type ChangeDiff = z.infer<typeof changeDiffSchema>
