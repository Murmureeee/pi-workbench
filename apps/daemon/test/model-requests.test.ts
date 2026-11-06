import type { SessionSubmit } from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { historyPageSchema, runtimeCapabilities } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'
import { denyFixtureApprovals } from './helpers/decisions.js'

const input = (text: string): SessionSubmit => ({
  requestId: randomUUID(),
  sessionId: null,
  text,
  retryOf: null,
  configuration: {
    projectId: null,
    workspaceId: null,
    model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
    thinking: 'off',
  },
})

test('mODEL-07 actual SDK errors have one request, zero retries, sanitized replay/history and restart without executing again', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-model-errors-')),
    port = 24391
  let app = await createApp({ dataDir: directory, port, development: true })
  try {
    const kernels = app.get(KernelService),
      original = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, value, options) =>
      original(id, cwd, { ...value, fixture: 'error' }, options)
    const receipt = await app.get(SessionService).submit(input('模型错误验收'))
    await expect
      .poll(() => app.get(SessionStore).submission(receipt.submission.requestId)?.status, {
        timeout: 20000,
      })
      .toBe('failed')
    const events = app.get(EventService),
      snapshot = events.visibleSnapshot(receipt.session.id)!
    expect(snapshot.turns.at(-1)?.modelRequest).toMatchObject({
      attempts: 1,
      retryCount: 0,
      retryLimit: 0,
      state: 'settled',
    })
    expect(JSON.stringify(snapshot)).not.toContain('fixture-model-error-secret')
    expect(snapshot.turns.at(-1)?.error).toContain('Offline fixture error')
    const frames: unknown[] = []
    events.subscribe(
      {
        type: 'subscribe',
        sessionId: receipt.session.id,
        daemonId: events.daemonId,
        epoch: snapshot.epoch,
        since: 0,
        protocolVersion: 1,
        requiredCapabilities: [...runtimeCapabilities],
      },
      (frame) => frames.push(frame),
      true,
    )()
    expect(JSON.stringify(frames)).not.toContain('fixture-model-error-secret')
    const path = kernels.list().find((k) => k.sessionId === receipt.session.id)!.sessionFile!
    const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex'),
      before = hash()
    await app.close()
    app = await createApp({ dataDir: directory, port, development: true })
    expect(app.get(KernelService).list()).toEqual([])
    expect(
      app.get(EventService).visibleSnapshot(receipt.session.id)?.turns[0]?.modelRequest,
    ).toMatchObject({ attempts: 1, retryLimit: 0 })
    const headers = await authorizedHeaders(app, port)
    const response = await app.inject({
      url: `/api/sessions/${receipt.session.id}/history`,
      headers,
    })
    const page = historyPageSchema.parse(response.json())
    expect(page.modelRequests?.[0]?.request).toMatchObject({
      attempts: 1,
      retryCount: 0,
      retryLimit: 0,
      state: 'settled',
    })
    expect(response.body).not.toContain('fixture-model-error-secret')
    expect(hash()).toBe(before)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('mODEL-07 actual guarded write rejection cannot be replayed through whole-task retry or changed configuration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-model-retry-')),
    port = 24392
  const app = await createApp({ dataDir: directory, port, development: true })
  denyFixtureApprovals(app)
  try {
    const kernels = app.get(KernelService),
      original = kernels.prompt.bind(kernels)
    let calls = 0
    kernels.prompt = (id, cwd, value, options) => {
      calls++
      return original(id, cwd, { ...value, fixture: 'unknown-tool' }, options)
    }
    const sessions = app.get(SessionService),
      receipt = await sessions.submit(input('禁用工具不会因重试放行'))
    await expect
      .poll(() => app.get(SessionStore).submission(receipt.submission.requestId)?.status, {
        timeout: 20000,
      })
      .toBe('failed')
    expect(
      app.get(SessionStore).retryRequiresReview(receipt.session.id, receipt.submission.turnId),
    ).toBe(true)
    const retry = {
      ...input('禁用工具不会因重试放行'),
      sessionId: receipt.session.id,
      retryOf: receipt.submission.requestId,
    }
    await expect(sessions.submit(retry)).rejects.toThrow('不能重放整项任务')
    await expect(
      sessions.submit({
        ...retry,
        requestId: randomUUID(),
        configuration: {
          ...retry.configuration,
          model: { kind: 'provider', provider: 'other-provider', model: 'other-model' },
        },
      }),
    ).rejects.toThrow('所选模型当前不可用')
    expect(calls).toBe(1)
    const tools = app.get(EventService).snapshot(receipt.session.id)?.turns[0]?.tools
    expect(tools?.some((tool) => tool.status === 'denied' && tool.risk?.level === 'L2')).toBe(true)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
