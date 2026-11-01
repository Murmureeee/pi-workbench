import { z } from 'zod'

export const sceneSchema = z.enum([
  'new',
  'running',
  'approval',
  'denied',
  'stopping',
  'stopped',
  'settling',
  'review',
  'error',
  'offline',
])
export const eventSchema = z.object({
  version: z.literal(1),
  source: z.literal('fake-kernel'),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  epoch: z.string().min(1),
  seq: z.number().int().positive(),
  payload: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('started'),
      prompt: z.string(),
    }),
    z.object({
      type: z.literal('delta'),
      text: z.string(),
    }),
    z.object({
      type: z.literal('approval'),
      command: z.string(),
      cwd: z.string(),
    }),
    z.object({
      type: z.literal('denied'),
    }),
    z.object({
      type: z.literal('stopping'),
    }),
    z.object({
      type: z.literal('stopped'),
    }),
    z.object({
      type: z.literal('model-ended'),
    }),
    z.object({
      type: z.literal('settled'),
    }),
    z.object({
      type: z.literal('error'),
      message: z.string(),
    }),
  ]),
})
export const fixtureSchema = z.object({
  source: z.literal('fake-kernel'),
  scene: sceneSchema,
  events: z.array(eventSchema),
})
export const healthSchema = z.object({
  status: z.literal('ok'),
  kernel: z.literal('fake'),
  protocolVersion: z.literal(1),
  node: z.string(),
  storage: z.literal('sqlite'),
  realProviderEnabled: z.literal(false),
})
