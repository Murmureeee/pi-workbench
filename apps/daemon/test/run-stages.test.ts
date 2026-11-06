import type { SessionSubmit } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'

test('oBS-02 actual SDK stages checkpoint before broadcast, stop failure preserves running authority, restart never dispatches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piw-stage-')),
    port = 24406
  let app = await createApp({ dataDir: dir, port, development: true })
  try {
    const kernels = app.get(KernelService),
      original = kernels.prompt.bind(kernels),
      events = app.get(EventService),
      stages: string[] = []
    const input: SessionSubmit = {
      requestId: randomUUID(),
      sessionId: null,
      text: '真实SDK阶段',
      retryOf: null,
      configuration: {
        projectId: null,
        workspaceId: null,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    }
    kernels.prompt = (id, cwd, value, options) =>
      original(id, cwd, { ...value, fixture: 'hold' }, options)
    const off = events.onChange(() => {
      const snapshot = events.snapshot(
        app.get(SessionStore).submission(input.requestId)?.sessionId ?? '',
      )
      const stage = snapshot?.turns.at(-1)?.stage
      if (stage && stages.at(-1) !== stage) {
        stages.push(stage)
      }
    })
    const receipt = await app.get(SessionService).submit(input)
    await expect.poll(() => stages.includes('streaming'), { timeout: 20000 }).toBe(true)
    expect(stages).toEqual(expect.arrayContaining(['starting', 'waiting-model', 'streaming']))
    const checkpoints = readdirSync(join(dir, 'inflight'), {
      recursive: true,
      encoding: 'utf8',
    }).filter((n) => n.endsWith('.json'))
    expect(
      checkpoints.some((n) => readFileSync(join(dir, 'inflight', n), 'utf8').includes('streaming')),
    ).toBe(true)
    const pid = kernels.list()[0]?.pid,
      abort = kernels.abort.bind(kernels)
    kernels.abort = () => Promise.reject(new Error('injected stop transport failure'))
    await expect(kernels.abort(receipt.session.id, receipt.submission.turnId)).rejects.toThrow(
      'injected',
    )
    expect(kernels.list()[0]?.pid).toBe(pid)
    expect(app.get(SessionStore).submission(input.requestId)?.status).toBe('executing')
    expect(events.snapshot(receipt.session.id)?.turns.at(-1)?.phase).toBe('running')
    kernels.abort = abort
    await kernels.abort(receipt.session.id, receipt.submission.turnId)
    await expect
      .poll(() => app.get(SessionStore).submission(input.requestId)?.status)
      .toBe('aborted')
    expect(events.snapshot(receipt.session.id)?.turns.at(-1)).toMatchObject({
      phase: 'aborted',
      stage: 'settling',
    })
    off()
    await app.close()
    app = await createApp({ dataDir: dir, port, development: true })
    expect(app.get(KernelService).list()).toEqual([])
    expect(app.get(EventService).visibleSnapshot(receipt.session.id)?.turns[0]?.phase).toBe(
      'aborted',
    )
    expect(app.get(SessionStore).submission(input.requestId)?.status).toBe('aborted')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
