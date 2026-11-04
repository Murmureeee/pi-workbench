import { z } from 'zod'

import { trustResourceSchema } from './trust-contracts.js'

/** Organization never carries a cwd or a permission grant. Versions reject lost updates,
 * including moving away and back while an older dialog remains open. */
export const sessionProjectSchema = z.strictObject({
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  project: z.strictObject({ id: z.uuid(), revision: z.number().int().positive() }).nullable(),
})
export const sessionOriginSchema = z.strictObject({
  sessionId: z.uuid(),
  kind: z.enum(['standalone', 'workspace']),
  cwd: z.string(),
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  recordedAt: z.number(),
  provenance: z.enum(['created', 'legacy-observed']),
})
export const sessionSpaceSchema = z.strictObject({
  sessionId: z.uuid(),
  cwd: z.string(),
  workspaceId: z.uuid(),
  standalone: z.boolean(),
  projectId: z.uuid().nullable(),
  membershipVersion: z.number().int().positive(),
  origin: sessionOriginSchema,
  policy: z.literal('host-tools-disabled'),
  realProviderEnabled: z.literal(false),
  activeContextCount: z.number().int().nonnegative(),
  resources: z
    .array(
      trustResourceSchema.omit({ project: true, preview: true, impact: true }).extend({
        enabledNextTurn: z.boolean(),
        loadedNow: z.boolean(),
      }),
    )
    .max(256),
  diagnostics: z.array(z.string()),
})
export type SessionProject = z.infer<typeof sessionProjectSchema>
export type SessionSpace = z.infer<typeof sessionSpaceSchema>
