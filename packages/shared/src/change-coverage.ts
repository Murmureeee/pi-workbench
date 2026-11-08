import { z } from 'zod'

/** Initial host limits, not user configuration or executable permission. Retention keeps
 * every published reference; reaching capacity never authorizes deletion or collection. */
export const fileLedgerPolicy = {
  fileBytes: 5 * 1024 * 1024,
  snapshotBytes: 32 * 1024 * 1024,
  entries: 2048,
  depth: 8,
  capacityBytes: 512 * 1024 * 1024,
  warningRatio: 0.8,
} as const

export const ledgerCapacitySchema = z.strictObject({
  state: z.enum(['normal', 'warning', 'full', 'unavailable']),
  usedBytes: z.number().int().nonnegative().nullable(),
  limitBytes: z.number().int().positive(),
  warningBytes: z.number().int().positive(),
  measurement: z.literal('git-object-kib'),
  automaticCleanup: z.literal(false),
  retention: z.literal('keep-all-published'),
  diagnostic: z.string().nullable(),
})

export const changeCoverageSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  checkedAt: z.number().int().nonnegative(),
  basis: z.enum(['baseline', 'round']),
  state: z.enum(['full', 'partial', 'none']),
  rollbackAvailable: z.boolean(),
  files: z.number().int().nonnegative(),
  reasons: z.array(z.string()).max(12),
  exclusions: z.array(z.strictObject({ path: z.string(), reason: z.string() })).max(64),
  baselineExcluded: z.number().int().nonnegative(),
  finalExcluded: z.number().int().nonnegative(),
  limits: z.strictObject({
    fileBytes: z.number().int().positive(),
    snapshotBytes: z.number().int().positive(),
    entries: z.number().int().positive(),
    depth: z.number().int().positive(),
  }),
  storage: ledgerCapacitySchema,
})
export type ChangeCoverage = z.infer<typeof changeCoverageSchema>
export type LedgerCapacity = z.infer<typeof ledgerCapacitySchema>
