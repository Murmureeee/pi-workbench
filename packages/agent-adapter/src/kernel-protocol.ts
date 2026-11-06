import { z } from 'zod'

import {
  executionDecisionSchema,
  executionRequestSchema,
  modelRequestSchema,
  reasoningSchema,
  runStageSchema,
  runtimeToolSchema,
  trustedContextSchema,
} from '@pi-workbench/shared'

const identity = {
  protocol: z.literal(1),
  sessionId: z.uuid(),
  epoch: z.uuid(),
}

export const kernelIdentitySchema = z.object(identity)
const fixtureModeSchema = z.enum([
  'reply',
  'hold',
  'error',
  'unknown-tool',
  'context',
  'trust-context',
  'rendering',
  'rendering-long',
  'scrolling',
  'reasoning',
  'queue',
  'queue-fast',
  'guard-read',
  'guard-denied',
  'approval-write',
  'approval-command',
  'approval-running',
  'approval-boundary',
])
const resumeSchema = z.strictObject({
  sessionFile: z.string().min(1),
  nativeSessionId: z.string().min(1),
})

/** Private daemon ↔ child IPC. This is not the client replay protocol (CORE-05). */
export const kernelCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...identity,
    type: z.literal('init'),
    cwd: z.string().min(1),
    runtimeDir: z.string().min(1),
    resume: resumeSchema.optional(),
    guarded: z.boolean().default(false),
  }),
  z.strictObject({
    ...identity,
    type: z.literal('prompt'),
    turnId: z.uuid(),
    text: z.string().min(1).max(65536),
    fixture: fixtureModeSchema,
    inputQueue: z.boolean().default(false),
    trustedContext: z.array(trustedContextSchema).max(128).default([]),
  }),
  z.strictObject({ ...identity, type: z.literal('abort'), turnId: z.uuid() }),
  z.strictObject({
    ...identity,
    type: z.literal('guard-result'),
    turnId: z.uuid(),
    decision: executionDecisionSchema,
  }),
  z.strictObject({
    ...identity,
    type: z.literal('queue-boundary'),
    turnId: z.uuid(),
    boundaryId: z.uuid(),
    item: z.strictObject({ id: z.uuid(), text: z.string().min(1).max(16000) }).nullable(),
  }),
  z.strictObject({ ...identity, type: z.literal('dispose'), turnId: z.uuid().nullable() }),
])

const guardSchema = z.strictObject({
  version: z.literal(1),
  mode: z.enum(['deny-all', 'final-parameters-v1']),
  activeTools: z.array(z.enum(['read', 'write', 'edit', 'bash', 'powershell'])).max(5),
  extensionsEnabled: z.literal(false),
  realProviderEnabled: z.literal(false),
})

const envelope = { ...identity, seq: z.number().int().positive(), turnId: z.uuid().nullable() }
export const kernelMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('ready'),
    pid: z.number().int().positive(),
    cwd: z.string().min(1),
    sessionFile: z.string().min(1),
    nativeSessionId: z.string().min(1),
    guard: guardSchema,
  }),
  z.strictObject({ ...envelope, type: z.literal('running') }),
  z.strictObject({
    ...envelope,
    type: z.literal('guard-request'),
    request: executionRequestSchema,
  }),
  z.strictObject({ ...envelope, type: z.literal('queue-boundary'), boundaryId: z.uuid() }),
  z.strictObject({ ...envelope, type: z.literal('queue-delivered'), id: z.uuid() }),
  z.strictObject({ ...envelope, type: z.literal('delta'), text: z.string().max(65536) }),
  z.strictObject({ ...envelope, type: z.literal('reasoning'), reasoning: reasoningSchema }),
  z.strictObject({ ...envelope, type: z.literal('model'), modelRequest: modelRequestSchema }),
  z.strictObject({ ...envelope, type: z.literal('stage'), stage: runStageSchema }),
  z.strictObject({
    ...envelope,
    type: z.literal('tool'),
    toolId: z.string().min(1),
    ...runtimeToolSchema.omit({ id: true }).shape,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('finished'),
    outcome: z.enum(['completed', 'aborted', 'error']),
    localRequests: z.number().int().nonnegative(),
    blockedNetworkAttempts: z.number().int().nonnegative(),
    error: z.string().optional(),
  }),
  z.strictObject({ ...envelope, type: z.literal('disposed') }),
  z.strictObject({ ...envelope, type: z.literal('fatal'), error: z.string() }),
])

export type KernelIdentity = z.infer<typeof kernelIdentitySchema>
export type KernelCommand = z.infer<typeof kernelCommandSchema>
export type KernelMessage = z.infer<typeof kernelMessageSchema>
export type FixtureMode = z.infer<typeof fixtureModeSchema>
