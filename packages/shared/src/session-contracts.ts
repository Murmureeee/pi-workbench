import { z } from 'zod'

import { workspaceNameSchema } from './workspace-contracts.js'

export const sessionModelSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('local-fixture'),
    provider: z.literal('piw-offline'),
    model: z.literal('fixture'),
  }),
  z.strictObject({
    kind: z.literal('provider'),
    provider: z.string().min(1).max(256),
    model: z.string().min(1).max(512),
  }),
])
export const projectSchema = z.strictObject({
  id: z.uuid(),
  name: workspaceNameSchema,
  workspaceId: z.uuid().nullable(),
  directory: z.string().nullable(),
  pinned: z.boolean(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
})
export const projectCreateSchema = z.strictObject({
  requestId: z.uuid(),
  name: workspaceNameSchema,
  workspaceId: z.uuid().nullable(),
})
const projectEdit = z.strictObject({
  expectedRevision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
})
/** Project metadata never carries an existing session's execution environment. */
export const projectCommandSchema = z.discriminatedUnion('action', [
  projectEdit.extend({
    action: z.literal('edit'),
    name: workspaceNameSchema,
    workspaceId: z.uuid().nullable(),
  }),
  projectEdit.extend({ action: z.literal('pin'), pinned: z.boolean() }),
  projectEdit.extend({ action: z.literal('move'), direction: z.enum(['up', 'down']) }),
  projectEdit.extend({ action: z.literal('remove') }),
])
export type ProjectCommand = z.infer<typeof projectCommandSchema>
export const sessionConfigurationSchema = z.strictObject({
  projectId: z.uuid().nullable(),
  workspaceId: z.uuid().nullable(),
  model: sessionModelSchema,
  thinking: z.literal('off'),
})
/** A request ID binds immutable input. HTTP retries reconcile that ID; they never create a
 * second session/turn. A manual retry is a new command, explicitly linked to the failed one.
 */
export const sessionSubmitSchema = z.strictObject({
  requestId: z.uuid(),
  sessionId: z.uuid().nullable(),
  configuration: sessionConfigurationSchema,
  text: z.string().trim().min(1).max(16000),
  retryOf: z.uuid().nullable(),
})
export const submissionSchema = z.strictObject({
  requestId: z.uuid(),
  sessionId: z.uuid(),
  messageId: z.uuid(),
  turnId: z.uuid(),
  status: z.enum(['pending', 'executing', 'completed', 'failed', 'aborted', 'interrupted']),
  text: z.string(),
  retryOf: z.uuid().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
})
export const managedSessionSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  titleSource: z.enum(['local', 'user']),
  titleVersion: z.number().int().positive(),
  creationRequestId: z.uuid(),
  configuration: sessionConfigurationSchema,
  workspaceId: z.uuid(),
  cwd: z.string(),
  createdAt: z.number(),
})
export const sessionReceiptSchema = z.strictObject({
  session: managedSessionSchema,
  submission: submissionSchema,
})
export const sessionListSchema = z.strictObject({ sessions: z.array(managedSessionSchema) })
export const submissionListSchema = z.strictObject({ submissions: z.array(submissionSchema) })
export const sessionOptionsSchema = z.strictObject({
  version: z.literal(1),
  realProviderEnabled: z.literal(false),
  localFixtureEnabled: z.boolean(),
  projects: z.array(projectSchema),
})
export type SessionModel = z.infer<typeof sessionModelSchema>
export type SessionConfiguration = z.infer<typeof sessionConfigurationSchema>
export type SessionSubmit = z.infer<typeof sessionSubmitSchema>
export type SessionSubmission = z.infer<typeof submissionSchema>
export type ManagedSession = z.infer<typeof managedSessionSchema>
export type SessionReceipt = z.infer<typeof sessionReceiptSchema>
export type SessionOptions = z.infer<typeof sessionOptionsSchema>
export type Project = z.infer<typeof projectSchema>
export const sessionDraftSchema = z.strictObject({
  text: z.string().max(16000),
  projectId: z.uuid().nullable(),
  model: sessionModelSchema,
  workspace: z
    .strictObject({ id: z.uuid(), name: z.string(), canonicalPath: z.string() })
    .nullable(),
  pending: sessionSubmitSchema.nullable(),
  lastAttempt: sessionSubmitSchema.nullable().default(null),
})
export const sessionDraftCollectionSchema = z.record(z.string(), sessionDraftSchema)
export type SessionDraft = z.infer<typeof sessionDraftSchema>

const readingPositionSchema = z.strictObject({
  anchor: z.string().nullable(),
  offset: z.number().finite(),
  top: z.number().nonnegative(),
  follow: z.boolean(),
})
/** Window-owned presentation state, never execution state or restored authorization. */
export const sessionViewSchema = z.strictObject({
  panel: z.enum(['conversation', 'history', 'records']).default('conversation'),
  cursor: z.string().nullable().default(null),
  expanded: z.array(z.string()).default([]),
  selectedReference: z.string().nullable().default(null),
  reading: z.record(z.string(), readingPositionSchema).default({}),
})
export const sessionViewsSchema = z.record(z.string(), sessionViewSchema)
export const sessionActivitySchema = z.object({
  sessions: z.array(
    z.strictObject({
      id: z.uuid(),
      running: z.boolean(),
      approvals: z.number().int().nonnegative(),
      held: z.number().int().nonnegative(),
    }),
  ),
})
export type SessionView = z.infer<typeof sessionViewSchema>
