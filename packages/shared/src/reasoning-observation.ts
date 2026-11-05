import type { Redactor } from './redaction.js'

import { z } from 'zod'

const limit = 65536
/** Only explicitly public SDK text crosses the observation boundary. Signatures and encrypted
 * continuity payloads are deliberately absent; unavailable states cannot carry any text. */
export const reasoningSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('provided'),
    text: z.string().min(1).max(limit),
    truncated: z.boolean(),
  }),
  z.strictObject({ status: z.enum(['not-provided', 'unsupported', 'unavailable']) }),
])
export type Reasoning = z.infer<typeof reasoningSchema>

/** Reads completed SDK content only, never speculative deltas. A filtered block withholds the
 * whole message, including mixed public/filtered parts. Unknown shapes grant no display rights. */
export function publicReasoning(content: unknown, supported?: boolean): Reasoning {
  if (!Array.isArray(content)) {
    return { status: supported === false ? 'unsupported' : 'not-provided' }
  }
  const blocks = content.filter(
    (part: unknown) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      typeof part.type === 'string' &&
      /thinking|reasoning/i.test(part.type),
  )
  const parsed = blocks.map((block: unknown) =>
    z
      .object({
        type: z.literal('thinking'),
        thinking: z.string(),
        redacted: z.boolean().optional(),
      })
      .safeParse(block),
  )
  if (parsed.some((part) => !part.success || part.data.redacted)) {
    return { status: 'unavailable' }
  }
  const text = parsed.flatMap((part) => (part.success ? [part.data.thinking] : [])).join('\n\n')
  return text
    ? { status: 'provided', text: text.slice(0, limit), truncated: text.length > limit }
    : {
        status: blocks.length
          ? 'not-provided'
          : supported === false
            ? 'unsupported'
            : 'not-provided',
      }
}

/** Aggregates a turn's completed assistant messages without weakening filtered output rights. */
export function mergeReasoning(previous: Reasoning | undefined, incoming: Reasoning): Reasoning {
  if (previous?.status === 'unavailable' || incoming.status === 'unavailable') {
    return { status: 'unavailable' }
  }
  if (incoming.status !== 'provided') {
    return previous ?? incoming
  }
  if (previous?.status !== 'provided') {
    return incoming
  }
  const text = previous.text + '\n\n' + incoming.text
  return {
    status: 'provided',
    text: text.slice(0, limit),
    truncated: previous.truncated || incoming.truncated || text.length > limit,
  }
}

/** Public full replacements use cumulative redaction, also withholding incomplete secret suffixes. */
export function visibleReasoning(value: Reasoning, redactor: Redactor): Reasoning {
  if (value.status !== 'provided') {
    return value
  }
  const text = redactor.text(value.text, true)
  return text ? { ...value, text } : { status: 'not-provided' }
}
