import { z } from 'zod'

import { gitEnvironmentSchema, workspaceEnvironmentTargetSchema } from './workspace-environment.js'

const fields = { directory: z.uuid().optional(), cursor: z.uuid().optional() }
export const fileListQuerySchema = z.union([
  z.strictObject({ workspaceId: z.uuid(), ...fields }),
  z.strictObject({ sessionId: z.uuid(), ...fields }),
])
export const fileSearchQuerySchema = z.union([
  z.strictObject({ workspaceId: z.uuid(), query: z.string().trim().min(1).max(160) }),
  z.strictObject({ sessionId: z.uuid(), query: z.string().trim().min(1).max(160) }),
])
export const fileLocateQuerySchema = z.union([
  z.strictObject({ workspaceId: z.uuid(), file: z.uuid() }),
  z.strictObject({ sessionId: z.uuid(), file: z.uuid() }),
])
/** Opaque, expiring host handles bind the unredacted path and physical target. Display
 * strings are never submitted as authority. A listed name does not grant file access. */
export const fileNodeSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'directory', 'link', 'other']),
  availability: z.enum(['available', 'inaccessible', 'private', 'invalid', 'link', 'unsupported']),
  ignored: z.enum(['yes', 'no', 'unknown']),
  scanSkipped: z.boolean(),
  reason: z.string().nullable(),
  size: z.number().nonnegative().nullable(),
})
const scope = {
  target: workspaceEnvironmentTargetSchema,
  root: z.string(),
  git: gitEnvironmentSchema,
  additionalRoots: z.literal(0),
  checkedAt: z.number().int().nonnegative(),
}
export const fileListingSchema = z.strictObject({
  ...scope,
  directory: fileNodeSchema,
  parent: fileNodeSchema.nullable(),
  entries: z.array(fileNodeSchema).max(100),
  cursor: z.uuid().nullable(),
  complete: z.boolean(),
  diagnostic: z.string().nullable(),
  order: z.literal('filesystem'),
})
export const fileSearchSchema = z.strictObject({
  ...scope,
  query: z.string(),
  entries: z.array(fileNodeSchema).max(100),
  visited: z.number().int().min(0).max(5000),
  complete: z.boolean(),
  diagnostic: z.string().nullable(),
})
export const fileLocationSchema = z.strictObject({
  ...scope,
  file: fileNodeSchema,
  absolutePath: z.string(),
  directory: fileNodeSchema,
})
export type FileNode = z.infer<typeof fileNodeSchema>
export type FileListing = z.infer<typeof fileListingSchema>
export type FileSearch = z.infer<typeof fileSearchSchema>
export type FileLocation = z.infer<typeof fileLocationSchema>

const readSource = z.union([
  z.strictObject({ file: z.uuid() }),
  z.strictObject({ path: z.string().min(1).max(4096) }),
])
export const fileReadInputSchema = z.strictObject({
  target: workspaceEnvironmentTargetSchema,
  source: readSource,
  version: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})
export const fileReadQuerySchema = z.union([
  z.strictObject({
    workspaceId: z.uuid(),
    file: z.uuid(),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    sessionId: z.uuid(),
    file: z.uuid(),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    workspaceId: z.uuid(),
    path: z.string().min(1).max(4096),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    sessionId: z.uuid(),
    path: z.string().min(1).max(4096),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
])
/** Content is a checked, redacted reading snapshot, never the historical Diff or a file
 * write capability. A changed/unsupported result carries no stale content. */
export const fileReadingSchema = z.strictObject({
  target: workspaceEnvironmentTargetSchema,
  path: z.string(),
  absolutePath: z.string(),
  checkedAt: z.number().int().nonnegative(),
  version: z.string().nullable(),
  status: z.enum(['ready', 'changed', 'binary', 'encoding', 'too_large', 'redacted_lines']),
  diagnostic: z.string(),
  lines: z.array(z.string()).max(10000),
  bytes: z.number().nonnegative(),
})
export type FileReadInput = z.infer<typeof fileReadInputSchema>
export type FileReading = z.infer<typeof fileReadingSchema>

/** Recognize only explicit local Markdown destinations. They remain untrusted hints
 * for the daemon's current root; never hand them to browser/system navigation. */
export function fileLink(value: string): { path: string; line: number } | null {
  if (/[\p{Cc}\p{Cf}]/u.test(value) || value.length > 4200) {
    return null
  }
  let path = value
  try {
    if (/^file:\/\//i.test(path)) {
      const url = new URL(path)
      if (url.host || url.search || url.username || url.password) {
        return null
      }
      path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, '$1') + url.hash
    } else {
      path = decodeURIComponent(path)
    }
  } catch {
    return null
  }
  const match = /(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?::\d+)?)$/.exec(path)
  const line = Number(match?.[1] ?? match?.[2] ?? 1)
  if (match) {
    path = path.slice(0, match.index)
  }
  if (
    !Number.isSafeInteger(line) ||
    line < 1 ||
    line > 10000 ||
    /[\p{Cc}\p{Cf}?#]/u.test(path) ||
    /^(?:\\\\|\/\/)/.test(path) ||
    /^[A-Za-z][\w+.-]*:/.test(path.replace(/^[A-Za-z]:[\\/]/, '')) ||
    !/(?:[\\/]|\.[\p{L}\d]{1,12}$)/u.test(path)
  ) {
    return null
  }
  return { path, line }
}
