import type { RuntimeFrame, RuntimeSnapshot } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { applyRuntimeEvent, runtimeFrameSchema, runtimeSnapshotSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { authorizedHeaders } from './helpers/access.js'

function request(snapshot: RuntimeSnapshot) {
  return {
    type: 'subscribe' as const,
    protocolVersion: 1 as const,
    requiredCapabilities: ['snapshots', 'replay', 'tool-observation'],
    sessionId: snapshot.sessionId,
    epoch: snapshot.epoch,
    daemonId: snapshot.daemonId,
    since: snapshot.seq,
  }
}

describe('CORE-05 replay journal boundaries (synthetic observations, no execution)', () => {
  it('replays retained records once, resyncs all unavailable cursors, and atomically joins live delivery', () => {
    const events = new EventService(2)
    const sessionId = randomUUID(),
      epoch = randomUUID(),
      turnId = randomUUID()
    events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
    const initial = events.snapshot(sessionId)
    if (!initial) {
      throw new Error('Missing snapshot')
    }
    events.publish(sessionId, epoch, turnId, {
      type: 'turn.started',
      messageId: 'm',
      prompt: 'fixture',
    })
    events.publish(sessionId, epoch, turnId, { type: 'message.delta', messageId: 'm', text: 'AB' })
    const frames: RuntimeFrame[] = []
    const off = events.subscribe(request(initial), (frame) => frames.push(frame))
    events.publish(sessionId, epoch, turnId, { type: 'turn.finished', outcome: 'completed' })
    expect(frames.map((frame) => frame.type)).toEqual(['event', 'event', 'caught-up', 'event'])
    const observed = frames
      .flatMap((frame) => (frame.type === 'event' ? [frame.event] : []))
      .reduce(applyRuntimeEvent, initial)
    expect(observed).toEqual(events.snapshot(sessionId))
    off()
    for (const cursor of [
      request(initial),
      { ...request(observed), since: 99 },
      { ...request(observed), epoch: randomUUID() },
      { ...request(observed), daemonId: randomUUID() },
    ]) {
      const notices: RuntimeFrame[] = []
      events.subscribe(cursor, (frame) => notices.push(frame))()
      expect(notices).toMatchObject([{ type: 'resync-required' }])
    }
    const copy = events.snapshot(sessionId)
    if (copy?.turns[0]) {
      copy.turns[0].text = 'client truncation'
    }
    expect(events.snapshot(sessionId)?.turns[0]?.text).toBe('AB')
  })
  it('byte retention does not truncate snapshots; approvals and terminal flush immediately; stale callbacks cannot alter next turn', () => {
    const events = new EventService(1024, 300)
    const sessionId = randomUUID(),
      epoch = randomUUID(),
      turnId = randomUUID()
    events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
    events.publish(sessionId, epoch, turnId, {
      type: 'turn.started',
      messageId: 'm',
      prompt: 'fixture',
    })
    const initial = events.snapshot(sessionId)
    if (!initial) {
      throw new Error('Missing snapshot')
    }
    const frames: RuntimeFrame[] = []
    events.subscribe(request(initial), (frame) => frames.push(frame))
    const text = '完整内容👩‍💻'.repeat(15000)
    events.publish(sessionId, epoch, turnId, { type: 'message.delta', messageId: 'm', text })
    events.publish(sessionId, epoch, turnId, {
      type: 'approval.requested',
      approval: { id: 'a', command: 'fixture only', cwd: 'fixture' },
    })
    expect(frames.at(-1)).toMatchObject({
      type: 'event',
      event: { payload: { type: 'approval.requested' } },
    })
    events.publish(sessionId, epoch, turnId, { type: 'turn.finished', outcome: 'aborted' })
    expect(frames.at(-1)).toMatchObject({
      type: 'event',
      event: { payload: { type: 'turn.finished' } },
    })
    const next = randomUUID()
    events.publish(sessionId, epoch, next, {
      type: 'turn.started',
      messageId: 'm2',
      prompt: 'next',
    })
    const before = events.snapshot(sessionId)
    events.publish(sessionId, epoch, turnId, { type: 'turn.finished', outcome: 'error' })
    expect(events.snapshot(sessionId)).toEqual(before)
    expect(events.snapshot(sessionId)?.turns[0]?.text).toBe(text)
    expect(events.snapshot(sessionId)?.turns[1]?.phase).toBe('running')
  })
})

describe('CORE-05 real SDK + local fixture over REST and native WebSocket', () => {
  it('keeps two TCP observers consistent through replay, abort, unknown tool, error and generation replacement', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-events-'))
    const port = 4328
    const app = await createApp({ dataDir: directory, port, development: true })
    const sockets: WebSocket[] = []
    try {
      await app.listen(port, '127.0.0.1')
      const headers = await authorizedHeaders(app, port)
      const kernels = app.get(KernelService),
        events = app.get(EventService)
      const sessionId = randomUUID()
      await kernels.open(sessionId, directory)
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/snapshot`, {
        headers,
      })
      const initial = runtimeSnapshotSchema.parse(await response.json())
      expect(response.headers.get('cache-control')).toBe('no-store')
      const connect = async (snapshot: RuntimeSnapshot) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
          headers,
          origin: 'http://127.0.0.1:5173',
        })
        sockets.push(socket)
        const frames: RuntimeFrame[] = []
        let view = snapshot
        socket.on('message', (raw) => {
          if (!Buffer.isBuffer(raw)) {
            throw new Error('Expected text frame buffer')
          }
          const frame = runtimeFrameSchema.parse(JSON.parse(raw.toString('utf8')))
          frames.push(frame)
          if (frame.type === 'hello') {
            socket.send(JSON.stringify(request(snapshot)))
          }
          if (frame.type === 'event') {
            view = applyRuntimeEvent(view, frame.event)
          }
        })
        await expect.poll(() => frames.some((frame) => frame.type === 'caught-up')).toBe(true)
        return { socket, frames, value: () => view }
      }
      const first = await connect(initial),
        second = await connect(initial)
      expect(
        await kernels.prompt(sessionId, directory, {
          turnId: randomUUID(),
          text: 'local streamed reply',
        }),
      ).toMatchObject({ outcome: 'completed', localRequests: 1, blockedNetworkAttempts: 0 })
      await expect.poll(() => first.value().turns[0]?.phase).toBe('completed')
      await expect.poll(() => second.value()).toEqual(events.snapshot(sessionId))
      expect(first.value().turns[0]?.text).toBe('OFFLINE_OK')
      const cursor = second.value()
      second.socket.close()
      const stopped = new Promise<void>((resolve) => second.socket.once('close', resolve))
      await stopped
      const turnId = randomUUID()
      const run = kernels.prompt(sessionId, directory, {
        turnId,
        text: 'abort fixture',
        fixture: 'hold',
      })
      await expect.poll(() => events.snapshot(sessionId)?.turns.at(-1)?.text).toBe('OFFLINE_')
      await expect.poll(() => first.value()).toEqual(events.visibleSnapshot(sessionId))
      await kernels.abort(sessionId, turnId)
      expect(await run).toMatchObject({ outcome: 'aborted' })
      const reconnected = await connect(cursor)
      await expect.poll(() => reconnected.value()).toEqual(first.value())
      await kernels.prompt(sessionId, directory, {
        turnId: randomUUID(),
        text: 'unknown tool fixture',
        fixture: 'unknown-tool',
      })
      await kernels.prompt(sessionId, directory, {
        turnId: randomUUID(),
        text: 'error fixture',
        fixture: 'error',
      })
      await expect.poll(() => reconnected.value()).toEqual(events.visibleSnapshot(sessionId))
      expect(JSON.stringify(reconnected.value())).not.toContain('fixture-model-error-secret')
      expect(reconnected.value().turns.at(-1)?.phase).toBe('error')
      const toolTurn = reconnected.value().turns[2]
      expect(toolTurn?.tools).toMatchObject([
        { id: 'offline-untrusted', name: 'write', status: 'error' },
      ])
      expect(toolTurn?.tools).toHaveLength(1)
      const delivered = reconnected.frames.flatMap((frame) =>
        frame.type === 'event' ? [frame.event.id] : [],
      )
      expect(new Set(delivered).size).toBe(delivered.length)
      await kernels.destroy(sessionId)
      await expect.poll(() => reconnected.frames.at(-1)?.type).toBe('resync-required')
      await kernels.open(sessionId, directory)
      expect(events.snapshot(sessionId)?.epoch).not.toBe(initial.epoch)
      expect(events.snapshot(sessionId)?.turns).toEqual([])
    } finally {
      for (const socket of sockets) {
        socket.terminate()
      }
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects foreign/missing Origin, bad Host, protocol/capability mismatches and command frames without executing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-protocol-'))
    const app = await createApp({ dataDir: directory, port: 4317, development: true })
    const server = app.getHttpAdapter().getInstance()
    try {
      const headers = await authorizedHeaders(app, 4317)
      const events = app.get(EventService),
        sessionId = randomUUID(),
        epoch = randomUUID()
      events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
      const snapshot = events.snapshot(sessionId)
      if (!snapshot) {
        throw new Error('Missing snapshot')
      }
      await Promise.all(
        [
          { host: '127.0.0.1:4317' },
          { host: '127.0.0.1:4317', origin: 'https://evil.example' },
          { host: 'evil.example', origin: 'http://127.0.0.1:5173' },
        ].map(async (invalidHeaders) => {
          await expect(server.injectWS('/api/events', { headers: invalidHeaders })).rejects.toThrow(
            /403/,
          )
        }),
      )
      await Promise.all(
        [
          { ...request(snapshot), protocolVersion: 2 },
          { ...request(snapshot), requiredCapabilities: ['execute'] },
          { type: 'prompt', text: 'must-not-run' },
        ].map(async (input) => {
          const socket = await server.injectWS('/api/events', {
            headers: { ...headers, origin: 'http://127.0.0.1:5173' },
          })
          const frames: RuntimeFrame[] = []
          socket.on('message', (raw) => {
            if (!Buffer.isBuffer(raw)) {
              throw new Error('Expected text frame buffer')
            }
            frames.push(runtimeFrameSchema.parse(JSON.parse(raw.toString('utf8'))))
          })
          socket.send(JSON.stringify(input))
          await expect.poll(() => frames.some((frame) => frame.type === 'incompatible')).toBe(true)
          socket.terminate()
        }),
      )
      expect(app.get(KernelService).list()).toEqual([])
      expect(events.snapshot(sessionId)).toEqual(snapshot)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
