import { z } from 'zod'

const auditKindSchema = z.enum([
  'approval',
  'session-grant',
  'resource-trust',
  'client-access',
  'rollback',
  'change-review',
  'user-file-save',
])
export const auditEntrySchema = z.strictObject({
  sequence: z.number().int().positive(),
  id: z.uuid(),
  kind: auditKindSchema,
  objectId: z.string().min(1).max(512),
  sessionId: z.uuid().nullable(),
  source: z.enum(['human', 'host', 'synthetic-fixture']),
  actor: z.string().max(512).nullable(),
  risk: z.enum(['L0', 'L1', 'L2', 'L3', 'unknown']),
  decision: z.string().min(1).max(128),
  scope: z.string().max(131072),
  reason: z.string().max(8192),
  at: z.number().int().nonnegative(),
})
export const auditQuerySchema = z.strictObject({
  kind: auditKindSchema.optional(),
  sessionId: z.uuid().optional(),
  snapshot: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
})
export const auditPageSchema = z.strictObject({
  entries: z.array(auditEntrySchema).max(50),
  snapshot: z.number().int().nonnegative(),
  nextBefore: z.number().int().positive().nullable(),
  checkedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  warning: z.string().nullable(),
  retention: z.literal('originals-retained-no-delete-api'),
  exportScope: z.literal('filtered-page-max-50'),
})
export const auditExportSchema = z.strictObject({
  format: z.literal('piw-audit-v1'),
  exportedAt: z.number().int().nonnegative(),
  redacted: z.literal(true),
  query: auditQuerySchema,
  page: auditPageSchema,
})
export type AuditEntry = z.infer<typeof auditEntrySchema>
export type AuditKind = z.infer<typeof auditKindSchema>
export type AuditQuery = z.infer<typeof auditQuerySchema>
export type AuditPage = z.infer<typeof auditPageSchema>
