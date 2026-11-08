import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'
import { z } from 'zod'

import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { ChangeRollbackService } from '../dist/modules/changes/change-rollback.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { setupChangeFixture } from './helpers/change-fixture.js'

test('cHANGE-09 actual SDK receives same-directory rollback facts across sessions and cold restart, without rewriting old native history or extra requests', async () => {
  const f = await setupChangeFixture()
  try {
    const path = join(f.cwd, 'a.txt')
    writeFileSync(path, 'before')
    const a = await f.collect(() => writeFileSync(path, 'after'))
    const native = f.app
      .get(KernelService)
      .list()
      .find((k) => k.sessionId === a.sessionId)!.sessionFile!
    const prior = readFileSync(native)
    const result = await f.rollback(a)
    expect(result).toMatchObject({
      state: 'succeeded',
      source: 'human',
      externalConfirmed: true,
      afterStatus: 'ready',
    })
    expect(result.beforeReference).not.toBe(result.afterReference)
    expect(result.files[0]).toMatchObject({ written: true, observation: 'present' })
    expect(readFileSync(native)).toEqual(prior)
    const inspect = async (sessionId: string, cwd: string) => {
      const response = await f.app.get(KernelService).prompt(sessionId, cwd, {
        turnId: randomUUID(),
        text: '核对环境事实',
        fixture: 'trust-context',
      })
      expect(response).toMatchObject({
        outcome: 'completed',
        localRequests: 1,
        blockedNetworkAttempts: 0,
      })
      let text = ''
      for (const message of f.app.get(SessionStore).history(sessionId)!.messages) {
        if (message.role === 'assistant') {
          text = message.text
        }
      }
      return text
    }
    expect(await inspect(randomUUID(), f.cwd)).toContain(result.id)
    const other = join(f.root, '独立目录')
    mkdirSync(other)
    expect(await inspect(randomUUID(), other)).not.toContain(result.id)
    await f.restart()
    expect(f.app.get(KernelService).list()).toHaveLength(0)
    const service = f.app.get(ChangeRollbackService)
    expect(service.history(a.sessionId).records[0]).toMatchObject({ id: result.id, totalFiles: 1 })
    expect(service.record(a.sessionId, result.id)).toEqual(result)
    expect(readFileSync(native)).toEqual(prior)
    const next = await inspect(randomUUID(), f.cwd)
    expect(next).toContain(result.id)
    expect(next).toContain('文件回滚未撤销消息历史')
    expect(next).toContain('执行前应重新读取现场')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-09 stable pagination, redacted facts, restart interruption and bounded environment facts preserve uncertain outcomes', async () => {
  const f = await setupChangeFixture()
  try {
    writeFileSync(join(f.cwd, 'a.txt'), 'before')
    const a = await f.collect(() => writeFileSync(join(f.cwd, 'a.txt'), 'after'))
    const service = f.app.get(ChangeRollbackService)
    const original = await service.prepare({ ...a, fileId: null }, 'fixture-desktop')
    const db = f.app.get(WorkspaceDatabase).sqlite
    // Explicit persisted-record fault fixture, not SDK provenance or native execution.
    const row = z
      .object({ directory_key: z.string(), cwd: z.string() })
      .parse(db.prepare('SELECT * FROM change_rollbacks WHERE id=?').get(original.record.id))
    const insert = db.prepare(
      'INSERT INTO change_rollbacks(id,session_id,turn_id,directory_key,cwd,state,data) VALUES(?,?,?,?,?,?,?)',
    )
    for (let index = 0; index < 24; index++) {
      const record = structuredClone(original.record)
      record.id = randomUUID()
      record.state = 'succeeded'
      record.actor = 'api_key=fixture-secret-value'
      insert.run(
        record.id,
        a.sessionId,
        a.turnId,
        row.directory_key,
        row.cwd,
        record.state,
        JSON.stringify(record),
      )
    }
    const first = service.history(a.sessionId)
    expect(first.records).toHaveLength(20)
    expect(first.next).not.toBeNull()
    const second = service.history(a.sessionId, first.next!)
    expect(second.records).toHaveLength(5)
    expect(second.next).toBeNull()
    expect(new Set([...first.records, ...second.records].map((r) => r.id)).size).toBe(25)
    expect(JSON.stringify(first)).not.toContain('fixture-secret-value')
    const note = service.environmentNote(row.directory_key)
    expect(note).toContain('"olderOmitted":true')
    expect(note.length).toBeLessThan(16384)
    expect(note).not.toContain('fixture-secret-value')
    const interruptedId = first.records.at(0)?.id
    if (!interruptedId) {
      throw new Error('Missing persisted fixture record')
    }
    db.prepare(
      "UPDATE change_rollbacks SET state='running',data=json_set(data,'$.state','running') WHERE id=?",
    ).run(interruptedId)
    await f.restart()
    expect(f.app.get(ChangeRollbackService).record(a.sessionId, interruptedId).state).toBe(
      'interrupted',
    )
    expect(f.app.get(KernelService).list()).toHaveLength(0)
    expect(readFileSync(join(f.cwd, 'a.txt'), 'utf8')).toBe('after')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-09 failed batch persists actual compensated or conflicting final versions and explicitly marks unavailable capture', async () => {
  const f = await setupChangeFixture()
  try {
    writeFileSync(join(f.cwd, 'a'), 'a0')
    writeFileSync(join(f.cwd, 'b'), 'b0')
    const a = await f.collect(() => {
      writeFileSync(join(f.cwd, 'a'), 'a1')
      writeFileSync(join(f.cwd, 'b'), 'b1')
    })
    const service = f.app.get(ChangeRollbackService),
      write = service.files.write.bind(service.files)
    let count = 0
    vi.spyOn(service.files, 'write').mockImplementation(async (...args) => {
      if (++count === 2) {
        throw new Error('injected second IO failure')
      }
      return write(...args)
    })
    const result = await f.rollback(a)
    expect(result.state).toBe('compensated')
    expect(result.afterStatus).toBe('ready')
    expect(result.afterSnapshotId).not.toBe(result.id)
    const identity = f.app.get(ChangeService).context(a.turnId).identity
    const actual = await f.app
      .get(ChangeService)
      .ledger.verify(identity, result.afterSnapshotId!, 'final', result.afterReference!)
    expect(actual.get('a')?.toString()).toBe('a1')
    expect(actual.get('b')?.toString()).toBe('b1')
    expect(
      result.files.every((p) => p.observation === 'present' && p.observedAfter === p.current),
    ).toBe(true)
    vi.restoreAllMocks()
    vi.spyOn(service.files, 'write').mockRejectedValue(new Error('injected first IO failure'))
    const ledger = f.app.get(ChangeService).ledger,
      capture = ledger.capture.bind(ledger)
    vi.spyOn(ledger, 'capture').mockImplementation((id, turn, phase) =>
      phase === 'final'
        ? Promise.reject(new Error('injected final capture failure'))
        : capture(id, turn, phase),
    )
    const missing = await f.rollback(a)
    expect(missing).toMatchObject({
      state: 'failed',
      afterStatus: 'unavailable',
      afterReference: null,
      afterSnapshotId: null,
    })
    expect(missing.diagnostic).toContain('最终现场快照不可用')
  } finally {
    await f.close()
  }
}, 60000)
