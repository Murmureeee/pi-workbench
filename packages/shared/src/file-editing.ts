import { z } from 'zod'

import { fileReadInputSchema } from './file-browser.js'

export const fileEditOpenSchema = fileReadInputSchema.omit({ version: true })
export const fileEditSaveSchema = z.strictObject({
  editId: z.uuid(),
  text: z.string().max(262144),
  confirmationId: z.uuid().optional(),
})
/** Editing only exact, unredacted UTF-8. LF is the UI representation; daemon restores
 * the original uniform line ending and BOM. Tokens are volatile and client-bound. */
export const fileEditSnapshotSchema = z.strictObject({
  editId: z.uuid(),
  target: fileReadInputSchema.shape.target,
  path: z.string(),
  absolutePath: z.string(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string(),
  bom: z.boolean(),
  newline: z.enum(['lf', 'crlf', 'none']),
  bytes: z.number().int().nonnegative(),
  source: z.literal('current-disk'),
})
export const fileEditResultSchema = z.strictObject({
  status: z.enum(['saved', 'conflict']),
  version: z.string(),
  confirmationId: z.uuid().nullable(),
  diagnostic: z.string(),
  source: z.literal('user-external'),
})
export type FileEditSnapshot = z.infer<typeof fileEditSnapshotSchema>
export const fileEditDraftsSchema = z
  .record(
    z.string(),
    z.object({
      snapshot: fileEditSnapshotSchema,
      text: z.string().max(262144),
      uncertain: z.boolean(),
    }),
  )
  .refine((v) => Object.keys(v).length <= 4)
