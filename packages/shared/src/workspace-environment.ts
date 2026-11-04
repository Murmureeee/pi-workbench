import { z } from 'zod'

/** Only registered identities cross HTTP; renderer paths never select a Git process cwd. */
export const workspaceEnvironmentTargetSchema = z.union([
  z.strictObject({ workspaceId: z.uuid() }),
  z.strictObject({ sessionId: z.uuid() }),
])
const path = z.string().min(1).max(4096)
const commit = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
export const gitEnvironmentSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('repository'),
    root: path,
    gitDirectory: path,
    superprojectRoot: path.nullable(),
    head: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('branch'),
        name: z.string().min(1).max(1024),
        commit: commit.nullable(),
      }),
      z.strictObject({ kind: z.literal('detached'), commit }),
    ]),
  }),
  z.strictObject({ status: z.literal('not_repository') }),
  z.strictObject({
    status: z.literal('unavailable'),
    code: z.enum(['git_missing', 'git_failed', 'changed', 'directory_unavailable', 'busy']),
    message: z.string().min(1).max(2048),
  }),
])
export const workspaceEnvironmentSchema = z.strictObject({
  target: workspaceEnvironmentTargetSchema,
  cwd: path,
  workspacePath: path,
  resolvedCwd: path.nullable(),
  directoryMessage: z.string().max(2048),
  checkedAt: z.number().int().nonnegative(),
  git: gitEnvironmentSchema,
})
export type WorkspaceEnvironmentTarget = z.infer<typeof workspaceEnvironmentTargetSchema>
export type WorkspaceEnvironment = z.infer<typeof workspaceEnvironmentSchema>
export type GitEnvironment = z.infer<typeof gitEnvironmentSchema>
