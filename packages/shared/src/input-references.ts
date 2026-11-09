import { z } from 'zod'

import { workspaceEnvironmentTargetSchema } from './workspace-environment.js'

export const inputReferenceSchema = z.strictObject({
  id: z.uuid(),
  draftId: z.uuid(),
  kind: z.enum(['file', 'range', 'directory', 'paste']),
  path: z.string(),
  from: z.number().int().positive().nullable(),
  to: z.number().int().positive().nullable(),
  bytes: z.number().int().nonnegative(),
  version: z.string(),
  preview: z.string(),
  createdAt: z.number(),
})
export const inputReferenceCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('paste'),
    draftId: z.uuid(),
    text: z.string().min(1).max(262144),
  }),
  z.strictObject({
    kind: z.enum(['file', 'range', 'directory']),
    draftId: z.uuid(),
    target: workspaceEnvironmentTargetSchema,
    path: z.string().min(1).max(4096),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    from: z.number().int().positive().max(10000).optional(),
    to: z.number().int().positive().max(10000).optional(),
  }),
])
export const inputReferenceSelectionSchema = z.strictObject({
  draftId: z.uuid(),
  ids: z
    .array(z.uuid())
    .min(1)
    .max(8)
    .refine((ids) => new Set(ids).size === ids.length),
})
export type InputReference = z.infer<typeof inputReferenceSchema>
export type InputReferenceCreate = z.infer<typeof inputReferenceCreateSchema>
export type InputReferenceSelection = z.infer<typeof inputReferenceSelectionSchema>
