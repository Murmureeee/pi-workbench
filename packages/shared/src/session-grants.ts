import { z } from 'zod'

/** A redacted description, never an executable permit. Exact final parameters and physical
 * directory identity are matched by the host; no wildcard, prefix or implicit subtool grant. */
export const sessionGrantSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  tool: z.string().min(1),
  cwd: z.string().min(1),
  targetPath: z.string().nullable(),
  physicalIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  parameterDigest: z.string().regex(/^[a-f0-9]{64}$/),
  parameters: z.string().max(65536),
  policyVersion: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  actor: z.string().min(1),
})
export const sessionGrantListSchema = z.strictObject({
  grants: z.array(sessionGrantSchema).max(64),
  auditWarning: z.string().nullable(),
})
export const sessionGrantRevokeSchema = z.strictObject({
  sessionId: z.uuid(),
  grantId: z.uuid().nullable(),
})
export type SessionGrant = z.infer<typeof sessionGrantSchema>
