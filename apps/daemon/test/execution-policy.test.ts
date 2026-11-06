import type { ExecutionRequest } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { executionDigest, executionParameters } from '@pi-workbench/agent-adapter'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ExecutionPolicyService } from '../dist/modules/security/execution-policy.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { denyFixtureApprovals } from './helpers/decisions.js'

const directories: string[] = []
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-policy-'))
  directories.push(directory)
  const cwd = join(directory, 'workspace')
  mkdirSync(cwd)
  return {
    directory,
    binding: {
      sessionId: randomUUID(),
      epoch: randomUUID(),
      turnId: randomUUID(),
      cwd: realpathSync(cwd),
    },
  }
}
function request(
  binding: { sessionId: string; epoch: string; turnId: string; cwd: string },
  tool: string,
  parameters: unknown,
): ExecutionRequest {
  const unsigned = {
    id: randomUUID(),
    callId: randomUUID(),
    parentId: null,
    tool,
    parameters: executionParameters(parameters),
  }
  return { ...unsigned, digest: executionDigest(binding, unsigned) }
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('sEC-01 only bounded physical text reads are automatic; exact host snapshot remains immutable after file changes', async () => {
  const { binding } = setup(),
    policy = new ExecutionPolicyService(),
    file = join(binding.cwd, '中文.txt')
  writeFileSync(file, '一\n二\n三\n四')
  const decision = await policy.decide(
    binding,
    request(binding, 'read', { path: '中文.txt', offset: 2, limit: 2 }),
  )
  expect(decision).toMatchObject({
    allowed: true,
    risk: { level: 'L0', automatic: true, policyVersion: 1 },
  })
  expect(decision.readText).toBe('二\n三\n[受限读取已截断；可明确指定 offset 和 limit 继续读取。]')
  writeFileSync(file, 'changed after decision')
  expect(decision.readText).toContain('二\n三')
  await Promise.all(
    [
      { path: '中文.txt', offset: 0 },
      { path: '中文.txt', offset: 100 },
      { path: '中文.txt', limit: 2001 },
      { path: '中文.txt', readOnly: true },
    ].map(async (parameters) => {
      expect(await policy.decide(binding, request(binding, 'read', parameters))).toMatchObject({
        allowed: false,
        risk: { level: 'L1' },
      })
    }),
  )
})

test('sEC-01 read rejects links, hardlinks, large/binary/invalid text, directories and missing files without side effects', async () => {
  const { binding, directory } = setup(),
    policy = new ExecutionPolicyService()
  writeFileSync(join(binding.cwd, 'original.txt'), 'original')
  linkSync(join(binding.cwd, 'original.txt'), join(binding.cwd, 'hard.txt'))
  const external = join(directory, 'external')
  mkdirSync(external)
  writeFileSync(join(external, 'linked.txt'), 'external secret')
  symlinkSync(external, join(binding.cwd, 'junction'), 'junction')
  writeFileSync(join(binding.cwd, 'large.txt'), 'x'.repeat(262145))
  writeFileSync(join(binding.cwd, 'binary.txt'), Buffer.from([1, 0, 2]))
  writeFileSync(join(binding.cwd, 'invalid.txt'), Buffer.from([0xff, 0xfe]))
  await Promise.all(
    [
      'original.txt',
      'hard.txt',
      'junction/linked.txt',
      'large.txt',
      'binary.txt',
      'invalid.txt',
      'junction',
      'missing.txt',
    ].map(async (path) => {
      const result = await policy.decide(binding, request(binding, 'read', { path }))
      expect(result.allowed).toBe(false)
      expect(result.readText).toBeUndefined()
    }),
  )
  expect(readFileSync(join(external, 'linked.txt'), 'utf8')).toBe('external secret')
})

test('sEC-01 highest risk wins for paths, shell composition, credentials, network and unknown readonly hints', async () => {
  const { binding, directory } = setup(),
    policy = new ExecutionPolicyService()
  await Promise.all(
    (
      [
        ['write', { path: 'output.txt', content: 'no' }, 'L2'],
        ['edit', { path: 'output.txt', oldText: 'old', newText: 'new' }, 'L2'],
        ['bash', { command: 'pwd' }, 'L2'],
        ['powershell', { command: 'Get-Content readme.txt' }, 'L2'],
        ['powershell', { command: 'Get-Content readme.txt; Set-Content marker.txt denied' }, 'L3'],
        ['bash', { command: 'echo $(curl https://invalid.example)' }, 'L3'],
        ['read', { path: '.env' }, 'L3'],
        ['read', { path: 'sub/auth.json' }, 'L3'],
        ['read', { path: '../outside.txt' }, 'L3'],
        ['read', { path: join(directory, 'workspace-sibling', 'text.txt') }, 'L3'],
        ['read', { path: 'readme.txt:stream' }, 'L3'],
        ['mcp_readonly', { readOnly: true, path: 'readme.txt' }, 'L3'],
      ] as const
    ).map(async ([tool, parameters, level]) => {
      const result = await policy.decide(binding, request(binding, tool, parameters))
      expect(result).toMatchObject({ allowed: false, risk: { level, automatic: false } })
      expect(result.readText).toBeUndefined()
    }),
  )
  expect(existsSync(join(binding.cwd, 'output.txt'))).toBe(false)
  expect(existsSync(join(binding.cwd, 'marker.txt'))).toBe(false)
})

test('sEC-01 invalid digest, canonical input, cancelled identity and changed policy never yield a permit', async () => {
  const { binding } = setup(),
    policy = new ExecutionPolicyService()
  writeFileSync(join(binding.cwd, 'readme.txt'), 'safe')
  const r = request(binding, 'read', { path: 'readme.txt' })
  await expect(policy.decide(binding, { ...r, digest: '0'.repeat(64) })).rejects.toThrow('digest')
  const noncanonical = { ...r, parameters: '{ "path": "readme.txt" }' }
  noncanonical.digest = executionDigest(binding, noncanonical)
  await expect(policy.decide(binding, noncanonical)).rejects.toThrow('canonical')
  expect(await policy.decide(binding, r, () => false)).toMatchObject({
    allowed: false,
    risk: { level: 'L3' },
  })
  const pending = policy.decide(binding, request(binding, 'read', { path: 'readme.txt' }))
  policy.invalidate()
  expect(await pending).toMatchObject({ allowed: false, risk: { level: 'L3', policyVersion: 1 } })
  expect(
    await policy.decide(binding, request(binding, 'read', { path: 'readme.txt' })),
  ).toMatchObject({ allowed: true, risk: { policyVersion: 2 } })
})

test('sEC-01 real SDK/IPC reads the host snapshot and denies four dangerous final calls; restart preserves evidence without execution', async () => {
  const { binding, directory } = setup()
  writeFileSync(join(binding.cwd, 'readme.txt'), '真实中文受限读取\nSDK_HOST_SNAPSHOT')
  writeFileSync(join(binding.cwd, '.env'), 'DO_NOT_READ_PRIVATE')
  writeFileSync(join(directory, 'outside.txt'), 'DO_NOT_READ_OUTSIDE')
  let app = await createApp({ dataDir: join(directory, 'data'), port: 24401, development: true })
  try {
    const kernels = app.get(KernelService),
      events = app.get(EventService)
    denyFixtureApprovals(app)
    const read = await kernels.prompt(binding.sessionId, binding.cwd, {
      turnId: binding.turnId,
      text: '受限读取',
      fixture: 'guard-read',
    })
    expect(read).toMatchObject({
      outcome: 'completed',
      localRequests: 2,
      blockedNetworkAttempts: 0,
    })
    const readTool = events.snapshot(binding.sessionId)?.turns[0]?.tools[0]
    expect(readTool).toMatchObject({
      name: 'read',
      status: 'completed',
      risk: { level: 'L0', automatic: true },
    })
    expect(readTool?.summary).toContain('SDK_HOST_SNAPSHOT')
    const turnId = randomUUID()
    const denied = await kernels.prompt(binding.sessionId, binding.cwd, {
      turnId,
      text: '拒绝危险调用',
      fixture: 'guard-denied',
    })
    // Provider stats are cumulative across this actual SDK process: two per explicit turn.
    expect(denied).toMatchObject({
      outcome: 'completed',
      localRequests: 4,
      blockedNetworkAttempts: 0,
    })
    const tools = events.snapshot(binding.sessionId)?.turns.at(-1)?.tools
    expect(tools).toHaveLength(4)
    expect(Object.fromEntries(tools?.map((t) => [t.id, [t.status, t.risk?.level]]) ?? [])).toEqual({
      'guard-0': ['denied', 'L2'],
      'guard-1': ['denied', 'L3'],
      'guard-2': ['denied', 'L3'],
      'guard-3': ['denied', 'L3'],
    })
    expect(new Set(tools?.map((t) => t.risk?.digest)).size).toBe(4)
    expect(existsSync(join(binding.cwd, 'MUST-NOT-EXIST'))).toBe(false)
    const file = kernels.list()[0]?.sessionFile
    if (!file) {
      throw new Error('Missing actual SDK history')
    }
    const before = readFileSync(file)
    expect(before.toString()).toContain('SDK_HOST_SNAPSHOT')
    expect(before.toString()).not.toContain('DO_NOT_READ_PRIVATE')
    expect(before.toString()).not.toContain('DO_NOT_READ_OUTSIDE')
    await app.close()
    app = await createApp({ dataDir: join(directory, 'data'), port: 24401, development: true })
    expect(app.get(KernelService).list()).toEqual([])
    expect(
      app
        .get(SessionStore)
        .history(binding.sessionId)
        ?.toolTimelines?.flatMap((t) => t.tools)
        .filter((t) => t.risk),
    ).toHaveLength(5)
    expect(readFileSync(file)).toEqual(before)
  } finally {
    await app.close()
  }
})
