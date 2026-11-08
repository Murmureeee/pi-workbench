import type { SessionOrganize, SessionSubmit } from '@pi-workbench/shared'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accessSnapshotSchema,
  runtimeCapabilities,
  sessionOrganizationSchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'

const port = 24368
const apps: Awaited<ReturnType<typeof createApp>>[] = [],
  directories: string[] = []
const budget = readFileSync('docs/validation/live-validation-budget.json')
function input(sessionId: string | null = null): SessionSubmit {
  return {
    requestId: randomUUID(),
    sessionId,
    text: '会话整理离线验收',
    retryOf: null,
    configuration: {
      projectId: null,
      workspaceId: null,
      model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
      thinking: 'off',
    },
  }
}
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-library-'))) {
  directories.push(directory)
  const app = await createApp({ dataDir: join(directory, 'data'), port, development: true })
  apps.push(app)
  const ticket = app.get(AccessService).issueTicket('desktop')
  const pair = await app.inject({
    method: 'POST',
    url: '/api/access/pair',
    headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    payload: { code: ticket.code, label: 'Organization fixture' },
  })
  const cookie = String(pair.headers['set-cookie']).split(';')[0]
  const access = accessSnapshotSchema.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/api/access',
        headers: { host: `127.0.0.1:${port}`, cookie },
      })
    ).json(),
  )
  const headers = {
    host: `127.0.0.1:${port}`,
    cookie,
    origin: `http://127.0.0.1:${port}`,
    'x-piw-csrf': access.csrf ?? '',
    'x-piw-protocol': '1',
    'x-piw-capabilities': runtimeCapabilities.join(','),
  }
  const store = app.get(SessionStore),
    service = app.get(SessionService),
    kernels = app.get(KernelService)
  const meta = (id: string) => {
    const row = store.organizations().find((item) => item.sessionId === id)
    if (!row) {
      throw new Error('Missing organization')
    }
    return row
  }
  const change = (id: string, payload: SessionOrganize, patch = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/chat/sessions/${id}/organization`,
      headers: { ...headers, ...patch },
      payload,
    })
  const create = async () => {
    const receipt = await service.submit(input())
    await vi.waitFor(
      () => {
        if (store.submission(receipt.submission.requestId)?.status !== 'completed') {
          throw new Error('SDK result pending')
        }
      },
      { timeout: 15000 },
    )
    return receipt
  }
  return { app, directory, headers, store, service, kernels, meta, change, create }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of new Set(directories.splice(0))) {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(readFileSync('docs/validation/live-validation-budget.json'), budget)
})

describe('SESSION-03 daemon-owned library; actual SQLite and SDK/local HTTP fixture', () => {
  it('persists pin, manual unread, archive and restore across a daemon restart without touching SDK history or starting work', async () => {
    const f = await fixture(),
      receipt = await f.create(),
      id = receipt.session.id
    const historyPath = f.kernels.list().find((row) => row.sessionId === id)?.sessionFile
    if (!historyPath) {
      throw new Error('No SDK history')
    }
    const history = readFileSync(historyPath)
    expect(
      (await f.change(id, { action: 'pin', pinned: true, expectedRevision: f.meta(id).revision }))
        .statusCode,
    ).toBe(200)
    expect(
      (await f.change(id, { action: 'unread', expectedRevision: f.meta(id).revision })).statusCode,
    ).toBe(200)
    expect(
      (
        await f.change(id, {
          action: 'archive',
          archived: true,
          expectedRevision: f.meta(id).revision,
        })
      ).statusCode,
    ).toBe(200)
    const saved = f.meta(id)
    expect(saved).toMatchObject({ pinned: true, archived: true, unread: true, resultVersion: 1 })
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.meta(id)).toEqual(saved)
    expect(next.kernels.list()).toEqual([])
    const restored = await next.change(id, {
      action: 'archive',
      archived: false,
      expectedRevision: saved.revision,
    })
    expect(restored.statusCode).toBe(200)
    expect(next.meta(id)).toMatchObject({ pinned: true, archived: false, unread: true })
    expect(next.kernels.list()).toEqual([])
    expect(readFileSync(historyPath)).toEqual(history)
    expect(next.store.managedSessions()).toEqual([receipt.session])
  })

  it('counts each terminal result once; stale read receipts cannot erase new results or a manual unread action', async () => {
    const f = await fixture(),
      receipt = await f.create(),
      id = receipt.session.id,
      first = f.meta(id)
    expect(first).toMatchObject({
      unread: true,
      resultVersion: 1,
      readVersion: 0,
      resultRequestId: receipt.submission.requestId,
    })
    f.store.settleSubmission(receipt.submission.requestId, 'completed')
    f.store.settleSubmission(receipt.submission.requestId, 'executing')
    expect(f.meta(id)).toEqual(first)
    expect(
      (await f.change(id, { action: 'read', throughVersion: 1, expectedRevision: first.revision }))
        .statusCode,
    ).toBe(200)
    const read = f.meta(id)
    expect(read.unread).toBe(false)
    expect(
      (await f.change(id, { action: 'unread', expectedRevision: read.revision })).statusCode,
    ).toBe(200)
    expect(
      (await f.change(id, { action: 'read', throughVersion: 1, expectedRevision: read.revision }))
        .statusCode,
    ).toBe(409)
    const second = await f.service.submit(input(id))
    await expect
      .poll(() => f.store.submission(second.submission.requestId)?.status, { timeout: 15000 })
      .toBe('completed')
    expect(f.meta(id)).toMatchObject({ resultVersion: 2, readVersion: 1, unread: true })
    expect(
      (await f.change(id, { action: 'read', throughVersion: 1, expectedRevision: first.revision }))
        .statusCode,
    ).toBe(409)
    const partial = await f.change(id, {
      action: 'read',
      throughVersion: 1,
      expectedRevision: f.meta(id).revision,
    })
    expect(sessionOrganizationSchema.parse(partial.json())).toMatchObject({
      unread: true,
      manualUnread: false,
      readVersion: 1,
    })
    expect(
      (
        await f.change(id, {
          action: 'read',
          throughVersion: 2,
          expectedRevision: f.meta(id).revision,
        })
      ).statusCode,
    ).toBe(200)
    expect(f.meta(id).unread).toBe(false)
  })

  it('refuses to hide real running/queued work until explicit abort has settled, then archives without reviving work', async () => {
    const f = await fixture(),
      original = f.kernels.prompt.bind(f.kernels)
    vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, command, options) =>
      original(id, cwd, { ...command, fixture: 'hold' }, options),
    )
    const held = await f.service.submit(input()),
      id = held.session.id
    await expect
      .poll(() => f.kernels.list().find((row) => row.sessionId === id)?.state, { timeout: 15000 })
      .toBe('running')
    const pid = f.kernels.list().find((row) => row.sessionId === id)?.pid
    expect(
      (
        await f.change(id, {
          action: 'archive',
          archived: true,
          expectedRevision: f.meta(id).revision,
        })
      ).statusCode,
    ).toBe(409)
    expect(f.service.activity().find((row) => row.id === id)?.running).toBe(true)
    expect(f.kernels.list().find((row) => row.sessionId === id)?.pid).toBe(pid)
    const queued = await f.service.submit(input())
    expect(
      (
        await f.change(queued.session.id, {
          action: 'archive',
          archived: true,
          expectedRevision: f.meta(queued.session.id).revision,
        })
      ).statusCode,
    ).toBe(409)
    await f.kernels.abort(queued.session.id, queued.submission.turnId)
    await f.kernels.abort(id, held.submission.turnId)
    await expect.poll(() => f.store.submission(held.submission.requestId)?.status).toBe('aborted')
    await expect.poll(() => f.service.activity().find((row) => row.id === id)?.running).toBe(false)
    expect(f.meta(id).unread).toBe(true)
    expect(
      (
        await f.change(id, {
          action: 'archive',
          archived: true,
          expectedRevision: f.meta(id).revision,
        })
      ).statusCode,
    ).toBe(200)
    expect(f.store.submission(held.submission.requestId)?.status).toBe('aborted')
  })

  it('blocks pending approval and held queue records rather than inventing a decision; restart invalidates approvals, not held work', async () => {
    const f = await fixture(),
      receipt = await f.create(),
      id = receipt.session.id
    const identity = {
      sessionId: id,
      epoch: f.kernels.list()[0]?.epoch ?? randomUUID(),
      turnId: receipt.submission.turnId,
      source: 'synthetic-fixture',
    }
    f.store.saveApproval({
      ...identity,
      id: randomUUID(),
      decision: 'pending',
      parameters: {},
      reason: '合成待审批记录；未执行',
    })
    expect(
      (
        await f.change(id, {
          action: 'archive',
          archived: true,
          expectedRevision: f.meta(id).revision,
        })
      ).statusCode,
    ).toBe(409)
    f.store.saveQueue({
      ...identity,
      id: randomUUID(),
      kind: 'follow-up',
      position: 0,
      text: '合成待处理记录',
      status: 'held',
    })
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.store.hasPendingApproval(id)).toBe(false)
    expect(
      (
        await next.change(id, {
          action: 'archive',
          archived: true,
          expectedRevision: next.meta(id).revision,
        })
      ).statusCode,
    ).toBe(409)
    expect(next.meta(id).archived).toBe(false)
  })

  it('rechecks archive after asynchronous directory validation; existing idempotent receipts still reconcile', async () => {
    const f = await fixture(),
      receipt = await f.create(),
      id = receipt.session.id
    let release: (() => void) | undefined
    const blocked = new Promise<void>((done) => {
      release = done
    })
    const workspace = f.app.get(WorkspaceService),
      original = workspace.validate.bind(workspace)
    vi.spyOn(workspace, 'validate').mockImplementationOnce(async (workspaceId) => {
      await blocked
      return original(workspaceId)
    })
    const task = input(id),
      delayed = f.service.submit(task)
    expect(
      (
        await f.change(id, {
          action: 'archive',
          archived: true,
          expectedRevision: f.meta(id).revision,
        })
      ).statusCode,
    ).toBe(200)
    release?.()
    await expect(delayed).rejects.toThrow('已归档')
    expect(f.store.submission(task.requestId)).toBeUndefined()
    const retry = await f.service.submit({
      ...input(),
      requestId: receipt.submission.requestId,
      text: '会话整理离线验收',
    })
    expect(retry.session.id).toBe(id)
  })

  it('rolls back failed metadata writes and enforces desktop identity, protocol, Origin and CSRF', async () => {
    const f = await fixture(),
      receipt = await f.create(),
      id = receipt.session.id,
      prior = f.meta(id)
    const command: SessionOrganize = {
      action: 'pin',
      pinned: true,
      expectedRevision: prior.revision,
    }
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      "CREATE TRIGGER fail_organize BEFORE UPDATE ON session_organization BEGIN SELECT RAISE(ABORT, 'injected write failure'); END",
    )
    expect((await f.change(id, command)).statusCode).toBe(503)
    expect(f.meta(id)).toEqual(prior)
    db.exec('DROP TRIGGER fail_organize')
    expect((await f.change(id, command, { 'x-piw-csrf': '' })).statusCode).toBe(403)
    expect((await f.change(id, command, { origin: 'http://evil.invalid' })).statusCode).toBe(403)
    expect((await f.change(id, command, { 'x-piw-protocol': '99' })).statusCode).toBe(409)
    expect((await f.change(id, command, { cookie: '' })).statusCode).toBe(401)
    const ticket = f.app.get(AccessService).issueTicket('browser')
    const pair = await f.app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers: f.headers,
      payload: { code: ticket.code, label: 'Browser' },
    })
    const cookie = String(pair.headers['set-cookie']).split(';')[0]
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/chat/organization',
          headers: { ...f.headers, cookie },
        })
      ).statusCode,
    ).toBe(403)
    expect((await f.change(id, command)).statusCode).toBe(200)
    expect((await f.change(id, command)).statusCode).toBe(409)
  })

  it('migrates an existing library with old results read, and makes only newly recovered interruptions unread', async () => {
    const f = await fixture(),
      receipt = await f.create(),
      id = receipt.session.id
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      'DROP TABLE session_origins; ALTER TABLE session_configurations DROP COLUMN membership_version',
    )
    db.exec(
      'ALTER TABLE projects DROP COLUMN pinned; ALTER TABLE projects DROP COLUMN position; ALTER TABLE projects DROP COLUMN revision; ALTER TABLE projects DROP COLUMN removed; ALTER TABLE projects DROP COLUMN creation_input; DROP INDEX workspaces_recent_order; ALTER TABLE workspaces DROP COLUMN custom_name; ALTER TABLE workspaces DROP COLUMN last_opened_at; ALTER TABLE workspaces DROP COLUMN revision; ALTER TABLE session_configurations DROP COLUMN title_version; ALTER TABLE session_configurations DROP COLUMN title_source; DROP TABLE session_organization; ALTER TABLE session_turns DROP COLUMN model_request; DROP TABLE operation_audit; DROP TABLE session_model_settings; DROP TABLE directory_rounds; DROP TABLE change_rounds; DROP TABLE change_tool_observations; DROP TABLE change_rollbacks; DROP TABLE change_decisions; DELETE FROM __drizzle_migrations WHERE created_at >= 1793674835887',
    )
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.meta(id)).toMatchObject({
      pinned: false,
      archived: false,
      unread: false,
      resultVersion: 1,
      readVersion: 1,
    })
    const pending = input(id)
    next.store.acceptSubmission(pending, 'synthetic-crash-outbox', receipt.session)
    await next.app.close()
    const restarted = await fixture(f.directory)
    expect(restarted.store.submission(pending.requestId)?.status).toBe('interrupted')
    expect(restarted.meta(id)).toMatchObject({
      unread: true,
      resultVersion: 2,
      readVersion: 1,
      resultRequestId: pending.requestId,
    })
    expect(restarted.kernels.list()).toEqual([])
  })
})
