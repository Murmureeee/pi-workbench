import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { historyPageSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'

function syntheticHistory(
  store: SessionStore,
  directory: string,
  count: number,
  text = '合成历史',
) {
  const sessionId = randomUUID(),
    epoch = randomUUID(),
    turnId = randomUUID()
  const sessionFile = join(directory, 'kernels', sessionId, epoch, 'sessions', 'fixture.jsonl')
  mkdirSync(dirname(sessionFile), { recursive: true })
  store.registerRuntime({
    sessionId,
    epoch,
    cwd: directory,
    nativeSessionId: sessionId,
    sessionFile,
    source: 'synthetic-ipc-fixture',
  })
  const records: unknown[] = [
    { type: 'session', version: 3, id: sessionId, cwd: directory },
    {
      type: 'custom',
      id: 'marker',
      parentId: null,
      customType: 'pi-workbench.turn.v1',
      data: { version: 1, sessionId, epoch, turnId, messageId: `${turnId}:assistant` },
    },
  ]
  for (let i = 0; i < count; i++) {
    records.push({
      type: 'message',
      id: `entry-${i}`,
      parentId: i ? `entry-${i - 1}` : 'marker',
      message: {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `${i === 6 || count < 100 ? text : '合成历史'}${i}` }],
        ...(i % 2 ? { stopReason: 'stop' } : {}),
      },
    })
  }
  writeFileSync(sessionFile, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  return { sessionId, epoch, turnId, sessionFile }
}

describe('CORE-06 durable managed history and crash recovery', () => {
  it('preserves actual SDK abort and error outcomes across graceful shutdown without classifying them as a crash', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-persist-outcomes-'))
    let app = await createApp({ dataDir: directory, port: 4338 })
    try {
      const sessionId = randomUUID(),
        turnId = randomUUID(),
        kernels = app.get(KernelService)
      const kernel = await kernels.open(sessionId, directory)
      const delta = new Promise<void>((resolve) =>
        kernel.subscribe((message) => {
          if (message.type === 'delta') {
            resolve()
          }
        }),
      )
      const run = kernels.prompt(sessionId, directory, {
        turnId,
        text: '真实本地中止',
        fixture: 'hold',
      })
      await delta
      await kernels.abort(sessionId, turnId)
      expect(await run).toMatchObject({ outcome: 'aborted' })
      await kernels.prompt(sessionId, directory, {
        turnId: randomUUID(),
        text: '真实本地提供商错误',
        fixture: 'error',
      })
      await app.close()
      app = await createApp({ dataDir: directory, port: 4338 })
      const page = app.get(SessionStore).history(sessionId)
      expect(
        page?.messages
          .filter((message) => message.role === 'assistant')
          .map((message) => message.outcome),
      ).toEqual(['aborted', 'error'])
      expect(page?.messages.some((message) => message.origin === 'interrupted-checkpoint')).toBe(
        false,
      )
      expect(page?.messages.at(-1)?.error).toContain('Offline fixture error')
      expect(app.get(KernelService).list()).toEqual([])
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retains an input not yet committed by SDK and ignores a stale checkpoint callback with the same message identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-early-crash-'))
    let app = await createApp({ dataDir: directory, port: 4338 })
    try {
      const store = app.get(SessionStore),
        fixture = syntheticHistory(store, directory, 0),
        events = app.get(EventService)
      events.attach(fixture.sessionId, fixture.epoch, 'synthetic-ipc-fixture')
      events.publish(fixture.sessionId, fixture.epoch, fixture.turnId, {
        type: 'turn.started',
        messageId: `${fixture.turnId}:assistant`,
        prompt: '尚未确认送达的输入',
      })
      const old = events.snapshot(fixture.sessionId)
      if (!old) {
        throw new Error('No snapshot')
      }
      events.publish(fixture.sessionId, fixture.epoch, fixture.turnId, {
        type: 'message.delta',
        messageId: `${fixture.turnId}:assistant`,
        text: '较新检查点',
      })
      events.publish(fixture.sessionId, fixture.epoch, fixture.turnId, { type: 'turn.stopping' })
      store.capture(old, true)
      await app.close()
      app = await createApp({ dataDir: directory, port: 4338 })
      const page = app.get(SessionStore).history(fixture.sessionId)
      expect(page?.messages.map((message) => [message.role, message.origin, message.text])).toEqual(
        [
          ['user', 'interrupted-checkpoint', '尚未确认送达的输入'],
          ['assistant', 'interrupted-checkpoint', '较新检查点'],
        ],
      )
      expect(app.get(EventService).snapshot(fixture.sessionId)?.turns[0]?.phase).toBe('interrupted')
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('reopens real SDK JSONL with stable distinct turns, abort/error outcomes and no runtime restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-persist-'))
    let app = await createApp({ dataDir: directory, port: 4338 })
    const sessionId = randomUUID()
    try {
      const kernels = app.get(KernelService),
        ids = [randomUUID(), randomUUID()] as const
      await kernels.prompt(sessionId, directory, {
        turnId: ids[0],
        text: '相同正文不可用于猜测去重',
      })
      await kernels.prompt(sessionId, directory, {
        turnId: ids[1],
        text: '相同正文不可用于猜测去重',
      })
      const before = app.get(SessionStore).history(sessionId)
      expect(before?.diagnostics).toEqual([])
      expect(
        before?.messages
          .filter((message) => message.role === 'assistant')
          .map((message) => message.turnId),
      ).toEqual(ids)
      const files = kernels
        .list()
        .map((kernel) => kernel.sessionFile!)
        .map((path) => ({ path, bytes: readFileSync(path) }))
      const daemonId = app.get(EventService).daemonId
      await app.close()
      app = await createApp({ dataDir: directory, port: 4338 })
      expect(app.get(KernelService).list()).toEqual([])
      expect(app.get(SessionStore).history(sessionId)).toEqual(before)
      expect(app.get(EventService).snapshot(sessionId)).toMatchObject({
        turns: [{ phase: 'completed', text: 'OFFLINE_OK', id: ids[1] }],
        seq: 0,
      })
      expect(app.get(EventService).daemonId).not.toBe(daemonId)
      for (const file of files) {
        expect(readFileSync(file.path)).toEqual(file.bytes)
      }
      await app
        .get(KernelService)
        .prompt(sessionId, directory, { turnId: randomUUID(), text: '显式新轮次，不自动重放' })
      expect(app.get(SessionStore).history(sessionId)?.messages).toHaveLength(6)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('pages at most 100 entries, bounds UTF-8 previews at 64 KiB and returns exact full content without rewriting JSONL', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-paging-'))
    const app = await createApp({ dataDir: directory, port: 4338 })
    try {
      const store = app.get(SessionStore),
        text = '👩‍💻你e\u0301'.repeat(7000)
      const fixture = syntheticHistory(store, directory, 106, text)
      const original = readFileSync(fixture.sessionFile)
      const page = store.history(fixture.sessionId)!
      const first = page.messages[0]
      if (!first) {
        throw new Error('Missing paged message')
      }
      expect(page.messages).toHaveLength(100)
      expect(page.messages[0]?.nativeEntryId).toBe('entry-6')
      expect(Buffer.byteLength(first.text)).toBeLessThanOrEqual(65536)
      expect(page.messages[0]?.text).not.toContain('\ufffd')
      expect(page.messages[0]?.truncated).toBe(true)
      expect(store.content(fixture.sessionId, first.id)).toBe(`${text}6`)
      expect(store.history(fixture.sessionId, page.nextCursor!)?.messages).toHaveLength(6)
      expect(() => store.history(fixture.sessionId, 'expired')).toThrow('cursor expired')
      expect(() => store.history(fixture.sessionId, undefined, 101)).toThrow('1..100')
      const server = app.getHttpAdapter().getInstance()
      const response = await server.inject({
        method: 'GET',
        url: `/api/sessions/${fixture.sessionId}/history?limit=101`,
        headers: { host: '127.0.0.1:4338' },
      })
      expect(response.statusCode).toBe(409)
      expect(readFileSync(fixture.sessionFile)).toEqual(original)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('diagnoses malformed JSONL/index/checkpoint records and exports exact original bytes while retaining readable history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-corrupt-'))
    let app = await createApp({ dataDir: directory, port: 4338 })
    try {
      const store = app.get(SessionStore),
        fixture = syntheticHistory(store, directory, 2)
      const id = randomUUID(),
        source = 'synthetic-fixture'
      store.saveApproval({
        sessionId: fixture.sessionId,
        epoch: fixture.epoch,
        turnId: fixture.turnId,
        id,
        source,
        decision: 'denied',
        parameters: {},
        reason: '合成历史拒绝',
      })
      app
        .get(WorkspaceDatabase)
        .sqlite.prepare('UPDATE session_approvals SET data = ? WHERE id = ?')
        .run('{broken-index', id)
      const events = app.get(EventService),
        turnId = randomUUID()
      events.attach(fixture.sessionId, fixture.epoch, 'synthetic-ipc-fixture')
      events.publish(fixture.sessionId, fixture.epoch, turnId, {
        type: 'turn.started',
        messageId: `${turnId}:assistant`,
        prompt: '合成损坏检查点',
      })
      const checkpoint = join(
        directory,
        'inflight',
        fixture.sessionId,
        `${fixture.epoch}-${turnId}.json`,
      )
      writeFileSync(checkpoint, '{broken-checkpoint')
      const badLine = Buffer.from('{broken-jsonl\n')
      appendFileSync(fixture.sessionFile, badLine)
      appendFileSync(fixture.sessionFile, '{"incomplete":')
      const original = readFileSync(fixture.sessionFile)
      await app.close()
      app = await createApp({ dataDir: directory, port: 4338 })
      const recovered = app.get(SessionStore),
        page = recovered.history(fixture.sessionId)!
      expect(page.messages).toHaveLength(2)
      expect(page.diagnostics.map((item) => item.code)).toEqual([
        'invalid-record',
        'incomplete-tail',
        'invalid-checkpoint',
        'invalid-record',
      ])
      for (const diagnostic of page.diagnostics) {
        const raw = recovered.raw(fixture.sessionId, diagnostic.id)
        expect(raw).toBeDefined()
      }
      expect(
        recovered
          .raw(fixture.sessionId, page.diagnostics.find((item) => item.source === 'inflight')!.id)
          ?.toString(),
      ).toBe('{broken-checkpoint')
      expect(
        recovered
          .raw(fixture.sessionId, page.diagnostics.find((item) => item.source === 'index')!.id)
          ?.toString(),
      ).toBe('{broken-index')
      expect(
        recovered.raw(
          fixture.sessionId,
          page.diagnostics.find(
            (item) => item.source === 'sdk-jsonl' && item.code === 'invalid-record',
          )!.id,
        ),
      ).toEqual(badLine)
      expect(readFileSync(fixture.sessionFile)).toEqual(original)
      await expect(
        app
          .get(KernelService)
          .prompt(fixture.sessionId, directory, { turnId: randomUUID(), text: '必须先诊断' }),
      ).rejects.toThrow('requires diagnosis')
      const server = app.getHttpAdapter().getInstance(),
        diagnostic = page.diagnostics.find((item) => item.source === 'sdk-jsonl')!
      const response = await server.inject({
        method: 'GET',
        url: `/api/sessions/${fixture.sessionId}/diagnostics/${diagnostic.id}/raw`,
        headers: { host: '127.0.0.1:4338' },
      })
      expect(response.rawPayload).toEqual(badLine)
      expect(response.headers['content-type']).toContain('application/octet-stream')
      expect(
        (
          await server.inject({
            method: 'GET',
            url: `/api/sessions/${fixture.sessionId}/history`,
            headers: { host: '127.0.0.1:4338', origin: 'https://invalid.example' },
          })
        ).statusCode,
      ).toBe(403)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('lets committed SDK entries replace a stale checkpoint by turn identity and diagnoses a mismatched epoch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-final-dedupe-'))
    let app = await createApp({ dataDir: directory, port: 4338 })
    try {
      const store = app.get(SessionStore),
        fixture = syntheticHistory(store, directory, 2)
      const events = app.get(EventService)
      events.attach(fixture.sessionId, fixture.epoch, 'synthetic-ipc-fixture')
      events.publish(fixture.sessionId, fixture.epoch, fixture.turnId, {
        type: 'turn.started',
        messageId: `${fixture.turnId}:assistant`,
        prompt: '合成旧检查点',
      })
      const path = join(
        directory,
        'inflight',
        fixture.sessionId,
        `${fixture.epoch}-${fixture.turnId}.json`,
      )
      const old = JSON.parse(readFileSync(path, 'utf8')) as unknown
      await app.close()
      app = await createApp({ dataDir: directory, port: 4338 })
      expect(
        app
          .get(SessionStore)
          .history(fixture.sessionId)
          ?.messages.every((message) => message.origin === 'sdk-jsonl'),
      ).toBe(true)
      expect(app.get(SessionStore).history(fixture.sessionId)?.messages).toHaveLength(2)
      if (typeof old !== 'object' || old === null) {
        throw new Error('Invalid test checkpoint')
      }
      writeFileSync(path, JSON.stringify({ ...old, epoch: randomUUID() }))
      expect(app.get(SessionStore).history(fixture.sessionId)?.diagnostics).toMatchObject([
        { code: 'invalid-checkpoint' },
      ])
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps the previous atomic checkpoint on a real filesystem write failure and blocks new work until a successful flush', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-checkpoint-io-'))
    const app = await createApp({ dataDir: directory, port: 4338 })
    try {
      const store = app.get(SessionStore),
        fixture = syntheticHistory(store, directory, 2),
        turnId = randomUUID()
      const events = app.get(EventService)
      events.attach(fixture.sessionId, fixture.epoch, 'synthetic-ipc-fixture')
      events.publish(fixture.sessionId, fixture.epoch, turnId, {
        type: 'turn.started',
        messageId: `${turnId}:assistant`,
        prompt: '合成 IO 故障',
      })
      const path = join(directory, 'inflight', fixture.sessionId, `${fixture.epoch}-${turnId}.json`)
      const previous = readFileSync(path)
      mkdirSync(`${path}.tmp`)
      const start = Date.now()
      events.publish(fixture.sessionId, fixture.epoch, turnId, {
        type: 'message.delta',
        messageId: `${turnId}:assistant`,
        text: '尚未刷盘👩‍💻',
      })
      await expect
        .poll(
          () =>
            store
              .history(fixture.sessionId)
              ?.diagnostics.some((item) => item.code === 'write-failed'),
          { timeout: 3000 },
        )
        .toBe(true)
      expect(Date.now() - start).toBeLessThan(3000)
      expect(readFileSync(path)).toEqual(previous)
      expect(() => store.assertWritable(fixture.sessionId)).toThrow('persistence unavailable')
      rmdirSync(`${path}.tmp`)
      events.publish(fixture.sessionId, fixture.epoch, turnId, {
        type: 'turn.finished',
        outcome: 'aborted',
      })
      expect(readFileSync(path, 'utf8')).toContain('尚未刷盘👩‍💻')
      expect(store.history(fixture.sessionId)?.diagnostics).toEqual([])
      expect(() => store.assertWritable(fixture.sessionId)).not.toThrow()
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a second live data owner, preserves final approval decisions and isolates managed path references', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-data-owner-'))
    const app = await createApp({ dataDir: directory, port: 4338 })
    try {
      expect(() => new WorkspaceDatabase(directory)).toThrow('already owned')
      const store = app.get(SessionStore),
        fixture = syntheticHistory(store, directory, 2)
      const decision = {
        id: randomUUID(),
        sessionId: fixture.sessionId,
        epoch: fixture.epoch,
        turnId: fixture.turnId,
        source: 'synthetic-fixture',
        decision: 'denied',
        parameters: {},
        reason: '首个有效决定',
      }
      store.saveApproval(decision)
      store.saveApproval({ ...decision, decision: 'allowed' })
      expect(store.history(fixture.sessionId)?.approvals[0]?.decision).toBe('denied')
      expect(() => store.saveApproval({ ...decision, sessionId: randomUUID() })).toThrow(
        'identity mismatch',
      )
      app
        .get(WorkspaceDatabase)
        .sqlite.prepare('UPDATE session_runtimes SET session_file = ? WHERE epoch = ?')
        .run(join(directory, '..', 'private-file'), fixture.epoch)
      expect(store.history(fixture.sessionId)?.diagnostics).toMatchObject([
        { code: 'unsafe-reference', exportable: false },
      ])
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('survives an actual daemon/SDK SIGKILL and restores interrupted text, held queue and invalidated approval without replay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-hard-crash-'))
    const child = fork(new URL('./fixtures/recovery-host.mjs', import.meta.url), [directory], {
      execArgv: [],
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let output = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    let app: Awaited<ReturnType<typeof createApp>> | undefined
    try {
      const message = await new Promise<{
        sessionId: string
        turnId: string
        epoch: string
        sessionFile: string
      }>((resolve, reject) => {
        child.once('message', (value: unknown) => {
          if (
            typeof value !== 'object' ||
            value === null ||
            !('sessionId' in value) ||
            !('turnId' in value) ||
            !('epoch' in value) ||
            !('sessionFile' in value) ||
            typeof value.sessionId !== 'string' ||
            typeof value.turnId !== 'string' ||
            typeof value.epoch !== 'string' ||
            typeof value.sessionFile !== 'string'
          ) {
            reject(new Error('Invalid crash fixture handshake'))
            return
          }
          resolve({
            sessionId: value.sessionId,
            turnId: value.turnId,
            epoch: value.epoch,
            sessionFile: value.sessionFile,
          })
        })
        child.once('exit', () => reject(new Error(`Crash fixture exited before ready: ${output}`)))
      })
      const native = readFileSync(message.sessionFile)
      expect(native.toString()).not.toContain('OFFLINE_')
      child.send('crash')
      await exit
      app = await createApp({ dataDir: directory, port: 4338 })
      const store = app.get(SessionStore)
      const page = store.history(message.sessionId)!
      expect(page.messages.map((item) => [item.role, item.origin, item.text])).toEqual([
        ['user', 'sdk-jsonl', '真实 SDK 硬杀恢复夹具'],
        ['assistant', 'interrupted-checkpoint', 'OFFLINE_'],
      ])
      expect(page.queue).toMatchObject([{ status: 'held' }])
      expect(page.approvals.map((item) => item.decision)).toEqual(
        expect.arrayContaining(['allowed', 'invalidated']),
      )
      expect(page.approvals.every((item) => !item.executable)).toBe(true)
      expect(page.changes).toMatchObject([{ reference: 'synthetic-ledger:baseline-1' }])
      expect(app.get(EventService).snapshot(message.sessionId)?.turns[0]).toMatchObject({
        phase: 'interrupted',
        text: 'OFFLINE_',
        approval: null,
      })
      expect(app.get(KernelService).list()).toEqual([])
      expect(store.history(message.sessionId)).toEqual(page)
      expect(readFileSync(message.sessionFile)).toEqual(native)
      const server = app.getHttpAdapter().getInstance()
      const response = await server.inject({
        method: 'GET',
        url: `/api/sessions/${message.sessionId}/history`,
        headers: { host: '127.0.0.1:4338' },
      })
      expect(historyPageSchema.parse(response.json())).toEqual(page)
      expect(existsSync(join(directory, 'MUST-NOT-EXIST'))).toBe(false)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await exit
      }
      await app?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
