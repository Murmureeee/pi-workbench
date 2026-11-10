import { z } from 'zod'

import { fileReadInputSchema } from './file-browser.js'

export const previewRequestSchema = z.strictObject({ id: z.uuid(), input: fileReadInputSchema })
export const previewSnapshotSchema = z.strictObject({
  target: fileReadInputSchema.shape.target,
  path: z.string().max(4096),
  absolutePath: z.string().max(4096),
  source: z.literal('current-disk-uncertain'),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  kind: z.literal('html'),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(256 * 1024),
  content: z.string().max(350000),
})
/** Only the authenticated parent IPC carries bytes. No preview URL, cookie, file
 * resolver or arbitrary execution option is exposed to the workbench renderer. */
export const hostPreviewRequestSchema = z.strictObject({
  type: z.literal('host-preview'),
  ...previewRequestSchema.shape,
  cookie: z.string().regex(/^piw_client_\d+=[a-f0-9]{64}$/),
})
export const hostPreviewResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    type: z.literal('host-preview-result'),
    id: z.uuid(),
    ok: z.literal(true),
    snapshot: previewSnapshotSchema,
  }),
  z.strictObject({
    type: z.literal('host-preview-result'),
    id: z.uuid(),
    ok: z.literal(false),
    message: z.string().max(2000),
  }),
])
export type PreviewSnapshot = z.infer<typeof previewSnapshotSchema>
export type HostPreviewResult = z.infer<typeof hostPreviewResultSchema>
