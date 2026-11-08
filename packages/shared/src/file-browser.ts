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
