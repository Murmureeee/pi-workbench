import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { changeCoverageSchema, fileLedgerPolicy } from '@pi-workbench/shared'

import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { ChangeDecisionService } from '../dist/modules/changes/change-decision.service.js'
import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeRollbackService } from '../dist/modules/changes/change-rollback.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { DirectoryWriteService } from '../dist/modules/workspaces/directory-write.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'
import { setupChangeFixture } from './helpers/change-fixture.js'

const wait = { timeout: 20000, interval: 50 }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function required<T>(v: T | undefined): T {
  if (v === undefined) {
    throw new Error('Coverage fixture missing')
  }
  return v
}
type Fixture = Awaited<ReturnType<typeof setupChangeFixture>>
const changes = (f: Fixture) => f.app.get(ChangeService)
const repo = (f: Fixture) =>
  join(f.dataDir, 'ledger', required(readdirSync(join(f.dataDir, 'ledger'))[0]), 'objects.git')
const git = (f: Fixture, ...args: string[]) =>
  execFileSync('git', ['--git-dir', repo(f), ...args], { windowsHide: true, encoding: 'utf8' })

/** Actual incompressible, unreferenced Git object, not an SDK mutation or a quota mock. */
function fillObjects(f: Fixture, bytes: number): string {
  const oid = execFileSync('git', ['--git-dir', repo(f), 'hash-object', '-w', '--stdin'], {
    windowsHide: true,
    encoding: 'utf8',
    input: randomBytes(bytes),
  }).trim()
  return join(repo(f), 'objects', oid.slice(0, 2), oid.slice(2))
}

async function pending(
  f: Fixture,
  fixture: 'approval-write' | 'approval-command' = 'approval-write',
) {
  const sessionId = randomUUID(),
    turnId = randomUUID(),
    kernels = f.app.get(KernelService)
  const promise = kernels.prompt(sessionId, f.cwd, { turnId, text: '范围验收，本地SDK', fixture })
  void promise.catch(() => undefined)
  await vi.waitFor(() => expect(f.app.get(ApprovalService).list(sessionId)).toHaveLength(1), wait)
  return {
    sessionId,
    turnId,
    promise,
    approval: required(f.app.get(ApprovalService).list(sessionId)[0]),
  }
}
function decide(
  f: Fixture,
  p: Awaited<ReturnType<typeof pending>>,
  action: 'cancel' | 'allow-once',
  acceptIrreversible = false,
) {
  const a = p.approval
  f.app.get(ApprovalService).decide(
    a.id,
    {
      sessionId: a.sessionId,
      epoch: a.epoch,
      turnId: a.turnId,
      digest: a.risk.digest,
      policyVersion: a.risk.policyVersion,
      action,
      reason: '明确本地夹具决定',
      acceptIrreversible,
    },
    'fixture-desktop',
  )
}

test('cHANGE-08 actual SDK approvals explain protected file bytes and partial command side effects without weakening one-shot consent', async () => {
  const f = await setupChangeFixture()
  try {
    writeFileSync(join(f.cwd, 'existing.txt'), 'dirty before')
    const file = await pending(f)
    expect(file.approval.rollbackCoverage).toMatchObject({
      state: 'full',
      basis: 'baseline',
      rollbackAvailable: false,
      limits: { fileBytes: 5242880 },
      storage: { limitBytes: 536870912, retention: 'keep-all-published', automaticCleanup: false },
    })
    expect(() => decide(f, file, 'allow-once')).toThrow('明确接受')
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    decide(f, file, 'cancel')
    await file.promise
    const command = await pending(f, 'approval-command')
    expect(command.approval.rollbackCoverage?.state).toBe('partial')
    expect(command.approval.rollbackCoverage?.reasons.join(' ')).toContain('外部副作用不可回滚')
    decide(f, command, 'cancel')
    await command.promise
    expect(readFileSync(join(f.cwd, 'existing.txt'), 'utf8')).toBe('dirty before')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-08 capacity failure before rollback writes or during SDK settlement preserves files and releases the physical lease only after persistence', async () => {
  const f = await setupChangeFixture(1024 * 1024)
  try {
    writeFileSync(join(f.cwd, 'a'), 'before')
    const t = await f.collect(() => writeFileSync(join(f.cwd, 'a'), 'after'))
    const identity = changes(f).context(t.turnId).identity,
      refs = git(f, 'show-ref')
    const plan = await f.app
      .get(ChangeRollbackService)
      .prepare({ sessionId: t.sessionId, turnId: t.turnId, fileId: null }, 'fixture-desktop')
    const filler = fillObjects(f, 1024 * 1024)
    const result = await f.app.get(ChangeRollbackService).command({
      sessionId: t.sessionId,
      operationId: plan.record.id,
      confirmationId: plan.confirmationId,
      action: 'confirm-external',
    })
    expect(result).toMatchObject({ state: 'conflict', beforeReference: null })
    expect(result.diagnostic).toContain('容量不足')
    expect(result.files.every((file) => !file.written)).toBe(true)
    expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('after')
    expect(git(f, 'show-ref')).toBe(refs)
    expect(f.app.get(DirectoryWriteService).blocker(identity)).toBeNull()
    unlinkSync(filler)
    const active = f.start()
    await f.ready(active.sessionId)
    const before = changes(f).context(active.turnId).record.baseline
    fillObjects(f, 1024 * 1024)
    writeFileSync(join(f.cwd, 'a'), 'external while SDK active')
    await f.app.get(KernelService).abort(active.sessionId, active.turnId)
    await active.promise
    const ended = changes(f).context(active.turnId).record
    expect(ended).toMatchObject({
      outcome: 'aborted',
      baseline: before,
      final: { status: 'failed' },
    })
    expect(ended.final.diagnostic).toContain('容量不足')
    expect(f.app.get(DirectoryWriteService).blocker(identity)).toBeNull()
    await f.restart()
    expect(changes(f).context(active.turnId).record).toEqual(ended)
    expect(f.app.get(KernelService).list()).toHaveLength(0)
    expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('external while SDK active')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-08 capacity belongs to the physical directory, leaving independent directory capture available', async () => {
  const f = await setupChangeFixture(1024 * 1024)
  try {
    writeFileSync(join(f.cwd, 'a'), 'before')
    const a = await f.collect(() => writeFileSync(join(f.cwd, 'a'), 'after'))
    fillObjects(f, 1024 * 1024)
    const other = join(f.root, 'independent')
    mkdirSync(other)
    writeFileSync(join(other, 'b'), 'other before')
    const b = await f.collect(
      () => writeFileSync(join(other, 'b'), 'other after'),
      undefined,
      other,
    )
    expect((await changes(f).coverage(a.turnId)).storage.state).toBe('full')
    expect(await changes(f).coverage(b.turnId)).toMatchObject({
      storage: { state: 'normal' },
      rollbackAvailable: true,
    })
    expect(changes(f).context(a.turnId).identity.directoryKey).not.toBe(
      changes(f).context(b.turnId).identity.directoryKey,
    )
    expect(await changes(f).readVersion(a.turnId, 'baseline', 'a')).toEqual(Buffer.from('before'))
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-08 actual ignored files and junctions remain excluded, external paths and oversize invocation are never described as fully restorable', async () => {
  const f = await setupChangeFixture()
  try {
    mkdirSync(join(f.root, 'outside'))
    writeFileSync(join(f.root, 'outside', 'external.txt'), 'outside untouched')
    symlinkSync(join(f.root, 'outside'), join(f.cwd, 'linked'), 'junction')
    writeFileSync(join(f.cwd, '.gitignore'), 'ignored.txt\n')
    writeFileSync(join(f.cwd, 'ignored.txt'), 'ignored untouched')
    writeFileSync(join(f.cwd, 'a.txt'), 'before')
    const t = await f.collect(() => writeFileSync(join(f.cwd, 'a.txt'), 'after'))
    const coverage = await changes(f).coverage(t.turnId)
    expect(coverage).toMatchObject({
      state: 'partial',
      rollbackAvailable: true,
      baselineExcluded: 2,
      finalExcluded: 2,
    })
    expect(coverage.exclusions.map((e) => e.path)).toEqual(
      expect.arrayContaining(['ignored.txt', 'linked']),
    )
    expect(coverage.exclusions).toHaveLength(2)
    const invoke = (targetPath: string, content = 'x') =>
      changes(f).coverage(t.turnId, {
        tool: 'write',
        targetPath,
        parameters: JSON.stringify({ path: targetPath, content }),
      })
    expect((await invoke(join(f.cwd, 'ignored.txt'))).state).toBe('none')
    expect((await invoke(join(f.cwd, 'linked', 'external.txt'))).state).toBe('none')
    expect((await invoke(join(f.root, 'outside', 'external.txt'))).state).toBe('none')
    expect(
      (await invoke(join(f.cwd, 'new.txt'), 'x'.repeat(fileLedgerPolicy.fileBytes + 1))).state,
    ).toBe('none')
    expect(readFileSync(join(f.root, 'outside', 'external.txt'), 'utf8')).toBe('outside untouched')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-08 real oversized baseline pauses the SDK write and explains limits before separate irreversible confirmation', async () => {
  const f = await setupChangeFixture()
  try {
    writeFileSync(join(f.cwd, 'large.bin'), Buffer.alloc(fileLedgerPolicy.fileBytes + 1, 1))
    const p = await pending(f)
    expect(p.approval.rollbackCoverage).toMatchObject({ state: 'none', rollbackAvailable: false })
    expect(p.approval.rollbackCoverage?.reasons.join(' ')).toContain('5 MiB')
    expect(changes(f).history(p.sessionId).rounds[0]?.baseline.status).toBe('failed')
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(() => decide(f, p, 'allow-once')).toThrow('明确接受')
    decide(f, p, 'cancel')
    await p.promise
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-08 actual Git object disk warning/full admission preserves all refs, SQLite decisions and bytes across restart', async () => {
  const f = await setupChangeFixture(1024 * 1024)
  try {
    writeFileSync(join(f.cwd, 'a.txt'), 'before')
    const t = await f.collect(() => writeFileSync(join(f.cwd, 'a.txt'), 'after'))
    const record = changes(f).context(t.turnId).record,
      review = await f.app.get(ChangeReviewService).list(t.turnId)
    const decision = await f.app.get(ChangeDecisionService).accept(
      {
        sessionId: t.sessionId,
        turnId: t.turnId,
        fileId: required(review.files[0]).id,
        baselineReference: required(record.baseline.reference ?? undefined),
        finalReference: required(record.final.reference ?? undefined),
      },
      'fixture-desktop',
    )
    const references = git(f, 'show-ref'),
      bytes = await changes(f).snapshotFiles(t.turnId, 'baseline')
    let filler = fillObjects(f, 850 * 1024)
    expect((await changes(f).coverage(t.turnId)).storage.state).toBe('warning')
    unlinkSync(filler)
    filler = fillObjects(f, 1024 * 1024)
    const full = await changes(f).coverage(t.turnId)
    expect(full).toMatchObject({
      rollbackAvailable: false,
      storage: { state: 'full', automaticCleanup: false },
    })
    const p = await pending(f)
    expect(p.approval.rollbackCoverage?.state).toBe('none')
    expect(p.approval.rollbackCoverage?.reasons.join(' ')).toContain('容量')
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    decide(f, p, 'cancel')
    await p.promise
    expect(git(f, 'show-ref')).toBe(references)
    expect(await changes(f).snapshotFiles(t.turnId, 'baseline')).toEqual(bytes)
    await f.restart()
    expect(f.app.get(KernelService).list()).toHaveLength(0)
    expect((await changes(f).coverage(t.turnId)).storage.state).toBe('full')
    expect(git(f, 'show-ref')).toBe(references)
    expect(
      (await f.app.get(ChangeDecisionService).status(t.sessionId, t.turnId)).files[0]?.accepted,
    ).toEqual(decision)
    unlinkSync(filler)
    expect((await changes(f).coverage(t.turnId)).rollbackAvailable).toBe(true)
    expect(readFileSync(join(f.cwd, 'a.txt'), 'utf8')).toBe('after')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-08 conservative new-capture estimate refuses before publication; an unknown object root never becomes zero capacity', async () => {
  const f = await setupChangeFixture(1024 * 1024)
  try {
    writeFileSync(join(f.cwd, 'a'), 'before')
    const t = await f.collect(() => writeFileSync(join(f.cwd, 'a'), 'after'))
    const refs = git(f, 'show-ref'),
      identity = changes(f).context(t.turnId).identity
    const filler = fillObjects(f, 850 * 1024)
    await expect(changes(f).ledger.capture(identity, randomUUID(), 'baseline')).rejects.toThrow(
      '预计新增',
    )
    expect(git(f, 'show-ref')).toBe(refs)
    unlinkSync(filler)
    const objects = join(repo(f), 'objects'),
      saved = join(f.root, 'saved-objects')
    renameSync(objects, saved)
    symlinkSync(saved, objects, 'junction')
    expect(await changes(f).ledger.capacity(identity)).toMatchObject({
      state: 'unavailable',
      usedBytes: null,
    })
    const coverage = await changes(f).coverage(t.turnId)
    expect(coverage.rollbackAvailable).toBe(false)
    expect(coverage.storage.usedBytes).toBeNull()
    unlinkSync(objects)
    renameSync(saved, objects)
    expect(git(f, 'show-ref')).toBe(refs)
  } finally {
    await f.close()
  }
}, 60000)

test.each(['missing-ref', 'changed-ref', 'corrupt-object'] as const)(
  'cHANGE-08 %s disables restore and preserves immutable metadata, decisions and current files',
  async (fault) => {
    const f = await setupChangeFixture()
    try {
      writeFileSync(join(f.cwd, 'a'), 'before')
      const t = await f.collect(() => writeFileSync(join(f.cwd, 'a'), 'after'))
      const record = changes(f).context(t.turnId).record,
        file = required((await f.app.get(ChangeReviewService).list(t.turnId)).files[0])
      await f.app.get(ChangeDecisionService).accept(
        {
          sessionId: t.sessionId,
          turnId: t.turnId,
          fileId: file.id,
          baselineReference: required(record.baseline.reference ?? undefined),
          finalReference: required(record.final.reference ?? undefined),
        },
        'fixture-desktop',
      )
      const db = f.app.get(WorkspaceDatabase),
        before = db.sqlite.prepare('SELECT data FROM change_decisions').all()
      if (fault === 'missing-ref') {
        git(f, 'update-ref', '-d', `refs/piw/${t.turnId}/baseline`)
      } else if (fault === 'changed-ref') {
        git(
          f,
          'update-ref',
          `refs/piw/${t.turnId}/baseline`,
          required(record.final.reference ?? undefined),
        )
      } else {
        const reference = required(record.baseline.reference ?? undefined),
          loose = join(repo(f), 'objects', reference.slice(0, 2), reference.slice(2)),
          packs = join(repo(f), 'objects', 'pack'),
          path = existsSync(loose)
            ? loose
            : join(packs, required(readdirSync(packs).find((p) => p.endsWith('.pack')))),
          bytes = readFileSync(path)
        bytes[0] = 0
        chmodSync(path, 0o600)
        writeFileSync(path, bytes)
      }
      expect(await changes(f).coverage(t.turnId)).toMatchObject({
        state: 'none',
        rollbackAvailable: false,
      })
      await expect(
        f.app
          .get(ChangeRollbackService)
          .prepare({ sessionId: t.sessionId, turnId: t.turnId, fileId: null }, 'fixture-desktop'),
      ).rejects.toThrow(/版本|账本/)
      expect(changes(f).context(t.turnId).record).toEqual(record)
      expect(db.sqlite.prepare('SELECT data FROM change_decisions').all()).toEqual(before)
      expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('after')
      await f.restart()
      expect((await changes(f).coverage(t.turnId)).rollbackAvailable).toBe(false)
      expect(changes(f).context(t.turnId).record).toEqual(record)
    } finally {
      await f.close()
    }
  },
  60000,
)

test('cHANGE-08 paired desktop scope enforces session identity and remains read-only', async () => {
  const f = await setupChangeFixture()
  try {
    writeFileSync(join(f.cwd, 'a'), 'before')
    const workspace = await f.app.get(WorkspaceService).open(f.cwd)
    if (!workspace.ok) {
      throw new Error('Workspace unavailable')
    }
    const kernels = f.app.get(KernelService),
      prompt = kernels.prompt.bind(kernels)
    vi.spyOn(kernels, 'prompt').mockImplementation((id, path, input, options) =>
      prompt(id, path, { ...input, fixture: 'hold' }, options),
    )
    const receipt = await f.app.get(SessionService).submit({
      requestId: randomUUID(),
      sessionId: null,
      configuration: {
        projectId: null,
        workspaceId: workspace.workspace.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
      text: 'HTTP实际会话',
      retryOf: null,
    })
    const t = { sessionId: receipt.session.id, turnId: receipt.submission.turnId }
    await f.ready(t.sessionId)
    writeFileSync(join(f.cwd, 'a'), 'after')
    await kernels.abort(t.sessionId, t.turnId)
    await vi.waitFor(
      async () => expect((await changes(f).coverage(t.turnId)).rollbackAvailable).toBe(true),
      wait,
    )
    const desktop = await authorizedHeaders(f.app, 24477, 'desktop'),
      browser = await authorizedHeaders(f.app, 24477)
    const url = `/api/changes/coverage?sessionId=${t.sessionId}&turnId=${t.turnId}`,
      refs = git(f, 'show-ref'),
      content = hash(readFileSync(join(f.cwd, 'a')))
    expect((await f.app.inject({ url, headers: browser })).statusCode).toBe(403)
    expect(
      (await f.app.inject({ url: url.replace(t.sessionId, randomUUID()), headers: desktop }))
        .statusCode,
    ).toBe(404)
    const result = await f.app.inject({ url, headers: desktop })
    expect(result.statusCode).toBe(200)
    expect(changeCoverageSchema.parse(result.json())).toMatchObject({
      sessionId: t.sessionId,
      turnId: t.turnId,
      state: 'full',
      rollbackAvailable: true,
    })
    expect(git(f, 'show-ref')).toBe(refs)
    expect(hash(readFileSync(join(f.cwd, 'a')))).toBe(content)
  } finally {
    await f.close()
  }
}, 60000)

test.each(['baseline', 'final'] as const)(
  'cHANGE-08 %s reference lost after preflight rejects the consumed confirmation before any workspace write',
  async (phase) => {
    const f = await setupChangeFixture()
    try {
      writeFileSync(join(f.cwd, 'a'), 'before')
      const t = await f.collect(() => writeFileSync(join(f.cwd, 'a'), 'after'))
      const plan = await f.app
        .get(ChangeRollbackService)
        .prepare({ sessionId: t.sessionId, turnId: t.turnId, fileId: null }, 'fixture-desktop')
      const round = changes(f).context(t.turnId).record
      git(f, 'update-ref', '-d', `refs/piw/${t.turnId}/${phase}`)
      const result = await f.app.get(ChangeRollbackService).command({
        sessionId: t.sessionId,
        operationId: plan.record.id,
        confirmationId: plan.confirmationId,
        action: 'confirm-external',
      })
      expect(result).toMatchObject({ state: 'conflict', beforeReference: null })
      expect(result.diagnostic).toContain('历史版本失效')
      expect(result.files.every((file) => !file.written)).toBe(true)
      expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('after')
      expect(changes(f).context(t.turnId).record).toEqual(round)
      expect(
        f.app.get(DirectoryWriteService).blocker(changes(f).context(t.turnId).identity),
      ).toBeNull()
      await f.restart()
      expect(f.app.get(ChangeRollbackService).record(t.sessionId, plan.record.id)).toEqual(result)
      expect(f.app.get(KernelService).list()).toHaveLength(0)
      expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('after')
    } finally {
      await f.close()
    }
  },
  60000,
)
