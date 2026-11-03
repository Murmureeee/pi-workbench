import { z } from 'zod'

/** Count Unicode code points, rather than UTF-16 units. Trimming is the only normalization. */
export const sessionRenameSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .refine((value) => {
      const length = Array.from(value).length
      return length >= 1 && length <= 80
    }, '请输入 1–80 个 Unicode 字符。'),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
})
export const sessionTitleSchema = z.strictObject({
  sessionId: z.uuid(),
  title: z.string(),
  titleSource: z.enum(['local', 'user']),
  titleVersion: z.number().int().positive(),
})
export const sessionTitleListSchema = z.strictObject({ titles: z.array(sessionTitleSchema) })
/** Metadata uses a separate subscription; it never consumes runtime epoch/turn/seq cursors.
 * Every acknowledgement requires a fresh index read, including after reconnection. */
export const sessionTitleSubscribeSchema = z.strictObject({
  type: z.literal('subscribe-titles'),
  protocolVersion: z.literal(1),
})
export const sessionTitleFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('titles-subscribed'), daemonId: z.uuid() }),
  z.strictObject({
    type: z.literal('title.updated'),
    daemonId: z.uuid(),
    title: sessionTitleSchema,
  }),
])
export type SessionRename = z.infer<typeof sessionRenameSchema>
export type SessionTitle = z.infer<typeof sessionTitleSchema>
export type SessionTitleFrame = z.infer<typeof sessionTitleFrameSchema>
