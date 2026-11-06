import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { sessionUsageSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

test('mODEL-05 actual SDK counters retain per-message/turn identity, unknown zeros, cold history and read-only access', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-usage-'))
  const app = await createApp({ dataDir: directory, port: 24613, development: true })
  const service = app.get(SessionService),
    store = app.get(SessionStore),
    kernels = app.get(KernelService)
  const original = kernels.prompt.bind(kernels)
  let prompts = 0
  kernels.prompt = (id, cwd, input, options) => {
    prompts++
    return original(id, cwd, { ...input, fixture: prompts === 1 ? 'usage' : 'reply' }, options)
  }
  const configuration = {
    projectId: null,
    workspaceId: null,
    model: {
      kind: 'local-fixture' as const,
      provider: 'piw-offline' as const,
      model: 'fixture' as const,
    },
    thinking: 'off' as const,
  }
  try {
    const first = await service.submit({
      requestId: randomUUID(),
      sessionId: null,
      text: '用量实际SDK',
      retryOf: null,
      configuration,
    })
    await expect
      .poll(() => store.submission(first.submission.requestId)?.status, { timeout: 20000 })
      .toBe('completed')
    const a = sessionUsageSchema.parse(service.usage(first.session.id))
    expect(a.latest).toMatchObject({
      turnId: first.submission.turnId,
      provider: 'piw-offline' as const,
      model: 'fixture',
      contextWindow: 8192,
      tokens: { input: 96, output: 16, cacheRead: 32, cacheWrite: null, total: 144 },
    })
    const next = await service.submit({
      requestId: randomUUID(),
      sessionId: first.session.id,
      text: '未知用量',
      retryOf: null,
      configuration,
    })
    await expect
      .poll(() => store.submission(next.submission.requestId)?.status, { timeout: 20000 })
      .toBe('completed')
    const b = sessionUsageSchema.parse(service.usage(first.session.id))
    expect(b.turns).toHaveLength(2)
    expect(b.latest?.tokens.total).toBeNull()
    expect(b.totals.total).toEqual({ known: 144, unknown: 1 })
    expect(b.totals.cacheWrite).toEqual({ known: 0, unknown: 2 })
    expect(prompts).toBe(2)
    const path = kernels.list()[0]?.sessionFile
    if (!path) {
      throw new Error('No actual SDK history')
    }
    const bytes = readFileSync(path)
    const desktop = await authorizedHeaders(app, 24613, 'desktop'),
      browser = await authorizedHeaders(app, 24613)
    const url = `/api/chat/sessions/${first.session.id}/usage`
    expect((await app.inject({ url, headers: browser })).statusCode).toBe(403)
    const response = await app.inject({ url, headers: desktop })
    expect(response.statusCode).toBe(200)
    expect(sessionUsageSchema.parse(response.json()).totals).toEqual(b.totals)
    expect(readFileSync(path)).toEqual(bytes)
    await app.close()
    const reopened = await createApp({ dataDir: directory, port: 24613, development: true })
    try {
      expect(reopened.get(KernelService).list()).toEqual([])
      expect(
        sessionUsageSchema.parse(reopened.get(SessionService).usage(first.session.id)).totals,
      ).toEqual(b.totals)
      writeFileSync(path, Buffer.concat([bytes, Buffer.from('{broken\n')]))
      expect(
        sessionUsageSchema.parse(reopened.get(SessionService).usage(first.session.id)).diagnostics,
      ).toContain('invalid-record')
      expect(readFileSync(path).length).toBe(bytes.length + 8)
      writeFileSync(path, bytes)
    } finally {
      await reopened.close()
    }
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
