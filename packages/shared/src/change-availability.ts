import { z } from 'zod'

const digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable()
const reference = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .nullable()
export const changeAvailabilitySchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  checkedAt: z.number().int().nonnegative(),
  baselineReference: reference,
  finalReference: reference,
  diagnostic: z.string().nullable(),
  owner: z.strictObject({ sessionId: z.uuid(), turnId: z.uuid() }).nullable(),
  laterTruncated: z.boolean(),
  files: z
    .array(
      z.strictObject({
        fileId: z.string().regex(/^[a-f0-9]{64}$/),
        path: z.string(),
        state: z.enum(['matches-final', 'at-baseline', 'changed', 'unavailable']),
        requiresExternalConfirmation: z.boolean(),
        diagnostic: z.string().nullable(),
        versions: z
          .array(
            z.strictObject({ path: z.string(), baseline: digest, final: digest, current: digest }),
          )
          .max(2),
        later: z
          .array(
            z.strictObject({
              sessionId: z.uuid(),
              turnId: z.uuid(),
              baselineReference: reference,
              finalReference: reference,
              relation: z.enum(['changed-path', 'unavailable']),
            }),
          )
          .max(20),
      }),
    )
    .max(100),
  total: z.number().int().nonnegative(),
  next: z.number().int().nonnegative().nullable(),
})
