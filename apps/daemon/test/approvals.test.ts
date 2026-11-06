import type { ExecutionApproval, ExecutionApprovalCommand } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { executionDigest, executionParameters } from '@pi-workbench/agent-adapter'
import { runtimeCapabilities } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { ExecutionPolicyService } from '../dist/modules/security/execution-policy.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-approval-')),
    cwd = join(directory, 'cwd')
  mkdirSync(cwd)
  const app = await createApp({ dataDir: join(directory, 'data'), port: 24412, development: true }),
    kernels = app.get(KernelService),
    approvals = app.get(ApprovalService),
    events = app.get(EventService),
    store = app.get(SessionStore)
  return {
    directory,
    cwd,
    app,
    kernels,
    approvals,
    events,
    store,
    run: (fixture: 'approval-write' | 'approval-command' | 'guard-denied' = 'approval-write') => {
      const sessionId = randomUUID(),
        turnId = randomUUID()
      const run = kernels.prompt(sessionId, cwd, {
        turnId,
        text: 'local approval fixture',
        fixture,
      })
      return { sessionId, turnId, run }
    },
    close: async () => {
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
function command(
  p: ExecutionApproval,
  action: ExecutionApprovalCommand['action'] = 'allow-once',
): ExecutionApprovalCommand {
  return {
    sessionId: p.sessionId,
    epoch: p.epoch,
    turnId: p.turnId,
    digest: p.risk.digest,
    policyVersion: p.risk.policyVersion,
    action,
    reason: '明确测试决定',
    acceptIrreversible: action === 'allow-once',
  }
}
async function pending(f: Awaited<ReturnType<typeof setup>>): Promise<ExecutionApproval> {
  await expect.poll(() => f.approvals.list().length, { timeout: 15000 }).toBe(1)
  const p = f.approvals.list()[0]
  if (!p) {
    throw new Error('Missing live approval')
  }
  return p
}

test('sEC-02 actual SDK waits without side effects across observer disconnect; first valid desktop decision wins, history cannot reauthorize', async () => {
  const f = await setup()
  try {
    const t = f.run(),
      p = await pending(f)
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(f.kernels.resources().kernels[0]?.waitingApproval).toBe(true)
    const snap = f.events.snapshot(t.sessionId)
    if (!snap) {
      throw new Error('Missing runtime')
    }
    const off = f.events.subscribe(
      {
        type: 'subscribe',
        protocolVersion: 1,
        requiredCapabilities: [...runtimeCapabilities],
        sessionId: t.sessionId,
        epoch: snap.epoch,
        since: snap.seq,
        daemonId: snap.daemonId,
      },
      () => {},
    )
    off()
    expect(f.approvals.list()).toHaveLength(1)
    expect(Object.keys(p)).not.toContain('expiresAt')
    const base = await authorizedHeaders(f.app, 24412, 'desktop'),
      other = await authorizedHeaders(f.app, 24412, 'desktop'),
      headers = (h: typeof base) => ({
        ...h,
        origin: 'http://127.0.0.1:24412',
        'x-piw-csrf': f.app.get(AccessService).snapshot(h.cookie).csrf ?? '',
        'x-piw-protocol': '1',
        'x-piw-capabilities': runtimeCapabilities.join(','),
      })
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `/api/chat/approvals/${p.id}/decision`,
          headers: headers(base),
          payload: { ...command(p), acceptIrreversible: false },
        })
      ).statusCode,
    ).toBe(409)
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    const responses = await Promise.all(
      [base, other].map((h) =>
        f.app.inject({
          method: 'POST',
          url: `/api/chat/approvals/${p.id}/decision`,
          headers: headers(h),
          payload: command(p),
        }),
      ),
    )
    const statuses = responses.map((r) => r.statusCode)
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(statuses.filter((status) => status === 409)).toHaveLength(1)
    expect(await t.run).toMatchObject({
      outcome: 'completed',
      localRequests: 2,
      blockedNetworkAttempts: 0,
    })
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
    expect(f.store.history(t.sessionId)?.approvals).toMatchObject([
      { decision: 'allowed', executable: false },
    ])
    expect(() => f.approvals.decide(p.id, command(p), 'late-client')).toThrow('已处理或失效')
    const history = f.kernels.list()[0]?.sessionFile
    if (!history) {
      throw new Error('Missing SDK history')
    }
    const bytes = readFileSync(history)
    await f.app.close()
    const restarted = await createApp({
      dataDir: join(f.directory, 'data'),
      port: 24412,
      development: true,
    })
    try {
      expect(restarted.get(ApprovalService).list()).toEqual([])
      expect(restarted.get(KernelService).list()).toEqual([])
      expect(readFileSync(history)).toEqual(bytes)
    } finally {
      await restarted.close()
    }
  } finally {
    await f.close()
  }
})

test('sEC-02 rejection reason reaches SDK and blocks alternate forms without more approval or side effects', async () => {
  const f = await setup()
  try {
    const t = f.run('guard-denied')
    await expect.poll(() => f.approvals.list().length, { timeout: 15000 }).toBe(2)
    const p = f.approvals.list().find((item) => item.tool === 'write')
    if (!p) {
      throw new Error('Missing parallel write approval')
    }
    f.approvals.decide(
      p.id,
      { ...command(p, 'deny'), reason: '不要改换命令 api_key=fixture-decision-secret' },
      'desktop-A',
    )
    expect(await t.run).toMatchObject({ outcome: 'completed', localRequests: 2 })
    const tools = f.events.visibleSnapshot(t.sessionId)?.turns[0]?.tools
    expect(tools).toHaveLength(4)
    expect(tools?.every((x) => x.status === 'denied')).toBe(true)
    expect(tools?.find((item) => item.id === 'guard-0')?.summary).toContain('不要改换命令')
    expect(JSON.stringify(f.store.history(t.sessionId)?.approvals)).not.toContain(
      'fixture-decision-secret',
    )
    expect(f.approvals.list()).toEqual([])
    expect(existsSync(join(f.cwd, 'MUST-NOT-EXIST'))).toBe(false)
  } finally {
    await f.close()
  }
})

test.each(['cancel', 'stop', 'policy', 'child'] as const)(
  'sEC-02 %s wakes waiters and forbids stale decisions',
  async (mode) => {
    const f = await setup()
    try {
      const t = f.run(),
        runResult = t.run.catch(() => null),
        p = await pending(f)
      if (mode === 'cancel') {
        f.approvals.decide(p.id, command(p, 'cancel'), 'desktop')
      } else if (mode === 'stop') {
        await f.kernels.abort(t.sessionId, t.turnId)
      } else if (mode === 'policy') {
        f.app.get(ExecutionPolicyService).invalidate()
      } else {
        const pid = f.kernels.list().find((k) => k.sessionId === t.sessionId)?.pid
        if (!pid) {
          throw new Error('Missing actual SDK PID')
        }
        process.kill(pid, 'SIGKILL')
      }
      await runResult
      await expect.poll(() => f.approvals.list().length).toBe(0)
      expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
      expect(() => f.approvals.decide(p.id, command(p), 'late')).toThrow('已处理或失效')
      const record = f.store.history(t.sessionId)?.approvals[0]
      expect(record?.decision).toBe(mode === 'cancel' ? 'cancelled' : 'invalidated')
      await f.kernels.destroy(t.sessionId)
    } finally {
      await f.close()
    }
  },
)

test('sEC-02 malformed/stale commands preserve the current waiter; durable decision failure never permits execution', async () => {
  const f = await setup()
  try {
    const t = f.run(),
      result = t.run.catch(() => null),
      p = await pending(f)
    for (const change of [
      { digest: '0'.repeat(64) },
      { sessionId: randomUUID() },
      { epoch: randomUUID() },
      { turnId: randomUUID() },
      { policyVersion: 99 },
    ]) {
      expect(() => f.approvals.decide(p.id, { ...command(p), ...change }, 'client')).toThrow(
        '不匹配',
      )
      expect(f.approvals.list()).toHaveLength(1)
    }
    const save = vi.spyOn(f.store, 'saveApproval').mockImplementation(() => {
      throw new Error('fixture durable approval failure')
    })
    expect(() => f.approvals.decide(p.id, command(p), 'client')).toThrow('durable')
    save.mockRestore()
    await result
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(f.approvals.list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('sEC-02 shutdown invalidates pending durable records; restart has zero permits or kernels', async () => {
  const f = await setup()
  try {
    const t = f.run(),
      result = t.run.catch(() => null),
      p = await pending(f)
    await f.app.close()
    await result
    const restarted = await createApp({
      dataDir: join(f.directory, 'data'),
      port: 24412,
      development: true,
    })
    try {
      expect(restarted.get(ApprovalService).list()).toEqual([])
      expect(restarted.get(KernelService).list()).toEqual([])
      expect(restarted.get(SessionStore).history(t.sessionId)?.approvals[0]).toMatchObject({
        id: p.id,
        decision: 'invalidated',
        executable: false,
      })
      expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    } finally {
      await restarted.close()
    }
  } finally {
    await f.close()
  }
})

test('sEC-02 final path identity changes and blocked private/link/outside targets cannot be approved', async () => {
  const f = await setup()
  try {
    const t = f.run(),
      p = await pending(f)
    writeFileSync(join(f.cwd, 'APPROVED.txt'), 'external change during approval')
    f.approvals.decide(p.id, command(p), 'client')
    await t.run
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe(
      'external change during approval',
    )
    const outside = join(f.directory, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(f.cwd, 'link'), 'junction')
    const binding = {
      sessionId: randomUUID(),
      epoch: randomUUID(),
      turnId: randomUUID(),
      cwd: f.cwd,
    }
    await Promise.all(
      ['.env', '../outside/file', 'link/file'].map(async (path) => {
        const unsigned = {
          id: randomUUID(),
          callId: 'path-call',
          parentId: null,
          tool: 'write',
          parameters: executionParameters({ path, content: 'denied' }),
        }
        await expect(
          f.app
            .get(ExecutionPolicyService)
            .explicitTarget(binding, { ...unsigned, digest: executionDigest(binding, unsigned) }),
        ).rejects.toThrow(/当前不开放|不能批准|链接/)
      }),
    )
  } finally {
    await f.close()
  }
})

test('sEC-02 approval reads and decisions retain desktop pairing, Origin, CSRF, JSON and capability gates', async () => {
  const f = await setup()
  try {
    const t = f.run(),
      p = await pending(f),
      url = `/api/chat/approvals/${p.id}/decision`
    const desktop = await authorizedHeaders(f.app, 24412, 'desktop'),
      browser = await authorizedHeaders(f.app, 24412, 'browser')
    const good = {
      ...desktop,
      origin: 'http://127.0.0.1:24412',
      'x-piw-csrf': f.app.get(AccessService).snapshot(desktop.cookie).csrf ?? '',
      'x-piw-protocol': '1',
      'x-piw-capabilities': runtimeCapabilities.join(','),
    }
    expect(
      (await f.app.inject({ url: '/api/chat/approvals', headers: { host: desktop.host } }))
        .statusCode,
    ).toBe(401)
    expect((await f.app.inject({ url: '/api/chat/approvals', headers: browser })).statusCode).toBe(
      403,
    )
    const denied = await Promise.all([
      f.app.inject({
        method: 'POST',
        url,
        headers: { ...good, 'x-piw-csrf': 'wrong' },
        payload: command(p),
      }),
      f.app.inject({
        method: 'POST',
        url,
        headers: { ...good, origin: 'https://other.invalid' },
        payload: command(p),
      }),
      f.app.inject({
        method: 'POST',
        url,
        headers: { ...good, 'x-piw-capabilities': 'tool-risk-v1' },
        payload: command(p),
      }),
      f.app.inject({
        method: 'POST',
        url,
        headers: { ...good, 'content-type': 'text/plain' },
        payload: JSON.stringify(command(p)),
      }),
    ])
    expect(denied.map((r) => r.statusCode)).toEqual([403, 403, 409, 415])
    expect(f.approvals.list()).toHaveLength(1)
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    f.approvals.decide(p.id, command(p, 'cancel'), 'desktop')
    await t.run
  } finally {
    await f.close()
  }
})

test('sEC-02 policy invalidation during the final asynchronous path recheck cannot release an already allowed call', async () => {
  const f = await setup()
  try {
    const policy = f.app.get(ExecutionPolicyService),
      original = policy.explicitTarget.bind(policy)
    let checks = 0
    vi.spyOn(policy, 'explicitTarget').mockImplementation(async (binding, request) => {
      const token = await original(binding, request)
      if (++checks === 2) {
        policy.invalidate()
      }
      return token
    })
    const t = f.run(),
      p = await pending(f)
    f.approvals.decide(p.id, command(p), 'desktop')
    await t.run
    expect(checks).toBe(2)
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(f.events.snapshot(t.sessionId)?.turns[0]?.tools[0]).toMatchObject({ status: 'denied' })
  } finally {
    await f.close()
  }
})
