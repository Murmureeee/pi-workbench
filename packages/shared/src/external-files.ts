import { z } from 'zod'

import { fileReadInputSchema } from './file-browser.js'

export const ideAdapterSchema = z.enum(['vscode', 'jetbrains', 'path'])
export const externalFileInputSchema = z.strictObject({
  ...fileReadInputSchema.shape,
  action: z.enum(['ide', 'reveal', 'system']),
  line: z.number().int().min(1).max(10000).default(1),
})
export const externalFileRequestSchema = z.strictObject({
  id: z.uuid(),
  input: externalFileInputSchema,
})
export const editorCommandSchema = z.strictObject({
  id: z.uuid(),
  adapter: z.union([ideAdapterSchema, z.literal('auto')]),
})
export const externalResultSchema = z.strictObject({
  status: z.enum(['requested', 'saved', 'cancelled', 'failed']),
  message: z.string().max(2000),
})
export const editorStatusSchema = z.strictObject({
  state: z.enum(['ready', 'missing', 'invalid']),
  source: z.enum(['automatic', 'selected']),
  adapter: ideAdapterSchema,
  label: z.string(),
  diagnostic: z.string(),
})
export const editorPreferenceSchema = z.strictObject({
  version: z.literal(1),
  path: z.string().min(1).max(4096),
  stamp: z.string().min(1).max(512),
  adapter: ideAdapterSchema,
})

/** Private parent/desktop IPC only. The unredacted physical proof and host cookie must
 * never be forwarded to renderer, HTTP, persisted audit or diagnostic output. */
export const hostFileRequestSchema = z.strictObject({
  type: z.literal('host-file-target'),
  id: z.uuid(),
  cookie: z.string().regex(/^piw_client_\d+=[a-f0-9]{64}$/),
  input: externalFileInputSchema,
})
export const externalTargetSchema = z.strictObject({
  root: z.string().min(1).max(4096),
  path: z.string().max(4096),
  chain: z.string().min(1).max(32768),
  stamp: z.string().min(1).max(512),
  kind: z.enum(['file', 'directory']),
  action: externalFileInputSchema.shape.action,
  line: externalFileInputSchema.shape.line,
  expiresAt: z.number().int().positive(),
})
export const hostFileResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    type: z.literal('host-file-result'),
    id: z.uuid(),
    ok: z.literal(true),
    target: externalTargetSchema,
  }),
  z.strictObject({
    type: z.literal('host-file-result'),
    id: z.uuid(),
    ok: z.literal(false),
    message: z.string().max(2000),
  }),
])

/** Deliberately narrow system association opening. Executables, scripts, shortcuts,
 * active web documents and unknown extensions require an explicit editor choice. */
export function systemOpenAllowed(path: string): boolean {
  return /\.(?:txt|md|log|pdf|png|jpe?g|gif|webp|bmp)$/i.test(path)
}
export type IdeAdapter = z.infer<typeof ideAdapterSchema>
export type ExternalFileInput = z.infer<typeof externalFileInputSchema>
export type ExternalTarget = z.infer<typeof externalTargetSchema>
export type ExternalResult = z.infer<typeof externalResultSchema>
export type EditorStatus = z.infer<typeof editorStatusSchema>
export type HostFileResult = z.infer<typeof hostFileResultSchema>
