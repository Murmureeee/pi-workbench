import type { RuntimeFrame, RuntimeSnapshot } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expect, test } from 'vitest'
import { WebSocket } from 'ws'

import {
  applyRuntimeEvent,
  historyPageSchema,
  runtimeCapabilities,
  runtimeFrameSchema,
  runtimeSnapshotSchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

/** Explicit synthetic native file + real daemon persistence/HTTP/TCP. No SDK execution. */
function seed(store: SessionStore, events: EventService, directory: string) {
  const sessionId = randomUUID(),
    epoch = randomUUID(),
    turnId = randomUUID()
  const file = join(directory, 'kernels', sessionId, epoch, 'sessions', 'fixture.jsonl')
  mkdirSync(dirname(file), { recursive: true })
  const records = [
    { type: 'session', version: 3, id: sessionId, cwd: directory },
    {
      type: 'custom',
      id: 'marker',
      parentId: null,
      customType: 'pi-workbench.turn.v1',
      data: { version: 1, sessionId, epoch, turnId, messageId: `${turnId}:assistant` },
    },
    {
      type: 'message',
      id: 'user',
      parentId: 'marker',
      message: { role: 'user', content: [{ type: 'text', text: '合成工具观察，不执行' }] },
    },
    {
      type: 'message',
      id: 'assistant',
      parentId: 'user',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '合成观察完成' }],
        stopReason: 'stop',
      },
    },
  ]
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  store.registerRuntime({
    sessionId,
    epoch,
    cwd: directory,
    nativeSessionId: sessionId,
    sessionFile: file,
    source: 'synthetic-ipc-fixture',
  })
  events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
  events.publish(sessionId, epoch, turnId, {
    type: 'turn.started',
    messageId: `${turnId}:assistant`,
    prompt: '合成工具观察，不执行',
  })
  return { sessionId, epoch, turnId, file }
}

test('oBS-03 real HTTP/TCP snapshots/live/replay share safe nested calls; conflicting identities and partial secrets never rebind or leak', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-tool-events-')),
    port = 4336
  const app = await createApp({ dataDir: directory, port, development: true })
  let socket: WebSocket | undefined
  try {
    await app.listen(port, '127.0.0.1')
    const events = app.get(EventService),
      store = app.get(SessionStore),
      security = app.get(SecurityService)
    security.redactor.remember('fixture-private-token-123')
    const f = seed(store, events, directory),
      before = readFileSync(f.file)
    const headers = await authorizedHeaders(app, port)
    const read = async () =>
      runtimeSnapshotSchema.parse(
        await (
          await fetch(`http://127.0.0.1:${port}/api/sessions/${f.sessionId}/snapshot`, { headers })
        ).json(),
      )
    let view: RuntimeSnapshot = await read()
    socket = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
      headers,
      origin: 'http://127.0.0.1:5173',
    })
    const frames: RuntimeFrame[] = []
    socket.on('message', (raw) => {
      if (!Buffer.isBuffer(raw)) {
        throw new Error('Expected a text frame buffer')
      }
      const frame = runtimeFrameSchema.parse(JSON.parse(raw.toString('utf8')))
      frames.push(frame)
      if (frame.type === 'hello') {
        socket?.send(
          JSON.stringify({
            type: 'subscribe',
            protocolVersion: 1,
            requiredCapabilities: [...runtimeCapabilities],
            sessionId: f.sessionId,
            epoch: f.epoch,
            daemonId: view.daemonId,
            since: view.seq,
          }),
        )
      }
      if (frame.type === 'event') {
        view = applyRuntimeEvent(view, frame.event)
      }
    })
    await expect.poll(() => frames.some((frame) => frame.type === 'caught-up')).toBe(true)
    const initial = view
    events.publish(f.sessionId, f.epoch, f.turnId, {
      type: 'tool.updated',
      tool: {
        id: 'child',
        name: 'read',
        status: 'completed',
        summary: 'returned first',
        parentId: 'parent',
        origin: 'synthetic-fixture',
      },
    })
    events.publish(f.sessionId, f.epoch, f.turnId, {
      type: 'tool.updated',
      tool: {
        id: 'child',
        name: 'read',
        status: 'running',
        summary: '',
        parameters: '{"path":"中文.txt","apiKey":"never-shown"}',
        parentId: 'parent',
        origin: 'synthetic-fixture',
      },
    })
    events.publish(f.sessionId, f.epoch, f.turnId, {
      type: 'tool.updated',
      tool: {
        id: 'parent',
        name: 'custom',
        status: 'running',
        summary: '{"content":[{"text":"fixture-private-token-"}]}',
        origin: 'synthetic-fixture',
      },
    })
    await expect.poll(() => view.seq).toBe(events.snapshot(f.sessionId)?.seq)
    expect(JSON.stringify(frames)).not.toContain('never-shown')
    expect(JSON.stringify(frames)).not.toContain('fixture-private-token-')
    expect(view).toEqual(await read())
    events.publish(f.sessionId, f.epoch, f.turnId, {
      type: 'tool.updated',
      tool: { id: 'child', name: 'write', status: 'error', summary: 'wrong association' },
    })
    events.publish(f.sessionId, f.epoch, f.turnId, { type: 'turn.finished', outcome: 'aborted' })
    await expect.poll(() => view.seq).toBe(events.snapshot(f.sessionId)?.seq)
    expect(view.turns[0]?.tools[0]).toMatchObject({
      name: 'read',
      status: 'completed',
      summary: 'returned first',
      parentId: 'parent',
    })
    expect(view.turns[0]?.tools[0]?.diagnostic).toContain('冲突')
    expect(view.turns[0]?.tools[1]?.status).toBe('interrupted')
    const replay: RuntimeFrame[] = []
    events.subscribe(
      {
        type: 'subscribe',
        protocolVersion: 1,
        requiredCapabilities: [...runtimeCapabilities],
        sessionId: f.sessionId,
        epoch: f.epoch,
        daemonId: initial.daemonId,
        since: initial.seq,
      },
      (frame) => replay.push(frame),
      true,
    )()
    expect(
      replay
        .flatMap((frame) => (frame.type === 'event' ? [frame.event] : []))
        .reduce(applyRuntimeEvent, initial),
    ).toEqual(view)
    const page = historyPageSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${port}/api/sessions/${f.sessionId}/history`, { headers })
      ).json(),
    )
    expect(page.toolTimelines?.[0]?.tools[0]?.parameters).not.toContain('never-shown')
    expect(page.toolTimelines?.[0]?.tools[1]?.summary).not.toContain('fixture-private-token-')
    expect(events.snapshot(f.sessionId)?.turns[0]?.tools[0]?.parameters).toContain('never-shown')
    expect(readFileSync(f.file)).toEqual(before)
    expect(app.get(KernelService).list()).toEqual([])
  } finally {
    socket?.terminate()
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('oBS-03 actual SQLite restart retains earlier turn observations, separates reused call IDs, and never resumes tools', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-tool-history-'))
  let app = await createApp({ dataDir: directory, port: 4328 })
  try {
    const store = app.get(SessionStore),
      events = app.get(EventService),
      f = seed(store, events, directory)
    events.publish(f.sessionId, f.epoch, f.turnId, {
      type: 'tool.updated',
      tool: {
        id: 'same',
        name: 'write',
        status: 'denied',
        summary: '明确拒绝',
        parameters: '{"path":"not-created.txt","content":"fixture"}',
        origin: 'synthetic-fixture',
      },
    })
    events.publish(f.sessionId, f.epoch, f.turnId, { type: 'turn.finished', outcome: 'completed' })
    const next = randomUUID()
    events.publish(f.sessionId, f.epoch, next, {
      type: 'turn.started',
      messageId: `${next}:assistant`,
      prompt: '第二轮合成观察',
    })
    events.publish(f.sessionId, f.epoch, next, {
      type: 'tool.updated',
      tool: {
        id: 'same',
        name: 'write',
        status: 'running',
        summary: '未确认的输出',
        origin: 'synthetic-fixture',
      },
    })
    const historyBefore = readFileSync(f.file)
    await app.close()
    app = await createApp({ dataDir: directory, port: 4328 })
    const restored = app.get(EventService).snapshot(f.sessionId)
    expect(restored?.turns[0]?.id).toBe(next)
    expect(restored?.turns[0]?.tools[0]?.status).toBe('interrupted')
    const page = app.get(SessionStore).history(f.sessionId)
    expect(
      page?.toolTimelines?.find((timeline) => timeline.turnId === f.turnId)?.tools[0]?.status,
    ).toBe('denied')
    expect(
      page?.toolTimelines?.find((timeline) => timeline.turnId === next)?.tools[0]?.status,
    ).toBe('interrupted')
    expect(app.get(KernelService).list()).toEqual([])
    expect(readFileSync(f.file)).toEqual(historyBefore)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
