/* oxlint-disable no-await-in-loop -- Actual SDK rounds, preflight and fault compensation follow a single directory lifecycle. */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeRollbackService } from '../dist/modules/changes/change-rollback.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { AuditService } from '../dist/modules/security/audit.service.js'
import { DirectoryWriteService } from '../dist/modules/workspaces/directory-write.service.js'

const wait = { timeout: 20000, interval: 40 }
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'piw-rollback-')),
    cwd = join(root, '中文目录'),
    dataDir = join(root, 'data')
  mkdirSync(cwd)
  let app = await createApp({
    dataDir,
    port: 24476,
    development: true,
    resourceLimits: { kernels: 4, modelTasks: 3 },
  })
  const get = () => ({
    rollback: app.get(ChangeRollbackService),
    changes: app.get(ChangeService),
    review: app.get(ChangeReviewService),
    kernels: app.get(KernelService),
    writes: app.get(DirectoryWriteService),
  })
  const start = (
    fixture: 'hold' | 'change-chain' = 'hold',
    sessionId: string = randomUUID(),
    path = cwd,
  ) => {
    const turnId = randomUUID(),
      promise = get().kernels.prompt(sessionId, path, {
        turnId,
        text: '真实 SDK 本地回滚夹具',
        fixture,
      })
    void promise.catch(() => undefined)
    return { sessionId, turnId, promise }
  }
  const ready = async (sessionId: string) =>
    vi.waitFor(
      () => expect(get().changes.history(sessionId).rounds[0]?.baseline.status).toBe('ready'),
      wait,
    )
  const collect = async (mutate: () => void, sessionId?: string) => {
    const t = start('hold', sessionId)
    await ready(t.sessionId)
    mutate()
    await get().kernels.abort(t.sessionId, t.turnId)
    await t.promise
    await vi.waitFor(
      () => expect(get().changes.history(t.sessionId).rounds[0]?.final.status).toBe('ready'),
      wait,
    )
    return t
  }
  return {
    root,
    cwd,
    dataDir,
    get,
    start,
    ready,
    collect,
    get app() {
      return app
    },
    prepare: async (t: { sessionId: string; turnId: string }, fileId: string | null = null) =>
      get().rollback.prepare({ sessionId: t.sessionId, turnId: t.turnId, fileId }, 'desktop-test'),
    confirm: async (plan: Awaited<ReturnType<ChangeRollbackService['prepare']>>, external = true) =>
      get().rollback.command({
        sessionId: plan.record.sessionId,
        operationId: plan.record.id,
        confirmationId: plan.confirmationId,
        action: external ? 'confirm-external' : 'confirm',
      }),
    restart: async () => {
      await app.close()
      app = await createApp({ dataDir, port: 24476, development: true })
    },
    close: async () => {
      vi.restoreAllMocks()
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

test('cHANGE-05 actual SDK chain restores preexisting dirty bytes without touching user HEAD/index/config', async () => {
  const f = await setup()
  try {
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=f@piw.invalid', '-C', f.cwd, ...args],
        { windowsHide: true },
      )
    git('init')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'committed\n')
    git('add', '.')
    git('commit', '-m', 'user history')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'staged\n')
    git('add', '.')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'dirty\n')
    const unchanged = ['HEAD', 'index', 'config', 'logs/HEAD'].map((p) =>
      hash(readFileSync(join(f.cwd, '.git', p))),
    )
    const t = f.start('change-chain')
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(
        () =>
          expect(
            f.app
              .get(ApprovalService)
              .list()
              .some((p) => p.turnId === t.turnId),
          ).toBe(true),
        wait,
      )
      const p = f.app
        .get(ApprovalService)
        .list()
        .find((candidate) => candidate.turnId === t.turnId)!
      f.app.get(ApprovalService).decide(
        p.id,
        {
          sessionId: p.sessionId,
          epoch: p.epoch,
          turnId: p.turnId,
          digest: p.risk.digest,
          policyVersion: p.risk.policyVersion,
          action: 'allow-once',
          reason: 'explicit fixture',
          acceptIrreversible: true,
        },
        'desktop-test',
      )
    }
    expect(await t.promise).toMatchObject({
      outcome: 'completed',
      localRequests: 3,
      blockedNetworkAttempts: 0,
    })
    const plan = await f.prepare(t)
    expect(plan.record.files.every((p) => !p.conflict && p.source === 'tool-observed')).toBe(true)
    expect((await f.confirm(plan, false)).state).toBe('succeeded')
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('dirty\n')
    expect(
      ['HEAD', 'index', 'config', 'logs/HEAD'].map((p) =>
        hash(readFileSync(join(f.cwd, '.git', p))),
      ),
    ).toEqual(unchanged)
    expect(
      f.app
        .get(AuditService)
        .page({ kind: 'rollback' })
        .entries.map((e) => e.decision),
    ).toEqual(['succeeded', 'confirmed'])
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-05 real files non-Git batch restores add/delete/rename/binary/zero/nested; unknown source requires separate confirmation and duplicates never replay', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'dirty.txt'), 'dirty before\n')
    writeFileSync(join(f.cwd, 'deleted.txt'), 'restore deleted\n')
    writeFileSync(join(f.cwd, 'old.txt'), 'rename unique\n')
    writeFileSync(join(f.cwd, 'binary.bin'), Buffer.from([0, 255, 1]))
    mkdirSync(join(f.cwd, 'nested'))
    writeFileSync(join(f.cwd, 'nested', 'gone.txt'), 'parent gone\n')
    const t = await f.collect(() => {
      writeFileSync(join(f.cwd, 'dirty.txt'), 'agent after\n')
      writeFileSync(join(f.cwd, 'added.txt'), 'added')
      unlinkSync(join(f.cwd, 'deleted.txt'))
      renameSync(join(f.cwd, 'old.txt'), join(f.cwd, 'new.txt'))
      writeFileSync(join(f.cwd, 'binary.bin'), Buffer.from([0, 255, 2]))
      writeFileSync(join(f.cwd, 'zero.txt'), '')
      rmSync(join(f.cwd, 'nested'), { recursive: true })
    })
    const plan = await f.prepare(t)
    await expect(f.confirm(plan, false)).rejects.toThrow('冲突')
    expect(readFileSync(join(f.cwd, 'dirty.txt'), 'utf8')).toBe('agent after\n')
    const result = await f.confirm(plan)
    expect(result.state).toBe('succeeded')
    expect(result.externalConfirmed).toBe(true)
    expect(existsSync(join(f.cwd, 'added.txt'))).toBe(false)
    expect(existsSync(join(f.cwd, 'zero.txt'))).toBe(false)
    expect(readFileSync(join(f.cwd, 'deleted.txt'), 'utf8')).toBe('restore deleted\n')
    expect(readFileSync(join(f.cwd, 'old.txt'), 'utf8')).toBe('rename unique\n')
    expect(existsSync(join(f.cwd, 'new.txt'))).toBe(false)
    expect(readFileSync(join(f.cwd, 'binary.bin'))).toEqual(Buffer.from([0, 255, 1]))
    expect(readFileSync(join(f.cwd, 'nested', 'gone.txt'), 'utf8')).toBe('parent gone\n')
    writeFileSync(join(f.cwd, 'dirty.txt'), 'later external')
    expect(await f.confirm(plan)).toEqual(result)
    expect(readFileSync(join(f.cwd, 'dirty.txt'), 'utf8')).toBe('later external')
    await f.restart()
    expect(f.get().rollback.record(t.sessionId, result.id)).toEqual(result)
    expect(f.get().kernels.list()).toHaveLength(0)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-05 stale preflight causes whole-batch zero writes, even after explicit external consent', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'a'), 'a0')
    writeFileSync(join(f.cwd, 'b'), 'b0')
    const t = await f.collect(() => {
      writeFileSync(join(f.cwd, 'a'), 'a1')
      writeFileSync(join(f.cwd, 'b'), 'b1')
    })
    const plan = await f.prepare(t)
    writeFileSync(join(f.cwd, 'b'), 'external after prepare')
    expect((await f.confirm(plan)).state).toBe('conflict')
    expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('a1')
    expect(readFileSync(join(f.cwd, 'b'), 'utf8')).toBe('external after prepare')
    const second = await f.prepare(t)
    expect((await f.confirm(second)).state).toBe('succeeded')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-05 per-file selection leaves other paths, prepared cancellation and restart invalidate confirmation', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'a'), 'a0')
    writeFileSync(join(f.cwd, 'b'), 'b0')
    const t = await f.collect(() => {
      writeFileSync(join(f.cwd, 'a'), 'a1')
      writeFileSync(join(f.cwd, 'b'), 'b1')
    })
    const selected = (await f.get().review.list(t.turnId)).files.find((p) => p.path === 'a')!
    const plan = await f.prepare(t, selected.id)
    const cancelled = await f.get().rollback.command({
      sessionId: t.sessionId,
      operationId: plan.record.id,
      confirmationId: plan.confirmationId,
      action: 'cancel',
    })
    expect(cancelled.state).toBe('cancelled')
    expect((await f.confirm(plan)).state).toBe('cancelled')
    const single = await f.prepare(t, selected.id)
    expect((await f.confirm(single)).state).toBe('succeeded')
    expect(readFileSync(join(f.cwd, 'b'), 'utf8')).toBe('b1')
    const pending = await f.prepare(t)
    await f.restart()
    expect((await f.confirm(pending)).state).toBe('cancelled')
    expect(readFileSync(join(f.cwd, 'b'), 'utf8')).toBe('b1')
    await expect(
      f.get().rollback.prepare({ ...t, fileId: '0'.repeat(64) }, 'test'),
    ).rejects.toThrow('没有可回滚')
    expect(() => f.get().rollback.record(randomUUID(), plan.record.id)).toThrow('不属于')
  } finally {
    await f.close()
  }
}, 60000)

test.each([false, true])(
  'cHANGE-05 injected second-write failure compensates only unchanged written bytes; preserve external edit=%s',
  async (external) => {
    const f = await setup()
    try {
      writeFileSync(join(f.cwd, 'a'), 'a0')
      writeFileSync(join(f.cwd, 'b'), 'b0')
      const t = await f.collect(() => {
        writeFileSync(join(f.cwd, 'a'), 'a1')
        writeFileSync(join(f.cwd, 'b'), 'b1')
      })
      const plan = await f.prepare(t),
        write = f.get().rollback.files.write.bind(f.get().rollback.files)
      const first = plan.record.files[0]
      if (!first) {
        throw new Error('Rollback fixture target missing')
      }
      let count = 0
      vi.spyOn(f.get().rollback.files, 'write').mockImplementation(
        async (cwd, path, expected, target) => {
          if (++count === 2) {
            if (external) {
              writeFileSync(join(cwd, first.path), 'external during compensation')
            }
            throw new Error('injected IO failure')
          }
          return write(cwd, path, expected, target)
        },
      )
      const result = await f.confirm(plan)
      expect(result.state).toBe(external ? 'needs-recovery' : 'compensated')
      expect(result.files[0]?.compensated).toBe(!external)
      expect(readFileSync(join(f.cwd, first.path), 'utf8')).toBe(
        external
          ? 'external during compensation'
          : plan.record.files[0]?.path === 'a'
            ? 'a1'
            : 'b1',
      )
      expect(f.get().writes.blocker(f.get().writes.identify(f.cwd))).toBeNull()
    } finally {
      await f.close()
    }
  },
  60000,
)

test('cHANGE-05 current ignore/link exclusions refuse even explicit overwrite; unavailable historical ledger cannot fallback', async () => {
  const f = await setup()
  try {
    mkdirSync(join(f.cwd, 'sub'))
    writeFileSync(join(f.cwd, 'sub', 'a'), 'before')
    const t = await f.collect(() => writeFileSync(join(f.cwd, 'sub', 'a'), 'after'))
    writeFileSync(join(f.cwd, '.gitignore'), 'sub/\n')
    await expect(f.prepare(t)).rejects.toThrow('忽略')
    unlinkSync(join(f.cwd, '.gitignore'))
    renameSync(join(f.cwd, 'sub'), join(f.root, 'outside'))
    symlinkSync(join(f.root, 'outside'), join(f.cwd, 'sub'), 'junction')
    await expect(f.prepare(t)).rejects.toThrow('父目录')
    unlinkSync(join(f.cwd, 'sub'))
    renameSync(join(f.root, 'outside'), join(f.cwd, 'sub'))
    vi.spyOn(f.get().changes, 'snapshotFiles').mockRejectedValue(
      new Error('injected corrupt object'),
    )
    await expect(f.prepare(t)).rejects.toThrow('corrupt')
    expect(readFileSync(join(f.cwd, 'sub', 'a'), 'utf8')).toBe('after')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-05 actual same-directory SDK blocks rollback, independent SDK continues; shutdown waits an in-flight rollback IO', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'a'), 'before')
    const t = await f.collect(() => writeFileSync(join(f.cwd, 'a'), 'after'))
    const other = join(f.root, 'independent')
    mkdirSync(other)
    const busy = f.start(),
      independent = f.start('hold', randomUUID(), other)
    await f.ready(busy.sessionId)
    await f.ready(independent.sessionId)
    const blocked = await f.confirm(await f.prepare(t))
    expect(blocked.state).toBe('conflict')
    expect(blocked.diagnostic).toContain(busy.turnId)
    expect(
      f
        .get()
        .kernels.list()
        .filter((k) => k.state === 'running').length,
    ).toBeGreaterThanOrEqual(2)
    await f.get().kernels.abort(busy.sessionId, busy.turnId)
    await busy.promise
    const plan = await f.prepare(t),
      write = f.get().rollback.files.write.bind(f.get().rollback.files)
    let entered = false,
      release = () => {
        entered = false
      }
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(f.get().rollback.files, 'write').mockImplementation(async (...args) => {
      entered = true
      await gate
      return write(...args)
    })
    const result = f.confirm(plan)
    await vi.waitFor(() => expect(entered).toBe(true), wait)
    expect(f.get().writes.blocker(f.get().writes.identify(f.cwd))?.turnId).toBe(plan.record.id)
    let closed = false
    const closing = f.app.close().then(() => {
      closed = true
      return closed
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(closed).toBe(false)
    release()
    expect((await result).state).toBe('succeeded')
    await closing
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-05 audit intent failure writes nothing; durable result failure quarantines lease and retains pre-operation objects', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'a'), 'before')
    const t = await f.collect(() => writeFileSync(join(f.cwd, 'a'), 'after'))
    const plan = await f.prepare(t),
      audit = f.app.get(AuditService)
    vi.spyOn(audit, 'record').mockImplementation(() => {
      throw new Error('injected audit disk failure')
    })
    await expect(f.confirm(plan)).rejects.toThrow('disk failure')
    expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('after')
    expect(f.get().writes.blocker(f.get().writes.identify(f.cwd))?.state).toBe('quarantined')
    const row = f.app
      .get(WorkspaceDatabase)
      .sqlite.prepare('SELECT data FROM change_rollbacks WHERE id=?')
      .get(plan.record.id)
    expect(row).toBeDefined()
  } finally {
    await f.close()
  }
}, 60000)
