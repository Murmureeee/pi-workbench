import { z } from 'zod'

const path = z.string().min(1).max(4096)
const workspaceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(4096),
  canonicalPath: path,
})
export const workspaceOpenSchema = z.strictObject({ path })
export const workspaceValidateSchema = z.strictObject({ id: z.uuid() })
export const workspaceResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), workspace: workspaceSchema, reused: z.boolean() }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum([
      'invalid_path',
      'not_found',
      'not_directory',
      'not_readable',
      'not_writable',
      'directory_changed',
      'unknown_workspace',
      'storage_failed',
      'cleanup_failed',
      'unavailable',
    ]),
    message: z.string().min(1).max(2048),
    recovery: z.string().min(1).max(2048),
  }),
])
/** The sandboxed preload exposes only an explicit native directory picker, never arbitrary IPC. */
export const directorySelectionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('selected'), path }),
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({ status: z.literal('unavailable') }),
])
export type Workspace = z.infer<typeof workspaceSchema>
export type WorkspaceResult = z.infer<typeof workspaceResultSchema>
export type DirectorySelection = z.infer<typeof directorySelectionSchema>
