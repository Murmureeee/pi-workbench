import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { resourceSnapshotSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { readOptions } from '../dist/bootstrap/options.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'
import { processBirth } from './helpers/process-identity.js'

const wait = { timeout: 10000, interval: 20 }
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Missing resource fixture value')
  }
  return value
}
async function fixture(limits = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-resources-'))
  const app = await createApp({
    dataDir: directory,
    port: 4338,
    development: true,
    resourceLimits: limits,
  })
  return {
    directory,
    app,
    kernels: app.get(KernelService),
    events: app.get(EventService),
    store: app.get(SessionStore),
    close: async () => {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
function approval(f: Awaited<ReturnType<typeof fixture>>, sessionId: string) {
  const kernel = f.kernels.list().find((item) => item.sessionId === sessionId)!
  const turnId = randomUUID()
  // Explicit synthetic observation only. No real approval tool/service exists in M1.
  f.events.publish(sessionId, kernel.epoch, turnId, {
    type: 'turn.started',
    prompt: 'synthetic approval retention',
    messageId: `${turnId}:assistant`,
  })
  f.events.publish(sessionId, kernel.epoch, turnId, {
    type: 'approval.requested',
    approval: { id: turnId, command: 'synthetic, never executed', cwd: kernel.cwd },
  })
  return () =>
    f.events.publish(sessionId, kernel.epoch, turnId, { type: 'turn.finished', outcome: 'aborted' })
}
async function streaming(f: Awaited<ReturnType<typeof fixture>>, sessionId: string) {
  await vi.waitFor(
    () => expect(f.events.snapshot(sessionId)?.turns.at(-1)?.text).toContain('OFFLINE_'),
    wait,
  )
}

describe('CORE-07 real SDK + local HTTP fixture resource admission', () => {
  it('cancels one startup waiter without killing another caller sharing the same generation', async () => {
    const f = await fixture({ kernels: 1 })
    try {
      const sessionId = randomUUID(),
        controller = new AbortController()
      const cancelled = f.kernels
        .open(sessionId, f.directory, { signal: controller.signal })
        .catch((error: unknown) => error)
      const surviving = f.kernels.open(sessionId, f.directory)
      controller.abort()
      expect(await cancelled).toMatchObject({ name: 'AbortError' })
      const handle = await surviving
      expect(handle.snapshot.state).toBe('ready')
      expect(f.kernels.list()).toHaveLength(1)
      expect(f.kernels.resources().kernels[0]?.pins).toBe(0)
      expect(
        await f.kernels.prompt(sessionId, f.directory, {
          turnId: randomUUID(),
          text: 'surviving waiter',
        }),
      ).toMatchObject({ outcome: 'completed', localRequests: 1 })
    } finally {
      await f.close()
    }
  })

  it('bounds the admission queue, rejects stale cancellation and releases an error task for its FIFO successor', async () => {
    const f = await fixture()
    try {
      const first = randomUUID(),
        turnId = randomUUID()
      const run = f.kernels.prompt(first, f.directory, {
        turnId,
        text: 'queue pressure',
        fixture: 'hold',
      })
      await streaming(f, first)
      await expect(f.kernels.abort(first, randomUUID())).rejects.toThrow('Unknown active turn')
      const queued = Array.from({ length: 256 }, () =>
        f.kernels
          .prompt(randomUUID(), f.directory, {
            turnId: randomUUID(),
            text: 'never dispatch queue pressure',
          })
          .catch((error: unknown) => error),
      )
      await expect(
        f.kernels.prompt(randomUUID(), f.directory, { turnId: randomUUID(), text: 'overflow' }),
      ).rejects.toThrow('queue is full')
      expect(f.kernels.list()).toHaveLength(1)
      expect(f.kernels.resources().queue.filter((item) => item.stage === 'queued')).toHaveLength(
        256,
      )
      await Promise.all(
        f.kernels
          .resources()
          .queue.filter((item) => item.stage === 'queued')
          .map((task) => f.kernels.abort(task.sessionId, task.id)),
      )
      const cancelled = await Promise.all(queued)
      expect(
        cancelled.every((result) => result instanceof DOMException && result.name === 'AbortError'),
      ).toBe(true)
      const failedId = randomUUID(),
        nextId = randomUUID()
      const failed = f.kernels.prompt(failedId, f.directory, {
        turnId: randomUUID(),
        text: 'local provider error',
        fixture: 'error',
      })
      const next = f.kernels.prompt(nextId, f.directory, {
        turnId: randomUUID(),
        text: 'after provider error',
      })
      await f.kernels.abort(first, turnId)
      await run
      expect(await failed).toMatchObject({ outcome: 'error', localRequests: 1 })
      expect(await next).toMatchObject({ outcome: 'completed', localRequests: 1 })
      expect(f.kernels.resources().modelTasks).toBe(0)
    } finally {
      await f.close()
    }
  })

  it('counts starting processes, caps at three and queues/cancels FIFO without reclaiming synthetic pending approval', async () => {
    const f = await fixture()
    try {
      const ids = [randomUUID(), randomUUID(), randomUUID()]
      const opening = ids.map((id) => f.kernels.open(id, f.directory))
      expect(f.kernels.resources().kernels).toHaveLength(3)
      const handles = await Promise.all(opening)
      const retiredPid = required(handles[0]).snapshot.pid!,
        retiredBirth = processBirth(retiredPid)
      expect(retiredBirth).not.toBe('')
      const release = ids.map((id) => approval(f, id))
      const controller = new AbortController(),
        cancelledId = randomUUID(),
        nextId = randomUUID(),
        lastId = randomUUID()
      const cancelled = f.kernels.open(cancelledId, f.directory, { signal: controller.signal })
      const rejected = cancelled.catch((error: unknown) => error)
      const order: string[] = []
      const next = f.kernels.open(nextId, f.directory).then((handle) => {
        order.push(nextId)
        return handle
      })
      const last = f.kernels.open(lastId, f.directory).then((handle) => {
        order.push(lastId)
        return handle
      })
      expect(
        f.kernels.resources().queue.map((item) => [item.sessionId, item.position, item.reason]),
      ).toEqual([
        [cancelledId, 1, 'kernel-limit'],
        [nextId, 2, 'kernel-limit'],
        [lastId, 3, 'kernel-limit'],
      ])
      controller.abort()
      expect(await rejected).toMatchObject({ name: 'AbortError' })
      expect(f.kernels.resources().queue.map((item) => item.position)).toEqual([1, 2])
      expect(handles.every((handle) => handle.snapshot.state === 'ready')).toBe(true)
      required(release[0])()
      await Promise.all([next, last])
      expect(order).toEqual([nextId, lastId])
      expect(f.kernels.list().length).toBeLessThanOrEqual(3)
      expect(processBirth(retiredPid)).not.toBe(retiredBirth)
      expect(f.kernels.list().some((kernel) => kernel.sessionId === ids[0])).toBe(false)
      expect(required(handles[1]).snapshot.state).toBe('ready')
      expect(required(handles[2]).snapshot.state).toBe('ready')
      expect(f.store.list().some((session) => session.id === cancelledId)).toBe(false)
    } finally {
      await f.close()
    }
  })

  it('runs one model task by default, preserves FIFO, cancels queued input and exposes no raw prompt bypass', async () => {
    const f = await fixture()
    try {
      const first = randomUUID(),
        second = randomUUID(),
        third = randomUUID(),
        fourth = randomUUID(),
        turn = randomUUID()
      const run = f.kernels.prompt(first, f.directory, {
        turnId: turn,
        text: 'hold',
        fixture: 'hold',
      })
      await streaming(f, first)
      const view = await f.kernels.open(first, f.directory)
      expect('prompt' in view).toBe(false)
      const cancelled = f.kernels.prompt(second, f.directory, {
        turnId: randomUUID(),
        text: 'must never reach SDK',
      })
      const cancelledCheck = cancelled.catch((error: unknown) => error)
      const order: string[] = []
      const next = f.kernels
        .prompt(third, f.directory, { turnId: randomUUID(), text: 'third' })
        .then((result) => {
          order.push(third)
          return result
        })
      const last = f.kernels
        .prompt(fourth, f.directory, { turnId: randomUUID(), text: 'fourth' })
        .then((result) => {
          order.push(fourth)
          return result
        })
      expect(f.kernels.resources().modelTasks).toBe(1)
      expect(f.kernels.list()).toHaveLength(1)
      expect(
        f.kernels
          .resources()
          .queue.filter((item) => item.stage === 'queued')
          .map((item) => [item.sessionId, item.position, item.reason]),
      ).toEqual([
        [second, 1, 'directory-busy'],
        [third, 2, 'directory-busy'],
        [fourth, 3, 'directory-busy'],
      ])
      const queuedTurn = f.kernels.resources().queue.find((item) => item.sessionId === second)!.id
      await f.kernels.abort(second, queuedTurn)
      expect(await cancelledCheck).toMatchObject({ name: 'AbortError' })
      expect(f.store.list().some((session) => session.id === second)).toBe(false)
      await f.kernels.abort(first, turn)
      expect(await run).toMatchObject({ outcome: 'aborted' })
      expect(await next).toMatchObject({
        outcome: 'completed',
        localRequests: 1,
        blockedNetworkAttempts: 0,
      })
      expect(await last).toMatchObject({ outcome: 'completed' })
      expect(order).toEqual([third, fourth])
      expect(f.kernels.resources().modelTasks).toBe(0)
      expect(f.kernels.resources().queue).toEqual([])
    } finally {
      await f.close()
    }
  })

  it('cancels model admission blocked on a protected kernel and releases permits without creating native work', async () => {
    const f = await fixture({ kernels: 1 })
    try {
      const pinned = randomUUID(),
        cancelledId = randomUUID(),
        turnId = randomUUID()
      await f.kernels.open(pinned, f.directory)
      const release = approval(f, pinned)
      const run = f.kernels.prompt(cancelledId, f.directory, { turnId, text: 'never dispatch' })
      const rejected = run.catch((error: unknown) => error)
      expect(f.kernels.resources().modelTasks).toBe(1)
      expect(f.kernels.resources().queue.some((item) => item.kind === 'kernel')).toBe(true)
      await f.kernels.abort(cancelledId, turnId)
      expect(await rejected).toMatchObject({ name: 'AbortError' })
      release()
      expect(f.kernels.resources().modelTasks).toBe(0)
      expect(f.kernels.resources().queue).toEqual([])
      expect(f.store.list().some((session) => session.id === cancelledId)).toBe(false)
    } finally {
      await f.close()
    }
  })

  it('applies configurable model concurrency and admits the next task only after a killed SDK is reaped', async () => {
    const f = await fixture({ modelTasks: 2 })
    try {
      const cwdA = join(f.directory, 'a'),
        cwdB = join(f.directory, 'b')
      mkdirSync(cwdA)
      mkdirSync(cwdB)
      const ids = [randomUUID(), randomUUID(), randomUUID()] as const,
        turns = [randomUUID(), randomUUID()] as const
      const first = f.kernels.prompt(ids[0], cwdA, {
        turnId: turns[0],
        text: 'crash',
        fixture: 'hold',
      })
      const failed = first.catch((error: unknown) => error)
      const second = f.kernels.prompt(ids[1], cwdB, {
        turnId: turns[1],
        text: 'survivor',
        fixture: 'hold',
      })
      await Promise.all([streaming(f, ids[0]), streaming(f, ids[1])])
      const last = f.kernels.prompt(ids[2], cwdA, {
        turnId: randomUUID(),
        text: 'after crash',
      })
      expect(f.kernels.resources().modelTasks).toBe(2)
      const pid = f.kernels.list().find((kernel) => kernel.sessionId === ids[0])!.pid!
      const birth = processBirth(pid)
      expect(birth).not.toBe('')
      process.kill(pid, 'SIGKILL')
      const failure = await failed
      expect(failure).toBeInstanceOf(Error)
      if (!(failure instanceof Error)) {
        throw new Error('Expected SDK crash failure')
      }
      expect(failure.message).toMatch(/Kernel/)
      const afterCrash = await last
      expect(afterCrash.error).toBeUndefined()
      expect(afterCrash).toMatchObject({ outcome: 'completed' })
      expect(processBirth(pid)).not.toBe(birth)
      expect(f.kernels.list().some((kernel) => kernel.sessionId === ids[0])).toBe(false)
      expect(f.kernels.list().find((kernel) => kernel.sessionId === ids[1])?.state).toBe('running')
      await f.kernels.abort(ids[1], turns[1])
      expect(await second).toMatchObject({ outcome: 'aborted' })
    } finally {
      await f.close()
    }
  })

  it('reaps idle LRU processes, cold opens the same native history without a request, and sends its actual context on explicit prompt', async () => {
    const f = await fixture({ kernels: 1 })
    try {
      const sessionId = randomUUID(),
        firstTurn = randomUUID()
      await f.kernels.prompt(sessionId, f.directory, {
        turnId: firstTurn,
        text: 'COLD_CONTEXT_SENTINEL',
      })
      const before = required(f.kernels.list()[0]),
        beforeBirth = processBirth(before.pid!),
        bytes = readFileSync(before.sessionFile!),
        history = f.store.history(sessionId)!
      expect(beforeBirth).not.toBe('')
      await f.kernels.open(randomUUID(), f.directory)
      expect(processBirth(before.pid!)).not.toBe(beforeBirth)
      expect(f.kernels.list().some((kernel) => kernel.sessionId === sessionId)).toBe(false)
      const restored = await f.kernels.open(sessionId, f.directory)
      expect(restored.snapshot).toMatchObject({
        sessionFile: before.sessionFile,
        nativeSessionId: before.nativeSessionId,
        state: 'ready',
      })
      expect(restored.snapshot.epoch).not.toBe(before.epoch)
      expect(readFileSync(before.sessionFile!)).toEqual(bytes)
      expect(f.store.history(sessionId)?.messages).toEqual(history.messages)
      expect(f.store.history(sessionId)?.diagnostics).toEqual([])
      const result = await f.kernels.prompt(sessionId, f.directory, {
        turnId: randomUUID(),
        text: 'EXPLICIT_NEW_INPUT',
        fixture: 'context',
      })
      expect(result).toMatchObject({ localRequests: 1, blockedNetworkAttempts: 0 })
      const text = f.events.snapshot(sessionId)?.turns.at(-1)?.text
      expect(text).toContain('COLD_CONTEXT_SENTINEL')
      expect(text).toContain('OFFLINE_OK')
      expect(text).toContain('EXPLICIT_NEW_INPUT')
      const after = f.store.history(sessionId)!
      expect(after.diagnostics).toEqual([])
      expect(after.messages).toHaveLength(4)
      expect(after.messages.slice(0, 2).map((message) => message.id)).toEqual(
        history.messages.map((message) => message.id),
      )
      expect(new Set(after.messages.map((message) => message.id)).size).toBe(4)
    } finally {
      await f.close()
    }
  })

  it('keeps synthetic interrupted checkpoints in their original history position and out of cold SDK context', async () => {
    const f = await fixture({ kernels: 1 })
    try {
      const sessionId = randomUUID()
      await f.kernels.prompt(sessionId, f.directory, {
        turnId: randomUUID(),
        text: 'COMMITTED_NATIVE_INPUT',
      })
      const before = required(f.kernels.list()[0]),
        partial = randomUUID()
      // Explicit synthetic crash projection after a real committed turn. No SDK message is forged.
      f.events.publish(sessionId, before.epoch, partial, {
        type: 'turn.started',
        prompt: 'UNCONFIRMED_SYNTHETIC_INPUT',
        messageId: `${partial}:assistant`,
      })
      f.events.publish(sessionId, before.epoch, partial, {
        type: 'message.delta',
        messageId: `${partial}:assistant`,
        text: 'SYNTHETIC_PARTIAL_REPLY',
      })
      f.events.publish(sessionId, before.epoch, partial, {
        type: 'turn.finished',
        outcome: 'error',
      })
      await f.kernels.destroy(sessionId)
      await f.kernels.prompt(sessionId, f.directory, {
        turnId: randomUUID(),
        text: 'NEW_EXPLICIT_INPUT',
        fixture: 'context',
      })
      const context = f.events.snapshot(sessionId)?.turns.at(-1)?.text
      expect(context).toContain('COMMITTED_NATIVE_INPUT')
      expect(context).toContain('NEW_EXPLICIT_INPUT')
      expect(context).not.toContain('UNCONFIRMED_SYNTHETIC_INPUT')
      expect(context).not.toContain('SYNTHETIC_PARTIAL_REPLY')
      const history = f.store.history(sessionId)!
      expect(history.diagnostics).toEqual([])
      expect(history.messages.map((message) => message.origin)).toEqual([
        'sdk-jsonl',
        'sdk-jsonl',
        'interrupted-checkpoint',
        'interrupted-checkpoint',
        'sdk-jsonl',
        'sdk-jsonl',
      ])
      expect(history.messages[2]?.text).toBe('UNCONFIRMED_SYNTHETIC_INPUT')
      expect(history.messages[4]?.text).toBe('NEW_EXPLICIT_INPUT')
    } finally {
      await f.close()
    }
  })

  it('expires idle processes automatically while protecting a real stream and synthetic pending approval', async () => {
    const f = await fixture({ idleMs: 100 })
    try {
      const first = randomUUID(),
        second = randomUUID(),
        third = randomUUID(),
        turnId = randomUUID()
      const run = f.kernels.prompt(first, f.directory, {
        turnId,
        text: 'busy stays alive',
        fixture: 'hold',
      })
      await streaming(f, first)
      await f.kernels.open(second, f.directory)
      approval(f, second)
      const idle = await f.kernels.open(third, f.directory)
      await vi.waitFor(() => expect(idle.snapshot.state).toBe('disposed'), wait)
      expect(f.kernels.list().find((kernel) => kernel.sessionId === first)?.state).toBe('running')
      expect(f.kernels.list().find((kernel) => kernel.sessionId === second)?.state).toBe('ready')
      await f.kernels.abort(first, turnId)
      await run
    } finally {
      await f.close()
    }
  })

  it('refuses damaged/future native history before cold loading and preserves exact bytes and capacity', async () => {
    const f = await fixture({ kernels: 1 })
    try {
      const sessionId = randomUUID()
      await f.kernels.prompt(sessionId, f.directory, { turnId: randomUUID(), text: 'source' })
      const path = required(f.kernels.list()[0]).sessionFile!
      await f.kernels.destroy(sessionId)
      appendFileSync(path, '{broken\n')
      const corrupt = readFileSync(path)
      await expect(f.kernels.open(sessionId, f.directory)).rejects.toThrow(/diagnos/)
      expect(readFileSync(path)).toEqual(corrupt)
      const text = corrupt
        .toString()
        .replace('"version":3', '"version":999')
        .replace('{broken\n', '')
      writeFileSync(path, text)
      await expect(f.kernels.open(sessionId, f.directory)).rejects.toThrow(/diagnos/)
      expect(readFileSync(path, 'utf8')).toBe(text)
      expect(f.kernels.resources().kernels).toHaveLength(0)
      expect(f.kernels.resources().queue).toEqual([])
      await f.kernels.open(randomUUID(), f.directory)
    } finally {
      await f.close()
    }
  })

  it('settles queued and running tasks before database shutdown and never resumes queued work after restart', async () => {
    const f = await fixture()
    try {
      const first = randomUUID(),
        second = randomUUID()
      const run = f.kernels.prompt(first, f.directory, {
        turnId: randomUUID(),
        text: 'shutdown',
        fixture: 'hold',
      })
      await streaming(f, first)
      const pending = f.kernels.prompt(second, f.directory, {
        turnId: randomUUID(),
        text: 'queued input',
      })
      const rejected = pending.catch((error: unknown) => error)
      const processes = f.kernels.list().map((kernel) => ({
        pid: kernel.pid!,
        birth: processBirth(kernel.pid!),
      }))
      expect(processes.every((entry) => entry.birth !== '')).toBe(true)
      await f.app.close()
      expect(await rejected).toMatchObject({ message: 'Daemon is shutting down' })
      expect(await run).toMatchObject({ outcome: 'aborted' })
      for (const entry of processes) {
        expect(processBirth(entry.pid)).not.toBe(entry.birth)
      }
      expect(f.kernels.list()).toEqual([])
      const app = await createApp({ dataDir: f.directory, port: 4338 })
      try {
        expect(app.get(KernelService).resources()).toMatchObject({
          kernels: [],
          modelTasks: 0,
          queue: [],
        })
        expect(
          app
            .get(SessionStore)
            .list()
            .some((session) => session.id === second),
        ).toBe(false)
      } finally {
        await app.close()
      }
    } finally {
      await f.close()
    }
  })

  it('validates limits before opening storage and serves a no-store read-only contract with Host/Origin checks', async () => {
    expect(readOptions({}).resourceLimits).toEqual({
      kernels: 3,
      modelTasks: 1,
      terminals: 6,
      idleMs: 300000,
    })
    expect(
      readOptions({
        PIW_MAX_KERNELS: '2',
        PIW_MAX_MODEL_TASKS: '2',
        PIW_MAX_TERMINALS: '4',
        PIW_KERNEL_IDLE_MS: '2000',
      }).resourceLimits,
    ).toEqual({ kernels: 2, modelTasks: 2, terminals: 4, idleMs: 2000 })
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '33', '']) {
      expect(() => readOptions({ PIW_MAX_KERNELS: value })).toThrow(/Too|Invalid/)
    }
    const f = await fixture()
    try {
      const server = f.app.getHttpAdapter().getInstance()
      const response = await server.inject({
        method: 'GET',
        url: '/api/kernels/resources',
        headers: await authorizedHeaders(f.app, 4338),
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(resourceSnapshotSchema.parse(response.json())).toMatchObject({
        limits: { kernels: 3, modelTasks: 1, terminals: 6 },
        viewCacheIndependent: true,
        terminalEnforcement: 'reserved-until-M4',
      })
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/kernels/resources',
            headers: { host: '127.0.0.1:4338', origin: 'https://untrusted.example' },
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/kernels/resources',
            headers: await authorizedHeaders(f.app, 4338),
          })
        ).statusCode,
      ).toBe(403)
      await expect(
        f.kernels.prompt('../unsafe', f.directory, { turnId: randomUUID(), text: 'invalid' }),
      ).rejects.toThrow(/Invalid/)
      expect(f.kernels.list()).toEqual([])
    } finally {
      await f.close()
    }
  })
})
