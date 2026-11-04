import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accessSnapshotSchema,
  workspaceMetadataResultSchema,
  workspaceRecentSchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { TrustService } from '../dist/modules/security/trust.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'

const port = 24388
const apps: Awaited<ReturnType<typeof createApp>>[] = []
const directories: string[] = []
const budget = readFileSync('docs/validation/live-validation-budget.json')
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-recents-'))) {
  directories.push(directory)
  const first = join(directory, '甲目录'),
    second = join(directory, 'Beta')
  mkdirSync(first, { recursive: true })
  mkdirSync(second, { recursive: true })
  const app = await createApp({ dataDir: join(directory, 'data'), port, development: true })
  apps.push(app)
  const service = app.get(WorkspaceService),
    db = app.get(WorkspaceDatabase).sqlite
  const record = (id: string) => {
    const result = service.recent().entries.find((entry) => entry.id === id)
    assert(result)
    return result
  }
  const open = async (path = first) => {
    const result = await service.open(path)
    assert(result.ok)
    return record(result.workspace.id)
  }
  const pair = async (kind: 'desktop' | 'browser') => {
    const ticket = app.get(AccessService).issueTicket(kind)
    const response = await app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
      payload: { code: ticket.code, label: `Recent ${kind}` },
    })
    const headers = {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
      cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
    }
    const access = accessSnapshotSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/access', headers })).json(),
    )
    return { ...headers, 'x-piw-csrf': access.csrf ?? '' }
  }
  return { directory, first, second, app, service, db, record, open, pair }
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of new Set(directories.splice(0))) {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(readFileSync('docs/validation/live-validation-budget.json'), budget)
})

describe('WS-02 actual SQLite, directory, HTTP and SDK/local fixture boundaries', () => {
  it('persists explicit-open order and custom names across restart; validation and rename do not reorder; aliases preserve names', async () => {
    const f = await fixture(),
      a = await f.open(),
      b = await f.open(f.second)
    expect(f.service.recent().entries.map((row) => row.id)).toEqual([b.id, a.id])
    const changed = f.service.rename({
      id: a.id,
      name: '  开发工作区 🧪  ',
      expectedRevision: a.revision,
    })
    expect(changed).toMatchObject({
      ok: true,
      record: { name: '开发工作区 🧪', customName: '开发工作区 🧪' },
    })
    expect((await f.service.validate(a.id)).ok).toBe(true)
    expect(f.service.recent().entries.map((row) => [row.id, row.lastOpenedAt])).toEqual([
      [b.id, b.lastOpenedAt],
      [a.id, a.lastOpenedAt],
    ])
    const alias = join(f.directory, 'alias')
    symlinkSync(f.first, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const reused = await f.open(alias)
    expect(reused).toMatchObject({ id: a.id, name: '开发工作区 🧪' })
    expect(f.service.recent().entries.map((row) => row.id)).toEqual([a.id, b.id])
    const before = f.service.recent()
    await f.app.close()
    const restarted = await fixture(f.directory)
    expect(restarted.service.recent()).toEqual(before)
    expect(restarted.app.get(KernelService).list()).toEqual([])
    expect(restarted.app.get(SessionStore).list()).toEqual([])
  })

  it('keeps 100 visible entries bounded without deleting older registrations or inventing legacy/internal recency', async () => {
    const f = await fixture()
    const internal = await f.service.open(f.first, { remember: false })
    assert(internal.ok)
    expect(f.service.recent().entries).toEqual([])
    const insert = f.db.prepare(
      'INSERT INTO workspaces (id, directory_key, canonical_path, name, last_opened_at) VALUES (?, ?, ?, ?, ?)',
    )
    f.db.transaction(() => {
      for (let i = 0; i < 102; i++) {
        insert.run(
          randomUUID(),
          `synthetic-identity-${i}`,
          join(f.directory, `synthetic-path-${i}`),
          `合成旧记录 ${i}`,
          i + 1,
        )
      }
    })()
    expect(f.service.recent().total).toBe(102)
    expect(f.service.recent().limit).toBe(100)
    expect(f.service.recent().entries).toHaveLength(100)
    expect(f.service.recent().entries[0]?.name).toBe('合成旧记录 101')
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM workspaces').get()).toEqual({ n: 103 })
    expect(f.app.get(SessionStore).list()).toEqual([])
  })

  it('validates Unicode names, preserves failed edits and uses revision conflicts rather than overwriting concurrent changes', async () => {
    const f = await fixture(),
      a = await f.open()
    expect(
      f.service.rename({ id: a.id, name: '🧪'.repeat(81), expectedRevision: a.revision }),
    ).toMatchObject({ ok: false, code: 'invalid_name' })
    expect(
      f.service.rename({ id: a.id, name: ' \n ', expectedRevision: a.revision }),
    ).toMatchObject({ ok: false, code: 'invalid_name' })
    expect(f.record(a.id)).toEqual(a)
    f.db.exec(
      "CREATE TRIGGER deny_workspace_name BEFORE UPDATE OF custom_name ON workspaces BEGIN SELECT RAISE(FAIL, 'fixture name save failure'); END",
    )
    expect(
      f.service.rename({ id: a.id, name: '保留编辑', expectedRevision: a.revision }),
    ).toMatchObject({ ok: false, code: 'storage_failed' })
    expect(f.record(a.id)).toEqual(a)
    f.db.exec('DROP TRIGGER deny_workspace_name')
    const saved = f.service.rename({
      id: a.id,
      name: '🧪'.repeat(80),
      expectedRevision: a.revision,
    })
    assert(saved.ok)
    expect(saved.record.name).toBe('🧪'.repeat(80))
    expect(
      f.service.rename({ id: a.id, name: '迟到编辑', expectedRevision: a.revision }),
    ).toMatchObject({ ok: false, code: 'conflict', current: saved.record })
    expect(f.service.remove({ id: a.id, expectedRevision: a.revision })).toMatchObject({
      ok: false,
      code: 'conflict',
    })
    expect(
      f.service.rename({ id: a.id, name: null, expectedRevision: saved.record.revision }),
    ).toMatchObject({ ok: true, record: { name: '甲目录', customName: null } })
    expect(readdirSync(f.directory)).toContain('甲目录')
  })

  it('diagnoses moved/replaced paths and explicitly relocates only the same identity, retaining ordering and metadata on any failure', async () => {
    const f = await fixture(),
      a = await f.open(),
      b = await f.open(f.second)
    const moved = join(f.directory, '移动后的甲目录')
    renameSync(f.first, moved)
    expect(await f.service.activate(a.id)).toMatchObject({ ok: false, code: 'not_found' })
    expect(await f.service.open(moved)).toMatchObject({ ok: false, code: 'relocation_required' })
    expect(
      await f.service.relocate({ id: a.id, expectedRevision: a.revision, path: f.second }),
    ).toMatchObject({ ok: false, code: 'directory_changed' })
    expect(f.record(a.id)).toEqual(a)
    f.db.exec(
      "CREATE TRIGGER deny_workspace_path BEFORE UPDATE OF canonical_path ON workspaces BEGIN SELECT RAISE(FAIL, 'fixture relocate failure'); END",
    )
    expect(
      await f.service.relocate({ id: a.id, expectedRevision: a.revision, path: moved }),
    ).toMatchObject({ ok: false, code: 'storage_failed' })
    expect(f.record(a.id)).toEqual(a)
    f.db.exec('DROP TRIGGER deny_workspace_path')
    const result = await f.service.relocate({ id: a.id, expectedRevision: a.revision, path: moved })
    assert(result.ok)
    expect(result.record).toMatchObject({
      id: a.id,
      canonicalPath: moved,
      lastOpenedAt: a.lastOpenedAt,
    })
    expect(f.service.recent().entries.map((entry) => entry.id)).toEqual([b.id, a.id])
    expect((await f.service.activate(a.id)).ok).toBe(true)
    expect(f.service.recent().entries[0]?.id).toBe(a.id)
    expect(f.app.get(TrustService).inspect().records).toEqual([])
    expect(readdirSync(moved).filter((name) => name.startsWith('.pi-workbench-check-'))).toEqual([])
  })

  it('removes only a recent marker while a real SDK task runs; reopening preserves identity/name and relocation never rewrites existing cwd/history', async () => {
    const f = await fixture(),
      a = await f.open()
    writeFileSync(join(f.first, '用户文件.txt'), '用户内容')
    const sessions = f.app.get(SessionService),
      store = f.app.get(SessionStore),
      kernels = f.app.get(KernelService)
    const prompt = kernels.prompt.bind(kernels)
    vi.spyOn(kernels, 'prompt').mockImplementationOnce((id, cwd, command, options) =>
      prompt(id, cwd, { ...command, fixture: 'hold' }, options),
    )
    const receipt = await sessions.submit({
      requestId: randomUUID(),
      sessionId: null,
      text: '离线后台任务',
      retryOf: null,
      configuration: {
        projectId: null,
        workspaceId: a.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    await vi.waitFor(
      () =>
        expect(f.app.get(EventService).snapshot(receipt.session.id)?.turns.at(-1)?.text).toContain(
          'OFFLINE_',
        ),
      { timeout: 15000 },
    )
    const pid = kernels.list().find((kernel) => kernel.sessionId === receipt.session.id)?.pid
    assert(pid)
    const renamed = f.service.rename({
      id: a.id,
      name: '保留名称',
      expectedRevision: f.record(a.id).revision,
    })
    assert(renamed.ok)
    const removed = f.service.remove({ id: a.id, expectedRevision: renamed.record.revision })
    assert(removed.ok)
    expect(f.service.recent().entries).toEqual([])
    expect(kernels.list().find((kernel) => kernel.sessionId === receipt.session.id)?.pid).toBe(pid)
    expect(store.submission(receipt.submission.requestId)?.status).toBe('executing')
    expect(readFileSync(join(f.first, '用户文件.txt'), 'utf8')).toBe('用户内容')
    const reopened = await f.open()
    expect(reopened).toMatchObject({ id: a.id, name: '保留名称' })
    await kernels.abort(receipt.session.id, receipt.submission.turnId)
    await kernels.destroy(receipt.session.id)
    const history = store.resumeRuntime(receipt.session.id, receipt.session.cwd)
    assert(history)
    const before = readFileSync(history.sessionFile)
    const moved = join(f.directory, '原目录移动')
    renameSync(f.first, moved)
    expect(
      await f.service.relocate({ id: a.id, path: moved, expectedRevision: reopened.revision }),
    ).toMatchObject({ ok: true })
    expect(store.managedSessions().find((session) => session.id === receipt.session.id)?.cwd).toBe(
      f.first,
    )
    await expect(
      sessions.submit({
        requestId: randomUUID(),
        sessionId: receipt.session.id,
        text: '不应隐式切换目录',
        retryOf: null,
        configuration: receipt.session.configuration,
      }),
    ).rejects.toThrow(/执行目录身份已变化/)
    expect(readFileSync(history.sessionFile)).toEqual(before)
    expect(kernels.list()).toEqual([])
    expect(existsSync(join(moved, '用户文件.txt'))).toBe(true)
  })

  it('enforces desktop/Host/Origin/CSRF boundaries and validates actual recent/rename/remove/relocate HTTP responses', async () => {
    const f = await fixture(),
      a = await f.open(),
      desktop = await f.pair('desktop'),
      browser = await f.pair('browser')
    const payload = { id: a.id, expectedRevision: a.revision, name: 'HTTP 名称' }
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/workspaces/recent',
          headers: { host: desktop.host },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (await f.app.inject({ method: 'GET', url: '/api/workspaces/recent', headers: browser }))
        .statusCode,
    ).toBe(403)
    const rejected = await Promise.all(
      [
        browser,
        { ...desktop, host: 'evil.example' },
        { ...desktop, origin: 'http://evil.example' },
        { ...desktop, 'x-piw-csrf': 'wrong' },
      ].map((headers) =>
        f.app.inject({ method: 'POST', url: '/api/workspaces/rename', headers, payload }),
      ),
    )
    expect(rejected.map((rejection) => rejection.statusCode)).toEqual([403, 403, 403, 403])
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/workspaces/rename',
      headers: desktop,
      payload,
    })
    const saved = workspaceMetadataResultSchema.parse(response.json())
    assert(saved.ok)
    expect(saved.record.name).toBe('HTTP 名称')
    const list = await f.app.inject({
      method: 'GET',
      url: '/api/workspaces/recent',
      headers: desktop,
    })
    expect(list.headers['cache-control']).toBe('no-store')
    expect(workspaceRecentSchema.parse(list.json()).entries[0]).toEqual(saved.record)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/workspaces/rename',
          headers: desktop,
          payload: { ...payload, extra: true },
        })
      ).statusCode,
    ).toBe(400)
    const browserWrites = await Promise.all(
      ['remove', 'relocate', 'activate'].map((operation) =>
        f.app.inject({
          method: 'POST',
          url: `/api/workspaces/${operation}`,
          headers: browser,
          payload:
            operation === 'activate'
              ? { id: a.id }
              : {
                  id: a.id,
                  expectedRevision: saved.record.revision,
                  ...(operation === 'relocate' ? { path: f.first } : {}),
                },
        }),
      ),
    )
    expect(browserWrites.map((rejection) => rejection.statusCode)).toEqual([403, 403, 403])
    expect(f.app.get(SessionStore).list()).toEqual([])
    expect(f.app.get(TrustService).inspect().records).toEqual([])
  })

  it('migrates the actual previous registry without inventing recency or losing original identity/name and session data', async () => {
    const f = await fixture(),
      a = await f.open()
    f.db.exec(
      'DROP TABLE session_origins; ALTER TABLE session_configurations DROP COLUMN membership_version',
    )
    f.db.exec(
      'ALTER TABLE projects DROP COLUMN pinned; ALTER TABLE projects DROP COLUMN position; ALTER TABLE projects DROP COLUMN revision; ALTER TABLE projects DROP COLUMN removed; ALTER TABLE projects DROP COLUMN creation_input; DROP INDEX workspaces_recent_order; ALTER TABLE workspaces DROP COLUMN custom_name; ALTER TABLE workspaces DROP COLUMN last_opened_at; ALTER TABLE workspaces DROP COLUMN revision; DELETE FROM __drizzle_migrations WHERE created_at >= 1793702779063',
    )
    await f.app.close()
    const restarted = await fixture(f.directory)
    expect(restarted.service.recent().entries).toEqual([])
    expect(restarted.service.lookup(a.id)).toEqual({
      id: a.id,
      name: a.defaultName,
      canonicalPath: a.canonicalPath,
    })
    expect(await restarted.open()).toMatchObject({ id: a.id, name: a.defaultName })
    expect(restarted.app.get(KernelService).list()).toEqual([])
  })
})
