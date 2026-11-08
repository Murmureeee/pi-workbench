import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, vi } from 'vitest'

import { createApp } from '../../dist/bootstrap/app.js'
import { ChangeRollbackService } from '../../dist/modules/changes/change-rollback.service.js'
import { ChangeService } from '../../dist/modules/changes/change.service.js'
import { KernelService } from '../../dist/modules/kernels/kernel.service.js'

/** Actual SQLite, independent ledger and installed SDK + local HTTP. Mutations supplied
 * by collect are explicitly external fixture writes, never synthetic agent provenance. */
export async function setupChangeFixture(ledgerCapacityBytes?: number) {
  const root = mkdtempSync(join(tmpdir(), 'piw-change-chain-')),
    cwd = join(root, '中文目录'),
    dataDir = join(root, 'data')
  mkdirSync(cwd)
  let app = await createApp({
    dataDir,
    port: 24477,
    development: true,
    resourceLimits: { kernels: 4, modelTasks: 3 },
    ledgerCapacityBytes,
  })
  const start = (sessionId: string = randomUUID(), path = cwd) => {
    const turnId = randomUUID(),
      promise = app
        .get(KernelService)
        .prompt(sessionId, path, { turnId, text: '本地文件版本验收', fixture: 'hold' })
    void promise.catch(() => undefined)
    return { sessionId, turnId, promise }
  }
  const ready = async (sessionId: string) =>
    vi.waitFor(
      () =>
        expect(app.get(ChangeService).history(sessionId).rounds[0]?.baseline.status).toBe('ready'),
      { timeout: 20000, interval: 40 },
    )
  return {
    root,
    cwd,
    dataDir,
    start,
    ready,
    get app() {
      return app
    },
    collect: async (mutate: () => void, sessionId?: string, path = cwd) => {
      const t = start(sessionId, path)
      await ready(t.sessionId)
      mutate()
      await app.get(KernelService).abort(t.sessionId, t.turnId)
      await t.promise
      await vi.waitFor(
        () =>
          expect(app.get(ChangeService).history(t.sessionId).rounds[0]?.final.status).toBe('ready'),
        { timeout: 20000, interval: 40 },
      )
      return t
    },
    rollback: async (t: { sessionId: string; turnId: string }, fileId: string | null = null) => {
      const service = app.get(ChangeRollbackService),
        plan = await service.prepare({ ...t, fileId }, 'fixture-desktop')
      return service.command({
        sessionId: t.sessionId,
        operationId: plan.record.id,
        confirmationId: plan.confirmationId,
        action: 'confirm-external',
      })
    },
    restart: async () => {
      await app.close()
      app = await createApp({
        dataDir,
        port: 24477,
        development: true,
        resourceLimits: { kernels: 4, modelTasks: 3 },
        ledgerCapacityBytes,
      })
    },
    close: async () => {
      vi.restoreAllMocks()
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
