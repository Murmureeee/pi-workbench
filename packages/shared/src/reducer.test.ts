import type { WorkbenchEvent } from './types.js'

import { describe, expect, it } from 'vitest'

import { eventSchema } from './contracts.js'
import { emptyProjection, reduceEvent, restoreProjection } from './reducer.js'

function event(seq: number, payload: WorkbenchEvent['payload']): WorkbenchEvent {
  return {
    version: 1,
    source: 'fake-kernel',
    sessionId: 's1',
    turnId: 't1',
    epoch: 'e1',
    seq,
    payload,
  }
}
const started = () =>
  reduceEvent(emptyProjection(), event(1, { type: 'started', prompt: '检查当前项目' }))

describe('OPS-01 pure projection baseline', () => {
  it('accumulates every delta and ignores a duplicate', () => {
    const delta = event(2, { type: 'delta', text: '你好\n' })
    const first = reduceEvent(started(), delta)
    expect(reduceEvent(first, delta)).toBe(first)
    expect(reduceEvent(first, event(3, { type: 'delta', text: '世界' })).answer).toBe('你好\n世界')
  })
  it('requires settled after model completion', () => {
    const state = reduceEvent(started(), event(2, { type: 'model-ended' }))
    expect(state.phase).toBe('settling')
    expect(reduceEvent(state, event(3, { type: 'settled' })).phase).toBe('review')
  })
  it('stops applying deltas after a sequence gap', () => {
    const gap = reduceEvent(started(), event(3, { type: 'delta', text: 'lost predecessor' }))
    expect(gap.needsSync).toBe(true)
    expect(reduceEvent(gap, event(2, { type: 'delta', text: 'late' })).answer).toBe('')
  })
  it('ignores a terminal event from another turn or epoch', () => {
    const state = started()
    expect(
      reduceEvent(state, {
        ...event(2, { type: 'settled' }),
        turnId: 'old',
      }),
    ).toBe(state)
    expect(
      reduceEvent(state, {
        ...event(2, { type: 'error', message: 'old' }),
        epoch: 'old',
      }),
    ).toBe(state)
  })
  it('rejects malformed protocol data at the boundary', () => {
    expect(
      eventSchema.safeParse({
        ...event(1, { type: 'started', prompt: '' }),
        version: 2,
      }).success,
    ).toBe(false)
  })
})

describe('OPS-08 projection contract regressions (synthetic envelopes)', () => {
  it('keeps the selected session when a foreign start arrives late', () => {
    const state = started()
    expect(
      reduceEvent(state, {
        ...event(99, { type: 'started', prompt: 'foreign' }),
        sessionId: 'other',
      }),
    ).toBe(state)
  })

  it('requires a snapshot to change the runtime generation', () => {
    const state = started()
    expect(
      reduceEvent(state, {
        ...event(1, { type: 'started', prompt: 'new generation' }),
        epoch: 'e2',
      }),
    ).toBe(state)
  })

  it('does not hide a missing event when a later turn starts', () => {
    const state = reduceEvent(started(), event(2, { type: 'delta', text: 'kept' }))
    const gap = reduceEvent(state, {
      ...event(4, { type: 'started', prompt: 'next' }),
      turnId: 't2',
    })
    expect(gap).toMatchObject({ turnId: 't1', answer: 'kept', seq: 2, needsSync: true })
  })

  it('does not clear a known gap with a newly delivered start', () => {
    const gap = reduceEvent(started(), event(3, { type: 'delta', text: 'missing' }))
    const next = reduceEvent(gap, {
      ...event(4, { type: 'started', prompt: 'next' }),
      turnId: 't2',
    })
    expect(next).toBe(gap)
  })

  it.each(['stopped', 'error', 'review'] as const)(
    'preserves the first %s terminal against late conflicting events',
    (phase) => {
      let state = started()
      const terminal: WorkbenchEvent['payload'][] =
        phase === 'review'
          ? [{ type: 'model-ended' }, { type: 'settled' }]
          : phase === 'error'
            ? [{ type: 'error', message: 'fixture error' }]
            : [{ type: 'stopping' }, { type: 'stopped' }]
      for (const payload of terminal) {
        state = reduceEvent(state, event(state.seq + 1, payload))
      }
      const nextSeq = state.seq + 1
      for (const payload of [
        { type: 'delta', text: 'must not append' },
        { type: 'model-ended' },
        { type: 'settled' },
        { type: 'error', message: 'late' },
      ] satisfies WorkbenchEvent['payload'][]) {
        expect(reduceEvent(state, event(nextSeq, payload))).toMatchObject({
          phase,
          answer: state.answer,
          error: state.error,
        })
      }
    },
  )

  it('starts a later turn contiguously and ignores an old terminal afterwards', () => {
    const stopped = reduceEvent(started(), event(2, { type: 'stopped' }))
    const next = reduceEvent(stopped, {
      ...event(3, { type: 'started', prompt: 'new task' }),
      turnId: 't2',
    })
    expect(next).toMatchObject({ phase: 'running', turnId: 't2', prompt: 'new task', answer: '' })
    expect(reduceEvent(next, event(4, { type: 'error', message: 'old turn' }))).toBe(next)
  })

  it('requires resync for an invalid transition instead of inventing completion', () => {
    const state = reduceEvent(started(), event(2, { type: 'settled' }))
    expect(state).toMatchObject({ phase: 'running', seq: 1, needsSync: true })
  })

  it('restores an authoritative snapshot after a gap, then accepts only its next delta', () => {
    const initial = started()
    const gap = reduceEvent(initial, event(3, { type: 'delta', text: 'B' }))
    const snapshot = { ...initial, seq: 3, answer: 'AB', needsSync: false }
    const restored = restoreProjection(gap, snapshot, { sessionId: 's1', epoch: 'e1' })
    expect(reduceEvent(restored, event(3, { type: 'delta', text: 'B' }))).toBe(restored)
    expect(reduceEvent(restored, event(4, { type: 'delta', text: 'C' }))).toMatchObject({
      answer: 'ABC',
      needsSync: false,
    })
  })

  it('rejects stale, foreign and incomplete snapshots without losing current content', () => {
    const state = reduceEvent(started(), event(2, { type: 'delta', text: 'kept' }))
    for (const snapshot of [
      { ...state, seq: 1 },
      { ...state, sessionId: 'other' },
      { ...state, epoch: 'old' },
      { ...state, needsSync: true },
    ]) {
      expect(restoreProjection(state, snapshot, { sessionId: 's1', epoch: 'e1' })).toBe(state)
    }
    expect(() => restoreProjection(state, { answer: 7 }, { sessionId: 's1', epoch: 'e1' })).toThrow(
      /snapshot/i,
    )
  })

  it('preserves every character through duplicate delivery, including Unicode and long output', () => {
    const parts = ['你', '好\n', '👩‍💻', 'e\u0301', 'x'.repeat(70000)]
    const stream = parts.map((text, i) => event(i + 2, { type: 'delta', text }))
    const replayed = stream.flatMap((value) => [value, value]).reduce(reduceEvent, started())
    expect(replayed.answer).toBe(parts.join(''))
    expect(replayed.seq).toBe(parts.length + 1)
  })
})
