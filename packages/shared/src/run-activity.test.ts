import type { InputQueueRecord, RuntimeSnapshot, SessionSubmission, StopIntent } from './index.js'

import { expect, test } from 'vitest'

import { runStageSchema, selectRunActivity } from './run-activity.js'
import { applyRuntimeEvent, runtimeSnapshotSchema } from './runtime-contracts.js'

const id = '11111111-1111-4111-8111-111111111111',
  turnId = '22222222-2222-4222-8222-222222222222',
  epoch = '33333333-3333-4333-8333-333333333333'
const submission: SessionSubmission = {
  requestId: id,
  sessionId: id,
  messageId: id,
  turnId,
  status: 'executing',
  text: 'fixture',
  retryOf: null,
  error: null,
  createdAt: 1,
}
const turn: RuntimeSnapshot['turns'][number] = {
  id: turnId,
  messageId: 'assistant',
  prompt: 'fixture',
  text: '',
  phase: 'running',
  stage: 'waiting-model',
  tools: [],
  approval: null,
  error: null,
}
const record: InputQueueRecord = {
  id,
  sessionId: id,
  epoch,
  turnId,
  source: 'workbench',
  kind: 'follow-up',
  position: 0,
  text: 'next',
  status: 'queued',
  revision: 0,
  deliveredTurnId: null,
  error: null,
  inputDigest: 'digest',
}
const select = (
  s = submission,
  t = turn,
  records: InputQueueRecord[] = [],
  stop: StopIntent | null = null,
) =>
  selectRunActivity({
    submission: s,
    turn: t,
    records,
    knownTurnIds: [turnId],
    synchronized: true,
    stop,
  })

test('oBS-02 stage precedence preserves active tools, retry, compaction, approval and settling without invented thinking', () => {
  expect(select().label).toBe('等待模型响应')
  expect(
    select({ ...submission, status: 'completed' }, { ...turn, stage: 'compacting' }),
  ).toMatchObject({ code: 'compacting', dismissible: false })
  expect(
    select(
      { ...submission, status: 'completed' },
      { ...turn, tools: [{ id: 'tool', name: 'bash', status: 'running', summary: '' }] },
    ).code,
  ).toBe('executing-tools')
  expect(
    select(
      { ...submission, status: 'completed' },
      { ...turn, tools: [{ id: 'tool', name: 'bash', status: 'pending', summary: '' }] },
    ).code,
  ).toBe('preparing-tools')
  expect(
    select(submission, {
      ...turn,
      modelRequest: {
        attempts: 2,
        retryCount: 1,
        retryLimit: 2,
        state: 'waiting',
        waitUntil: 0,
        error: 'rate',
      },
    }),
  ).toMatchObject({ code: 'retry', dismissible: false, error: 'rate' })
  expect(
    select(submission, {
      ...turn,
      approval: { id: 'approval', command: 'fixture', cwd: 'fixture' },
    }).code,
  ).toBe('approval')
  expect(select(submission, { ...turn, phase: 'completed' }).code).toBe('settling')
  expect(select({ ...submission, status: 'completed' }, turn).code).toBe('unconfirmed')
  expect(runStageSchema.safeParse('thinking').success).toBe(false)
})

test('oBS-02 queue handoff never displays completion, unknown records need decisions and foreign queues are isolated', () => {
  const s = { ...submission, status: 'completed' as const },
    t = { ...turn, phase: 'completed' as const }
  for (const status of ['queued', 'sending', 'held', 'uncertain'] as const) {
    expect(select(s, t, [{ ...record, status }]).dismissible).toBe(false)
  }
  expect(select(s, t, [{ ...record, status: 'delivered', deliveredTurnId: epoch }]).code).toBe(
    'continuing',
  )
  expect(select(s, t, [{ ...record, status: 'delivered', deliveredTurnId: turnId }])).toMatchObject(
    { code: 'completed', dismissible: true },
  )
  expect(select(s, t, [{ ...record, sessionId: epoch }]).code).toBe('completed')
  expect(
    selectRunActivity({
      submission: s,
      turn: t,
      records: [],
      knownTurnIds: [turnId],
      synchronized: false,
      stop: null,
    }),
  ).toMatchObject({ code: 'syncing', dismissible: false })
})

test('oBS-02 stop intents bind operation and wait for durable confirmation; interrupted execution remains unknown', () => {
  const intent: StopIntent = { requestId: id, turnId, state: 'unknown', error: 'network failure' }
  expect(select(submission, turn, [], intent)).toMatchObject({
    code: 'stop-unknown',
    dismissible: false,
    error: 'network failure',
  })
  expect(select(submission, turn, [], { ...intent, state: 'sending' }).label).toBe('正在请求停止')
  expect(select(submission, turn, [], { ...intent, state: 'requested' }).label).toContain(
    '等待停止结果',
  )
  expect(select(submission, turn, [], { ...intent, requestId: epoch }).code).toBe('waiting-model')
  expect(
    select({ ...submission, status: 'aborted' }, { ...turn, phase: 'aborted' }, [], intent),
  ).toMatchObject({ code: 'aborted', dismissible: true, error: null })
  expect(
    select({ ...submission, status: 'interrupted' }, { ...turn, phase: 'interrupted' }, [], intent),
  ).toMatchObject({ code: 'interrupted', dismissible: false })
})

test('oBS-02 one error per operation prefers authority and dismissal tokens never merge equal text across operations', () => {
  const s = { ...submission, status: 'failed' as const, error: 'same error' },
    t = { ...turn, phase: 'error' as const, error: 'same error' }
  expect(select(s, t)).toMatchObject({ error: 'same error', dismissible: true })
  expect(select(s, t, [{ ...record, status: 'held' }])).toMatchObject({
    code: 'held',
    error: 'same error',
    dismissible: false,
  })
  expect(select(s, t).stamp).not.toBe(select({ ...s, requestId: epoch }, t).stamp)
  expect(select(s, t).stamp).toBe(select({ ...s, error: 'new wording' }, t).stamp)
})

test('oBS-02 stage events are strict, identity-bound, replay-idempotent and terminal monotonic', () => {
  const snapshot: RuntimeSnapshot = {
    version: 1,
    daemonId: id,
    sessionId: id,
    epoch,
    seq: 0,
    source: 'synthetic-ipc-fixture',
    turns: [turn],
  }
  const event = {
    version: 1 as const,
    daemonId: id,
    sessionId: id,
    epoch,
    seq: 1,
    id: `${epoch}:1`,
    turnId,
    payload: { type: 'stage.updated' as const, stage: 'compacting' as const },
  }
  const compact = applyRuntimeEvent(snapshot, event)
  expect(compact.turns[0]?.stage).toBe('compacting')
  expect(applyRuntimeEvent(compact, event)).toBe(compact)
  expect(applyRuntimeEvent(snapshot, { ...event, turnId: id }).turns[0]?.stage).toBe(
    'waiting-model',
  )
  const done = applyRuntimeEvent(compact, {
    ...event,
    seq: 2,
    id: `${epoch}:2`,
    payload: { type: 'turn.finished', outcome: 'completed' },
  })
  expect(applyRuntimeEvent(done, { ...event, seq: 3, id: `${epoch}:3` }).turns[0]?.phase).toBe(
    'completed',
  )
  expect(
    runtimeSnapshotSchema.safeParse({ ...snapshot, turns: [{ ...turn, stage: 'arbitrary' }] })
      .success,
  ).toBe(false)
})
