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
  kind: z.enum(['html', 'text', 'png', 'jpeg', 'pdf']),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(8 * 1024 * 1024),
  content: z.string().max(11184812),
})
/** Only the authenticated parent IPC carries bytes. No preview URL, cookie, file
 * resolver or arbitrary execution option is exposed to the workbench renderer. */
export const hostPreviewRequestSchema = z.strictObject({
  type: z.literal('host-preview'),
  ...previewRequestSchema.shape,
  cookie: z.string().regex(/^piw_client_\d+=[a-f0-9]{64}$/),
  checkOnly: z.literal(true).optional(),
})
export const hostPreviewResultSchema = z.union([
  z.strictObject({
    type: z.literal('host-preview-result'),
    id: z.uuid(),
    ok: z.literal(true),
    snapshot: previewSnapshotSchema,
  }),
  z.strictObject({
    type: z.literal('host-preview-result'),
    id: z.uuid(),
    ok: z.literal(true),
    verification: z.strictObject({
      version: previewSnapshotSchema.shape.version,
      checkedAt: previewSnapshotSchema.shape.checkedAt,
    }),
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

/** Fixed native PDF helper output, private host transport only. */
export const previewRasterResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), pages: z.array(z.string().max(22369624)).min(1).max(12) }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(['decode', 'pages', 'render_limit']) }),
])

/** Explicit local preview allowlist; no MIME sniffing into an active document type. */
export function previewKind(path: string): PreviewSnapshot['kind'] | null {
  if (/\.html?$/i.test(path)) {
    return 'html'
  }
  if (/\.(?:txt|md|json|csv|log)$/i.test(path)) {
    return 'text'
  }
  if (/\.png$/i.test(path)) {
    return 'png'
  }
  if (/\.jpe?g$/i.test(path)) {
    return 'jpeg'
  }
  if (/\.pdf$/i.test(path)) {
    return 'pdf'
  }
  return null
}
