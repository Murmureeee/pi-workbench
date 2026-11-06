import type { ModelSelection, SessionSubmit } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'
import { z } from 'zod'

import { runtimeCapabilities } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

const base: ModelSelection = {
  model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
  thinking: 'off',
}
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Required SDK fixture value missing')
  }
  return value
}
const reasoning: ModelSelection = {
  model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture-reasoning' },
  thinking: 'high',
}
const input = (): SessionSubmit => ({
  requestId: randomUUID(),
  sessionId: null,
  text: 'MODEL03 离线切换',
  retryOf: null,
  configuration: { projectId: null, workspaceId: null, ...base },
})
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-model-selection-')),
    port = 24461
  const app = await createApp({ dataDir: directory, port, development: true })
  return {
    app,
    directory,
    port,
    service: app.get(SessionService),
    store: app.get(SessionStore),
    kernels: app.get(KernelService),
    close: async () => {
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
async function settled(f: Awaited<ReturnType<typeof setup>>, requestId: string) {
  await expect
    .poll(() => f.store.submission(requestId)?.status, { timeout: 20000 })
    .toBe('completed')
}
function assistants(path: string) {
  const row = z.object({
    type: z.string(),
    message: z
      .object({
        role: z.string(),
        model: z.string().optional(),
        thinkingLevel: z.string().optional(),
      })
      .optional(),
  })
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => row.parse(JSON.parse(line)))
    .flatMap((r) => (r.message?.role === 'assistant' ? [r.message] : []))
}

test('mODEL-03 idle selection saves atomically without starting a model and survives restart', async () => {
  const f = await setup()
  try {
    const first = await f.service.submit(input())
    await settled(f, first.submission.requestId)
    const old = required(f.kernels.list()[0]),
      path = required(old.sessionFile),
      before = readFileSync(path, 'utf8')
    const state = f.service.changeModel(first.session.id, { ...reasoning, expectedRevision: 1 })
    expect(state).toMatchObject({
      revision: 2,
      effectiveRevision: 2,
      requested: reasoning,
      effective: reasoning,
    })
    expect(f.kernels.list()[0]?.pid).toBe(old.pid)
    expect(readFileSync(path, 'utf8')).toBe(before)
    const session = required(f.store.managedSessions()[0])
    expect(session.cwd).toBe(first.session.cwd)
    const next = await f.service.submit({
      ...input(),
      sessionId: session.id,
      configuration: session.configuration,
    })
    await settled(f, next.submission.requestId)
    expect(assistants(path).at(-1)).toMatchObject({
      model: 'fixture-reasoning',
      thinkingLevel: 'high',
    })
    f.store.modelApplied(session.id, 1, base)
    expect(f.store.modelState(session.id)).toMatchObject({
      effectiveRevision: 2,
      effective: reasoning,
    })
    await f.app.close()
    const reopened = await createApp({ dataDir: f.directory, port: f.port, development: true })
    try {
      expect(reopened.get(KernelService).list()).toEqual([])
      expect(reopened.get(SessionStore).modelState(session.id)).toMatchObject({
        revision: 2,
        requested: reasoning,
      })
    } finally {
      await reopened.close()
    }
  } finally {
    await f.close()
  }
})

test('mODEL-03 active tool continuation consumes the next selection in the same SDK turn', async () => {
  const f = await setup()
  try {
    const original = f.kernels.prompt.bind(f.kernels)
    f.kernels.prompt = (id, cwd, value, options) =>
      original(id, cwd, { ...value, fixture: 'approval-write' }, options)
    const receipt = await f.service.submit(input()),
      approvals = f.app.get(ApprovalService)
    await expect.poll(() => approvals.list().length, { timeout: 20000 }).toBe(1)
    const old = required(f.kernels.list()[0])
    expect(
      f.service.changeModel(receipt.session.id, { ...reasoning, expectedRevision: 1 }),
    ).toMatchObject({ revision: 2, effectiveRevision: 1, effective: base })
    const p = required(approvals.list()[0])
    approvals.decide(
      p.id,
      {
        sessionId: p.sessionId,
        epoch: p.epoch,
        turnId: p.turnId,
        digest: p.risk.digest,
        policyVersion: p.risk.policyVersion,
        action: 'deny',
        reason: 'Test explicit refusal',
        acceptIrreversible: false,
      },
      'offline-test',
    )
    await settled(f, receipt.submission.requestId)
    expect(f.kernels.list()[0]).toMatchObject({ pid: old.pid, epoch: old.epoch, cwd: old.cwd })
    const messages = assistants(required(old.sessionFile))
    expect(messages[0]).toMatchObject({ model: 'fixture', thinkingLevel: 'off' })
    expect(messages[1]).toMatchObject({ model: 'fixture-reasoning', thinkingLevel: 'high' })
    expect(f.store.modelState(receipt.session.id)).toMatchObject({
      effectiveRevision: 2,
      effective: reasoning,
    })
  } finally {
    await f.close()
  }
})

test('mODEL-03 unsupported levels, provider transport, stale CAS and disk errors keep the previous model', async () => {
  const f = await setup()
  try {
    const receipt = await f.service.submit(input())
    await settled(f, receipt.submission.requestId)
    const id = receipt.session.id,
      before = f.store.modelState(id)
    expect(() =>
      f.service.changeModel(id, { ...base, thinking: 'high', expectedRevision: 1 }),
    ).toThrow('不支持')
    expect(() =>
      f.service.changeModel(id, { ...reasoning, thinking: 'xhigh', expectedRevision: 1 }),
    ).toThrow('不支持')
    expect(() =>
      f.service.changeModel(id, {
        model: { kind: 'provider', provider: 'openai', model: 'gpt-5' },
        thinking: 'off',
        expectedRevision: 1,
      }),
    ).toThrow('真实提供商')
    expect(() => f.service.changeModel(id, { ...reasoning, expectedRevision: 7 })).toThrow('已变化')
    expect(f.store.modelState(id)).toEqual(before)
    f.app
      .get(WorkspaceDatabase)
      .sqlite.exec(
        "CREATE TRIGGER model_save_failure BEFORE UPDATE OF configuration ON session_configurations BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END",
      )
    expect(() => f.service.changeModel(id, { ...reasoning, expectedRevision: 1 })).toThrow(
      '未能保存',
    )
    expect(f.store.modelState(id)).toEqual(before)
  } finally {
    await f.close()
  }
})

test('mODEL-03 desktop protocol gates and strict unsupported attachment input reject without mutations', async () => {
  const f = await setup()
  try {
    const receipt = await f.service.submit(input())
    await settled(f, receipt.submission.requestId)
    const id = receipt.session.id,
      url = `/api/chat/sessions/${id}/model`
    const browser = await authorizedHeaders(f.app, f.port),
      desktop = await authorizedHeaders(f.app, f.port, 'desktop')
    expect((await f.app.inject({ url, headers: browser })).statusCode).toBe(403)
    const access = (await f.app.inject({ url: '/api/access', headers: desktop })).json<{
      csrf: string
    }>()
    const headers = {
      ...desktop,
      origin: `http://127.0.0.1:${f.port}`,
      'x-piw-csrf': access.csrf,
      'x-piw-protocol': '1',
      'x-piw-capabilities': runtimeCapabilities.join(','),
    }
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...reasoning, expectedRevision: 1, attachments: ['file.png'] },
        })
      ).statusCode,
    ).toBe(400)
    const saved = await f.app.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...reasoning, expectedRevision: 1 },
    })
    expect(saved.statusCode).toBe(200)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...base, expectedRevision: 1 },
        })
      ).statusCode,
    ).toBe(409)
    expect(f.store.modelState(id).requested).toEqual(reasoning)
  } finally {
    await f.close()
  }
})
