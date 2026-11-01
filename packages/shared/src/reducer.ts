import type { Projection, WorkbenchEvent } from './types.js'

import { z } from 'zod'

import { sceneSchema } from './contracts.js'

const snapshotSchema = z.strictObject({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  epoch: z.string().min(1),
  seq: z.number().int().positive(),
  phase: sceneSchema,
  prompt: z.string(),
  answer: z.string(),
  approval: z.object({ command: z.string(), cwd: z.string() }).nullable(),
  error: z.string().nullable(),
  needsSync: z.boolean(),
})

function terminal(state: Projection) {
  return state.phase === 'stopped' || state.phase === 'error' || state.phase === 'review'
}

export function emptyProjection(): Projection {
  return {
    sessionId: '',
    turnId: '',
    epoch: '',
    seq: 0,
    phase: 'new',
    prompt: '',
    answer: '',
    approval: null,
    error: null,
    needsSync: false,
  }
}

/** Pure presentation reducer. A gap blocks incrementals until an authoritative snapshot.
 * Runtime/session selection belongs to its caller; an unsolicited start cannot select it.
 */
export function reduceEvent(state: Projection, event: WorkbenchEvent): Projection {
  if (event.payload.type === 'started') {
    if (state.sessionId) {
      if (
        event.sessionId !== state.sessionId ||
        event.epoch !== state.epoch ||
        event.seq <= state.seq ||
        state.needsSync
      ) {
        return state
      }
      if (event.seq !== state.seq + 1 || event.turnId === state.turnId || !terminal(state)) {
        return { ...state, needsSync: true }
      }
    } else if (event.seq !== 1) {
      return { ...state, needsSync: true }
    }
    return {
      ...emptyProjection(),
      sessionId: event.sessionId,
      turnId: event.turnId,
      epoch: event.epoch,
      seq: event.seq,
      phase: 'running',
      prompt: event.payload.prompt,
    }
  }
  if (
    event.sessionId !== state.sessionId ||
    event.epoch !== state.epoch ||
    event.turnId !== state.turnId ||
    event.seq <= state.seq
  ) {
    return state
  }
  if (state.needsSync || event.seq !== state.seq + 1) {
    return { ...state, needsSync: true }
  }
  const next = { ...state, seq: event.seq }
  if (terminal(state)) {
    return next
  }
  switch (event.payload.type) {
    case 'delta':
      return { ...next, answer: next.answer + event.payload.text }
    case 'approval':
      return {
        ...next,
        phase: 'approval',
        approval: { command: event.payload.command, cwd: event.payload.cwd },
      }
    case 'denied':
      return { ...next, phase: 'denied', approval: null }
    case 'stopping':
      return { ...next, phase: 'stopping', approval: null }
    case 'stopped':
      return { ...next, phase: 'stopped', approval: null }
    case 'model-ended':
      return { ...next, phase: 'settling', approval: null }
    case 'settled':
      return state.phase === 'settling'
        ? { ...next, phase: 'review' }
        : { ...state, needsSync: true }
    case 'error':
      return {
        ...next,
        phase: 'error',
        error: event.payload.message,
        approval: null,
      }
  }
  throw new Error('Unsupported workbench event')
}

/** Apply a complete snapshot for the identity chosen by the current handshake/request.
 * This pure boundary does not implement transport, persistence or request-version ownership.
 */
export function restoreProjection(
  state: Projection,
  value: unknown,
  expected: { sessionId: string; epoch: string },
): Projection {
  const parsed = snapshotSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Invalid projection snapshot: ${parsed.error.message}`)
  }
  const snapshot = parsed.data
  if (
    snapshot.needsSync ||
    snapshot.sessionId !== expected.sessionId ||
    snapshot.epoch !== expected.epoch ||
    (state.sessionId && state.sessionId !== snapshot.sessionId)
  ) {
    return state
  }
  if (
    snapshot.epoch === state.epoch &&
    (snapshot.seq < state.seq ||
      (snapshot.seq === state.seq && snapshot.turnId !== state.turnId) ||
      (snapshot.turnId === state.turnId && terminal(state) && snapshot.phase !== state.phase))
  ) {
    return state
  }
  return snapshot
}
