import type { RuntimeView } from './runtime-client.js'
import type { RuntimeEvent, RuntimeSnapshot } from '@pi-workbench/shared'

import { afterEach, expect, test, vi } from 'vitest'

import { RuntimeClient } from './runtime-client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Real observer with controlled transport/animation frames; no browser clock timing guesses. */
async function observer() {
  const snapshot: RuntimeSnapshot = {
    version: 1,
    daemonId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    epoch: crypto.randomUUID(),
    seq: 0,
    source: 'synthetic-ipc-fixture',
    turns: [],
  }
  const hello = {
    type: 'hello',
    protocolVersion: 1,
    daemonId: snapshot.daemonId,
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
    ],
    mutations: false,
    realProviderEnabled: false,
  }
  const sockets: Transport[] = []
  class Transport extends EventTarget {
    constructor() {
      super()
      sockets.push(this)
    }
    send() {}
    close() {}
  }
  const paints = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    paints.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => paints.delete(key))
  vi.stubGlobal('location', { protocol: 'http:', host: '127.0.0.1:5173' })
  vi.stubGlobal('WebSocket', Transport)
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (path: string) =>
        new Response(JSON.stringify(path === '/api/protocol' ? hello : snapshot)),
    ),
  )
  const changed = vi.fn<(view: RuntimeView) => void>()
  const client = new RuntimeClient(snapshot.sessionId, changed)
  client.connect()
  await vi.waitFor(() => expect(sockets[0]).toBeDefined())
  const turnId = crypto.randomUUID()
  let seq = 0
  const event = (payload: RuntimeEvent['payload']) => {
    seq++
    sockets[0]?.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'event',
          event: {
            version: 1,
            daemonId: snapshot.daemonId,
            sessionId: snapshot.sessionId,
            epoch: snapshot.epoch,
            seq,
            id: `${snapshot.epoch}:${seq}`,
            turnId,
            payload,
          },
        }),
      }),
    )
  }
  event({ type: 'turn.started', messageId: 'm', prompt: '离线' })
  changed.mockClear()
  return {
    client,
    changed,
    event,
    paints,
    paint: () => {
      for (const [key, callback] of paints) {
        paints.delete(key)
        callback(0)
      }
    },
  }
}

test('one frame accumulates every Chinese/emoji delta; terminal authoritative replacement is not appended', async () => {
  const f = await observer()
  f.event({ type: 'message.delta', messageId: 'm', text: '你' })
  f.event({ type: 'message.delta', messageId: 'm', text: '好' })
  f.event({ type: 'message.delta', messageId: 'm', text: '🙂' })
  expect(f.changed).not.toHaveBeenCalled()
  expect(f.paints.size).toBe(1)
  f.paint()
  expect(f.changed).toHaveBeenCalledTimes(1)
  expect(f.changed.mock.lastCall?.[0].snapshot?.turns[0]?.text).toBe('你好🙂')
  f.event({ type: 'message.delta', messageId: 'm', text: '旧尾巴' })
  f.event({ type: 'turn.finished', outcome: 'completed', text: '你好🙂权威终态' })
  expect(f.paints.size).toBe(0)
  expect(f.changed.mock.lastCall?.[0].snapshot?.turns[0]?.text).toBe('你好🙂权威终态')
  f.client.disconnect()
})

test.each(['approval', 'cancel', 'error', 'replacement'] as const)(
  'pending text immediately flushes on %s and cannot later overwrite status',
  async (kind) => {
    const f = await observer()
    f.event({ type: 'message.delta', messageId: 'm', text: '全部保留' })
    if (kind === 'approval') {
      f.event({
        type: 'approval.requested',
        approval: { id: 'a', command: 'synthetic read-only observation', cwd: 'fixture' },
      })
    }
    if (kind === 'cancel') {
      f.event({ type: 'turn.stopping' })
    }
    if (kind === 'error') {
      f.event({ type: 'turn.finished', outcome: 'error', error: '明确故障' })
    }
    if (kind === 'replacement') {
      f.event({ type: 'message.replaced', messageId: 'm', text: '替换全文' })
    }
    expect(f.changed).toHaveBeenCalledTimes(1)
    expect(f.paints.size).toBe(0)
    expect(f.changed.mock.lastCall?.[0].snapshot?.turns[0]?.text).toBe(
      kind === 'replacement' ? '替换全文' : '全部保留',
    )
    f.paint()
    expect(f.changed).toHaveBeenCalledTimes(1)
    f.client.disconnect()
  },
)

test('disconnect flushes text and cancels old frame; disposed generation ignores late transport', async () => {
  const f = await observer()
  f.event({ type: 'message.delta', messageId: 'm', text: '保留已接收内容' })
  f.client.disconnect()
  expect(f.paints.size).toBe(0)
  expect(f.changed.mock.lastCall?.[0].snapshot?.turns[0]?.text).toBe('保留已接收内容')
  const count = f.changed.mock.calls.length
  f.event({ type: 'message.delta', messageId: 'm', text: '迟到' })
  f.paint()
  expect(f.changed).toHaveBeenCalledTimes(count)
})
