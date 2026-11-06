import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { sessionSearchPageSchema, sessionSearchQuerySchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SearchService } from '../dist/modules/search/search.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { ProjectService } from '../dist/modules/workspaces/project.service.js'
import { seedSearchSession } from './helpers/search.js'

const directories: string[] = [],
  apps: Awaited<ReturnType<typeof createApp>>[] = []
const budget = readFileSync('docs/validation/live-validation-budget.json')
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-search-'))) {
  directories.push(directory)
  const app = await createApp({ dataDir: directory, port: 24418, development: true })
  apps.push(app)
  const store = app.get(SessionStore),
    search = app.get(SearchService),
    db = app.get(WorkspaceDatabase).sqlite
  return {
    app,
    store,
    search,
    db,
    directory,
    find: (value: unknown = {}) => search.search(sessionSearchQuerySchema.parse(value)),
    seed: (title: string, texts?: string[], projectId?: string | null) =>
      seedSearchSession(app, directory, title, texts, projectId),
  }
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of new Set(directories.splice(0))) {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(readFileSync('docs/validation/live-validation-budget.json'), budget)
})
describe('SESSION-12 actual SQLite / native JSONL read-only search', () => {
  it('migrates an existing database and rebuilds derived search without starting SDK or changing native history', async () => {
    const f = await fixture(),
      a = await f.seed('旧库搜索标题')
    const bytes = readFileSync(a.sessionFile)
    f.db.exec(
      'DROP TABLE session_origins; ALTER TABLE session_configurations DROP COLUMN membership_version',
    )
    f.db.exec(
      'DROP TABLE session_search_documents; ALTER TABLE session_turns DROP COLUMN model_request; DROP TABLE operation_audit; DROP TABLE session_model_settings; DELETE FROM __drizzle_migrations WHERE created_at >= 1793728000000',
    )
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.find({ q: '用户中文' }).total).toBe(1)
    expect(next.app.get(KernelService).list()).toEqual([])
    expect(readFileSync(a.sessionFile)).toEqual(bytes)
  })

  it('rolls back failed index replacement and rejects a changing source before returning a mixed search snapshot', async () => {
    const f = await fixture(),
      a = await f.seed('索引恢复')
    f.find()
    const before = f.db.prepare('SELECT * FROM session_search_documents ORDER BY id').all()
    const append = (id: string, text: string) =>
      appendFileSync(
        a.sessionFile,
        JSON.stringify({
          type: 'message',
          id,
          parentId: 'entry-1',
          message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
        }) + '\n',
      )
    append('change-1', '写失败待恢复的命中')
    f.db.exec(
      "CREATE TRIGGER reject_search_index BEFORE INSERT ON session_search_documents BEGIN SELECT RAISE(ABORT,'search fixture disk failure'); END",
    )
    expect(() => f.find({ q: '待恢复' })).toThrow(/search fixture disk failure/)
    expect(f.db.prepare('SELECT * FROM session_search_documents ORDER BY id').all()).toEqual(before)
    f.db.exec('DROP TRIGGER reject_search_index')
    expect(f.find({ q: '待恢复' }).total).toBe(1)
    append('change-2', '读取时变化前')
    const read = f.store.searchSource.bind(f.store)
    const changed = vi.spyOn(f.store, 'searchSource').mockImplementationOnce((id) => {
      const source = read(id)
      append('change-3', '读取时变化后')
      return source
    })
    expect(() => f.find()).toThrow(/历史正在变化/)
    changed.mockRestore()
    expect(f.find({ q: '读取时变化后' }).total).toBe(1)
  })

  it('matches Chinese titles, user and assistant full bodies, excludes tools, handles literal SQL punctuation and locates an older-than-100 message', async () => {
    const f = await fixture(),
      texts = Array.from({ length: 132 }, (_, index) =>
        index === 4
          ? `前文${'甲'.repeat(70000)}中文用户定位 %_ ' OR 1=1`
          : index === 5
            ? '独特助手回答'
            : `普通上下文 ${index}`,
      )
    const a = await f.seed('中文标题😀', texts),
      bytes = readFileSync(a.sessionFile)
    expect(f.find({ q: '中文标题' }).results[0]).toMatchObject({ match: 'title', messageId: null })
    const hit = f.find({ q: '中文用户定位' }).results[0]
    assert(hit)
    expect(hit).toMatchObject({ match: 'user', messageId: `${a.epoch}:entry-4` })
    expect(hit.snippet).toContain('中文用户定位')
    expect(Array.from(hit.snippet).length).toBeLessThanOrEqual(182)
    expect(f.find({ q: " %_ ' OR 1=1" }).total).toBe(1)
    expect(f.find({ q: '独特助手回答' }).results[0]?.match).toBe('assistant')
    expect(f.store.history(a.session.id)?.messages.some((row) => row.id === hit.messageId)).toBe(
      false,
    )
    expect(
      f.store
        .history(a.session.id, undefined, 100, hit.messageId!)
        ?.messages.some((row) => row.id === hit.messageId),
    ).toBe(true)
    expect(() => f.store.history(a.session.id, undefined, 100, 'missing')).toThrow(/目标消息/)
    appendFileSync(
      a.sessionFile,
      JSON.stringify({
        type: 'message',
        id: 'tool-only',
        parentId: 'entry-131',
        message: {
          role: 'toolResult',
          toolCallId: 'test',
          toolName: 'read',
          content: [{ type: 'text', text: '仅工具私有日志' }],
          isError: false,
        },
      }) + '\n',
    )
    expect(f.find({ q: '仅工具私有日志' }).total).toBe(0)
    expect(readFileSync(a.sessionFile).subarray(0, bytes.length)).toEqual(bytes)
    expect(f.app.get(KernelService).list()).toEqual([])
  })
  it('filters all/specific/none, same-name projects, authoritative activity, inclusive time bounds and archive without starting work', async () => {
    const f = await fixture(),
      projects = f.app.get(ProjectService)
    const p = await projects.create({
        requestId: randomUUID(),
        name: '同名项目',
        workspaceId: null,
      }),
      p2 = await projects.create({ requestId: randomUUID(), name: '同名项目', workspaceId: null })
    const a = await f.seed('甲会话', undefined, p.id),
      b = await f.seed('乙会话', undefined, p2.id),
      c = await f.seed('无项目')
    const time = f.find().results.find((row) => row.sessionId === a.session.id)!.updatedAt
    expect(f.find().total).toBe(3)
    expect(f.find({ project: p.id }).results.map((row) => row.sessionId)).toEqual([a.session.id])
    expect(f.find({ project: 'none' }).results.map((row) => row.sessionId)).toEqual([c.session.id])
    expect(f.find({ project: p.id, from: time, to: time }).total).toBe(1)
    expect(f.find({ from: Date.now() + 60000 }).total).toBe(0)
    f.db
      .prepare("UPDATE session_submissions SET status='executing' WHERE session_id=?")
      .run(a.session.id)
    expect(f.find({ state: 'running' }).results.map((row) => row.sessionId)).toEqual([a.session.id])
    f.db
      .prepare("UPDATE session_submissions SET status='failed' WHERE session_id=?")
      .run(a.session.id)
    expect(f.find({ state: 'failed' }).total).toBe(1)
    f.store.organize(b.session.id, {
      action: 'archive',
      archived: true,
      expectedRevision: f.store.organizations().find((row) => row.sessionId === b.session.id)!
        .revision,
    })
    expect(f.find().total).toBe(2)
    expect(f.find({ archive: 'all' }).total).toBe(3)
    expect(f.find({ archive: 'archived' }).results.map((row) => row.sessionId)).toEqual([
      b.session.id,
    ])
    f.store.organize(b.session.id, {
      action: 'archive',
      archived: false,
      expectedRevision: f.store.organizations().find((row) => row.sessionId === b.session.id)!
        .revision,
    })
    expect(f.find().total).toBe(3)
    f.store.saveQueue({
      id: randomUUID(),
      sessionId: c.session.id,
      epoch: c.epoch,
      turnId: c.submission.turnId,
      source: 'synthetic-fixture',
      kind: 'follow-up',
      position: 0,
      text: '等待处理',
      status: 'held',
    })
    expect(f.find({ state: 'held' }).results.map((row) => row.sessionId)).toEqual([c.session.id])
    f.store.saveApproval({
      id: randomUUID(),
      sessionId: c.session.id,
      epoch: c.epoch,
      turnId: c.submission.turnId,
      source: 'synthetic-fixture',
      decision: 'pending',
      parameters: {},
      reason: '搜索不裁决',
    })
    expect(f.find({ state: 'approval' }).results.map((row) => row.sessionId)).toEqual([
      c.session.id,
    ])
  })
  it('redacts the entire document before indexing/slicing, reindexes new known credentials and does not persist queries', async () => {
    const f = await fixture(),
      secret = 'sk-abcdefghijklmnopqrstuvwxyz123456',
      known = 'private-known-search-value'
    await f.seed('安全标题', [
      '前文 api_key=super-secret-value 后文 ' + secret + ' 尾部中文',
      known + ' 助手正文',
    ])
    const page = f.find({ q: '尾部中文' })
    expect(page.results[0]?.snippet).toContain('«redacted»')
    expect(JSON.stringify(page)).not.toContain(secret)
    expect(f.find({ q: secret }).total).toBe(0)
    f.app.get(SecurityService).redactor.remember(known)
    expect(f.find({ q: known }).total).toBe(0)
    const rows = f.db.prepare('SELECT body,folded FROM session_search_documents').all()
    expect(JSON.stringify(rows)).not.toContain('super-secret-value')
    expect(JSON.stringify(rows)).not.toContain(known)
    const unknownQuery = '只查询不保存的中文'
    f.find({ q: unknownQuery })
    expect(
      JSON.stringify(f.db.prepare('SELECT * FROM session_search_documents').all()),
    ).not.toContain(unknownQuery)
  })
  it('refreshes rename, attribution/detach, archive/restore, append and deletion; restart rebuilds a corrupted derived index without rewriting history', async () => {
    const f = await fixture(),
      a = await f.seed('旧标题'),
      project = await f.app
        .get(ProjectService)
        .create({ requestId: randomUUID(), name: '归属项目', workspaceId: null })
    f.find()
    f.app.get(SessionService).rename(a.session.id, { title: '新标题', expectedVersion: 1 })
    expect(f.find({ q: '旧标题' }).total).toBe(0)
    expect(f.find({ q: '新标题' }).total).toBe(1)
    // Fixture for a future SESSION-13 owner mutation: search consumes canonical attribution,
    // without introducing a move endpoint or changing cwd/permissions in SESSION-12.
    const moved = { ...a.session.configuration, projectId: project.id }
    f.db
      .prepare('UPDATE session_configurations SET project_id=?,configuration=? WHERE session_id=?')
      .run(project.id, JSON.stringify(moved), a.session.id)
    expect(f.find({ project: project.id }).total).toBe(1)
    f.app
      .get(SessionService)
      .organizeProject(project.id, { action: 'remove', expectedRevision: project.revision })
    expect(f.find({ project: project.id }).total).toBe(0)
    expect(f.find({ project: 'none' }).total).toBe(1)
    appendFileSync(
      a.sessionFile,
      JSON.stringify({
        type: 'message',
        id: 'new-message',
        parentId: 'entry-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '追加中文新回复' }],
          stopReason: 'stop',
        },
      }) + '\n',
    )
    expect(f.find({ q: '追加中文' }).total).toBe(1)
    const before = readFileSync(a.sessionFile)
    f.db.prepare("UPDATE session_search_documents SET body='损坏索引',folded='损坏索引'").run()
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.find({ q: '追加中文' }).total).toBe(1)
    expect(next.find({ q: '损坏索引' }).total).toBe(0)
    expect(readFileSync(a.sessionFile)).toEqual(before)
    next.db.prepare('DELETE FROM session_configurations WHERE session_id=?').run(a.session.id)
    expect(next.find().total).toBe(0)
    expect(next.db.prepare('SELECT * FROM session_search_documents').all()).toEqual([])
    expect(next.app.get(KernelService).list()).toEqual([])
  })
  it('paginates in deterministic recent order, uses no stale bodies for unavailable histories and validates all external input', async () => {
    const f = await fixture()
    await Promise.all(Array.from({ length: 6 }, (_, index) => f.seed(`分页会话 ${index}`)))
    const first = f.find({ limit: 2 }),
      second = f.find({ limit: 2, page: 2 }),
      third = f.find({ limit: 2, page: 3 })
    expect(
      new Set([...first.results, ...second.results, ...third.results].map((row) => row.sessionId))
        .size,
    ).toBe(6)
    const a = await f.seed('丢失历史', ['丢失前可搜索', '助手'])
    expect(f.find({ q: '丢失前' }).total).toBe(1)
    unlinkSync(a.sessionFile)
    expect(f.find({ q: '丢失前' })).toMatchObject({ total: 0, incompleteSessions: 1 })
    for (const value of [
      { q: '中'.repeat(161) },
      { limit: 51 },
      { project: '../path' },
      { page: 0 },
      { from: 2, to: 1 },
      { archive: 'false' },
      { unknown: 'bad' },
    ]) {
      expect(sessionSearchQuerySchema.safeParse(value).success).toBe(false)
    }
    const access = f.app.get(AccessService),
      port = 24418
    const pair = async (kind: 'desktop' | 'browser') => {
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/access/pair',
        headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
        payload: { code: access.issueTicket(kind).code, label: 'Search contract' },
      })
      return {
        host: `127.0.0.1:${port}`,
        cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
      }
    }
    const desktop = await pair('desktop'),
      browser = await pair('browser')
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/chat/search',
          headers: { host: desktop.host },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (await f.app.inject({ method: 'GET', url: '/api/chat/search', headers: browser })).statusCode,
    ).toBe(403)
    expect(
      (await f.app.inject({ method: 'GET', url: '/api/chat/search?limit=51', headers: desktop }))
        .statusCode,
    ).toBe(400)
    const result = await f.app.inject({
      method: 'GET',
      url: '/api/chat/search?limit=2',
      headers: desktop,
    })
    expect(result.statusCode).toBe(200)
    expect(sessionSearchPageSchema.parse(result.json()).results).toHaveLength(2)
  })
  it('indexes real SDK/local HTTP first/continued responses and remains read-only for kernels, JSONL, budget and manual titles', async () => {
    const f = await fixture(),
      service = f.app.get(SessionService),
      kernels = f.app.get(KernelService)
    const receipt = await service.submit({
      requestId: randomUUID(),
      sessionId: null,
      retryOf: null,
      text: '真实中文首发',
      configuration: {
        projectId: null,
        workspaceId: null,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    await vi.waitFor(
      () => expect(f.store.submission(receipt.submission.requestId)?.status).toBe('completed'),
      { timeout: 15000 },
    )
    service.rename(receipt.session.id, { title: '保留人工标题', expectedVersion: 1 })
    expect(f.find({ q: 'OFFLINE_OK' }).results[0]?.match).toBe('assistant')
    expect(f.find({ q: '真实中文首发' }).results[0]?.match).toBe('user')
    const next = await service.submit({
      requestId: randomUUID(),
      sessionId: receipt.session.id,
      retryOf: null,
      text: '续发索引刷新',
      configuration: receipt.session.configuration,
    })
    await vi.waitFor(
      () => expect(f.store.submission(next.submission.requestId)?.status).toBe('completed'),
      { timeout: 15000 },
    )
    const native = kernels.list()[0]
    assert(native?.sessionFile)
    const bytes = readFileSync(native.sessionFile),
      before = kernels.resources()
    expect(f.find({ q: '续发索引刷新' }).total).toBe(1)
    expect(f.find({ q: '保留人工标题' }).total).toBe(1)
    expect(kernels.resources()).toEqual(before)
    expect(readFileSync(native.sessionFile)).toEqual(bytes)
    const kernel = await kernels.open(receipt.session.id, receipt.session.cwd)
    const delta = new Promise<void>((done) => {
      const off = kernel.subscribe((event) => {
        if (event.type === 'delta') {
          off()
          done()
        }
      })
    })
    const turnId = randomUUID(),
      work = kernels.prompt(receipt.session.id, receipt.session.cwd, {
        turnId,
        text: '后台任务搜索不影响执行',
        fixture: 'hold',
      })
    await vi.waitFor(() => expect(kernels.resources().modelTasks).toBe(1))
    await delta
    const running = kernels.list().find((row) => row.sessionId === receipt.session.id)
    expect(f.find({ state: 'running' }).results.map((row) => row.sessionId)).toEqual([
      receipt.session.id,
    ])
    expect(kernels.list().find((row) => row.sessionId === receipt.session.id)?.pid).toBe(
      running?.pid,
    )
    await kernels.abort(receipt.session.id, turnId)
    await work
  })
})
