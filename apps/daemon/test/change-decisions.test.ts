import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { accessSnapshotSchema, runtimeCapabilities } from '@pi-workbench/shared'

import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { ChangeDecisionService } from '../dist/modules/changes/change-decision.service.js'
import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeRollbackService } from '../dist/modules/changes/change-rollback.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AuditService } from '../dist/modules/security/audit.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'
import { setupChangeFixture } from './helpers/change-fixture.js'

function required<T>(v: T | undefined): T {
  if (v === undefined) {
    throw new Error('Decision fixture missing')
  }
  return v
}

test('cHANGE-04 actual files/SDK/ledger/SQLite: accept plus file rollback is 2/2; later round and restart retain original decisions and JSONL', async () => {
  const f = await setupChangeFixture()
  try {
    const a = join(f.cwd, 'a.txt'),
      b = join(f.cwd, 'b.txt')
    writeFileSync(a, 'a0')
    writeFileSync(b, 'b0')
    const t = await f.collect(() => {
      writeFileSync(a, 'a1')
      writeFileSync(b, 'b1')
    })
    const review = await f.app.get(ChangeReviewService).list(t.turnId),
      service = f.app.get(ChangeDecisionService)
    const fa = required(review.files.find((x) => x.path === 'a.txt')),
      fb = required(review.files.find((x) => x.path === 'b.txt'))
    const input = {
      sessionId: t.sessionId,
      turnId: t.turnId,
      fileId: fa.id,
      baselineReference: required(review.baselineReference ?? undefined),
      finalReference: required(review.finalReference ?? undefined),
    }
    const native = required(
        f.app
          .get(KernelService)
          .list()
          .find((x) => x.sessionId === t.sessionId)?.sessionFile ?? undefined,
      ),
      before = readFileSync(native)
    const decision = await service.accept(input, 'fixture-human')
    expect(readFileSync(a, 'utf8')).toBe('a1')
    expect(readFileSync(b, 'utf8')).toBe('b1')
    expect(readFileSync(native)).toEqual(before)
    expect(await service.accept(input, 'another-client')).toEqual(decision)
    expect(f.app.get(AuditService).page({ kind: 'change-review' }).entries).toHaveLength(1)
    expect(await service.status(t.sessionId, t.turnId)).toMatchObject({
      processed: 1,
      total: 2,
      outcome: 'aborted',
    })
    expect((await f.rollback(t, fb.id)).state).toBe('succeeded')
    expect(await service.status(t.sessionId, t.turnId)).toMatchObject({ processed: 2, total: 2 })
    expect(readFileSync(a, 'utf8')).toBe('a1')
    expect(readFileSync(b, 'utf8')).toBe('b0')
    await f.collect(() => writeFileSync(a, 'later external block'), t.sessionId)
    expect(
      (await service.status(t.sessionId, t.turnId)).files.find((x) => x.fileId === fa.id)?.accepted,
    ).toEqual(decision)
    await f.rollback(t, fa.id)
    const both = (await service.status(t.sessionId, t.turnId)).files.find((x) => x.fileId === fa.id)
    expect(both).toMatchObject({ accepted: decision })
    expect(both?.rollbackId).not.toBeNull()
    await f.restart()
    expect(f.app.get(KernelService).list()).toHaveLength(0)
    expect(await f.app.get(ChangeDecisionService).status(t.sessionId, t.turnId)).toMatchObject({
      processed: 2,
      total: 2,
    })
    expect(await f.app.get(ChangeDecisionService).accept(input, 'after-restart')).toEqual(decision)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-04 paired desktop HTTP validates CSRF, protocol, opaque target and durable duplicate result', async () => {
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
      async () =>
        expect((await f.app.get(ChangeReviewService).list(t.turnId)).available).toBe(true),
      { timeout: 20000 },
    )
    const review = await f.app.get(ChangeReviewService).list(t.turnId)
    const input = {
      sessionId: t.sessionId,
      turnId: t.turnId,
      fileId: required(review.files[0]).id,
      baselineReference: review.baselineReference,
      finalReference: review.finalReference,
    }
    const desktop = await authorizedHeaders(f.app, 24477, 'desktop'),
      browser = await authorizedHeaders(f.app, 24477)
    const csrf = accessSnapshotSchema.parse(
      (await f.app.inject({ url: '/api/access', headers: desktop })).json(),
    ).csrf
    const headers = {
      ...desktop,
      origin: 'http://127.0.0.1:24477',
      'x-piw-csrf': csrf ?? '',
      'x-piw-protocol': '1',
      'x-piw-capabilities': runtimeCapabilities.join(','),
    }
    const url = '/api/changes/decisions/accept'
    expect(
      (
        await f.app.inject({
          url: `/api/changes/decisions?sessionId=${t.sessionId}&turnId=${t.turnId}`,
          headers: browser,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers: { ...headers, 'x-piw-csrf': '' },
          payload: input,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers: { ...headers, 'x-piw-protocol': '0' },
          payload: input,
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...input, fileId: '0'.repeat(64) },
        })
      ).statusCode,
    ).toBe(409)
    const first = await f.app.inject({ method: 'POST', url, headers, payload: input })
    expect(first.statusCode).toBe(200)
    const second = await f.app.inject({ method: 'POST', url, headers, payload: input })
    expect(second.json()).toEqual(first.json())
    expect(readFileSync(join(f.cwd, 'a'), 'utf8')).toBe('after')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-04 persistence/audit faults, stale identities and rollback conflict/compensation never fabricate processed success', async () => {
  const f = await setupChangeFixture()
  try {
    const a = join(f.cwd, 'a'),
      b = join(f.cwd, 'b')
    writeFileSync(a, 'a0')
    writeFileSync(b, 'b0')
    const t = await f.collect(() => {
      writeFileSync(a, 'a1')
      writeFileSync(b, 'b1')
    })
    const review = await f.app.get(ChangeReviewService).list(t.turnId),
      service = f.app.get(ChangeDecisionService),
      db = f.app.get(WorkspaceDatabase).sqlite
    const input = {
      sessionId: t.sessionId,
      turnId: t.turnId,
      fileId: required(review.files[0]).id,
      baselineReference: required(review.baselineReference ?? undefined),
      finalReference: required(review.finalReference ?? undefined),
    }
    db.exec(
      "CREATE TRIGGER fail_accept BEFORE INSERT ON change_decisions BEGIN SELECT RAISE(ABORT,'injected decision storage'); END",
    )
    await expect(service.accept(input, 'human')).rejects.toThrow('injected decision storage')
    db.exec('DROP TRIGGER fail_accept')
    db.exec(
      "CREATE TRIGGER fail_review_audit BEFORE INSERT ON operation_audit WHEN NEW.kind='change-review' BEGIN SELECT RAISE(ABORT,'injected audit storage'); END",
    )
    await expect(service.accept(input, 'human')).rejects.toThrow('injected audit storage')
    expect(db.prepare('SELECT count(*) AS n FROM change_decisions').get()).toEqual({ n: 0 })
    db.exec('DROP TRIGGER fail_review_audit')
    await expect(service.accept({ ...input, sessionId: randomUUID() }, 'human')).rejects.toThrow(
      '不一致',
    )
    await expect(
      service.accept({ ...input, finalReference: '0'.repeat(40) }, 'human'),
    ).rejects.toThrow('不一致')
    const rollback = f.app.get(ChangeRollbackService),
      plan = await rollback.prepare({ ...t, fileId: null }, 'human')
    writeFileSync(b, 'after preflight')
    expect(
      (
        await rollback.command({
          sessionId: t.sessionId,
          operationId: plan.record.id,
          confirmationId: plan.confirmationId,
          action: 'confirm-external',
        })
      ).state,
    ).toBe('conflict')
    expect(await service.status(t.sessionId, t.turnId)).toMatchObject({ processed: 0, total: 2 })
    const write = rollback.files.write.bind(rollback.files)
    let count = 0
    const fault = vi.spyOn(rollback.files, 'write').mockImplementation(async (...args) => {
      if (++count === 2) {
        throw new Error('second write fault')
      }
      return write(...args)
    })
    expect((await f.rollback(t)).state).toBe('compensated')
    fault.mockRestore()
    expect(await service.status(t.sessionId, t.turnId)).toMatchObject({ processed: 0, total: 2 })
    expect((await service.accept(input, 'human')).decision).toBe('accepted')
    expect(() => db.prepare('DELETE FROM change_decisions').run()).toThrow('retained')
    expect(() => db.prepare("UPDATE change_decisions SET data='{}'").run()).toThrow('immutable')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-04 full count crosses file pages; byte-identical rename remains one handled file, acceptance needs no current path', async () => {
  const f = await setupChangeFixture()
  try {
    for (let n = 0; n < 101; n++) {
      writeFileSync(join(f.cwd, `p${n}.txt`), 'before ' + n)
    }
    writeFileSync(join(f.cwd, 'old.txt'), 'unique rename')
    const t = await f.collect(() => {
      for (let n = 0; n < 101; n++) {
        writeFileSync(join(f.cwd, `p${n}.txt`), 'after ' + n)
      }
      renameSync(join(f.cwd, 'old.txt'), join(f.cwd, 'new.txt'))
    })
    const service = f.app.get(ChangeDecisionService),
      review = await f.app.get(ChangeReviewService).list(t.turnId),
      second = await f.app.get(ChangeReviewService).list(t.turnId, 100)
    expect(review.files).toHaveLength(100)
    expect(second.files).toHaveLength(2)
    const renamed = required(review.files.find((x) => x.kind === 'renamed'))
    renameSync(join(f.cwd, 'new.txt'), join(f.cwd, 'external.txt'))
    await service.accept(
      {
        sessionId: t.sessionId,
        turnId: t.turnId,
        fileId: renamed.id,
        baselineReference: required(review.baselineReference ?? undefined),
        finalReference: required(review.finalReference ?? undefined),
      },
      'human',
    )
    expect(await service.status(t.sessionId, t.turnId)).toMatchObject({ total: 102, processed: 1 })
  } finally {
    await f.close()
  }
}, 60000)
