import type { SessionSubmit } from '@pi-workbench/shared'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { accessSnapshotSchema, runtimeCapabilities } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { TrustService } from '../dist/modules/security/trust.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { ProjectService } from '../dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'

const port = 24408,
  directories: string[] = [],
  apps: Awaited<ReturnType<typeof createApp>>[] = []
const command = (projectId: string | null, workspaceId: string | null): SessionSubmit => ({
  requestId: randomUUID(),
  sessionId: null,
  configuration: {
    projectId,
    workspaceId,
    model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
    thinking: 'off',
  },
  text: '项目离线验收',
  retryOf: null,
})
const budget = readFileSync('docs/validation/live-validation-budget.json')
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-projects-'))) {
  directories.push(directory)
  const first = join(directory, '甲目录'),
    second = join(directory, 'Beta')
  mkdirSync(first, { recursive: true })
  mkdirSync(second, { recursive: true })
  const app = await createApp({ dataDir: join(directory, 'data'), port, development: true })
  apps.push(app)
  const projects = app.get(ProjectService),
    workspaces = app.get(WorkspaceService),
    service = app.get(SessionService)
  const store = app.get(SessionStore),
    kernels = app.get(KernelService),
    db = app.get(WorkspaceDatabase).sqlite
  const open = async (path = first) => {
    const result = await workspaces.open(path)
    assert(result.ok)
    return result.workspace
  }
  const create = (name = '同名项目', workspaceId: string | null = null) =>
    projects.create({ requestId: randomUUID(), name, workspaceId })
  const pair = async (kind: 'desktop' | 'browser') => {
    const ticket = app.get(AccessService).issueTicket(kind)
    const response = await app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
      payload: { code: ticket.code, label: `Projects ${kind}` },
    })
    const headers = {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
      cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
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

  const settled = async (id: string) => {
    await vi.waitFor(() => expect(store.submission(id)?.status).toBe('completed'), {
      timeout: 15000,
    })
  }
  return {
    directory,
    first,
    second,
    app,
    projects,
    workspaces,
    service,
    store,
    kernels,
    db,
    open,
    create,
    pair,
    command,
    settled,
  }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of new Set(directories.splice(0))) {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(readFileSync('docs/validation/live-validation-budget.json'), budget)
})

describe('WS-06 actual SQLite/default directory/SDK local fixture boundaries', () => {
  it('upgrades existing project identities/defaults in insertion order without creating sessions or opening directories', async () => {
    const f = await fixture(),
      ws = await f.open()
    const input = { requestId: randomUUID(), name: '旧项目甲', workspaceId: ws.id }
    const a = await f.projects.create(input),
      b = await f.create('旧项目乙')
    const recent = f.workspaces.recent()
    f.db.exec(
      'DROP TABLE session_origins; ALTER TABLE session_configurations DROP COLUMN membership_version',
    )
    f.db.exec(
      'ALTER TABLE projects DROP COLUMN pinned; ALTER TABLE projects DROP COLUMN position; ALTER TABLE projects DROP COLUMN revision; ALTER TABLE projects DROP COLUMN removed; ALTER TABLE projects DROP COLUMN creation_input; ALTER TABLE session_turns DROP COLUMN model_request; DROP TABLE operation_audit; DELETE FROM __drizzle_migrations WHERE created_at >= 1793711585232',
    )
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.projects.list()).toEqual([a, b])
    expect(await next.projects.create(input)).toEqual(a)
    expect(next.workspaces.recent()).toEqual(recent)
    expect(next.store.list()).toEqual([])
    expect(next.kernels.list()).toEqual([])
  })

  it('creates distinct same-name IDs, counts Unicode points and keeps create IDs bound after editing', async () => {
    const f = await fixture(),
      a = await f.create(),
      b = await f.create()
    expect(a.id).not.toBe(b.id)
    const input = { requestId: randomUUID(), name: '🧪'.repeat(80), workspaceId: null }
    const unicode = await f.projects.create(input)
    const edited = await f.projects.edit(unicode.id, {
      action: 'edit',
      name: '人工项目名',
      workspaceId: null,
      expectedRevision: unicode.revision,
    })
    expect(await f.projects.create(input)).toEqual(edited)
    await expect(f.projects.create({ ...input, name: '改变原请求' })).rejects.toThrow(
      '绑定其他内容',
    )
    await Promise.all(
      ['', ' \n ', '🧪'.repeat(81), '含\u200b格式'].map((name) =>
        expect(f.create(name)).rejects.toThrow('Unicode'),
      ),
    )
    expect(f.projects.list()).toHaveLength(3)
    expect(f.store.list()).toEqual([])
    expect(f.kernels.list()).toEqual([])
  })

  it('preserves edits on write failure, rejects stale/late revisions and diagnoses invalid default directories', async () => {
    const f = await fixture(),
      workspace = await f.open(),
      a = await f.create('目录项目', workspace.id)
    f.db.exec(
      "CREATE TRIGGER deny_project_edit BEFORE UPDATE OF name ON projects BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    )
    await expect(
      f.projects.edit(a.id, {
        action: 'edit',
        name: '待保存',
        workspaceId: workspace.id,
        expectedRevision: a.revision,
      }),
    ).rejects.toThrow('未能保存')
    expect(f.projects.list()[0]).toEqual(a)
    f.db.exec('DROP TRIGGER deny_project_edit')
    const edited = await f.projects.edit(a.id, {
      action: 'edit',
      name: '更新项目',
      workspaceId: workspace.id,
      expectedRevision: a.revision,
    })
    await expect(
      f.projects.edit(a.id, {
        action: 'edit',
        name: '旧版本',
        workspaceId: null,
        expectedRevision: a.revision,
      }),
    ).rejects.toThrow('项目已更新')
    const original = f.workspaces.validate.bind(f.workspaces)
    vi.spyOn(f.workspaces, 'validate').mockImplementationOnce(async (id) => {
      await f.projects.edit(a.id, {
        action: 'edit',
        name: '并发编辑',
        workspaceId: null,
        expectedRevision: edited.revision,
      })
      return original(id)
    })
    await expect(
      f.projects.edit(a.id, {
        action: 'edit',
        name: '迟到编辑',
        workspaceId: workspace.id,
        expectedRevision: edited.revision,
      }),
    ).rejects.toThrow('项目已更新')
    expect(f.projects.list()[0]?.name).toBe('并发编辑')
    rmSync(f.first, { recursive: true })
    await expect(f.create('失效目录', workspace.id)).rejects.toMatchObject({ status: 409 })
    expect(f.projects.list()).toHaveLength(1)
    expect(f.app.get(TrustService).inspect().records).toEqual([])
  })

  it('changes only future defaults; existing sessions continue at their saved cwd and model', async () => {
    const f = await fixture(),
      wa = await f.open(),
      wb = await f.open(f.second),
      project = await f.create('默认目录', wa.id)
    const first = await f.service.submit(f.command(project.id, wa.id))
    await f.settled(first.submission.requestId)
    const saved = first.session.configuration
    await f.projects.edit(project.id, {
      action: 'edit',
      name: '新默认',
      workspaceId: wb.id,
      expectedRevision: project.revision,
    })
    const continued = await f.service.submit({
      ...f.command(project.id, wa.id),
      sessionId: first.session.id,
      configuration: saved,
    })
    await f.settled(continued.submission.requestId)
    expect(continued.session.cwd).toBe(f.first)
    expect(continued.session.configuration).toEqual(saved)
    const next = await f.service.submit(f.command(project.id, wb.id))
    await f.settled(next.submission.requestId)
    expect(next.session.cwd).toBe(f.second)
    expect(f.app.get(TrustService).inspect().records).toEqual([])
  })

  it('gives unbound project sessions independent durable execution spaces and blocks changed defaults during directory IO', async () => {
    const f = await fixture(),
      project = await f.create(),
      ws = await f.open()
    const a = await f.service.submit(f.command(project.id, null))
    await f.settled(a.submission.requestId)
    const b = await f.service.submit(f.command(project.id, null))
    await f.settled(b.submission.requestId)
    expect(a.session.cwd).not.toBe(b.session.cwd)
    expect(a.session.cwd).toBe(join(f.directory, 'data', 'standalone', a.session.id))
    expect(b.session.cwd).toBe(join(f.directory, 'data', 'standalone', b.session.id))
    const original = f.workspaces.validate.bind(f.workspaces)
    await f.projects.edit(project.id, {
      action: 'edit',
      name: project.name,
      workspaceId: ws.id,
      expectedRevision: project.revision,
    })
    vi.spyOn(f.workspaces, 'validate').mockImplementationOnce(async (id) => {
      await f.projects.edit(project.id, {
        action: 'edit',
        name: '期间更改默认',
        workspaceId: null,
        expectedRevision: 2,
      })
      return original(id)
    })
    await expect(f.service.submit(f.command(project.id, ws.id))).rejects.toThrow('默认目录已变化')
    expect(f.store.managedSessions()).toHaveLength(2)
    expect(existsSync(a.session.cwd)).toBe(true)
  })

  it('uses paired desktop identity, protocol and exact Origin/CSRF for metadata mutations', async () => {
    const f = await fixture(),
      desktop = await f.pair('desktop'),
      browser = await f.pair('browser')
    const payload = { requestId: randomUUID(), name: 'HTTP 项目', workspaceId: null }
    const post = (
      headers: Record<string, string>,
      value: Record<string, unknown> = payload,
      url = '/api/chat/projects',
    ) => f.app.inject({ method: 'POST', url, headers, payload: value })
    expect((await post(browser)).statusCode).toBe(403)
    expect((await post({ ...desktop, 'x-piw-csrf': '' })).statusCode).toBe(403)
    expect((await post({ ...desktop, origin: 'https://invalid.test' })).statusCode).toBe(403)
    expect((await post({ ...desktop, 'x-piw-protocol': '0' })).statusCode).toBe(409)
    const response = await post(desktop)
    expect(response.statusCode).toBe(200)
    const a = f.projects.list()[0]
    assert(a)
    expect(
      (
        await post(
          desktop,
          { action: 'edit', name: '已编辑', workspaceId: null, expectedRevision: a.revision },
          `/api/chat/projects/${a.id}`,
        )
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await post(
          browser,
          { action: 'pin', pinned: true, expectedRevision: 2 },
          `/api/chat/projects/${a.id}`,
        )
      ).statusCode,
    ).toBe(403)
    expect(f.store.list()).toEqual([])
  })

  it('persists stable pinned/manual order and renamed/default metadata across complete daemon restart', async () => {
    const f = await fixture(),
      ws = await f.open(),
      a = await f.create('甲项目'),
      b = await f.create('乙项目', ws.id),
      c = await f.create('丙项目')
    const change = (
      id: string,
      input: { action: 'pin'; pinned: boolean } | { action: 'move'; direction: 'up' | 'down' },
    ) => {
      const row = f.projects.list().find((item) => item.id === id)
      assert(row)
      return f.service.organizeProject(id, { ...input, expectedRevision: row.revision })
    }
    change(c.id, { action: 'move', direction: 'up' })
    expect(f.projects.list().map((row) => row.id)).toEqual([a.id, c.id, b.id])
    change(b.id, { action: 'pin', pinned: true })
    change(a.id, { action: 'pin', pinned: true })
    expect(f.projects.list().map((row) => row.id)).toEqual([b.id, a.id, c.id])
    change(a.id, { action: 'move', direction: 'up' })
    expect(f.projects.list().map((row) => row.id)).toEqual([a.id, b.id, c.id])
    await expect(
      f.projects.edit(a.id, {
        action: 'edit',
        name: '迟到排序版本',
        workspaceId: null,
        expectedRevision: a.revision,
      }),
    ).rejects.toThrow('项目已更新')
    change(a.id, { action: 'pin', pinned: false })
    expect(f.projects.list().map((row) => row.id)).toEqual([b.id, c.id, a.id])
    const current = f.projects.list().find((row) => row.id === b.id)
    assert(current)
    await f.projects.edit(b.id, {
      action: 'edit',
      name: '跨重启项目',
      workspaceId: ws.id,
      expectedRevision: current.revision,
    })
    const before = f.projects.list()
    await f.app.close()
    const restarted = await fixture(f.directory)
    expect(restarted.projects.list()).toEqual(before)
    expect(restarted.kernels.list()).toEqual([])
    expect(restarted.store.list()).toEqual([])
  })

  it('atomically dissolves project attribution while preserving live PID/cwd, files, permissions and history, with rollback on failure', async () => {
    const f = await fixture(),
      ws = await f.open(),
      input = { requestId: randomUUID(), name: '运行项目', workspaceId: ws.id },
      project = await f.projects.create(input)
    writeFileSync(join(f.first, '保留.txt'), '用户数据保持')
    const original = f.kernels.prompt.bind(f.kernels)
    const promptSpy = vi
      .spyOn(f.kernels, 'prompt')
      .mockImplementation((id, cwd, prompt, options) =>
        original(id, cwd, { ...prompt, fixture: 'hold' }, options),
      )
    const receipt = await f.service.submit(f.command(project.id, ws.id))
    await vi.waitFor(() => expect(f.kernels.list()[0]?.state).toBe('running'), { timeout: 15000 })
    const kernel = f.kernels.list()[0]
    assert(kernel?.pid)
    f.db.exec(
      "CREATE TRIGGER deny_detach BEFORE UPDATE OF project_id ON session_configurations BEGIN SELECT RAISE(ABORT,'detach fixture'); END",
    )
    expect(() =>
      f.service.organizeProject(project.id, {
        action: 'remove',
        expectedRevision: project.revision,
      }),
    ).toThrow('未能保存')
    expect(f.projects.list()).toHaveLength(1)
    expect(f.store.managedSessions()[0]?.configuration.projectId).toBe(project.id)
    f.db.exec('DROP TRIGGER deny_detach')
    f.service.organizeProject(project.id, { action: 'remove', expectedRevision: project.revision })
    expect(f.projects.list()).toEqual([])
    const session = f.store.managedSessions()[0]
    assert(session)
    expect(session.configuration).toEqual({ ...receipt.session.configuration, projectId: null })
    expect(session.cwd).toBe(f.first)
    expect(f.kernels.list()[0]?.pid).toBe(kernel.pid)
    expect(f.kernels.list()[0]?.state).toBe('running')
    expect(readFileSync(join(f.first, '保留.txt'), 'utf8')).toBe('用户数据保持')
    expect(f.app.get(TrustService).inspect().records).toEqual([])
    await expect(f.projects.create(input)).rejects.toThrow('已移除')
    expect(() => f.projects.created(input.requestId)).toThrow('已移除')
    await f.kernels.abort(receipt.session.id, receipt.submission.turnId)
    await vi.waitFor(() =>
      expect(f.store.submission(receipt.submission.requestId)?.status).toBe('aborted'),
    )
    promptSpy.mockImplementation(original)
    const continuation = await f.service.submit({
      ...f.command(null, ws.id),
      sessionId: session.id,
      configuration: session.configuration,
    })
    await f.settled(continuation.submission.requestId)
    expect(continuation.session.cwd).toBe(receipt.session.cwd)
    const before = f.store.managedSessions()
    await f.app.close()
    const restarted = await fixture(f.directory)
    expect(restarted.projects.list()).toEqual([])
    expect(restarted.store.managedSessions()).toEqual(before)
    expect(restarted.kernels.list()).toEqual([])
  })

  it('rejects late first-send and continuation admission when removal happens during directory validation', async () => {
    const f = await fixture(),
      ws = await f.open(),
      project = await f.create('竞态项目', ws.id)
    const original = f.workspaces.validate.bind(f.workspaces)
    const validateSpy = vi.spyOn(f.workspaces, 'validate').mockImplementationOnce(async (id) => {
      f.service.organizeProject(project.id, {
        action: 'remove',
        expectedRevision: project.revision,
      })
      return original(id)
    })
    await expect(f.service.submit(f.command(project.id, ws.id))).rejects.toThrow('项目已移除')
    expect(f.store.managedSessions()).toEqual([])
    expect(f.kernels.list()).toEqual([])
    const second = await f.create('续发竞态', ws.id)
    const receipt = await f.service.submit(f.command(second.id, ws.id))
    await f.settled(receipt.submission.requestId)
    validateSpy.mockImplementationOnce(async (id) => {
      f.service.organizeProject(second.id, { action: 'remove', expectedRevision: second.revision })
      return original(id)
    })
    await expect(
      f.service.submit({ ...f.command(second.id, ws.id), sessionId: receipt.session.id }),
    ).rejects.toThrow('归属已变化')
    expect(f.store.submissions(receipt.session.id)).toHaveLength(1)
  })
})
