import { randomUUID } from 'node:crypto'
import fs, {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { legacyCatalogSchema, legacyPageSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { LegacyHistoryService } from '../dist/modules/sessions/legacy-history.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'

const port = 24368
function firstRecord<T>(items: T[]): T {
  const item = items[0]
  if (item === undefined) {
    throw new Error('Expected a discovered record')
  }
  return item
}
const directories: string[] = []
const apps: Awaited<ReturnType<typeof createApp>>[] = []
function source(count = 201) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-legacy-'))
  directories.push(directory)
  const pi = join(directory, 'pi'),
    root = join(pi, 'sessions'),
    cwd = join(root, '--old-project--')
  mkdirSync(cwd, { recursive: true })
  const path = join(cwd, 'old.jsonl'),
    nativeId = randomUUID()
  const records: unknown[] = [
    {
      type: 'session',
      version: 3,
      id: nativeId,
      cwd: 'D:\\旧项目',
      timestamp: '2026-10-01T00:00:00Z',
    },
  ]
  for (let i = 0; i < count; i++) {
    records.push({
      type: 'message',
      id: `entry-${i}`,
      parentId: i ? `entry-${i - 1}` : null,
      message: {
        role: i % 2 ? 'assistant' : 'user',
        content: [
          { type: 'text', text: `旧历史消息 ${i} sk-abcdefghijklmnopqrstuvwxyz1234567890` },
        ],
        stopReason: 'stop',
      },
    })
  }
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  return { directory, pi, root, cwd, path, nativeId }
}
async function fixture(piAgentDir?: string) {
  const f = source()
  const app = await createApp({
    dataDir: join(f.directory, 'data'),
    port,
    piAgentDir: piAgentDir ?? f.pi,
  })
  apps.push(app)
  async function pair(kind: 'desktop' | 'browser') {
    const ticket = app.get(AccessService).issueTicket(kind)
    const response = await app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
      payload: { code: ticket.code, label: kind },
    })
    return {
      host: `127.0.0.1:${port}`,
      cookie: String(response.headers['set-cookie']).split(';')[0],
    }
  }
  const headers = await pair('desktop')
  const get = (url: string) => app.inject({ method: 'GET', url, headers })
  return { ...f, app, get, pair }
}
afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})
describe('SESSION-02 external pi discovery: actual filesystem/HTTP, never a runtime', () => {
  it('is disabled without an explicit source, and desktop-only under SEC-08', async () => {
    expect(new LegacyHistoryService().discover()).toMatchObject({
      enabled: false,
      root: null,
      sessions: [],
    })
    const f = await fixture()
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/legacy-history',
          headers: { host: `127.0.0.1:${port}` },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/legacy-history',
          headers: await f.pair('browser'),
        })
      ).statusCode,
    ).toBe(403)
    expect((await f.get('/api/legacy-history/../../auth.json')).statusCode).not.toBe(200)
  })
  it('paginates 100 messages with file versions, redacts every output, and preserves bytes/DB/runtime', async () => {
    const f = await fixture(),
      before = readFileSync(f.path)
    writeFileSync(join(f.pi, 'auth.json'), '{"must":"remain untouched"}')
    const config = readFileSync(join(f.pi, 'auth.json'))
    const catalog = legacyCatalogSchema.parse((await f.get('/api/legacy-history')).json())
    expect(catalog.sessions).toHaveLength(1)
    const id = firstRecord(catalog.sessions).id
    const latest = legacyPageSchema.parse((await f.get(`/api/legacy-history/${id}`)).json())
    expect(latest.messages).toHaveLength(100)
    expect(firstRecord(latest.messages).id).toBe('entry-101')
    expect(
      latest.messages.some((message) => message.text.includes('sk-abcdefghijklmnopqrstuvwxyz')),
    ).toBe(false)
    const earlier = legacyPageSchema.parse(
      (
        await f.get(
          `/api/legacy-history/${id}?version=${latest.version}&cursor=${latest.nextCursor}`,
        )
      ).json(),
    )
    expect(firstRecord(earlier.messages).id).toBe('entry-1')
    expect(latest.canResume).toBe(false)
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(f.app.get(SessionStore).list()).toEqual([])
    expect(readFileSync(f.path)).toEqual(before)
    expect(readFileSync(join(f.pi, 'auth.json'))).toEqual(config)
    expect((await f.get(`/api/legacy-history/${id}?cursor=entry-100`)).statusCode).toBe(409)
    const full = await f.get(
      `/api/legacy-history/${id}/messages/entry-200?version=${latest.version}`,
    )
    expect(full.statusCode).toBe(200)
    expect(full.body).toContain('旧历史消息 200')
    expect(full.body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    appendFileSync(
      f.path,
      JSON.stringify({
        type: 'message',
        id: 'long',
        parentId: 'entry-200',
        message: { role: 'assistant', content: '文'.repeat(33000) + '全文末端' },
      }) + '\n',
    )
    const longPage = legacyPageSchema.parse((await f.get(`/api/legacy-history/${id}`)).json())
    expect(longPage.messages.at(-1)?.truncated).toBe(true)
    expect(longPage.messages.at(-1)?.text).not.toContain('全文末端')
    const long = await f.get(`/api/legacy-history/${id}/messages/long?version=${longPage.version}`)
    expect(long.statusCode).toBe(200)
    expect(long.body).toContain('全文末端')
    appendFileSync(f.path, '{partial')
    expect(
      (await f.get(`/api/legacy-history/${id}/messages/entry-200?version=${latest.version}`))
        .statusCode,
    ).toBe(409)
  })
  it('keeps complete message suffixes while protecting interrupted and truncated secret prefixes', async () => {
    const f = await fixture()
    f.app.get(SecurityService).redactor.remember('0-deterministic-secret')
    const records = [
      { id: 'complete-user', role: 'user', text: '旧记录 0', stopReason: undefined },
      { id: 'complete-assistant', role: 'assistant', text: '正常回复 0', stopReason: 'stop' },
      { id: 'interrupted-assistant', role: 'assistant', text: '中断回复 0', stopReason: 'aborted' },
      {
        id: 'truncated-user',
        role: 'user',
        text: '文'.repeat(21845) + '0-deterministic-secret',
        stopReason: undefined,
      },
    ]
    records.forEach((record, i) =>
      appendFileSync(
        f.path,
        JSON.stringify({
          type: 'message',
          id: record.id,
          parentId: records[i - 1]?.id ?? 'entry-200',
          message: { role: record.role, content: record.text, stopReason: record.stopReason },
        }) + '\n',
      ),
    )
    const catalog = legacyCatalogSchema.parse((await f.get('/api/legacy-history')).json())
    const id = firstRecord(catalog.sessions).id
    const page = legacyPageSchema.parse((await f.get(`/api/legacy-history/${id}`)).json())
    expect(page.messages.find((message) => message.id === 'complete-user')?.text).toBe('旧记录 0')
    expect(page.messages.find((message) => message.id === 'complete-assistant')?.text).toBe(
      '正常回复 0',
    )
    expect(page.messages.find((message) => message.id === 'interrupted-assistant')?.text).toBe(
      '中断回复 ',
    )
    expect(page.messages.find((message) => message.id === 'truncated-user')?.text).toBe(
      '文'.repeat(21845),
    )
    const full = async (messageId: string) =>
      (await f.get(`/api/legacy-history/${id}/messages/${messageId}?version=${page.version}`)).body
    expect(await full('complete-user')).toBe('旧记录 0')
    expect(await full('complete-assistant')).toBe('正常回复 0')
    expect(await full('interrupted-assistant')).toBe('中断回复 ')
    expect(await full('truncated-user')).not.toContain('0-deterministic-secret')
  })
  it('rejects append/rewrite version conflicts, waits for partial tails, diagnoses corruption and incompatible versions', async () => {
    const f = await fixture(),
      catalog = legacyCatalogSchema.parse((await f.get('/api/legacy-history')).json()),
      id = firstRecord(catalog.sessions).id
    const first = legacyPageSchema.parse((await f.get(`/api/legacy-history/${id}`)).json())
    appendFileSync(f.path, '{"type":"message"')
    expect(
      (await f.get(`/api/legacy-history/${id}?version=${first.version}&cursor=${first.nextCursor}`))
        .statusCode,
    ).toBe(409)
    const partial = legacyPageSchema.parse((await f.get(`/api/legacy-history/${id}`)).json())
    expect(partial.diagnostics.some((item) => item.code === 'incomplete-tail')).toBe(true)
    appendFileSync(f.path, '}\n{broken}\n')
    const corrupt = legacyPageSchema.parse((await f.get(`/api/legacy-history/${id}`)).json())
    expect(corrupt.diagnostics.some((item) => item.code === 'invalid-record')).toBe(true)
    expect(corrupt.messages).toHaveLength(100)
    const modified = readFileSync(f.path, 'utf8').replace('消息 200', '新文 200')
    writeFileSync(f.path, modified)
    expect((await f.get(`/api/legacy-history/${id}?version=${corrupt.version}`)).statusCode).toBe(
      409,
    )
    writeFileSync(f.path, modified.replace('"version":3', '"version":2'))
    await f.get('/api/legacy-history')
    const incompatible = legacyPageSchema.parse((await f.get(`/api/legacy-history/${id}`)).json())
    expect(incompatible.diagnostics[0]?.code).toBe('incompatible-header')
    expect(incompatible.messages).toEqual([])
    expect(readFileSync(f.path, 'utf8')).toContain('"version":2')
    rmSync(f.path)
    expect((await f.get(`/api/legacy-history/${id}`)).statusCode).toBe(409)
  })
  it('detects actual concurrent CLI writes during the descriptor read, rejecting mixed snapshots', () => {
    const f = source(10),
      service = new LegacyHistoryService(f.pi)
    const id = firstRecord(service.discover().sessions).id,
      original = fs.readSync
    vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      const result = original(...args)
      appendFileSync(f.path, '{"cli":"append during read"}\n')
      return result
    })
    syncBuiltinESMExports()
    expect(() => service.read(id)).toThrow(/CLI 正在写入/)
  })
  it('refuses directory junctions and oversized sources and never repairs them', () => {
    const f = source(1),
      outside = join(f.directory, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.jsonl'), readFileSync(f.path))
    symlinkSync(outside, join(f.root, 'alias'), 'junction')
    const service = new LegacyHistoryService(f.pi)
    const catalog = service.discover()
    expect(catalog.sessions).toHaveLength(1)
    expect(catalog.diagnostics.some((item) => item.code === 'source-link')).toBe(true)
    writeFileSync(f.path, Buffer.alloc(16 * 1024 * 1024 + 1, 32))
    expect(() => service.read(firstRecord(catalog.sessions).id)).toThrow(/16 MiB/)
    expect(readFileSync(join(outside, 'secret.jsonl')).length).toBeGreaterThan(0)
  })
})
