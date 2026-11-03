import { z } from 'zod'

export const sessionSearchStates = [
  'all',
  'running',
  'approval',
  'held',
  'completed',
  'failed',
  'aborted',
  'interrupted',
  'idle',
] as const
export const sessionSearchQuerySchema = z
  .strictObject({
    q: z
      .string()
      .trim()
      .refine((value) => Array.from(value).length <= 160)
      .default(''),
    project: z.union([z.literal('all'), z.literal('none'), z.uuid()]).default('all'),
    state: z.enum(sessionSearchStates).default('all'),
    archive: z.enum(['active', 'all', 'archived']).default('active'),
    from: z.coerce.number().int().nonnegative().optional(),
    to: z.coerce.number().int().nonnegative().optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to)
export const sessionSearchResultSchema = z.strictObject({
  sessionId: z.uuid(),
  title: z.string(),
  projectId: z.uuid().nullable(),
  projectName: z.string(),
  projectDirectory: z.string().nullable(),
  updatedAt: z.number().int().nonnegative(),
  state: z.enum(sessionSearchStates).exclude(['all']),
  archived: z.boolean(),
  match: z.enum(['title', 'user', 'assistant', 'recent']),
  messageId: z.string().nullable(),
  snippet: z.string(),
})
export const sessionSearchPageSchema = z.strictObject({
  results: z.array(sessionSearchResultSchema).max(50),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  incompleteSessions: z.number().int().nonnegative(),
})
export type SessionSearchQuery = z.infer<typeof sessionSearchQuerySchema>
export type SessionSearchResult = z.infer<typeof sessionSearchResultSchema>
export type SessionSearchPage = z.infer<typeof sessionSearchPageSchema>
