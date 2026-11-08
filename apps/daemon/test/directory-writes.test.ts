import { ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { SessionKernel } from '@pi-workbench/agent-adapter'
import { directoryWriteStatusSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { SessionGrantService } from '../dist/modules/security/session-grant.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { DirectoryWriteService } from '../dist/modules/workspaces/directory-write.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'

const wait = { timeout: 20000, interval: 30 }
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Directory fixture object missing')
  }
  return value
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'piw-directory-')),
    a = join(root, 'a'),
    b = join(root, 'b'),
    dataDir = join(root, 'data')
  mkdirSync(a)
  mkdirSync(b)
  const app = await createApp({
    dataDir,
    port: 24471,
    development: true,
    resourceLimits: { kernels: 4, modelTasks: 3 },
  })
  const kernels = app.get(KernelService),
    writes = app.get(DirectoryWriteService),
    events = app.get(EventService)
  const failures = new Map<string, string>()
  const start = (
    cwd = a,
    fixture: 'hold' | 'reply' | 'directory-command' | 'approval-write' | 'error' = 'hold',
  ) => {
    const sessionId = randomUUID(),
      turnId = randomUUID()
    const promise = kernels.prompt(sessionId, cwd, { turnId, text: 'WS04 local fixture', fixture })
    void promise.catch((error: unknown) => {
      failures.set(sessionId, error instanceof Error ? error.message : 'Unknown fixture error')
    })
    return { sessionId, turnId, promise }
  }
  return {
    root,
    a,
    b,
    dataDir,
    app,
    kernels,
    writes,
    events,
    start,
    stream: async (id: string) => {
      try {
        await vi.waitFor(
          () => expect(events.snapshot(id)?.turns.at(-1)?.text ?? '').toContain('OFFLINE_'),
          wait,
        )
      } catch (cause) {
        throw new Error(
          `Directory fixture did not stream: ${JSON.stringify({ sessionId: id, error: failures.get(id), resources: kernels.resources() })}`,
          { cause },
        )
      }
    },
    close: async () => {
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

test('wS-04 real SDK uses physical aliases and per-directory FIFO with independent work running on multiple model slots', async () => {
  const f = await setup()
  try {
    const alias = join(f.root, 'alias')
    symlinkSync(f.a, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(f.writes.identify(alias)).toEqual(f.writes.identify(f.a))
    const first = f.start()
    await f.stream(first.sessionId)
    const second = f.start(alias),
      third = f.start(),
      independent = f.start(f.b)
    await f.stream(independent.sessionId)
    expect(f.kernels.resources().modelTasks).toBe(2)
    expect(f.kernels.resources().limits.modelTasks).toBe(3)
    expect(f.kernels.list().some((k) => k.sessionId === second.sessionId)).toBe(false)
    expect(f.kernels.directoryQueue(f.writes.identify(f.a))).toEqual([
      { sessionId: second.sessionId, turnId: second.turnId, position: 1 },
      { sessionId: third.sessionId, turnId: third.turnId, position: 2 },
    ])
    expect(f.kernels.resources().queue.find((q) => q.id === second.turnId)).toMatchObject({
      reason: 'directory-busy',
      directoryOwner: { sessionId: first.sessionId, turnId: first.turnId },
    })
    await f.kernels.abort(first.sessionId, first.turnId)
    await first.promise
    await f.stream(second.sessionId)
    expect(f.events.snapshot(third.sessionId)).toBeUndefined()
    await f.kernels.abort(third.sessionId, third.turnId)
    await expect(third.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.kernels.directoryQueue(f.writes.identify(f.a))).toEqual([])
    await f.kernels.abort(second.sessionId, second.turnId)
    await second.promise
    expect(f.writes.blocker(f.writes.identify(f.a))).toBeNull()
    expect(f.kernels.list().find((k) => k.sessionId === independent.sessionId)?.state).toBe(
      'running',
    )
  } finally {
    await f.close()
  }
}, 60000)

test('wS-04 overlapping parent/child roots wait, while queued cancellation and late stop IDs cannot release another owner', async () => {
  const f = await setup()
  try {
    const nested = join(f.a, 'nested')
    mkdirSync(nested)
    const first = f.start(nested)
    await f.stream(first.sessionId)
    const parent = f.start(f.a)
    expect(f.kernels.resources().queue.find((q) => q.id === parent.turnId)?.reason).toBe(
      'directory-busy',
    )
    await expect(f.kernels.abort(first.sessionId, randomUUID())).rejects.toThrow(
      'Unknown active turn',
    )
    await f.kernels.abort(parent.sessionId, parent.turnId)
    await expect(parent.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.writes.blocker(f.writes.identify(f.a))?.turnId).toBe(first.turnId)
    expect(f.kernels.list()).toHaveLength(1)
  } finally {
    await f.close()
  }
}, 60000)

test('wS-04 real approved write and pending approvals retain the lease until host settlement metadata is saved', async () => {
  const f = await setup()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const finish = f.writes.finish.bind(f.writes)
  let closingTurn = ''
  const hold = vi.spyOn(f.writes, 'finish').mockImplementationOnce(async (id, safe) => {
    closingTurn = id
    await gate
    await finish(id, safe)
  })
  try {
    const first = f.start(f.a, 'approval-write')
    const approvals = f.app.get(ApprovalService)
    await vi.waitFor(() => expect(approvals.list()).toHaveLength(1), wait)
    const pending = required(approvals.list()[0]),
      second = f.start()
    expect(f.writes.blocker(f.writes.identify(f.a))?.turnId).toBe(first.turnId)
    approvals.decide(
      pending.id,
      {
        sessionId: pending.sessionId,
        epoch: pending.epoch,
        turnId: pending.turnId,
        digest: pending.risk.digest,
        policyVersion: pending.risk.policyVersion,
        action: 'allow-once',
        reason: 'explicit local fixture write',
        acceptIrreversible: true,
      },
      'desktop-fixture',
    )
    await vi.waitFor(() => expect(closingTurn).toBe(first.turnId), wait)
    expect(readFileSync(join(f.a, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
    expect(f.events.snapshot(first.sessionId)?.turns.at(-1)?.phase).toBe('completed')
    expect(f.writes.blocker(f.writes.identify(f.a))?.turnId).toBe(first.turnId)
    expect(f.events.snapshot(second.sessionId)).toBeUndefined()
    // A real external edit mixes with the SDK-written bytes while the round still
    // owns the directory. Final observation must preserve both, without attribution.
    const mixedContent = 'SEC02_APPROVED_ONCE\nWS04_EXTERNAL_MIXED'
    writeFileSync(join(f.a, 'APPROVED.txt'), mixedContent)
    release()
    await first.promise
    await f.stream(second.sessionId)
    expect(f.writes.latest(first.sessionId)).toMatchObject({
      state: 'released',
      provenance: 'uncertain',
      automaticRollback: false,
      changedPaths: ['APPROVED.txt'],
    })
    expect(readFileSync(join(f.a, 'APPROVED.txt'), 'utf8')).toBe(mixedContent)
  } finally {
    release()
    hold.mockRestore()
    await f.close()
  }
}, 60000)

test('wS-04 child death is reaped before a queued round is admitted; no retry or prior authorization survives', async () => {
  const f = await setup()
  // oxlint-disable-next-line typescript/unbound-method -- Forwarded only with the actual SessionKernel instance via .call(this, input).
  const prompt = SessionKernel.prototype.prompt,
    order: string[] = [],
    capture = vi.spyOn(SessionKernel.prototype, 'prompt').mockImplementation(function (
      this: SessionKernel,
      input,
    ) {
      order.push(`prompt:${input.turnId}`)
      return prompt.call(this, input)
    })
  try {
    const first = f.start()
    await f.stream(first.sessionId)
    const second = f.start(),
      pid = required(f.kernels.list().find((k) => k.sessionId === first.sessionId)?.pid),
      context: unknown = capture.mock.contexts[0],
      child: unknown = context && typeof context === 'object' ? Reflect.get(context, 'child') : null
    if (!(child instanceof ChildProcess) || child.pid !== pid) {
      throw new Error('Actual SDK child-death fixture binding unavailable')
    }
    // Bind the actual process instance. A numeric PID can be reused by another SDK
    // or a parallel test after exit, so kill(pid, 0) cannot prove this child's lifetime.
    child.once('exit', () => order.push('original-exit'))
    process.kill(pid, 'SIGKILL')
    await expect(first.promise).rejects.toThrow(/Kernel/)
    await f.stream(second.sessionId)
    expect(order).toContain('original-exit')
    expect(order.indexOf('original-exit')).toBeLessThan(order.indexOf(`prompt:${second.turnId}`))
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(f.writes.latest(first.sessionId)?.state).toBe('released')
    expect(f.app.get(ApprovalService).list()).toEqual([])
    expect(f.app.get(SessionGrantService).list().grants).toEqual([])
  } finally {
    capture.mockRestore()
    await f.close()
  }
}, 60000)

test('wS-04 actual SDK IPC disconnect retains directory ownership until its process is reaped, then admits the queued round', async () => {
  const f = await setup()
  // Capture the real host object only to sever its owned IPC channel. Prompt, stream,
  // process shutdown, database and successor dispatch all use the actual SDK lifecycle.
  // oxlint-disable-next-line typescript/unbound-method -- Forwarded only with the actual SessionKernel instance via .call(this, input).
  const prompt = SessionKernel.prototype.prompt,
    order: string[] = [],
    capture = vi.spyOn(SessionKernel.prototype, 'prompt').mockImplementation(function (
      this: SessionKernel,
      input,
    ) {
      order.push(`prompt:${input.turnId}`)
      return prompt.call(this, input)
    })
  try {
    const first = f.start()
    await f.stream(first.sessionId)
    const second = f.start(),
      pid = required(f.kernels.list().find((k) => k.sessionId === first.sessionId)?.pid),
      context: unknown = capture.mock.contexts[0],
      channel: unknown =
        context && typeof context === 'object' ? Reflect.get(context, 'child') : null
    if (!(channel instanceof ChildProcess) || channel.pid !== pid) {
      throw new Error('Actual SDK IPC fixture binding unavailable')
    }
    channel.once('exit', () => order.push('original-exit'))
    expect(f.writes.blocker(f.writes.identify(f.a))?.turnId).toBe(first.turnId)
    channel.disconnect()
    await expect(first.promise).rejects.toThrow(/Kernel/)
    await f.stream(second.sessionId)
    expect(order).toContain('original-exit')
    expect(order.indexOf('original-exit')).toBeLessThan(order.indexOf(`prompt:${second.turnId}`))
    expect(channel.exitCode !== null || channel.signalCode !== null).toBe(true)
    expect(f.writes.blocker(f.writes.identify(f.a))?.turnId).toBe(second.turnId)
    expect(f.app.get(ApprovalService).list()).toEqual([])
  } finally {
    capture.mockRestore()
    await f.close()
  }
}, 60000)

test('wS-04 external edits, creates and deletes are persisted as uncertain metadata, with no file contents or rollback qualification', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.a, 'external.txt'), 'before')
    writeFileSync(join(f.a, 'removed.txt'), 'keep before')
    const first = f.start()
    await f.stream(first.sessionId)
    writeFileSync(join(f.a, 'external.txt'), 'EXTERNAL_SECRET_CONTENT_MUST_NOT_BE_PERSISTED')
    writeFileSync(join(f.a, 'created.txt'), 'new external text')
    unlinkSync(join(f.a, 'removed.txt'))
    await vi.waitFor(
      () =>
        expect(f.writes.latest(first.sessionId)?.changedPaths).toEqual(
          expect.arrayContaining(['external.txt', 'created.txt', 'removed.txt']),
        ),
      wait,
    )
    expect(f.writes.latest(first.sessionId)).toMatchObject({
      provenance: 'uncertain',
      automaticRollback: false,
    })
    await f.kernels.abort(first.sessionId, first.turnId)
    await first.promise
    const row = f.app
      .get(WorkspaceDatabase)
      .sqlite.prepare('SELECT data FROM directory_rounds WHERE turn_id = ?')
      .get(first.turnId)
    expect(JSON.stringify(row)).not.toContain('EXTERNAL_SECRET_CONTENT')
    expect(readFileSync(join(f.a, 'external.txt'), 'utf8')).toContain('EXTERNAL_SECRET_CONTENT')
  } finally {
    await f.close()
  }
}, 60000)

test('wS-04 bounded sampling never follows junctions, and injected identity failure confers no source or rollback authority', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.b, 'outside.txt'), 'outside untouched')
    symlinkSync(f.b, join(f.a, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    mkdirSync(join(f.a, '.git'))
    const first = f.start()
    await f.stream(first.sessionId)
    expect(f.writes.latest(first.sessionId)?.coverage).toBe('limited')
    writeFileSync(join(f.b, 'outside.txt'), 'outside edited')
    await f.kernels.abort(first.sessionId, first.turnId)
    await first.promise
    expect(f.writes.latest(first.sessionId)?.changedPaths).not.toContain(
      join('linked', 'outside.txt'),
    )
    expect(f.writes.latest(first.sessionId)?.automaticRollback).toBe(false)
    const next = f.start()
    await f.stream(next.sessionId)
    const identity = vi
      .spyOn(f.app.get(WorkspaceService), 'executionIdentity')
      .mockImplementation(() => {
        throw new Error('injected metadata IO failure')
      })
    await f.kernels.abort(next.sessionId, next.turnId)
    await next.promise
    identity.mockRestore()
    expect(f.writes.latest(next.sessionId)).toMatchObject({
      coverage: 'unavailable',
      automaticRollback: false,
      changedPaths: [],
    })
  } finally {
    await f.close()
  }
}, 60000)

test('wS-04 status HTTP is desktop-only and restart preserves observations without kernels, queues, old approvals or provider calls', async () => {
  const f = await setup()
  let closed = false
  try {
    const workspace = await f.app.get(WorkspaceService).open(f.a)
    if (!workspace.ok) {
      throw new Error('Workspace fixture unavailable')
    }
    const receipt = await f.app.get(SessionService).submit({
      requestId: randomUUID(),
      sessionId: null,
      text: 'WS04 managed local reply',
      retryOf: null,
      configuration: {
        projectId: null,
        workspaceId: workspace.workspace.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    await vi.waitFor(
      () => expect(f.writes.latest(receipt.session.id)?.state).toBe('released'),
      wait,
    )
    const file = required(f.kernels.list()[0]?.sessionFile),
      bytes = readFileSync(file)
    const url = `/api/workspaces/write-status?sessionId=${receipt.session.id}`
    expect(
      (await f.app.inject({ method: 'GET', url, headers: { host: '127.0.0.1:24471' } })).statusCode,
    ).toBe(401)
    expect(
      (await f.app.inject({ method: 'GET', url, headers: await authorizedHeaders(f.app, 24471) }))
        .statusCode,
    ).toBe(403)
    const headers = await authorizedHeaders(f.app, 24471, 'desktop')
    const response = await f.app.inject({ method: 'GET', url, headers })
    expect(response.statusCode).toBe(200)
    expect(directoryWriteStatusSchema.parse(response.json())).toMatchObject({
      owner: null,
      queue: [],
      latest: { state: 'released', automaticRollback: false },
    })
    await f.app.close()
    closed = true
    const restarted = await createApp({ dataDir: f.dataDir, port: 24471, development: true })
    try {
      expect(restarted.get(KernelService).list()).toEqual([])
      expect(restarted.get(KernelService).resources().queue).toEqual([])
      expect(restarted.get(DirectoryWriteService).latest(receipt.session.id)?.state).toBe(
        'released',
      )
      expect(restarted.get(ApprovalService).list()).toEqual([])
      expect(restarted.get(SessionGrantService).list().grants).toEqual([])
      expect(readFileSync(file)).toEqual(bytes)
      expect((await restarted.inject({ method: 'GET', url, headers })).statusCode).toBe(401)
    } finally {
      await restarted.close()
    }
  } finally {
    if (!closed) {
      await f.app.close()
    }
    rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 60000)

test('wS-04 graceful shutdown cancels the waiting request, finishes the owner, and leaves no write action running', async () => {
  const f = await setup()
  try {
    const first = f.start(f.a, 'directory-command'),
      approvals = f.app.get(ApprovalService)
    await vi.waitFor(() => expect(approvals.list()).toHaveLength(1), wait)
    const p = required(approvals.list()[0]),
      second = f.start()
    approvals.decide(
      p.id,
      {
        sessionId: p.sessionId,
        epoch: p.epoch,
        turnId: p.turnId,
        digest: p.risk.digest,
        policyVersion: p.risk.policyVersion,
        action: 'allow-once',
        reason: 'local wait action',
        acceptIrreversible: true,
      },
      'desktop-fixture',
    )
    await vi.waitFor(() => expect(existsSync(join(f.a, 'WS04-RUNNING.txt'))).toBe(true), wait)
    const pid = required(f.kernels.list()[0]?.pid)
    await f.app.close()
    await Promise.allSettled([first.promise, second.promise])
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/)
    expect(existsSync(join(f.a, 'WS04-FINISHED.txt'))).toBe(false)
  } finally {
    await f.close()
  }
}, 60000)

test.each(['disconnect', 'kill'] as const)(
  'wS-04 actual running command cannot write after successor admission on SDK %s',
  async (failure) => {
    const f = await setup()
    const capture = vi.spyOn(SessionKernel.prototype, 'prompt')
    try {
      const first = f.start(f.a, 'directory-command'),
        approvals = f.app.get(ApprovalService)
      await vi.waitFor(() => expect(approvals.list()).toHaveLength(1), wait)
      const p = required(approvals.list()[0]),
        next = f.start()
      approvals.decide(
        p.id,
        {
          sessionId: p.sessionId,
          epoch: p.epoch,
          turnId: p.turnId,
          digest: p.risk.digest,
          policyVersion: p.risk.policyVersion,
          action: 'allow-once',
          reason: 'explicit command lifecycle fixture',
          acceptIrreversible: true,
        },
        'desktop-fixture',
      )
      await vi.waitFor(() => expect(existsSync(join(f.a, 'WS04-RUNNING.txt'))).toBe(true), wait)
      const context: unknown = capture.mock.contexts[0],
        channel: unknown =
          context && typeof context === 'object' ? Reflect.get(context, 'child') : null
      if (!(channel instanceof ChildProcess) || !channel.pid) {
        throw new Error('Actual SDK command fixture binding unavailable')
      }
      if (failure === 'disconnect') {
        channel.disconnect()
      } else {
        process.kill(channel.pid, 'SIGKILL')
      }
      await expect(first.promise).rejects.toThrow(/Kernel/)
      await f.stream(next.sessionId)
      const finishedAtAdmission = existsSync(join(f.a, 'WS04-FINISHED.txt'))
      // The command's delayed write is an observable side effect, not a spy on cleanup.
      await new Promise<void>((resolve) => setTimeout(resolve, 8500))
      expect(existsSync(join(f.a, 'WS04-FINISHED.txt'))).toBe(finishedAtAdmission)
    } finally {
      capture.mockRestore()
      await f.close()
    }
  },
  60000,
)

test('wS-04 failed final metadata commit keeps a quarantine until the actual SDK process exits', async () => {
  const f = await setup()
  try {
    const first = f.start()
    await f.stream(first.sessionId)
    f.app.get(WorkspaceDatabase).sqlite
      .exec(`CREATE TRIGGER ws04_fail_final BEFORE UPDATE ON directory_rounds
      WHEN NEW.state = 'released' BEGIN SELECT RAISE(ABORT, 'fixture final metadata save failure'); END;`)
    const second = f.start()
    await f.kernels.abort(first.sessionId, first.turnId)
    await expect(first.promise).rejects.toThrow('fixture final metadata save failure')
    expect(f.writes.blocker(f.writes.identify(f.a))).toMatchObject({
      turnId: first.turnId,
      state: 'quarantined',
    })
    expect(f.events.snapshot(second.sessionId)).toBeUndefined()
    f.app.get(WorkspaceDatabase).sqlite.exec('DROP TRIGGER ws04_fail_final')
    await f.kernels.destroy(first.sessionId)
    await f.stream(second.sessionId)
    expect(f.writes.latest(first.sessionId)?.state).toBe('interrupted')
  } finally {
    await f.close()
  }
}, 60000)

test('wS-04 restart quarantines a still-live prior PID without adopting or prompting it, and admits only an explicit new request after exit', async () => {
  const f = await setup()
  // Explicit orphan-process fixture, not an SDK/approval record. Its real lifetime proves
  // that startup cannot discard a blocking record merely because this daemon is new.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  let restarted: Awaited<ReturnType<typeof createApp>> | undefined
  try {
    const priorSession = randomUUID(),
      turnId = randomUUID()
    f.writes.reserve(f.writes.identify(f.a), priorSession, turnId)
    await f.writes.begin(turnId, required(child.pid))
    await f.app.close()
    restarted = await createApp({
      dataDir: f.dataDir,
      port: 24471,
      development: true,
      resourceLimits: { modelTasks: 3 },
    })
    const kernels = restarted.get(KernelService),
      writes = restarted.get(DirectoryWriteService)
    expect(kernels.list()).toEqual([])
    expect(kernels.resources().queue).toEqual([])
    expect(writes.blocker(writes.identify(f.a))).toMatchObject({ turnId, state: 'quarantined' })
    const sessionId = randomUUID(),
      nextTurn = randomUUID()
    const run = kernels.prompt(sessionId, f.a, { turnId: nextTurn, text: 'explicit new round' })
    void run.catch(() => undefined)
    expect(kernels.resources().modelTasks).toBe(0)
    expect(kernels.list()).toEqual([])
    expect(kernels.resources().queue[0]).toMatchObject({ reason: 'directory-busy' })
    child.kill()
    await exited
    expect(await run).toMatchObject({
      outcome: 'completed',
      localRequests: 1,
      blockedNetworkAttempts: 0,
    })
    expect(writes.latest(priorSession)).toMatchObject({
      state: 'interrupted',
      automaticRollback: false,
    })
  } finally {
    child.kill()
    await exited
    await restarted?.close()
    await f.app.close()
    rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 60000)
