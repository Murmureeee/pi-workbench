import type { RuntimeEvent, RuntimeSnapshot } from './runtime-contracts.js'

import { describe, expect, it } from 'vitest'

import {
  applyRuntimeEvent,
  compatibleRuntime,
  runtimeCapabilities,
  runtimeEventSchema,
  runtimeSnapshotSchema,
  runtimeSubscribeSchema,
} from './runtime-contracts.js'

const sessionId = '11111111-1111-4111-8111-111111111111'
const epoch = '22222222-2222-4222-8222-222222222222'
const daemonId = '33333333-3333-4333-8333-333333333333'
const turnId = '44444444-4444-4444-8444-444444444444'
const nextTurn = '55555555-5555-4555-8555-555555555555'
const initial: RuntimeSnapshot = {
  version: 1,
  sessionId,
  epoch,
  daemonId,
  source: 'synthetic-ipc-fixture',
  seq: 0,
  turns: [],
}
const event = (seq: number, payload: RuntimeEvent['payload'], id = turnId): RuntimeEvent => ({
  version: 1,
  sessionId,
  epoch,
  daemonId,
  turnId: id,
  seq,
  id: `${epoch}:${seq}`,
  payload,
})
const start = event(1, { type: 'turn.started', messageId: 'm1', prompt: 'fixture' })

describe('CORE-05 authoritative observation contract', () => {
  it('accepts all advertised observation capabilities in a bounded subscription', () => {
    const subscription = {
      type: 'subscribe',
      protocolVersion: 1,
      requiredCapabilities: [...runtimeCapabilities],
      sessionId,
      epoch,
      since: 0,
      daemonId,
    }
    expect(runtimeSubscribeSchema.parse(subscription)).toEqual(subscription)
    expect(
      runtimeSubscribeSchema.safeParse({
        ...subscription,
        requiredCapabilities: Array.from({ length: 65 }, () => 'snapshots'),
      }).success,
    ).toBe(false)
  })
  it('accumulates every Unicode delta and deduplicates stable event and tool identities', () => {
    const text = '👩‍💻你\ne\u0301'.repeat(10000)
    const events = [
      start,
      event(2, { type: 'message.delta', messageId: 'm1', text }),
      event(3, {
        type: 'tool.updated',
        tool: { id: 'call1', name: 'unknown', status: 'running', summary: '' },
      }),
      event(4, {
        type: 'tool.updated',
        tool: { id: 'call1', name: 'unknown', status: 'error', summary: 'denied' },
      }),
      event(5, {
        type: 'tool.updated',
        tool: { id: 'call1', name: 'unknown', status: 'running', summary: '' },
      }),
    ]
    const value = events.flatMap((item) => [item, item]).reduce(applyRuntimeEvent, initial)
    expect(value.turns[0]).toMatchObject({
      text,
      tools: [{ id: 'call1', status: 'error', summary: 'denied' }],
    })
    expect(value.turns[0]?.tools).toHaveLength(1)
  })
  it('requires complete resync at gaps, rejects corrupt IDs, and ignores foreign epochs', () => {
    const value = applyRuntimeEvent(initial, start)
    expect(() => applyRuntimeEvent(value, event(3, { type: 'turn.stopping' }))).toThrow('gap')
    expect(
      applyRuntimeEvent(value, { ...event(2, { type: 'turn.stopping' }), epoch: nextTurn }),
    ).toBe(value)
    expect(runtimeEventSchema.safeParse({ ...start, id: 'unstable' }).success).toBe(false)
    expect(
      runtimeSnapshotSchema.safeParse({ ...value, turns: [...value.turns, ...value.turns] })
        .success,
    ).toBe(false)
  })
  it('applies approvals and terminal synchronously and preserves first terminal and old-turn content', () => {
    const events = [
      start,
      event(2, {
        type: 'approval.requested',
        approval: { id: 'a1', command: 'must-not-execute', cwd: 'fixture' },
      }),
      event(3, { type: 'turn.finished', outcome: 'aborted' }),
      event(4, { type: 'turn.finished', outcome: 'completed' }),
      event(5, { type: 'turn.started', messageId: 'm2', prompt: 'next' }, nextTurn),
      event(6, { type: 'turn.finished', outcome: 'error' }),
    ]
    const approval = events.slice(0, 2).reduce(applyRuntimeEvent, initial)
    expect(approval.turns[0]?.approval?.id).toBe('a1')
    const value = events.reduce(applyRuntimeEvent, initial)
    expect(value.turns.map((turn) => turn.phase)).toEqual(['aborted', 'running'])
    expect(value.turns[0]?.approval).toBeNull()
  })
  it('blocks overlapping turns and mismatched message identities', () => {
    const value = applyRuntimeEvent(initial, start)
    expect(() =>
      applyRuntimeEvent(
        value,
        event(2, { type: 'turn.started', messageId: 'm2', prompt: 'bad' }, nextTurn),
      ),
    ).toThrow('start')
    expect(() =>
      applyRuntimeEvent(value, event(2, { type: 'message.delta', messageId: 'bad', text: 'bad' })),
    ).toThrow('identity')
  })
  it('distinguishes protocol version and actual capabilities', () => {
    const hello = {
      type: 'hello' as const,
      daemonId,
      protocolVersion: 1,
      capabilities: [
        'snapshots',
        'replay',
        'tool-observation',
        'redacted-observation',
        'tool-timeline-v1',
        'reasoning-observation-v1',
        'model-request-v1',
        'input-queue-v1',
        'run-stage-v1',
        'tool-risk-v1',
        'execution-approval-v1',
        'session-authorization-v1',
        'operation-audit-v1',
        'model-selection-v1',
        'directory-write-v1',
        'change-snapshots-v1',
        'change-sources-v1',
        'change-review-v1',
        'change-rollback-v1',
        'change-history-chain-v1',
        'change-rollback-history-v1',
        'change-decisions-v1',
      ],
      mutations: false,
      realProviderEnabled: false,
    }
    expect(compatibleRuntime(hello)).toBe(true)
    expect(
      compatibleRuntime({
        ...hello,
        capabilities: hello.capabilities.filter((item) => item !== 'directory-write-v1'),
      }),
    ).toBe(false)
    expect(
      compatibleRuntime({
        ...hello,
        capabilities: hello.capabilities.filter((capability) => capability !== 'tool-risk-v1'),
      }),
    ).toBe(false)
    expect(
      compatibleRuntime({
        ...hello,
        capabilities: hello.capabilities.filter((item) => item !== 'tool-timeline-v1'),
      }),
    ).toBe(false)
    expect(compatibleRuntime({ ...hello, protocolVersion: 2 })).toBe(false)
    expect(compatibleRuntime({ ...hello, capabilities: ['snapshots'] })).toBe(false)
    expect(
      compatibleRuntime({ ...hello, capabilities: ['snapshots', 'replay', 'tool-observation'] }),
    ).toBe(false)
  })
})
