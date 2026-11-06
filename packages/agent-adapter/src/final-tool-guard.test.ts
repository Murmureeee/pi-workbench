import type { ExecutionDecision, ExecutionRequest } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { executionDigest, executionParameters, FinalToolGuard } from '../dist/final-tool-guard.js'
import { SessionKernel } from '../dist/kernel.js'

const identity = () => ({
  sessionId: randomUUID(),
  epoch: randomUUID(),
  turnId: randomUUID(),
  cwd: 'host-owned-test-cwd',
})
const permit = (request: ExecutionRequest): ExecutionDecision => ({
  id: request.id,
  digest: request.digest,
  allowed: true,
  reason: 'explicit test decision',
  risk: {
    level: 'L2',
    reasons: ['test-only explicit decision'],
    policyVersion: 1,
    digest: request.digest,
    automatic: false,
  },
})

test('sEC-01 actual SDK abort wakes final guard waiters and late host permits cannot execute in the next turn', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-guard-cancel-')),
    cwd = join(directory, 'cwd'),
    binding = identity()
  mkdirSync(cwd)
  const requests: Array<{
    request: ExecutionRequest
    resolve: (decision: ExecutionDecision) => void
    signal: AbortSignal
  }> = []
  const kernel = new SessionKernel({
    protocol: 1,
    ...binding,
    cwd,
    runtimeDir: join(directory, 'runtime'),
    authorize: (request, signal) =>
      new Promise((resolve) => {
        requests.push({ request, resolve, signal })
      }),
  })
  const stages: string[] = []
  kernel.subscribe((message) => {
    if (message.type === 'stage') {
      stages.push(message.stage)
    }
  })
  try {
    await kernel.ready()
    const running = kernel.prompt({
      turnId: binding.turnId,
      text: 'cancel pending write',
      fixture: 'guard-denied',
    })
    await expect.poll(() => requests.length).toBeGreaterThan(0)
    expect(stages).toContain('preparing-tools')
    expect(stages).not.toContain('executing-tools')
    expect(existsSync(join(cwd, 'MUST-NOT-EXIST'))).toBe(false)
    await kernel.abort(binding.turnId)
    const stopped = await running
    // MODEL-03's awaited request boundary blocks the cancelled tool continuation before
    // transport. The installed SDK now commits an aborted assistant; retain that outcome.
    expect(stopped).toMatchObject({
      outcome: 'aborted',
      error: 'Model request cancelled',
      localRequests: 1,
    })
    expect(requests.every((r) => r.signal.aborted)).toBe(true)
    requests.forEach((r) => r.resolve(permit(r.request)))
    expect(
      await kernel.prompt({ turnId: randomUUID(), text: 'next explicit turn', fixture: 'reply' }),
    ).toMatchObject({ outcome: 'completed' })
    expect(existsSync(join(cwd, 'MUST-NOT-EXIST'))).toBe(false)
  } finally {
    await kernel.dispose()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('sEC-01 final frozen snapshot survives caller mutation while waiting; rewritten calls receive new decisions', async () => {
  const binding = identity(),
    requests: ExecutionRequest[] = []
  let decide: ((value: ExecutionDecision) => void) | undefined
  const guard = new FinalToolGuard(
    () => binding,
    (request) => {
      requests.push(request)
      return new Promise((resolve) => {
        decide = resolve
      })
    },
  )
  const params = { path: 'before.txt', content: 'original', nested: { value: 1 } }
  const operation = guard.execute('one', 'write', params, undefined, async (snapshot) => {
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.nested)).toBe(true)
    return snapshot
  })
  params.path = 'after.txt'
  params.nested.value = 9
  expect(requests[0]?.parameters).toBe(
    '{"content":"original","nested":{"value":1},"path":"before.txt"}',
  )
  const first = requests[0]
  if (!first) {
    throw new Error('Missing final request')
  }
  decide?.(permit(first))
  await expect(operation).resolves.toEqual({
    path: 'before.txt',
    content: 'original',
    nested: { value: 1 },
  })
  const rewritten = guard.execute(
    'two',
    'write',
    params,
    undefined,
    async (snapshot) => snapshot.path,
  )
  expect(requests).toHaveLength(2)
  expect(requests[1]?.digest).not.toBe(requests[0]?.digest)
  const second = requests[1]
  if (!second) {
    throw new Error('Missing rewritten request')
  }
  decide?.({ ...permit(second), allowed: false, reason: 'rewritten input denied' })
  await expect(rewritten).rejects.toThrow('rewritten input denied')
})

test('sEC-01 nested calls never inherit permission; final digest binds parent, generation and complete input', async () => {
  const binding = identity(),
    requests: ExecutionRequest[] = []
  const guard = new FinalToolGuard(
    () => binding,
    async (request) => {
      requests.push(request)
      return { ...permit(request), allowed: request.callId === 'parent', reason: 'child denied' }
    },
  )
  guard.observe('child', 'parent')
  await expect(
    guard.execute('parent', 'composite', {}, undefined, async () => {
      return guard.execute(
        'child',
        'bash',
        { command: 'echo child' },
        undefined,
        async () => 'must not run',
      )
    }),
  ).rejects.toThrow('child denied')
  expect(requests.map((r) => r.parentId)).toEqual([null, 'parent'])
  const request = requests[1]
  if (!request) {
    throw new Error('Missing nested request')
  }
  for (const changed of [
    { ...request, parentId: null },
    { ...request, tool: 'read' },
    { ...request, parameters: '{}' },
    { ...request, callId: 'other' },
  ]) {
    expect(executionDigest(binding, changed)).not.toBe(request.digest)
  }
  expect(executionDigest({ ...binding, epoch: randomUUID() }, request)).not.toBe(request.digest)
  expect(executionDigest({ ...binding, cwd: 'other-directory' }, request)).not.toBe(request.digest)
})

test('sEC-01 cancellation, duplicate calls, transport loss, stale identity and mismatched permits fail closed', async () => {
  await Promise.all(
    ['cancel', 'stale', 'id', 'digest', 'risk', 'transport'].map(async (mode) => {
      const binding = identity(),
        controller = new AbortController()
      let effects = 0
      const guard = new FinalToolGuard(
        () => binding,
        async (request) => {
          const decision = permit(request)
          if (mode === 'cancel') {
            controller.abort()
          }
          if (mode === 'stale') {
            binding.turnId = randomUUID()
          }
          if (mode === 'id') {
            decision.id = randomUUID()
          }
          if (mode === 'digest') {
            decision.digest = '0'.repeat(64)
          }
          if (mode === 'risk') {
            decision.risk.digest = '0'.repeat(64)
          }
          if (mode === 'transport') {
            throw new Error('IPC lost')
          }
          return decision
        },
      )
      await expect(
        guard.execute('one', 'write', {}, controller.signal, async () => ++effects),
      ).rejects.toThrow(/invalid|IPC/)
      await expect(
        guard.execute('one', 'write', {}, undefined, async () => ++effects),
      ).rejects.toThrow('consumed')
      expect(effects).toBe(0)
    }),
  )
})

test('sEC-01 executable/non-JSON or excessive parameters cannot reach the host or executor', async () => {
  let getter = 0,
    calls = 0
  const accessor = {
    get path() {
      getter++
      return 'secret'
    },
  }
  const guard = new FinalToolGuard(identity, async (request) => {
    calls++
    return permit(request)
  })
  const arrayAccessor: unknown[] = []
  Object.defineProperty(arrayAccessor, '0', {
    enumerable: true,
    get() {
      getter++
      return 'no'
    },
  })
  await Promise.all(
    [
      accessor,
      arrayAccessor,
      { content: undefined },
      { path: new Date() },
      { content: 'x'.repeat(65537) },
    ].map(async (value) => {
      await expect(
        guard.execute(randomUUID(), 'write', value, undefined, async () => 'never'),
      ).rejects.toThrow(/rejected|JSON|budget/)
    }),
  )
  expect(getter).toBe(0)
  expect(calls).toBe(0)
  expect(() => executionParameters({ value: Number.NaN })).toThrow('plain JSON')
})
