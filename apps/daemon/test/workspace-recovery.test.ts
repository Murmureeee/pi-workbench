import type { SessionSubmit } from '@pi-workbench/shared'

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionKernel } from '@pi-workbench/agent-adapter'
import {
  accessSnapshotSchema,
  runtimeCapabilities,
  workspaceAvailabilitySchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { TrustService } from '../dist/modules/security/trust.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { WorkspaceAvailabilityService } from '../dist/modules/workspaces/workspace-availability.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'

const fixtures: { app: Awaited<ReturnType<typeof createApp>>; directory: string }[] = []
async function fixture(modelTasks = 2) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-recovery-')),
    cwd = join(directory, 'project')
  mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true })
  const marker = join(directory, 'MUST_NOT_EXECUTE')
  const code = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe'); export default () => {}`
  writeFileSync(join(cwd, 'AGENTS.md'), 'WS07_UNTRUSTED_CONTEXT')
  writeFileSync(join(cwd, '.pi', 'extensions', 'unsafe.mjs'), code)
  writeFileSync(
    join(cwd, '.pi', 'settings.json'),
    JSON.stringify({
      extensions: ['./.pi/extensions/unsafe.mjs'],
      packages: ['npm:must-not-install'],
    }),
  )
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ scripts: { postinstall: `node -e ${JSON.stringify(code)}` } }),
  )
  const app = await createApp({
    dataDir: join(directory, 'data'),
    port: 24417,
    development: true,
    resourceLimits: { modelTasks },
  })
  const workspaces = app.get(WorkspaceService),
    store = app.get(SessionStore),
    kernels = app.get(KernelService),
    sessions = app.get(SessionService),
    availability = app.get(WorkspaceAvailabilityService),
    trust = app.get(TrustService)
  const opened = await workspaces.open(cwd)
  assert(opened.ok)
  const command = (patch: Partial<SessionSubmit> = {}): SessionSubmit => ({
    requestId: randomUUID(),
    sessionId: null,
    text: '本地恢复验收',
    retryOf: null,
    configuration: {
      workspaceId: opened.workspace.id,
      projectId: null,
      model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
      thinking: 'off',
    },
    ...patch,
  })
  const wait = async (requestId: string, status: string) => {
    await expect
      .poll(() => store.receipt(requestId)?.submission.status, { timeout: 15000 })
      .toBe(status)
  }
  const result = {
    directory,
    cwd,
    marker,
    app,
    workspaces,
    store,
    kernels,
    sessions,
    availability,
    trust,
    command,
    wait,
    workspaceId: opened.workspace.id,
  }
  fixtures.push(result)
  return result
}
afterEach(async () => {
  vi.restoreAllMocks()
  const owned = fixtures.splice(0)
  await Promise.all(owned.map((f) => f.app.close()))
  for (const f of owned) {
    rmSync(f.directory, { recursive: true, force: true })
  }
})

describe('WS-07 saved directory execution guard and explicit recovery; actual SDK/local fixture', () => {
  it('opening/inspecting/sending never executes untrusted extensions, settings or install actions; recovery grants nothing', async () => {
    const f = await fixture(),
      target = { workspaceId: f.workspaceId },
      before = readFileSync(join(f.cwd, '.pi', 'settings.json'))
    const initial = workspaceAvailabilitySchema.parse(await f.availability.inspect(target))
    expect(initial).toMatchObject({
      state: 'available',
      resources: { trusted: 0, execution: 'disabled' },
    })
    expect(initial.resources!.untrusted).toBeGreaterThan(0)
    expect(f.kernels.list()).toEqual([])
    const original = f.kernels.prompt.bind(f.kernels)
    const results: Awaited<ReturnType<typeof original>>[] = []
    vi.spyOn(f.kernels, 'prompt').mockImplementation((id, cwd, input, options) =>
      original(id, cwd, { ...input, fixture: 'trust-context' }, options).then((value) => {
        results.push(value)
        return value
      }),
    )
    const first = await f.sessions.submit(f.command())
    await f.wait(first.submission.requestId, 'completed')
    expect(f.store.history(first.session.id)?.messages.at(-1)?.text).not.toContain(
      'WS07_UNTRUSTED_CONTEXT',
    )
    expect(await f.availability.inspect({ sessionId: first.session.id }, true)).toMatchObject({
      state: 'available',
      resources: { trusted: 0 },
    })
    expect(f.trust.inspect().records).toEqual([])
    expect(results).toMatchObject([{ localRequests: 1, blockedNetworkAttempts: 0 }])
    expect(existsSync(f.marker)).toBe(false)
    expect(readFileSync(join(f.cwd, '.pi', 'settings.json'))).toEqual(before)
  })

  it('moved, replaced and deleted directories block before admission; same-identity relocation keeps history and immutable cwd, restore needs explicit send', async () => {
    const f = await fixture(),
      input = f.command(),
      first = await f.sessions.submit(input)
    await f.wait(first.submission.requestId, 'completed')
    await f.kernels.destroy(first.session.id)
    const history = f.store.resumeRuntime(first.session.id, f.cwd)!,
      bytes = readFileSync(history.sessionFile),
      recent = f.workspaces.recent()
    const moved = join(f.directory, 'moved')
    const oldRecord = recent.entries[0]
    assert(oldRecord)
    renameSync(f.cwd, moved)
    const continuation = f.command({
      sessionId: first.session.id,
      configuration: first.session.configuration,
    })
    await expect(f.sessions.submit(continuation)).rejects.toMatchObject({ status: 409 })
    expect(await f.availability.inspect({ sessionId: first.session.id })).toMatchObject({
      state: 'unavailable',
    })
    mkdirSync(f.cwd)
    writeFileSync(join(f.cwd, 'AGENTS.md'), 'WS07_UNTRUSTED_CONTEXT')
    await expect(f.sessions.submit(continuation)).rejects.toMatchObject({ status: 409 })
    expect(
      await f.workspaces.relocate({
        id: f.workspaceId,
        expectedRevision: oldRecord.revision,
        path: f.cwd,
      }),
    ).toMatchObject({ ok: false, code: 'directory_changed' })
    rmSync(f.cwd, { recursive: true })
    expect(
      await f.workspaces.relocate({
        id: f.workspaceId,
        expectedRevision: oldRecord.revision,
        path: moved,
      }),
    ).toMatchObject({ ok: true })
    expect(await f.availability.inspect({ sessionId: first.session.id }, true)).toMatchObject({
      state: 'relocated',
      cwd: f.cwd,
    })
    expect(f.store.receipt(first.submission.requestId)?.session.cwd).toBe(f.cwd)
    expect(f.kernels.list()).toEqual([])
    expect(readFileSync(history.sessionFile)).toEqual(bytes)
    const sameRequest = await f.sessions.submit(input)
    expect(sameRequest.session.id).toBe(first.session.id)
    renameSync(moved, f.cwd)
    const record = f.workspaces.lookupRecord(f.workspaceId)!
    expect(
      await f.workspaces.relocate({
        id: f.workspaceId,
        expectedRevision: record.revision,
        path: f.cwd,
      }),
    ).toMatchObject({ ok: true })
    const before = f.workspaces.recent()
    expect(await f.availability.inspect({ sessionId: first.session.id }, true)).toMatchObject({
      state: 'available',
    })
    expect(f.workspaces.recent()).toEqual(before)
    expect(f.store.submissions(first.session.id)).toHaveLength(1)
    expect(f.kernels.list()).toEqual([])
    const next = await f.sessions.submit(continuation)
    await f.wait(next.submission.requestId, 'completed')
    await f.kernels.destroy(first.session.id)
    rmSync(f.cwd, { recursive: true })
    await expect(
      f.sessions.submit(
        f.command({ sessionId: first.session.id, configuration: first.session.configuration }),
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(
      f.store.history(first.session.id)?.messages.filter((item) => item.role === 'user'),
    ).toHaveLength(2)
    expect(f.kernels.list()).toEqual([])
  })

  it('identical content at a replacement physical directory cannot reuse context consent; relocation never transfers trust', async () => {
    const f = await fixture(),
      resource = f.trust.inspect(f.cwd).resources.find((item) => item.kind === 'context')!
    assert(resource.fingerprint)
    f.trust.grant(
      { project: f.cwd, id: resource.id, fingerprint: resource.fingerprint, confirmed: true },
      randomUUID(),
    )
    const moved = join(f.directory, 'original')
    renameSync(f.cwd, moved)
    mkdirSync(f.cwd)
    writeFileSync(join(f.cwd, 'AGENTS.md'), 'WS07_UNTRUSTED_CONTEXT')
    expect(f.trust.inspect(f.cwd).resources.find((item) => item.kind === 'context')).toMatchObject({
      trust: 'changed',
    })
    expect(f.trust.beginTurn(f.cwd, randomUUID(), randomUUID())).toEqual([])
    expect(f.trust.inspect(moved).resources.find((item) => item.kind === 'context')?.trust).toBe(
      'untrusted',
    )
    expect(f.trust.inspect().records).toHaveLength(1)
    expect(f.kernels.list()).toEqual([])
  })

  it('cancels queued tasks while another directory runs, even without an observing view; restoring cannot resume the queue', async () => {
    const f = await fixture(1),
      other = join(f.directory, 'other')
    mkdirSync(other)
    const opened = await f.workspaces.open(other)
    assert(opened.ok)
    const original = f.kernels.prompt.bind(f.kernels)
    vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, input, options) =>
      original(id, cwd, { ...input, fixture: 'hold' }, options),
    )
    const first = await f.sessions.submit(
      f.command({
        configuration: { ...f.command().configuration, workspaceId: opened.workspace.id },
      }),
    )
    await expect
      .poll(() => f.app.get(EventService).snapshot(first.session.id)?.turns.at(-1)?.text, {
        timeout: 15000,
      })
      .toContain('OFFLINE_')
    const queued = await f.sessions.submit(f.command())
    expect(
      f.kernels
        .resources()
        .queue.some((item) => item.sessionId === queued.session.id && item.stage === 'queued'),
    ).toBe(true)
    const moved = join(f.directory, 'temporarily-unmounted')
    renameSync(f.cwd, moved)
    await f.wait(queued.submission.requestId, 'failed')
    expect(f.store.receipt(queued.submission.requestId)?.submission.error).toContain('任务尚未发送')
    expect(f.kernels.list().some((item) => item.sessionId === queued.session.id)).toBe(false)
    renameSync(moved, f.cwd)
    await f.availability.inspect({ sessionId: queued.session.id }, true)
    expect(f.store.receipt(queued.submission.requestId)?.submission.status).toBe('failed')
    expect(f.kernels.resources().queue.some((item) => item.sessionId === queued.session.id)).toBe(
      false,
    )
    expect(f.store.receipt(first.submission.requestId)?.submission.status).toBe('executing')
    await f.kernels.abort(first.session.id, first.submission.turnId)
    const retry = await f.sessions.submit(
      f.command({
        sessionId: queued.session.id,
        configuration: queued.session.configuration,
        retryOf: queued.submission.requestId,
      }),
    )
    await f.wait(retry.submission.requestId, 'completed')
  })

  it('real OS access loss interrupts and reaps a running background SDK task, retains history and does not replay on restoration', async () => {
    const f = await fixture()
    const original = f.kernels.prompt.bind(f.kernels)
    vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, input, options) =>
      original(id, cwd, { ...input, fixture: 'hold' }, options),
    )
    const first = await f.sessions.submit(f.command())
    await expect
      .poll(() => f.app.get(EventService).snapshot(first.session.id)?.turns.at(-1)?.text, {
        timeout: 15000,
      })
      .toContain('OFFLINE_')
    const sid =
      process.platform === 'win32'
        ? execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
            encoding: 'utf8',
            windowsHide: true,
          }).match(/S-1-[\d-]+/)?.[0]
        : null
    const moved = join(f.directory, 'lost')
    try {
      if (process.platform === 'win32') {
        assert(sid)
        execFileSync('icacls', [f.cwd, '/deny', `*${sid}:(RD)`], {
          windowsHide: true,
          stdio: 'pipe',
        })
      } else {
        renameSync(f.cwd, moved)
      }
      await f.wait(first.submission.requestId, 'interrupted')
      expect(f.store.receipt(first.submission.requestId)?.submission.error).toContain(
        '执行目录不可用',
      )
      expect(f.kernels.list()).toEqual([])
    } finally {
      if (process.platform === 'win32') {
        execFileSync('icacls', [f.cwd, '/remove:d', `*${sid}`], {
          windowsHide: true,
          stdio: 'pipe',
        })
      } else if (existsSync(moved)) {
        renameSync(moved, f.cwd)
      }
    }
    const before = f.store.history(first.session.id)?.messages
    expect(before?.some((item) => item.role === 'user')).toBe(true)
    expect(await f.availability.inspect({ sessionId: first.session.id }, true)).toMatchObject({
      state: 'available',
    })
    expect(f.kernels.list()).toEqual([])
    expect(f.store.submissions(first.session.id)).toHaveLength(1)
    await expect(
      f.sessions.submit(
        f.command({ sessionId: first.session.id, retryOf: first.submission.requestId }),
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(f.store.history(first.session.id)?.messages).toEqual(before)
  })

  it('a lost shutdown acknowledgement preserves uncertainty instead of offering a known-safe replay', async () => {
    const f = await fixture(),
      prompt = f.kernels.prompt.bind(f.kernels)
    vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, input, options) =>
      prompt(id, cwd, { ...input, fixture: 'hold' }, options),
    )
    const first = await f.sessions.submit(f.command())
    await expect
      .poll(() => f.app.get(EventService).snapshot(first.session.id)?.turns.at(-1)?.text, {
        timeout: 15000,
      })
      .toContain('OFFLINE_')
    // oxlint-disable-next-line typescript/unbound-method -- Retain the original method, then explicitly bind this below so the real child exits before injecting the lost acknowledgement.
    const dispose = SessionKernel.prototype.dispose
    vi.spyOn(SessionKernel.prototype, 'dispose').mockImplementationOnce(async function (
      this: SessionKernel,
    ) {
      await dispose.call(this)
      throw new Error(
        'Explicit fault fixture: lost shutdown acknowledgement after real process exit',
      )
    })
    vi.spyOn(f.workspaces, 'environmentDirectory').mockResolvedValueOnce({
      ok: false,
      code: 'unavailable',
      message: 'Explicit directory-loss fixture',
      recovery: 'Restore original directory',
    })
    await f.wait(first.submission.requestId, 'interrupted')
    expect(f.store.receipt(first.submission.requestId)?.submission.error).toContain(
      '执行结果待确认',
    )
    expect(f.kernels.list()).toEqual([])
    await expect(
      f.sessions.submit(
        f.command({ sessionId: first.session.id, retryOf: first.submission.requestId }),
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(f.store.submissions(first.session.id)).toHaveLength(1)
  })

  it('a hung/late old-turn directory check cannot abort a later turn, and readonly recovery endpoints enforce identity and client boundaries', async () => {
    const f = await fixture()
    const headers = async (kind: 'desktop' | 'browser') => {
      const ticket = f.app.get(AccessService).issueTicket(kind)
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/access/pair',
        headers: { host: '127.0.0.1:24417', origin: 'http://127.0.0.1:24417' },
        payload: { code: ticket.code, label: 'WS07 test' },
      })
      const cookie = String(response.headers['set-cookie']).split(';')[0]
      const status = accessSnapshotSchema.parse(
        (
          await f.app.inject({ url: '/api/access', headers: { host: '127.0.0.1:24417', cookie } })
        ).json(),
      )
      return {
        host: '127.0.0.1:24417',
        origin: 'http://127.0.0.1:24417',
        cookie,
        'x-piw-csrf': status.csrf!,
        'x-piw-protocol': '1',
        'x-piw-capabilities': runtimeCapabilities.join(','),
      }
    }
    const desktop = await headers('desktop'),
      browser = await headers('browser'),
      target = { workspaceId: f.workspaceId }
    expect(
      (
        await f.app.inject({
          url: `/api/workspaces/availability?workspaceId=${randomUUID()}`,
          headers: desktop,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await f.app.inject({
          url: `/api/workspaces/availability?workspaceId=${f.workspaceId}`,
          headers: { host: desktop.host },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await f.app.inject({
          url: `/api/workspaces/availability?workspaceId=${f.workspaceId}`,
          headers: browser,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/workspaces/recover',
          headers: { ...desktop, 'x-piw-csrf': '' },
          payload: target,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/workspaces/recover',
          headers: desktop,
          payload: { ...target, cwd: f.directory },
        })
      ).statusCode,
    ).toBe(400)
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/workspaces/recover',
      headers: desktop,
      payload: target,
    })
    expect(response.statusCode).toBe(200)
    expect(workspaceAvailabilitySchema.parse(response.json()).state).toBe('available')
    const sessionId = randomUUID(),
      turnId = randomUUID()
    let failOld!: (error: Error) => void
    let checked = false
    const stale = new Promise<void>((_resolve, reject) => {
      failOld = reject
    })
    const task = f.kernels.prompt(
      sessionId,
      f.cwd,
      { turnId, text: 'old', fixture: 'hold' },
      {
        directoryCheck: () => {
          // Arm the injected hang after the SDK has committed native history. Under full
          // suite load, baseline capture can still be running at the first timer tick.
          if (
            !f.app.get(EventService).snapshot(sessionId)?.turns.at(-1)?.text.includes('OFFLINE_')
          ) {
            return Promise.resolve()
          }
          checked = true
          return stale
        },
      },
    )
    await expect.poll(() => checked, { timeout: 15000 }).toBe(true)
    await expect(task).rejects.toThrow('目录检查超时')
    expect(f.kernels.list()).toEqual([])
    const newTurn = randomUUID(),
      next = f.kernels.prompt(sessionId, f.cwd, { turnId: newTurn, text: 'new', fixture: 'hold' })
    await expect
      .poll(() => f.app.get(EventService).snapshot(sessionId)?.turns.at(-1)?.text, {
        timeout: 15000,
      })
      .toContain('OFFLINE_')
    failOld(new Error('old directory response'))
    await vi.waitFor(() =>
      expect(f.kernels.resources().queue.find((item) => item.id === newTurn)?.stage).toBe(
        'running',
      ),
    )
    await f.kernels.abort(sessionId, newTurn)
    expect((await next).outcome).toBe('aborted')
  }, 40000)
})
