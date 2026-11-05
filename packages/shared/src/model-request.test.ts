import { expect, test } from 'vitest'

import {
  interruptModelRequest,
  modelRequestSchema,
  modelWaitLabel,
  visibleModelRequest,
} from './model-request.js'
import { Redactor } from './redaction.js'
import { applyRuntimeEvent, runtimeSnapshotSchema } from './runtime-contracts.js'

test('mODEL-07 uses only host deadlines, preserves unknowns, and never turns elapsed waiting into execution', () => {
  const waiting = modelRequestSchema.parse({
    attempts: 2,
    retryCount: 1,
    retryLimit: 2,
    state: 'waiting',
    waitUntil: 5000,
    error: 'api_key=secret-value',
  })
  expect(modelWaitLabel(waiting, 2000)).toContain('3 秒')
  expect(modelWaitLabel(waiting, 8000)).toContain('等待服务确认')
  expect(modelWaitLabel({ ...waiting, waitUntil: null }, 2000)).toContain('未知')
  expect(waiting.state).toBe('waiting')
  expect(interruptModelRequest(waiting)).toMatchObject({ state: 'interrupted', waitUntil: null })
  expect(visibleModelRequest(waiting, new Redactor()).error).not.toContain('secret-value')
  expect(modelRequestSchema.safeParse({ ...waiting, waitUntil: -1 }).success).toBe(false)
  expect(modelRequestSchema.safeParse({ ...waiting, attempts: NaN }).success).toBe(false)
})

test('mODEL-07 old/other/terminal model events cannot replace the current attempt or tools', () => {
  const daemonId = '11111111-1111-4111-8111-111111111111',
    sessionId = '22222222-2222-4222-8222-222222222222',
    epoch = '33333333-3333-4333-8333-333333333333',
    turnId = '44444444-4444-4444-8444-444444444444'
  const request = modelRequestSchema.parse({
    attempts: 3,
    retryCount: 1,
    retryLimit: 2,
    state: 'waiting',
    waitUntil: null,
    error: 'limited',
  })
  const state = runtimeSnapshotSchema.parse({
    version: 1,
    daemonId,
    sessionId,
    epoch,
    seq: 4,
    source: 'synthetic-ipc-fixture',
    turns: [
      {
        id: turnId,
        messageId: 'm',
        prompt: 'test',
        text: '',
        phase: 'running',
        tools: [{ id: 'done', name: 'write', status: 'completed', summary: 'completed once' }],
        approval: null,
        error: null,
        modelRequest: request,
      },
    ],
  })
  const incoming = {
    version: 1 as const,
    daemonId,
    sessionId,
    epoch,
    seq: 5,
    id: `${epoch}:5`,
    turnId,
    payload: { type: 'model.updated' as const, modelRequest: { ...request, attempts: 1 } },
  }
  expect(applyRuntimeEvent(state, incoming).turns[0]?.modelRequest?.attempts).toBe(3)
  expect(applyRuntimeEvent(state, { ...incoming, sessionId: daemonId })).toBe(state)
  const stopped = applyRuntimeEvent(state, {
    ...incoming,
    payload: { type: 'turn.finished', outcome: 'aborted' },
  })
  expect(stopped.turns[0]?.modelRequest).toMatchObject({ state: 'settled', waitUntil: null })
  expect(stopped.turns[0]?.tools).toEqual(state.turns[0]?.tools)
  const redactor = new Redactor()
  redactor.remember('dummy-private-key')
  const observed = visibleModelRequest({ ...request, error: 'Request was aborted' }, redactor)
  const finished = applyRuntimeEvent(
    { ...state, turns: state.turns.map((turn) => ({ ...turn, modelRequest: observed })) },
    {
      ...incoming,
      payload: { type: 'turn.finished', outcome: 'aborted', error: 'Request was aborted' },
    },
  )
  expect(finished.turns[0]?.modelRequest?.error).toBe(observed.error)
  expect(
    applyRuntimeEvent(state, {
      ...incoming,
      payload: { type: 'model.updated', modelRequest: { ...request, retryCount: 0 } },
    }).turns[0]?.modelRequest,
  ).toEqual(request)
  const ended = {
    ...state,
    turns: state.turns.map((turn) => ({ ...turn, phase: 'error' as const })),
  }
  expect(applyRuntimeEvent(ended, incoming).turns[0]).toEqual(ended.turns[0])
  expect(
    applyRuntimeEvent(state, {
      ...incoming,
      payload: {
        type: 'model.updated',
        modelRequest: { ...request, attempts: 4, state: 'requesting' },
      },
    }).turns[0]?.tools,
  ).toEqual(state.turns[0]?.tools)
})
