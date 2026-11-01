import type { eventSchema, fixtureSchema, healthSchema, sceneSchema } from './contracts.js'
import type { z } from 'zod'

export type Scene = z.infer<typeof sceneSchema>
export type WorkbenchEvent = z.infer<typeof eventSchema>
export type Fixture = z.infer<typeof fixtureSchema>
export type Health = z.infer<typeof healthSchema>
export interface Projection {
  sessionId: string
  turnId: string
  epoch: string
  seq: number
  phase: Scene
  prompt: string
  answer: string
  approval: { command: string; cwd: string } | null
  error: string | null
  needsSync: boolean
}
