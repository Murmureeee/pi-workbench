import type { SessionTitleFrame } from '@pi-workbench/shared'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

import {
  accessSnapshotSchema,
  runtimeCapabilities,
  sessionTitleFrameSchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'

const port = 24378
const apps: Awaited<ReturnType<typeof createApp>>[] = [],
  directories: string[] = [],
  sockets: WebSocket[] = []
const budget = readFileSync('docs/validation/live-validation-budget.json')
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-titles-'))) {
  directories.push(directory)
  const app = await createApp({ dataDir: join(directory, 'data'), port, development: true })
  apps.push(app)
  const pair = async (kind: 'desktop' | 'browser') => {
    const ticket = app.get(AccessService).issueTicket(kind)
    const response = await app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
      payload: { code: ticket.code, label: `Title ${kind}` },
    })
    expect(response.statusCode).toBe(200)
    const headers = {
      host: `127.0.0.1:${port}`,
      cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
      origin: `http://127.0.0.1:${port}`,
    }
    const access = accessSnapshotSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/access', headers })).json(),
    )
    return {
      ...headers,
      'x-piw-csrf': access.csrf ?? '',
      'x-piw-protocol': '1',
      'x-piw-capabilities': runtimeCapabilities.join(','),
    }
  }
  const headers = await pair('desktop')
  const store = app.get(SessionStore),
    service = app.get(SessionService),
    kernels = app.get(KernelService)
  const create = async () => {
    const receipt = await service.submit({
      requestId: randomUUID(),
      sessionId: null,
      text: '初始中文标题',
      retryOf: null,
      configuration: {
        projectId: null,
        workspaceId: null,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    await vi.waitFor(
      () => expect(store.submission(receipt.submission.requestId)?.status).toBe('completed'),
      { timeout: 15000 },
    )
    return receipt
  }
  const rename = (id: string, title: string, expectedVersion: number, client = headers) =>
    app.inject({
      method: 'POST',
      url: `/api/chat/sessions/${id}/title`,
      headers: client,
      payload: { title, expectedVersion },
    })
  return { app, directory, pair, headers, store, service, kernels, create, rename }
}
afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate()
  }
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of new Set(directories.splice(0))) {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(readFileSync('docs/validation/live-validation-budget.json'), budget)
})

describe('SESSION-11 actual SQLite / SDK-local HTTP / authenticated TCP metadata', () => {
  it('trims Unicode code points, accepts duplicate titles, rejects invalid lengths/versions and preserves identity/history across restart', async () => {
    const f = await fixture(),
      a = await f.create(),
      b = await f.create()
    const path = f.kernels.list().find((row) => row.sessionId === a.session.id)?.sessionFile
    if (!path) {
      throw new Error('No SDK history')
    }
    const bytes = readFileSync(path)
    const invalid = await Promise.all(
      ['', ' \t\n ', '😀'.repeat(81)].map((title) => f.rename(a.session.id, title, 1)),
    )
    expect(invalid.map((row) => row.statusCode)).toEqual([400, 400, 400])
    expect((await f.rename(a.session.id, '版本无效', 0)).statusCode).toBe(400)
    const title = '😀'.repeat(80)
    expect((await f.rename(a.session.id, ` \t${title}\n`, 1)).json()).toEqual({
      sessionId: a.session.id,
      title,
      titleSource: 'user',
      titleVersion: 2,
    })
    expect((await f.rename(b.session.id, title, 1)).statusCode).toBe(200)
    expect(f.store.managedSessions().find((row) => row.id === a.session.id)).toEqual({
      ...a.session,
      title,
      titleSource: 'user',
      titleVersion: 2,
    })
    expect(readFileSync(path)).toEqual(bytes)
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.store.titles()).toHaveLength(2)
    expect(next.store.receipt(a.submission.requestId)?.session).toMatchObject({
      title,
      titleSource: 'user',
      titleVersion: 2,
    })
    expect(next.kernels.list()).toEqual([])
    expect(readFileSync(path)).toEqual(bytes)
  })

  it('serializes simultaneous clients with CAS, refreshes the title index and rejects browser or unpaired mutations', async () => {
    const f = await fixture(),
      a = await f.create(),
      second = await f.pair('desktop'),
      browser = await f.pair('browser')
    const results = await Promise.all([
      f.rename(a.session.id, '中文甲', 1),
      f.rename(a.session.id, '中文乙', 1, second),
    ])
    expect(results.filter((row) => row.statusCode === 200)).toHaveLength(1)
    expect(results.filter((row) => row.statusCode === 409)).toHaveLength(1)
    const saved = f.store.titles()[0]
    if (!saved) {
      throw new Error('No saved title')
    }
    const response = await f.app.inject({
      method: 'GET',
      url: `/api/session-titles?q=${encodeURIComponent(saved.title)}`,
      headers: browser,
    })
    expect(response.json()).toEqual({ titles: [saved] })
    expect(
      (
        await f.app.inject({ method: 'GET', url: '/api/session-titles?q=初始', headers: browser })
      ).json(),
    ).toEqual({ titles: [] })
    expect((await f.rename(a.session.id, '浏览器不可写', 2, browser)).statusCode).toBe(403)
    expect(
      (await f.rename(a.session.id, '无CSRF', 2, { ...second, 'x-piw-csrf': '' })).statusCode,
    ).toBe(403)
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/session-titles',
          headers: { host: `127.0.0.1:${port}` },
        })
      ).statusCode,
    ).toBe(401)
    expect((await f.rename(randomUUID(), '旧CLI或未知', 1)).statusCode).toBe(404)
    expect(f.store.titles()[0]).toEqual(saved)
  })

  it('rolls back failed saves without notifying clients, retains the original, and permits an explicit retry', async () => {
    const f = await fixture(),
      a = await f.create(),
      frames: SessionTitleFrame[] = []
    const off = f.app.get(EventService).subscribeTitles((frame) => frames.push(frame))
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      "CREATE TRIGGER reject_title BEFORE UPDATE OF title ON session_configurations BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END",
    )
    expect((await f.rename(a.session.id, '失败编辑保留', 1)).statusCode).toBe(503)
    expect(f.store.titles()[0]).toMatchObject({
      title: a.session.title,
      titleVersion: 1,
      titleSource: 'local',
    })
    expect(frames.map((row) => row.type)).toEqual(['titles-subscribed'])
    db.exec('DROP TRIGGER reject_title')
    expect((await f.rename(a.session.id, '失败编辑保留', 1)).statusCode).toBe(200)
    expect(frames.at(-1)).toMatchObject({ type: 'title.updated', title: { titleVersion: 2 } })
    off()
  })

  it('binds delayed local candidates to creation request/version and permanently protects manual ownership through continued sends', async () => {
    const f = await fixture(),
      a = await f.create(),
      id = a.session.id
    expect(() =>
      f.service.rename(id, { title: '错误首发', expectedVersion: 1 }, randomUUID()),
    ).toThrow(/标题已被/)
    f.service.rename(id, { title: '本地候选', expectedVersion: 1 }, a.session.creationRequestId)
    expect((await f.rename(id, '人工标题', 2)).statusCode).toBe(200)
    expect(() =>
      f.service.rename(
        id,
        { title: '迟到旧版本', expectedVersion: 1 },
        a.session.creationRequestId,
      ),
    ).toThrow(/标题已被/)
    expect(() =>
      f.service.rename(
        id,
        { title: '迟到新版本', expectedVersion: 3 },
        a.session.creationRequestId,
      ),
    ).toThrow(/标题已被/)
    const continued = await f.service.submit({
      requestId: randomUUID(),
      sessionId: id,
      text: '续发不改名',
      retryOf: null,
      configuration: a.session.configuration,
    })
    await vi.waitFor(
      () => expect(f.store.submission(continued.submission.requestId)?.status).toBe('completed'),
      { timeout: 15000 },
    )
    expect(f.store.receipt(continued.submission.requestId)?.session).toMatchObject({
      title: '人工标题',
      titleVersion: 3,
      titleSource: 'user',
    })
    expect(f.store.titles()[0]).toMatchObject({ title: '人工标题', titleVersion: 3 })
  })

  it('delivers redacted metadata to two authenticated TCP clients, isolates runtime cursors, reconnects to truth and closes revoked subscriptions', async () => {
    const f = await fixture(),
      a = await f.create()
    await f.app.listen(port, '127.0.0.1')
    const browser = await f.pair('browser')
    const subscribe = async (headers: { cookie: string }) => {
      const frames: SessionTitleFrame[] = []
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
        headers: { cookie: headers.cookie, origin: `http://127.0.0.1:${port}` },
      })
      sockets.push(socket)
      socket.on('message', (raw) => {
        if (!Buffer.isBuffer(raw)) {
          throw new Error('Non-buffer WS fixture frame')
        }
        const value: unknown = JSON.parse(raw.toString())
        if (value && typeof value === 'object' && 'type' in value && value.type === 'hello') {
          socket.send(JSON.stringify({ type: 'subscribe-titles', protocolVersion: 1 }))
        } else {
          frames.push(sessionTitleFrameSchema.parse(value))
        }
      })
      await vi.waitFor(() => expect(frames[0]?.type).toBe('titles-subscribed'))
      return { socket, frames }
    }
    const first = await subscribe(f.headers),
      second = await subscribe(browser)
    const snapshot = f.app.get(EventService).snapshot(a.session.id)
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
    expect((await f.rename(a.session.id, `中文 ${secret}`, 1)).statusCode).toBe(200)
    await vi.waitFor(() => {
      expect(first.frames).toHaveLength(2)
      expect(second.frames).toHaveLength(2)
    })
    expect(first.frames).toEqual(second.frames)
    expect(JSON.stringify(first.frames)).not.toContain(secret)
    expect(f.app.get(EventService).snapshot(a.session.id)).toEqual(snapshot)
    first.socket.close()
    await new Promise<void>((done) => first.socket.once('close', () => done()))
    expect((await f.rename(a.session.id, '断线期间的新标题', 2)).statusCode).toBe(200)
    const reconnected = await subscribe(f.headers)
    expect(reconnected.frames.map((row) => row.type)).toEqual(['titles-subscribed'])
    expect(
      (
        await f.app.inject({ method: 'GET', url: '/api/session-titles', headers: f.headers })
      ).json(),
    ).toMatchObject({ titles: [{ title: '断线期间的新标题', titleVersion: 3 }] })
    const authorization = accessSnapshotSchema.parse(
      (await f.app.inject({ method: 'GET', url: '/api/access', headers: browser })).json(),
    )
    const closed = new Promise<number>((done) => second.socket.once('close', done))
    if (!authorization.client) {
      throw new Error('No client')
    }
    f.app.get(AccessService).revoke(authorization.client.id)
    expect(await closed).toBe(1008)
  })

  it('migrates existing local titles without replacing text or creating a new session', async () => {
    const f = await fixture(),
      a = await f.create()
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      'DROP TABLE session_origins; ALTER TABLE session_configurations DROP COLUMN membership_version',
    )
    db.exec(
      'ALTER TABLE projects DROP COLUMN pinned; ALTER TABLE projects DROP COLUMN position; ALTER TABLE projects DROP COLUMN revision; ALTER TABLE projects DROP COLUMN removed; ALTER TABLE projects DROP COLUMN creation_input; DROP INDEX workspaces_recent_order; ALTER TABLE workspaces DROP COLUMN custom_name; ALTER TABLE workspaces DROP COLUMN last_opened_at; ALTER TABLE workspaces DROP COLUMN revision; ALTER TABLE session_configurations DROP COLUMN title_version; ALTER TABLE session_configurations DROP COLUMN title_source; ALTER TABLE session_turns DROP COLUMN model_request; DELETE FROM __drizzle_migrations WHERE created_at >= 1793682169954',
    )
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.store.managedSessions()).toEqual([a.session])
    expect(next.kernels.list()).toEqual([])
  })
})
