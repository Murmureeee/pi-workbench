import { z } from 'zod'

import { gitEnvironmentSchema, workspaceEnvironmentTargetSchema } from './workspace-environment.js'

/** Current Git state and byte evidence are independent. Neither assigns human authorship,
 * grants execution rights, nor replaces an immutable historical Diff. */
export const gitStatusSchema = z.strictObject({
  target: workspaceEnvironmentTargetSchema,
  cwd: z.string(),
  checkedAt: z.number().int().nonnegative(),
  state: z.enum(['ready', 'not_repository', 'unavailable']),
  git: gitEnvironmentSchema,
  diagnostic: z.string().nullable(),
  complete: z.boolean(),
  limit: z.literal(500),
  entries: z
    .array(
      z.strictObject({
        path: z.string(),
        previousPath: z.string().nullable(),
        index: z.string().length(1),
        worktree: z.string().length(1),
        untracked: z.boolean(),
        conflict: z.boolean(),
        source: z.enum(['baseline-retained', 'tool-observed', 'mixed', 'unknown']),
        baselinePresent: z.boolean().nullable(),
        baselineDiffersFromGit: z.boolean().nullable(),
        turnId: z.uuid().nullable(),
        reason: z.string(),
      }),
    )
    .max(500),
})
export type GitStatus = z.infer<typeof gitStatusSchema>
