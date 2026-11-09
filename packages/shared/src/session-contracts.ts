import { z } from 'zod'

import { inputReferenceSchema, inputReferenceSelectionSchema } from './input-references.js'
import { workspaceNameSchema } from './workspace-contracts.js'

export const sessionModelSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('local-fixture'),
    provider: z.literal('piw-offline'),
    model: z.enum(['fixture', 'fixture-reasoning']),
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
export const thinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
export const modelSelectionSchema = z.strictObject({
  model: sessionModelSchema,
  thinking: thinkingLevelSchema,
})
/** Host-owned selection. Effective identifies a request boundary, never a provider entitlement. */
export const sessionModelStateSchema = z.strictObject({
  sessionId: z.uuid(),
  revision: z.number().int().positive(),
  requested: modelSelectionSchema,
  effective: modelSelectionSchema,
  effectiveRevision: z.number().int().positive(),
})
export const sessionModelCommandSchema = modelSelectionSchema.extend({
  expectedRevision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
})
export type ModelSelection = z.infer<typeof modelSelectionSchema>
export type SessionModelState = z.infer<typeof sessionModelStateSchema>
export type SessionModelCommand = z.infer<typeof sessionModelCommandSchema>
export const sessionConfigurationSchema = z.strictObject({
  projectId: z.uuid().nullable(),
  workspaceId: z.uuid().nullable(),
  model: sessionModelSchema,
  thinking: thinkingLevelSchema,
})
/** A request ID binds immutable input. HTTP retries reconcile that ID; they never create a
 * second session/turn. A manual retry is a new command, explicitly linked to the failed one.
 */
export const sessionSubmitSchema = z
  .strictObject({
    requestId: z.uuid(),
    sessionId: z.uuid().nullable(),
    configuration: sessionConfigurationSchema,
    text: z.string().trim().min(1).max(600000),
    retryOf: z.uuid().nullable(),
    references: inputReferenceSelectionSchema.optional(),
  })
  .refine((input) => input.retryOf !== null || input.text.length <= 16000, {
    message: '普通任务最多 16,000 字符。',
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
  membershipVersion: z.number().int().positive().default(1),
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
  draftId: z.uuid().default(() => crypto.randomUUID()),
  references: z.array(inputReferenceSchema).max(8).default([]),
  text: z.string().max(16000),
  projectId: z.uuid().nullable(),
  model: sessionModelSchema,
  thinking: thinkingLevelSchema.default('off'),
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
  historyTrail: z.array(z.string().nullable()).max(100).default([]),
  expanded: z.array(z.string()).default([]),
  seenMessages: z.record(z.string(), z.string()).nullable().default(null),
  selectedReference: z.string().nullable().default(null),
  changeReview: z
    .strictObject({
      turnId: z.uuid(),
      fileId: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
    })
    .nullable()
    .default(null),
  changeReviewOpen: z.boolean().default(false),
  environmentOpen: z.boolean().default(false),
  configurationOpen: z.boolean().default(false),
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
