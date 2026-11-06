import { z } from 'zod'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
export const modelTokensSchema = z.strictObject({
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
  total: count,
})
export const modelUsageRecordSchema = z.strictObject({
  messageId: z.string(),
  epoch: z.uuid(),
  turnId: z.uuid().nullable(),
  provider: z.string().max(200).nullable(),
  model: z.string().max(200).nullable(),
  at: z.number().finite().nullable(),
  tokens: modelTokensSchema,
  contextWindow: count,
})
const sumSchema = z.strictObject({
  known: z.number().nonnegative(),
  unknown: z.number().int().nonnegative(),
})
export const sessionUsageSchema = z.strictObject({
  sessionId: z.uuid(),
  observedAt: z.number(),
  source: z.literal('sdk-jsonl'),
  totals: z.strictObject({
    input: sumSchema,
    output: sumSchema,
    cacheRead: sumSchema,
    cacheWrite: sumSchema,
    total: sumSchema,
  }),
  turns: z
    .array(
      z.strictObject({
        turnId: z.uuid(),
        status: z.string(),
        createdAt: z.number(),
        requests: z.array(modelUsageRecordSchema).max(100),
        totalRequests: z.number().int().nonnegative(),
      }),
    )
    .max(20),
  latest: modelUsageRecordSchema.nullable(),
  nextCursor: z.uuid().nullable(),
  totalTurns: z.number().int().nonnegative(),
  diagnostics: z.array(z.string()),
})
export type ModelTokens = z.infer<typeof modelTokensSchema>
export type ModelUsageRecord = z.infer<typeof modelUsageRecordSchema>
export type SessionUsage = z.infer<typeof sessionUsageSchema>

/** Positive SDK counters are verifiable record values. SDK-normalized zero cannot prove
 * a provider reported zero, so missing/zero/invalid values stay explicitly unknown. */
export function recordedTokens(value: unknown): ModelTokens {
  const raw = z.record(z.string(), z.unknown()).safeParse(value)
  const positive = (key: string) => {
    const item = raw.success ? raw.data[key] : undefined
    return typeof item === 'number' && Number.isSafeInteger(item) && item > 0 ? item : null
  }
  return {
    input: positive('input'),
    output: positive('output'),
    cacheRead: positive('cacheRead'),
    cacheWrite: positive('cacheWrite'),
    total: positive('totalTokens'),
  }
}

/** Partial sums retain unknown request counts; they are never labelled a complete bill. */
export function sumRecordedTokens(records: readonly ModelUsageRecord[]) {
  const sumField = (field: keyof ModelTokens) =>
    records.reduce(
      (sum, record) => {
        const value = record.tokens[field]
        return { known: sum.known + (value ?? 0), unknown: sum.unknown + Number(value === null) }
      },
      { known: 0, unknown: 0 },
    )
  return {
    input: sumField('input'),
    output: sumField('output'),
    cacheRead: sumField('cacheRead'),
    cacheWrite: sumField('cacheWrite'),
    total: sumField('total'),
  }
}
