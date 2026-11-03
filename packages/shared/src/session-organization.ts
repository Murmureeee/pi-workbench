import { z } from 'zod'

/** Shared personal library state. Result/read cursors identify displayed terminal results,
 * never SDK offsets, task authority, credentials, or restored permission. */
export const sessionOrganizationSchema = z.strictObject({
  sessionId: z.uuid(),
  pinned: z.boolean(),
  archived: z.boolean(),
  manualUnread: z.boolean(),
  unread: z.boolean(),
  resultVersion: z.number().int().nonnegative(),
  readVersion: z.number().int().nonnegative(),
  resultRequestId: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
export const sessionOrganizationListSchema = z.strictObject({
  organizations: z.array(sessionOrganizationSchema),
})
const expected = { expectedRevision: z.number().int().nonnegative() }
export const sessionOrganizeSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...expected, action: z.literal('pin'), pinned: z.boolean() }),
  z.strictObject({ ...expected, action: z.literal('unread') }),
  z.strictObject({
    ...expected,
    action: z.literal('read'),
    throughVersion: z.number().int().nonnegative(),
  }),
  z.strictObject({ ...expected, action: z.literal('archive'), archived: z.boolean() }),
])
export type SessionOrganization = z.infer<typeof sessionOrganizationSchema>
export type SessionOrganize = z.infer<typeof sessionOrganizeSchema>
