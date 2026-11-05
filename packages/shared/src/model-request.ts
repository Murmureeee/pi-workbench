import type { Redactor } from './redaction.js'

import { z } from 'zod'

/** Host observations only; a deadline is optional and never authorizes client execution. */
export const modelRequestSchema = z.strictObject({
  attempts: z.number().int().nonnegative().nullable(),
  retryCount: z.number().int().nonnegative().nullable(),
  retryLimit: z.number().int().nonnegative().nullable(),
  state: z.enum(['requesting', 'waiting', 'settled', 'interrupted']),
  waitUntil: z.number().int().nonnegative().nullable(),
  error: z.string().max(65536).nullable(),
})
export type ModelRequest = z.infer<typeof modelRequestSchema>

/** Restart restores observation, never a timer or an instruction to retry. */
export function interruptModelRequest(value: ModelRequest): ModelRequest {
  return value.state === 'settled' || value.state === 'interrupted'
    ? value
    : { ...value, state: 'interrupted', waitUntil: null }
}

/** Error suffixes use the same conservative boundary as interrupted model output. */
export function visibleModelRequest(value: ModelRequest, redactor: Redactor): ModelRequest {
  return { ...value, error: value.error ? redactor.text(value.error, true) : null }
}

/** Pure display clock: reaching zero waits for an event and does not run any callback. */
export function modelWaitLabel(value: ModelRequest, now: number): string {
  if (value.state !== 'waiting') {
    return ''
  }
  if (value.waitUntil === null) {
    return '等待期限未知 · 等待服务更新'
  }
  const seconds = Math.ceil(Math.max(0, value.waitUntil - now) / 1000)
  return seconds > 0 ? `距宿主等待期限 ${seconds} 秒` : '已到等待期限 · 等待服务确认后续状态'
}
