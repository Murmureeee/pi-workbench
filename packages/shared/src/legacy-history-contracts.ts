import { z } from 'zod'

const diagnostic = z.strictObject({
  code: z.string(),
  message: z.string(),
  line: z.number().int().nonnegative(),
})
const legacySourceSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string(),
  nativeId: z.string().nullable(),
  cwd: z.string().nullable(),
  timestamp: z.string().nullable(),
  modifiedAt: z.number(),
  readOnly: z.literal(true),
  diagnostic: z.string().nullable(),
})
export const legacyCatalogSchema = z.strictObject({
  source: z.literal('external-pi-jsonl'),
  root: z.string().nullable(),
  enabled: z.boolean(),
  sessions: z.array(legacySourceSchema).max(200),
  diagnostics: z.array(diagnostic),
})
export const legacyPageSchema = z.strictObject({
  source: z.literal('external-pi-jsonl'),
  session: legacySourceSchema,
  version: z.string().regex(/^[a-f0-9]{64}$/),
  messages: z
    .array(
      z.strictObject({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'toolResult']),
        text: z.string(),
        bytes: z.number().int().nonnegative(),
        truncated: z.boolean(),
        incomplete: z.boolean(),
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
  diagnostics: z.array(diagnostic),
  canResume: z.literal(false),
})
export const legacyReadSchema = z.strictObject({
  version: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  cursor: z.string().min(1).max(512).optional(),
})
export type LegacySource = z.infer<typeof legacySourceSchema>
