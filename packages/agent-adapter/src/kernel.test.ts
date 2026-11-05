import type { KernelMessage } from './kernel-protocol.js'

import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { SessionKernel } from '../dist/kernel.js'

const directories: string[] = []
const kernels: SessionKernel[] = []
function create(mode?: string, timeoutMs = 10000) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-kernel-test-'))
  directories.push(directory)
  const cwd = join(directory, 'workspace')
  mkdirSync(cwd)
  const kernel = new SessionKernel({
    protocol: 1,
    sessionId: randomUUID(),
    epoch: randomUUID(),
    cwd,
    runtimeDir: join(directory, mode ?? 'runtime'),
    timeoutMs,
    ...(mode
      ? { childEntry: new URL('../test/fixtures/kernel-fault-child.mjs', import.meta.url) }
      : {}),
  })
  kernels.push(kernel)
  return kernel
}

function alive(pid: number | undefined) {
  if (!pid) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('CORE-04 real SDK + local HTTP fixture (zero real provider requests)', () => {
  it('reaps the real SDK stream when its host disappears without graceful shutdown', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-orphan-test-'))
    directories.push(directory)
    const host = fork(new URL('../test/fixtures/kernel-orphan-host.mjs', import.meta.url), [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    })
    host.stderr?.resume()
    const exited = new Promise<void>((resolve) => {
      host.once('close', () => {
        resolve()
      })
    })
    let sdkPid: number | undefined
    try {
      const child = new Promise<number>((resolve, reject) => {
        host.once('error', reject)
        host.once('message', (message: unknown) => {
          const parsed = z.object({ sdkPid: z.number().int().positive() }).safeParse(message)
          if (parsed.success) {
            resolve(parsed.data.sdkPid)
          } else {
            reject(new Error('Invalid orphan fixture IPC'))
          }
        })
        host.once('exit', () => {
          if (!sdkPid) {
            reject(new Error('Host exited before reporting child'))
          }
        })
      })
      host.send({ directory })
      sdkPid = await child
      await exited
      await expect.poll(() => alive(sdkPid), { timeout: 10000 }).toBe(false)
    } finally {
      host.kill('SIGKILL')
      await exited
      if (alive(sdkPid) && sdkPid) {
        process.kill(sdkPid, 'SIGKILL')
        await delay(50)
      }
    }
  })
  it('binds process, cwd, native JSONL, turn and generation; streams and disposes', async () => {
    const kernel = create()
    await kernel.ready()
    expect(kernel.snapshot.state).toBe('ready')
    const events: KernelMessage[] = []
    const unsubscribe = kernel.subscribe((event) => events.push(event))
    const turnId = randomUUID()
    const result = await kernel.prompt({ turnId, text: 'offline lifecycle check' })
    expect(result).toMatchObject({
      outcome: 'completed',
      localRequests: 1,
      blockedNetworkAttempts: 0,
      turnId,
      epoch: kernel.snapshot.epoch,
      sessionId: kernel.snapshot.sessionId,
    })
    expect(
      events
        .filter((event) => event.type === 'delta')
        .map((event) => event.text)
        .join(''),
    ).toBe('OFFLINE_OK')
    expect(events.map((event) => event.seq)).toEqual(events.map((_event, i) => i + 2))
    const file = kernel.snapshot.sessionFile
    expect(file).toBeTruthy()
    if (!file) {
      throw new Error('Native history missing')
    }
    const rows: unknown[] = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line: string): unknown => JSON.parse(line))
    expect(rows[0]).toMatchObject({
      type: 'session',
      id: kernel.snapshot.nativeSessionId,
      cwd: kernel.snapshot.cwd,
    })
    expect(readFileSync(file, 'utf8')).toContain('OFFLINE_OK')
    await expect(kernel.prompt({ turnId, text: 'duplicate' })).rejects.toThrow('turn ID')
    unsubscribe()
    await Promise.all([kernel.dispose(), kernel.dispose()])
    expect(kernel.snapshot.state).toBe('disposed')
    expect(alive(kernel.snapshot.pid)).toBe(false)
    await expect(kernel.prompt({ turnId: randomUUID(), text: 'after dispose' })).rejects.toThrow(
      'unavailable',
    )
  })

  it('aborts an actual SDK stream, confirms stopped, then permits a new turn', async () => {
    const kernel = create()
    await kernel.ready()
    const turnId = randomUUID()
    const delta = new Promise<void>((resolve) => {
      kernel.subscribe((event) => {
        if (event.type === 'delta') {
          resolve()
        }
      })
    })
    const result = kernel.prompt({ turnId, text: 'abort fixture', fixture: 'hold' })
    await delta
    await expect(kernel.prompt({ turnId: randomUUID(), text: 'busy' })).rejects.toThrow('busy')
    await expect(kernel.abort(randomUUID())).rejects.toThrow('matching')
    await kernel.abort(turnId)
    expect(await result).toMatchObject({
      outcome: 'aborted',
      localRequests: 1,
      blockedNetworkAttempts: 0,
    })
    expect(kernel.snapshot.state).toBe('stopped')
    expect(await kernel.prompt({ turnId: randomUUID(), text: 'next turn' })).toMatchObject({
      outcome: 'completed',
      localRequests: 2,
    })
  })

  it('disposes during a streaming prompt and waits for process exit', async () => {
    const kernel = create()
    await kernel.ready()
    const delta = new Promise<void>((resolve) => {
      kernel.subscribe((event) => {
        if (event.type === 'delta') {
          resolve()
        }
      })
    })
    const result = kernel.prompt({ turnId: randomUUID(), text: 'dispose fixture', fixture: 'hold' })
    await delta
    await kernel.dispose()
    expect(await result).toMatchObject({ outcome: 'aborted' })
    expect(kernel.snapshot.state).toBe('disposed')
    expect(alive(kernel.snapshot.pid)).toBe(false)
  })

  it('keeps tools disabled even when the local model asks to write a file', async () => {
    const kernel = create()
    await kernel.ready()
    const observations: Extract<KernelMessage, { type: 'tool' }>[] = []
    kernel.subscribe((message) => {
      if (message.type === 'tool') {
        observations.push(message)
      }
    })
    const result = await kernel.prompt({
      turnId: randomUUID(),
      text: 'unknown tool fixture',
      fixture: 'unknown-tool',
    })
    expect(result).toMatchObject({ outcome: 'error', localRequests: 2, blockedNetworkAttempts: 0 })
    expect(existsSync(join(kernel.snapshot.cwd, 'MUST-NOT-EXIST'))).toBe(false)
    expect(observations.find((message) => message.status === 'running')).toMatchObject({
      toolId: 'offline-untrusted',
      name: 'write',
      origin: 'sdk',
      cwd: kernel.snapshot.cwd,
      parameters: '{"path":"MUST-NOT-EXIST","content":"denied"}',
    })
    expect(observations.find((message) => message.status === 'error')).toMatchObject({
      toolId: 'offline-untrusted',
      name: 'write',
      origin: 'sdk',
      parameters: '{"path":"MUST-NOT-EXIST","content":"denied"}',
    })
    expect(observations.every((message) => message.exitCode === undefined)).toBe(true)
    expect(
      kernel.snapshot.sessionFile && readFileSync(kernel.snapshot.sessionFile, 'utf8'),
    ).toContain('not found')
  })

  it('reports provider fixture failure without retry and retains a usable kernel', async () => {
    const kernel = create()
    await kernel.ready()
    expect(
      await kernel.prompt({ turnId: randomUUID(), text: 'failure fixture', fixture: 'error' }),
    ).toMatchObject({ outcome: 'error', localRequests: 1, blockedNetworkAttempts: 0 })
    expect(await kernel.prompt({ turnId: randomUUID(), text: 'still usable' })).toMatchObject({
      outcome: 'completed',
      localRequests: 2,
    })
  })

  it('isolates a hard crash of a real SDK process from another real SDK process', async () => {
    const broken = create()
    const healthy = create()
    await Promise.all([broken.ready(), healthy.ready()])
    const delta = new Promise<void>((resolve) => {
      broken.subscribe((event) => {
        if (event.type === 'delta') {
          resolve()
        }
      })
    })
    const run = broken.prompt({ turnId: randomUUID(), text: 'crash fixture', fixture: 'hold' })
    const rejection = run.catch((error: unknown) => error)
    await delta
    if (!broken.snapshot.pid) {
      throw new Error('Child pid missing')
    }
    process.kill(broken.snapshot.pid, 'SIGKILL')
    expect(await rejection).toBeInstanceOf(Error)
    await broken.dispose()
    expect(broken.snapshot.state).toBe('failed')
    expect(
      await healthy.prompt({ turnId: randomUUID(), text: 'surviving SDK fixture' }),
    ).toMatchObject({ outcome: 'completed', localRequests: 1 })
  })
})

describe('CORE-04 synthetic IPC fault fixtures (not SDK evidence)', () => {
  it.each([
    'bad-guard',
    'wrong-session',
    'wrong-epoch',
    'bad-cwd',
    'bad-path',
    'bad-pid',
    'bad-sequence',
    'bad-version',
    'invalid-json',
    'no-handshake',
  ])('fails closed for %s', async (mode) => {
    const kernel = create(mode, 1000)
    await expect(kernel.ready()).rejects.toThrow(/kernel/i)
    await expect(kernel.prompt({ turnId: randomUUID(), text: 'must not execute' })).rejects.toThrow(
      /kernel/i,
    )
    await kernel.dispose()
    expect(kernel.snapshot.state).toBe('failed')
    expect(alive(kernel.snapshot.pid)).toBe(false)
  })

  it.each([
    'crash',
    'disconnect',
    'stale-turn',
    'duplicate-delta',
    'gap-delta',
    'wrong-turn-delta',
    'unknown-outcome',
  ])('isolates %s from another SDK process', async (mode) => {
    const broken = create(mode)
    const healthy = create()
    await Promise.all([broken.ready(), healthy.ready()])
    expect(broken.snapshot.pid).not.toBe(healthy.snapshot.pid)
    await expect(broken.prompt({ turnId: randomUUID(), text: 'fault fixture' })).rejects.toThrow(
      /kernel/i,
    )
    expect(healthy.snapshot.state).toBe('ready')
    expect(await healthy.prompt({ turnId: randomUUID(), text: 'healthy fixture' })).toMatchObject({
      outcome: 'completed',
    })
    await broken.dispose()
    expect(alive(broken.snapshot.pid)).toBe(false)
  })

  it('rejects a prior turn terminal received after the next IPC turn starts', async () => {
    const kernel = create('late-finished')
    await kernel.ready()
    expect(
      await kernel.prompt({ turnId: randomUUID(), text: 'first synthetic turn' }),
    ).toMatchObject({ outcome: 'completed' })
    await expect(
      kernel.prompt({ turnId: randomUUID(), text: 'second synthetic turn' }),
    ).rejects.toThrow('turn binding mismatch')
    expect(kernel.snapshot.state).toBe('failed')
    await kernel.dispose()
    expect(alive(kernel.snapshot.pid)).toBe(false)
  })

  it('bounds an unresponsive abort and force-reaps only that process', async () => {
    const kernel = create('hang-abort', 1000)
    await kernel.ready()
    const turnId = randomUUID()
    const started = new Promise<void>((resolve) => {
      kernel.subscribe((event) => {
        if (event.type === 'running') {
          resolve()
        }
      })
    })
    const result = kernel.prompt({ turnId, text: 'synthetic hang' })
    const rejected = result.catch((error: unknown) => error)
    await started
    await expect(kernel.abort(turnId)).rejects.toThrow('abort timed out')
    expect(await rejected).toMatchObject({ message: 'SDK abort timed out' })
    expect(alive(kernel.snapshot.pid)).toBe(false)
  })

  it('bounds unresponsive disposal and waits for forced exit', async () => {
    const kernel = create('hang-dispose', 1000)
    await kernel.ready()
    await expect(kernel.dispose()).rejects.toThrow('disposal timed out')
    expect(kernel.snapshot.state).toBe('failed')
    expect(alive(kernel.snapshot.pid)).toBe(false)
    kernels.splice(kernels.indexOf(kernel), 1)
  })

  it('can cancel initialization without leaving a child or an unresolved ready waiter', async () => {
    const kernel = create('no-handshake')
    const readiness = kernel.ready().catch((error: unknown) => error)
    await kernel.dispose()
    expect(await readiness).toMatchObject({ message: 'Kernel disposed before readiness' })
    expect(kernel.snapshot.state).toBe('disposed')
    expect(alive(kernel.snapshot.pid)).toBe(false)
  })
})
