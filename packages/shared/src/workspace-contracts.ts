import { z } from 'zod'

const path = z.string().min(1).max(4096)
const workspaceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(4096),
  canonicalPath: path,
})
export const workspaceOpenSchema = z.strictObject({ path })
export const workspaceValidateSchema = z.strictObject({ id: z.uuid() })
/** Display names count Unicode code points. They never rename a filesystem directory. */
export const workspaceNameSchema = z
  .string()
  .trim()
  .refine((value) => {
    const length = Array.from(value).length
    return length >= 1 && length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(value)
  }, '请输入 1–80 个 Unicode 字符，不含控制字符。')
const revision = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1)
export const workspaceRecordSchema = workspaceSchema.extend({
  defaultName: z.string().min(1).max(4096),
  customName: workspaceNameSchema.nullable(),
  lastOpenedAt: z.number().int().nonnegative().nullable(),
  revision,
})
export const workspaceRecentSchema = z.strictObject({
  entries: z
    .array(workspaceRecordSchema.extend({ lastOpenedAt: z.number().int().nonnegative() }))
    .max(100),
  total: z.number().int().nonnegative(),
  limit: z.literal(100),
  order: z.literal('last-opened-desc-id-asc'),
})
export const workspaceEditSchema = z.strictObject({ id: z.uuid(), expectedRevision: revision })
export const workspaceRenameSchema = workspaceEditSchema.extend({
  name: workspaceNameSchema.nullable(),
})
export const workspaceRelocateSchema = workspaceEditSchema.extend({ path })
const workspaceFailureSchema = z.strictObject({
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
    'invalid_name',
    'conflict',
    'relocation_required',
  ]),
  message: z.string().min(1).max(2048),
  recovery: z.string().min(1).max(2048),
})
export const workspaceResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), workspace: workspaceSchema, reused: z.boolean() }),
  workspaceFailureSchema,
])
export const workspaceMetadataResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), record: workspaceRecordSchema }),
  workspaceFailureSchema.extend({ current: workspaceRecordSchema.nullable() }),
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
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>
export type WorkspaceRecent = z.infer<typeof workspaceRecentSchema>
export type WorkspaceRename = z.infer<typeof workspaceRenameSchema>
export type WorkspaceEdit = z.infer<typeof workspaceEditSchema>
export type WorkspaceRelocate = z.infer<typeof workspaceRelocateSchema>
export type WorkspaceMetadataResult = z.infer<typeof workspaceMetadataResultSchema>
