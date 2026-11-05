import { z } from 'zod'

import { runtimeToolSchema, trustedContextSchema } from '@pi-workbench/shared'

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
  }),
  z.strictObject({
    ...identity,
    type: z.literal('prompt'),
    turnId: z.uuid(),
    text: z.string().min(1).max(65536),
    fixture: fixtureModeSchema,
    trustedContext: z.array(trustedContextSchema).max(128).default([]),
  }),
  z.strictObject({ ...identity, type: z.literal('abort'), turnId: z.uuid() }),
  z.strictObject({ ...identity, type: z.literal('dispose'), turnId: z.uuid().nullable() }),
])

const guardSchema = z.strictObject({
  version: z.literal(1),
  mode: z.literal('deny-all'),
  activeTools: z.array(z.never()).length(0),
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
  z.strictObject({ ...envelope, type: z.literal('delta'), text: z.string().max(65536) }),
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
