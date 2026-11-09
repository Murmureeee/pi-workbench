import { z } from 'zod'

const objectId = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u)
export const messageTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('message'), messageId: objectId }),
  z.strictObject({
    kind: z.literal('turn'),
    turnId: z.uuid(),
    role: z.enum(['user', 'assistant']),
  }),
  z.strictObject({ kind: z.literal('tool'), turnId: z.uuid(), toolId: objectId }),
])
export const messageLocationSchema = z.strictObject({
  sessionId: z.uuid(),
  messageId: objectId,
  turnId: z.uuid().nullable(),
  toolId: objectId.nullable(),
  archived: z.boolean(),
})
export type MessageTarget = z.infer<typeof messageTargetSchema>
export type MessageLocation = z.infer<typeof messageLocationSchema>

/** Portable, origin-free links contain only persisted identities, never content, paths,
 * pairing credentials or execution permissions. Resolution always rechecks the daemon. */
export function messageLink(location: MessageLocation): string {
  const params = new URLSearchParams({ session: location.sessionId, message: location.messageId })
  if (location.toolId && location.turnId) {
    params.set('turn', location.turnId)
    params.set('tool', location.toolId)
  }
  return `/?${params}`
}

/** Only same-origin root navigation with an exact known set of object keys is actionable.
 * Model-produced links cannot smuggle settings, host changes or privileged protocols. */
export function parseMessageLink(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin || url.pathname !== '/' || url.hash || url.username || url.password) {
      return null
    }
    const params = url.searchParams
    if (
      [...params.keys()].some((key) => !['session', 'message', 'turn', 'tool'].includes(key)) ||
      [...new Set(params.keys())].some((key) => params.getAll(key).length !== 1) ||
      !z.uuid().safeParse(params.get('session')).success
    ) {
      return null
    }
    const message = params.get('message'),
      turn = params.get('turn'),
      tool = params.get('tool')
    if (
      (message !== null && !objectId.safeParse(message).success) ||
      (turn !== null && !z.uuid().safeParse(turn).success) ||
      (tool !== null && (!objectId.safeParse(tool).success || !turn || !message)) ||
      (turn !== null && !tool)
    ) {
      return null
    }
    return `/${url.search}`
  } catch {
    return null
  }
}
