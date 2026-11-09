import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { messageLocationSchema, sessionSearchQuerySchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SearchService } from '../dist/modules/search/search.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'
import { seedSearchSession } from './helpers/search.js'

test('oBS-05 actual SQLite message mode returns every match with scoped deterministic pages and redacted snippets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-msg-'))
  const app = await createApp({ dataDir: directory, port: 24418, development: true })
  try {
    const a = await seedSearchSession(
      app,
      directory,
      '同词标题',
      Array.from({ length: 34 }, (_, i) => `同词 第${i}条 api_key=fixture-hidden-value`),
    )
    await seedSearchSession(app, directory, '另一个会话', ['同词 输入', '同词 回复'])
    const search = app.get(SearchService),
      store = app.get(SessionStore)
    const before = readFileSync(a.sessionFile)
    const find = (patch: object) =>
      search.search(sessionSearchQuerySchema.parse({ q: '同词', ...patch }))
    expect(find({}).total).toBe(2)
    const first = find({ mode: 'messages', session: a.session.id, limit: 20 })
    const second = find({ mode: 'messages', session: a.session.id, limit: 20, page: 2 })
    expect(first.total).toBe(34)
    expect(second.results).toHaveLength(14)
    expect(new Set([...first.results, ...second.results].map((row) => row.messageId)).size).toBe(34)
    expect(JSON.stringify(first)).not.toContain('fixture-hidden-value')
    expect(find({ mode: 'messages' }).total).toBe(36)
    expect(find({ mode: 'messages', session: randomUUID() }).results).toEqual([])
    const archived = store.organizations().find((row) => row.sessionId === a.session.id)!
    store.organize(a.session.id, {
      action: 'archive',
      archived: true,
      expectedRevision: archived.revision,
    })
    expect(find({ mode: 'messages' }).total).toBe(2)
    expect(find({ mode: 'messages', archive: 'all' }).total).toBe(36)
    expect(readFileSync(a.sessionFile)).toEqual(before)
    expect(app.get(KernelService).list()).toEqual([])
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('oBS-05 paired HTTP resolves only owned native messages/tools; archive, missing content and same-data restart remain truthful', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-msg-'))
  let app = await createApp({ dataDir: directory, port: 24418, development: true })
  try {
    const a = await seedSearchSession(app, directory, '链接归属'),
      b = await seedSearchSession(app, directory, '其他会话')
    const store = app.get(SessionStore),
      events = app.get(EventService)
    events.attach(a.session.id, a.epoch, 'synthetic-ipc-fixture')
    events.publish(a.session.id, a.epoch, a.submission.turnId, {
      type: 'turn.started',
      messageId: `${a.submission.turnId}:assistant`,
      prompt: '合成观察',
    })
    events.publish(a.session.id, a.epoch, a.submission.turnId, {
      type: 'tool.updated',
      tool: {
        id: 'read-one',
        name: 'read',
        status: 'completed',
        summary: '合成结果，未执行',
        origin: 'synthetic-fixture',
      },
    })
    events.publish(a.session.id, a.epoch, a.submission.turnId, {
      type: 'turn.finished',
      outcome: 'completed',
    })
    const message = store.history(a.session.id)!.messages[0]
    assert(message)
    let headers = await authorizedHeaders(app, 24418)
    const get = (session: string, target: object, paired = true) =>
      app.inject({
        method: 'GET',
        url: `/api/sessions/${session}/locate?${new URLSearchParams(Object.entries(target))}`,
        headers: paired ? headers : { host: headers.host },
      })
    expect(
      (await get(a.session.id, { kind: 'message', messageId: message.id }, false)).statusCode,
    ).toBe(401)
    expect(
      (await get(a.session.id, { kind: 'message', messageId: message.id, extra: 'x' })).statusCode,
    ).toBe(400)
    const tool = { kind: 'tool', turnId: a.submission.turnId, toolId: 'read-one' }
    const resolved = messageLocationSchema.parse((await get(a.session.id, tool)).json())
    expect(resolved).toMatchObject({
      sessionId: a.session.id,
      turnId: a.submission.turnId,
      toolId: 'read-one',
      archived: false,
    })
    expect((await get(b.session.id, tool)).statusCode).toBe(404)
    expect((await get(a.session.id, { ...tool, toolId: 'missing' })).statusCode).toBe(404)
    expect(
      store
        .history(a.session.id, undefined, 2, resolved.messageId)
        ?.messages.some((row) => row.id === resolved.messageId),
    ).toBe(true)
    const org = store.organizations().find((row) => row.sessionId === a.session.id)!
    store.organize(a.session.id, {
      action: 'archive',
      archived: true,
      expectedRevision: org.revision,
    })
    expect(messageLocationSchema.parse((await get(a.session.id, tool)).json()).archived).toBe(true)
    const native = readFileSync(a.sessionFile)
    unlinkSync(a.sessionFile)
    expect((await get(a.session.id, tool)).statusCode).toBe(404)
    writeFileSync(a.sessionFile, native)
    await app.close()
    app = await createApp({ dataDir: directory, port: 24418, development: true })
    headers = await authorizedHeaders(app, 24418)
    expect(messageLocationSchema.parse((await get(a.session.id, tool)).json())).toEqual({
      ...resolved,
      archived: true,
    })
    expect(app.get(KernelService).list()).toEqual([])
    expect(readFileSync(a.sessionFile)).toEqual(native)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('oBS-05 actual SDK local fixture resolves accepted turn/role to persisted native identities without replay on restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-msg-sdk-'))
  const budget = readFileSync('docs/validation/live-validation-budget.json')
  let app = await createApp({ dataDir: directory, port: 24418, development: true })
  try {
    const receipt = await app.get(SessionService).submit({
      requestId: randomUUID(),
      sessionId: null,
      retryOf: null,
      text: '本地SDK消息链接',
      configuration: {
        projectId: null,
        workspaceId: null,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    const { session, submission } = receipt
    await vi.waitFor(
      () =>
        expect(app.get(SessionStore).submission(submission.requestId)?.status).toBe('completed'),
      { timeout: 15000 },
    )
    const store = app.get(SessionStore),
      kernels = app.get(KernelService)
    const native = kernels.list()[0]
    assert(native?.sessionFile)
    const file = native.sessionFile
    const before = readFileSync(file)
    const user = store.locate(session.id, {
      kind: 'turn',
      turnId: submission.turnId,
      role: 'user',
    })!
    const reply = store.locate(session.id, {
      kind: 'turn',
      turnId: submission.turnId,
      role: 'assistant',
    })!
    expect(user.messageId).not.toBe(submission.messageId)
    expect(reply.messageId).not.toBe(`${submission.messageId}:reply`)
    expect(store.content(session.id, reply.messageId)?.text).toContain('OFFLINE_OK')
    expect(kernels.list()[0]?.pid).toBe(native.pid)
    expect(readFileSync(file)).toEqual(before)
    await app.close()
    app = await createApp({ dataDir: directory, port: 24418, development: true })
    expect(
      app.get(SessionStore).locate(session.id, { kind: 'message', messageId: reply.messageId }),
    ).toEqual(reply)
    expect(app.get(KernelService).list()).toEqual([])
    expect(readFileSync(file)).toEqual(before)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
    expect(readFileSync('docs/validation/live-validation-budget.json')).toEqual(budget)
  }
}, 30000)
