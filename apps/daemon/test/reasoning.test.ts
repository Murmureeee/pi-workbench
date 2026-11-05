import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expect, test } from 'vitest'

import { historyPageSchema, runtimeCapabilities } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

test('oBS-06 actual HTTP/history/checkpoint/replay and restart withhold filtered/opaque data and never execute a request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-reasoning-')),
    port = 4342
  let app = await createApp({ dataDir: directory, port, development: true })
  const id = randomUUID(),
    epoch = randomUUID(),
    turnId = randomUUID()
  const file = join(directory, 'kernels', id, epoch, 'sessions', 'fixture.jsonl')
  const records = [
    { type: 'session', version: 3, id, cwd: directory },
    {
      type: 'custom',
      id: 'marker',
      parentId: null,
      customType: 'pi-workbench.turn.v1',
      data: { version: 1, sessionId: id, epoch, turnId, messageId: `${turnId}:assistant` },
    },
    {
      type: 'message',
      id: 'a',
      parentId: 'marker',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'FORBIDDEN', redacted: true, thinkingSignature: 'OPAQUE' },
          { type: 'text', text: '普通回答' },
        ],
        stopReason: 'stop',
      },
    },
  ]
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  const original = readFileSync(file)
  try {
    const events = app.get(EventService),
      store = app.get(SessionStore),
      security = app.get(SecurityService)
    store.registerRuntime({
      sessionId: id,
      epoch,
      cwd: directory,
      nativeSessionId: id,
      sessionFile: file,
      source: 'synthetic-ipc-fixture',
    })
    events.attach(id, epoch, 'synthetic-ipc-fixture')
    events.publish(id, epoch, turnId, {
      type: 'turn.started',
      messageId: `${turnId}:assistant`,
      prompt: '观察夹具',
    })
    security.redactor.remember('private-token-value')
    events.publish(id, epoch, turnId, {
      type: 'reasoning.updated',
      reasoning: { status: 'provided', text: '公开 private-token-value', truncated: false },
    })
    const frames: unknown[] = []
    events.subscribe(
      {
        type: 'subscribe',
        sessionId: id,
        daemonId: events.daemonId,
        epoch,
        since: 0,
        protocolVersion: 1,
        requiredCapabilities: [...runtimeCapabilities],
      },
      (frame) => frames.push(frame),
      true,
    )()
    expect(JSON.stringify(frames)).toContain('公开 ')
    expect(JSON.stringify(frames)).not.toContain('private-token-value')
    expect(events.visibleSnapshot(id)?.turns[0]?.reasoning).toMatchObject({ text: '公开 ' })
    events.publish(id, epoch, turnId, {
      type: 'reasoning.updated',
      reasoning: { status: 'unavailable' },
    })
    events.publish(id, epoch, turnId, { type: 'turn.finished', outcome: 'completed' })
    events.publish(id, epoch, turnId, {
      type: 'reasoning.updated',
      reasoning: { status: 'provided', text: 'LATE', truncated: false },
    })
    expect(events.snapshot(id)?.turns[0]?.reasoning).toEqual({ status: 'unavailable' })
    const headers = await authorizedHeaders(app, port)
    const history = await app.inject({ url: `/api/sessions/${id}/history`, headers })
    expect(history.statusCode).toBe(200)
    expect(history.body).not.toMatch(/FORBIDDEN|OPAQUE|THINKING_ONLY/)
    expect(historyPageSchema.parse(history.json()).messages[0]?.reasoning).toEqual({
      status: 'unavailable',
    })
    const content = await app.inject({
      url: `/api/sessions/${id}/messages/${encodeURIComponent(`${epoch}:a`)}/content`,
      headers,
    })
    expect(content.body).toBe('普通回答')
    expect(security.export(Buffer.from(JSON.stringify(records[2])))?.toString()).not.toMatch(
      /FORBIDDEN|OPAQUE/,
    )
    expect(
      security.export(Buffer.from('{"type":"thinking","redacted":true,"thinking":"FORBIDDEN"')),
    ).toBeUndefined()
    await app.close()
    app = await createApp({ dataDir: directory, port, development: true })
    expect(app.get(EventService).visibleSnapshot(id)?.turns[0]?.reasoning).toEqual({
      status: 'unavailable',
    })
    expect(readFileSync(file)).toEqual(original)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
