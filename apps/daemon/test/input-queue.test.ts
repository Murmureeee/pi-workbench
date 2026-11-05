import type { InputQueueCommand, SessionSubmit } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

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

test('iNPUT-06 actual SDK consumes FIFO steering before earlier follow-up, and follow-up waits settled/native checkpoint', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-input-queue-'))
  const app = await createApp({ dataDir: directory, port: 24393, development: true })
  try {
    const kernels = app.get(KernelService),
      store = app.get(SessionStore),
      service = app.get(SessionService),
      events = app.get(EventService)
    const original = kernels.prompt.bind(kernels)
    let prompts = 0
    const admissionChecks: unknown[] = []
    kernels.prompt = (id, cwd, value, options) => {
      prompts++
      admissionChecks.push({
        status: store.submissions(id)[0]?.status,
        phase: events.snapshot(id)?.turns[0]?.phase,
        history: store
          .history(id)
          ?.messages.some(
            (row) => row.role === 'assistant' && row.turnId === store.submissions(id)[0]?.turnId,
          ),
      })
      return original(id, cwd, { ...value, fixture: 'queue-fast' }, options)
    }
    const receipt = await service.submit(input('当前轮起点')),
      id = receipt.session.id,
      turnId = receipt.submission.turnId
    await expect
      .poll(() => events.snapshot(id)?.turns[0]?.text, { timeout: 20000 })
      .toContain('INPUT06_REQUEST')
    const command = (
      kind: 'steer' | 'follow-up',
      text: string,
    ): Extract<InputQueueCommand, { action: 'enqueue' }> => ({
      action: 'enqueue',
      id: randomUUID(),
      kind,
      text,
      turnId,
    })
    const append = command('follow-up', '追加一'),
      cancel = command('follow-up', '追加二'),
      steer1 = command('steer', '引导一'),
      steer2 = command('steer', '引导二')
    await service.inputCommand(id, append)
    await service.inputCommand(id, cancel)
    await service.inputCommand(id, steer1)
    await service.inputCommand(id, steer2)
    await service.inputCommand(id, append)
    expect(store.inputQueue(id)).toHaveLength(4)
    await expect(service.inputCommand(id, { ...append, text: '不能复用' })).rejects.toThrow('绑定')
    await service.inputCommand(id, {
      action: 'edit',
      id: append.id,
      revision: 0,
      text: '追加一已编辑 api_key=queue-fixture-secret',
    })
    await expect(
      service.inputCommand(id, { action: 'edit', id: append.id, revision: 0, text: '过期修改' }),
    ).rejects.toThrow('版本')
    await service.inputCommand(id, { action: 'cancel', id: cancel.id, revision: 0 })
    await service.inputCommand(id, {
      action: 'edit',
      id: steer2.id,
      revision: 0,
      text: '引导二已编辑',
    })
    await expect
      .poll(() => store.submissions(id).map((row) => row.status), { timeout: 20000 })
      .toEqual(['completed', 'completed'])
    expect(prompts).toBe(2)
    expect(admissionChecks[1]).toEqual({ status: 'completed', phase: 'completed', history: true })
    const rows = store.inputQueue(id)
    expect(rows.map((row) => row.status)).toEqual([
      'delivered',
      'cancelled',
      'delivered',
      'delivered',
    ])
    expect(rows[2]?.deliveredTurnId).toBe(turnId)
    expect(rows[3]?.deliveredTurnId).toBe(turnId)
    expect(rows[0]?.deliveredTurnId).toBe(store.submissions(id)[1]?.turnId)
    const users = store
      .history(id)
      ?.messages.filter((row) => row.role === 'user')
      .map((row) => row.text)
    expect(users).toEqual([
      '当前轮起点',
      '引导一',
      '引导二已编辑',
      '追加一已编辑 api_key=queue-fixture-secret',
    ])
    expect(events.snapshot(id)?.turns[0]?.modelRequest?.attempts).toBe(3)
    const http = app.getHttpAdapter().getInstance(),
      headers = await authorizedHeaders(app, 24393, 'desktop')
    const response = await http.inject({
      method: 'GET',
      url: `/api/chat/sessions/${id}/queue`,
      headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('queue-fixture-secret')
    const completedSteer = rows[2]
    if (!completedSteer) {
      throw new Error('Missing delivered steer')
    }
    await expect(
      service.inputCommand(id, {
        action: 'edit',
        id: steer1.id,
        revision: completedSteer.revision,
        text: '不能改已送达',
      }),
    ).rejects.toThrow('送达')
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('iNPUT-06 stop/restart holds editable inputs, isolates stale targets and only explicitly resumes one input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-input-held-'))
  let app = await createApp({ dataDir: directory, port: 24394, development: true })
  try {
    let kernels = app.get(KernelService),
      store = app.get(SessionStore),
      service = app.get(SessionService),
      events = app.get(EventService)
    const original = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, value, options) =>
      original(id, cwd, { ...value, fixture: 'hold' }, options)
    const receipt = await service.submit(input('暂停保留')),
      id = receipt.session.id,
      turnId = receipt.submission.turnId
    await expect
      .poll(() => events.snapshot(id)?.turns[0]?.text, { timeout: 20000 })
      .toBe('OFFLINE_')
    const first = randomUUID(),
      second = randomUUID()
    await service.inputCommand(id, {
      action: 'enqueue',
      id: first,
      kind: 'follow-up',
      text: '保留一',
      turnId,
    })
    await service.inputCommand(id, {
      action: 'enqueue',
      id: second,
      kind: 'follow-up',
      text: '保留二',
      turnId,
    })
    await expect(
      service.inputCommand(id, {
        action: 'enqueue',
        id: randomUUID(),
        kind: 'steer',
        text: '迟到目标',
        turnId: randomUUID(),
      }),
    ).rejects.toThrow('轮次')
    service.pauseInput(id)
    await kernels.abort(id, turnId)
    await expect.poll(() => store.submissions(id)[0]?.status).toBe('aborted')
    expect(store.inputQueue(id).map((row) => row.status)).toEqual(['held', 'held'])
    await app.close()
    app = await createApp({ dataDir: directory, port: 24394, development: true })
    kernels = app.get(KernelService)
    store = app.get(SessionStore)
    service = app.get(SessionService)
    events = app.get(EventService)
    expect(kernels.list()).toEqual([])
    expect(store.submissions(id)).toHaveLength(1)
    let row = store.inputQueue(id)[0]
    if (!row) {
      throw new Error('Missing held input')
    }
    const later = store.inputQueue(id)[1]
    if (!later) {
      throw new Error('Missing later held input')
    }
    await expect(
      service.inputCommand(id, { action: 'resume', id: second, revision: later.revision }),
    ).rejects.toThrow('更早')
    await expect(
      service.submit({ ...input('独立发送不能越过保留队列'), sessionId: id }),
    ).rejects.toThrow('会话未能保存')
    expect(kernels.list()).toEqual([])
    expect(store.submissions(id)).toHaveLength(1)
    await service.inputCommand(id, {
      action: 'edit',
      id: first,
      revision: row.revision,
      text: '保留一已修改',
    })
    row = store.inputQueue(id)[0]!
    await service.inputCommand(id, { action: 'resume', id: first, revision: row.revision })
    await expect.poll(() => store.submissions(id)[1]?.status, { timeout: 20000 }).toBe('completed')
    expect(store.inputQueue(id).map((item) => item.status)).toEqual(['delivered', 'held'])
    expect(store.submissions(id)).toHaveLength(2)
    row = store.inputQueue(id)[1]!
    await service.inputCommand(id, { action: 'cancel', id: second, revision: row.revision })
    expect(store.inputQueue(id)[1]?.status).toBe('cancelled')
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('iNPUT-06 crash-selected input recovers as uncertain and cannot silently replay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-input-uncertain-'))
  let app = await createApp({ dataDir: directory, port: 24395, development: true })
  try {
    const receipt = await app.get(SessionService).submit(input('建立原生绑定')),
      id = receipt.session.id,
      store = app.get(SessionStore)
    await expect.poll(() => store.submissions(id)[0]?.status, { timeout: 20000 }).toBe('completed')
    const epoch = app.get(EventService).snapshot(id)!.epoch,
      queueId = randomUUID()
    store.saveQueue({
      id: queueId,
      sessionId: id,
      epoch,
      turnId: receipt.submission.turnId,
      source: 'workbench',
      kind: 'steer',
      position: 0,
      text: '可能已送达',
      status: 'sending',
    })
    await app.close()
    app = await createApp({ dataDir: directory, port: 24395, development: true })
    expect(app.get(KernelService).list()).toEqual([])
    expect(app.get(SessionStore).inputQueue(id)[0]?.status).toBe('uncertain')
    await expect(
      app.get(SessionService).inputCommand(id, { action: 'resume', id: queueId, revision: 1 }),
    ).rejects.toThrow('送达')
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
