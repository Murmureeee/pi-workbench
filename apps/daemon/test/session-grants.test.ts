import type { ExecutionApproval, ExecutionApprovalCommand } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'
import { z } from 'zod'

import { executionDigest, executionParameters } from '@pi-workbench/agent-adapter'
import { runtimeCapabilities } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { ExecutionPolicyService } from '../dist/modules/security/execution-policy.service.js'
import { SessionGrantService } from '../dist/modules/security/session-grant.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

const port = 24413
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Required live fixture object missing')
  }
  return value
}
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-grants-')),
    cwd = join(directory, 'cwd')
  mkdirSync(cwd)
  const app = await createApp({ dataDir: join(directory, 'data'), port, development: true }),
    kernels = app.get(KernelService),
    approvals = app.get(ApprovalService),
    grants = app.get(SessionGrantService),
    policy = app.get(ExecutionPolicyService),
    store = app.get(SessionStore),
    events = app.get(EventService)
  return {
    directory,
    cwd,
    app,
    kernels,
    approvals,
    grants,
    policy,
    store,
    events,
    run: (
      sessionId = randomUUID(),
      fixture:
        | 'approval-write'
        | 'approval-command'
        | 'approval-running'
        | 'guard-denied' = 'approval-write',
    ) => {
      const turnId = randomUUID(),
        run = kernels.prompt(sessionId, cwd, {
          turnId,
          text: 'offline session grant fixture',
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
function decision(
  p: ExecutionApproval,
  action: ExecutionApprovalCommand['action'] = 'allow-session',
): ExecutionApprovalCommand {
  return {
    sessionId: p.sessionId,
    epoch: p.epoch,
    turnId: p.turnId,
    digest: p.risk.digest,
    policyVersion: p.risk.policyVersion,
    action,
    reason: 'explicit local fixture decision',
    acceptIrreversible: ['allow-session', 'use-grant', 'allow-once'].includes(action),
    ...(action === 'use-grant' && p.sessionPermission.matchingGrantId
      ? { grantId: p.sessionPermission.matchingGrantId }
      : {}),
  }
}
async function pending(f: Awaited<ReturnType<typeof setup>>) {
  await expect.poll(() => f.approvals.list().length, { timeout: 15000 }).toBe(1)
  return required(f.approvals.list()[0])
}
test('sEC-03 real SDK session permission is explicit, exact and reused only with this invocation irreversible consent', async () => {
  const f = await setup()
  try {
    const first = f.run(),
      p = await pending(f)
    expect(f.grants.list().grants).toEqual([])
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(() =>
      f.approvals.decide(p.id, { ...decision(p), acceptIrreversible: false }, 'desktop-a'),
    ).toThrow('无回滚基线')
    expect(f.grants.list().grants).toHaveLength(0)
    f.approvals.decide(p.id, decision(p), 'desktop-a')
    await first.run
    const grant = required(f.grants.list(first.sessionId).grants[0])
    expect(grant).toMatchObject({
      sessionId: first.sessionId,
      tool: 'write',
      targetPath: join(f.cwd, 'APPROVED.txt'),
      actor: 'desktop-a',
    })
    writeFileSync(join(f.cwd, 'APPROVED.txt'), 'sentinel before second explicit consent')
    const second = f.run(first.sessionId),
      next = await pending(f)
    expect(next.sessionPermission.matchingGrantId).toBe(grant.id)
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toContain('sentinel')
    expect(() =>
      f.approvals.decide(
        next.id,
        { ...decision(next, 'use-grant'), acceptIrreversible: false },
        'desktop-b',
      ),
    ).toThrow('无回滚基线')
    f.approvals.decide(next.id, decision(next, 'use-grant'), 'desktop-b')
    await second.run
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
    expect(f.grants.list().grants).toHaveLength(1)
    expect(
      f.store
        .history(first.sessionId)
        ?.approvals.filter((a) => a.parameters.kind === 'session-grant'),
    ).toMatchObject([{ executable: false, parameters: { event: 'created' } }])
  } finally {
    await f.close()
  }
})
test('sEC-03 session, tool, canonical parameter, exact target and physical directory changes never match a grant', async () => {
  const f = await setup()
  try {
    const first = f.run(),
      p = await pending(f)
    f.approvals.decide(p.id, decision(p), 'desktop')
    await first.run
    const binding = { sessionId: first.sessionId, epoch: p.epoch, turnId: randomUUID(), cwd: f.cwd }
    const scope = async (tool: string, parameters: unknown) => {
      const unsigned = {
        id: randomUUID(),
        callId: randomUUID(),
        parentId: null,
        tool,
        parameters: executionParameters(parameters),
      }
      return f.policy.sessionScope(binding, {
        ...unsigned,
        digest: executionDigest(binding, unsigned),
      })
    }
    const args = z.object({ path: z.string(), content: z.string() }).parse(JSON.parse(p.parameters))
    const same = await scope('write', args)
    expect(f.grants.find(first.sessionId, same, f.policy.policyVersion)).toBeTruthy()
    expect(f.grants.find(randomUUID(), same, f.policy.policyVersion)).toBeNull()
    await Promise.all(
      (
        [
          ['edit', args],
          ['write', { ...args, content: 'different' }],
          ['write', { ...args, path: 'APPROVED.txt.extra' }],
          ['write', { ...args, path: '../outside.txt' }],
        ] as const
      ).map(async ([tool, parameters]) => {
        expect(
          f.grants.find(first.sessionId, await scope(tool, parameters), f.policy.policyVersion),
        ).toBeNull()
      }),
    )
    // No SDK cwd is moved: dispose before exercising real physical directory replacement.
    await f.kernels.destroy(first.sessionId)
    renameSync(f.cwd, join(f.directory, 'original-cwd'))
    mkdirSync(f.cwd)
    expect(
      f.grants.find(first.sessionId, await scope('write', args), f.policy.policyVersion),
    ).toBeNull()
  } finally {
    await f.close()
  }
})
test('sEC-03 L3 and nested calls cannot create a session permission even with a forged eligible display field', async () => {
  const f = await setup()
  try {
    const turn = f.run(undefined, 'guard-denied')
    await expect
      .poll(() => f.approvals.list().some((p) => p.risk.level === 'L3'), { timeout: 15000 })
      .toBe(true)
    const high = required(f.approvals.list().find((p) => p.risk.level === 'L3'))
    expect(high.sessionPermission.eligible).toBe(false)
    expect(() => f.approvals.decide(high.id, decision(high), 'desktop')).toThrow('单次')
    expect(f.grants.list().grants).toHaveLength(0)
    f.approvals.decide(high.id, decision(high, 'deny'), 'desktop')
    await turn.run
    expect(existsSync(join(f.cwd, 'MUST-NOT-EXIST'))).toBe(false)
    const next = f.run(),
      p = await pending(f),
      binding = { sessionId: p.sessionId, epoch: p.epoch, turnId: p.turnId, cwd: p.cwd }
    const request = {
        id: p.id,
        callId: p.callId,
        parentId: 'parent-call',
        tool: p.tool,
        parameters: p.parameters,
        digest: p.risk.digest,
      },
      scope = await f.policy.sessionScope(binding, request)
    expect(() =>
      f.grants.create(
        {
          ...p,
          parentId: 'parent-call',
          sessionPermission: { ...p.sessionPermission, eligible: true },
        },
        scope,
        'desktop',
      ),
    ).toThrow('单次')
    f.approvals.decide(p.id, decision(p, 'cancel'), 'desktop')
    await next.run
  } finally {
    await f.close()
  }
})
test('sEC-03 individual/all revoke rejects stale reuse; revocation during final asynchronous preflight prevents the already-decided execution', async () => {
  const f = await setup()
  try {
    const first = f.run(),
      p = await pending(f)
    f.approvals.decide(p.id, decision(p), 'desktop')
    await first.run
    const grant = required(f.grants.list().grants[0])
    writeFileSync(join(f.cwd, 'APPROVED.txt'), 'keep after late revoke')
    const second = f.run(first.sessionId),
      next = await pending(f),
      original = f.policy.sessionScope.bind(f.policy)
    let checks = 0
    // Initial scope already captured: this hook runs in the final IO stage after deciding.
    vi.spyOn(f.policy, 'sessionScope').mockImplementation(async (...args) => {
      const value = await original(...args)
      checks++
      f.grants.revoke(first.sessionId, grant.id, 'late explicit revoke', 'desktop-b')
      return value
    })
    f.approvals.decide(next.id, decision(next, 'use-grant'), 'desktop')
    await second.run
    expect(checks).toBe(1)
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('keep after late revoke')
    expect(f.events.snapshot(first.sessionId)?.turns.at(-1)?.tools[0]?.status).toBe('denied')
    vi.restoreAllMocks()
    const third = f.run(first.sessionId),
      last = await pending(f)
    expect(last.sessionPermission.matchingGrantId).toBeNull()
    expect(() =>
      f.approvals.decide(last.id, { ...decision(last, 'use-grant'), grantId: grant.id }, 'desktop'),
    ).toThrow('已撤销')
    f.approvals.decide(last.id, decision(last), 'desktop')
    await third.run
    const fourth = f.run(undefined, 'approval-command'),
      other = await pending(f)
    f.approvals.decide(other.id, decision(other), 'desktop')
    await fourth.run
    expect(f.grants.list().grants).toHaveLength(2)
    f.grants.revoke(first.sessionId, null, 'all in one session', 'desktop')
    expect(f.grants.list().grants).toHaveLength(1)
    expect(f.grants.list(fourth.sessionId).grants).toHaveLength(1)
  } finally {
    await f.close()
  }
})
test('sEC-03 audit failure never installs a grant; revoke remains effective even if saving its audit fails', async () => {
  const f = await setup()
  try {
    const first = f.run(),
      p = await pending(f)
    const failing = vi.spyOn(f.store, 'saveApproval').mockImplementationOnce(() => {
      throw new Error('fixture grant persistence failure')
    })
    expect(() => f.approvals.decide(p.id, decision(p), 'desktop')).toThrow('persistence')
    expect(f.grants.list().grants).toHaveLength(0)
    expect(f.approvals.list()).toHaveLength(1)
    failing.mockRestore()
    f.approvals.decide(p.id, decision(p), 'desktop')
    await first.run
    const grant = required(f.grants.list().grants[0])
    vi.spyOn(f.store, 'saveApproval').mockImplementationOnce(() => {
      throw new Error('fixture revoke persistence failure')
    })
    f.grants.revoke(first.sessionId, grant.id, 'explicit revoke', 'desktop')
    expect(f.grants.list().grants).toEqual([])
    expect(f.grants.list().auditWarning).toContain('授权已撤销')
  } finally {
    vi.restoreAllMocks()
    await f.close()
  }
})
test('sEC-03 revoke does not claim to stop a command already executing; separate SDK stop settles the actual command', async () => {
  const f = await setup()
  try {
    const turn = f.run(undefined, 'approval-running'),
      p = await pending(f)
    f.approvals.decide(p.id, decision(p), 'desktop')
    await expect.poll(() => f.kernels.resources().kernels[0]?.waitingApproval).toBe(false)
    await expect
      .poll(() => f.events.snapshot(turn.sessionId)?.turns.at(-1)?.stage)
      .toBe('executing-tools')
    const pid = f.kernels.list()[0]?.pid
    f.grants.revoke(turn.sessionId, null, 'explicit revoke', 'desktop')
    expect(f.kernels.list()[0]?.pid).toBe(pid)
    expect(f.events.snapshot(turn.sessionId)?.turns.at(-1)?.phase).toBe('running')
    await f.kernels.abort(turn.sessionId, turn.turnId)
    const result = await turn.run
    expect(result.outcome).toBe('error')
    expect(result.error).toContain('aborted')
    expect(f.events.snapshot(turn.sessionId)?.turns.at(-1)?.phase).toBe('error')
    expect(f.grants.list().grants).toHaveLength(0)
  } finally {
    await f.close()
  }
})
test('sEC-03 policy invalidation and same-data daemon restart preserve audit but restore zero live grants or model tasks', async () => {
  const f = await setup()
  try {
    const first = f.run(),
      p = await pending(f)
    f.approvals.decide(p.id, decision(p), 'desktop')
    await first.run
    f.policy.invalidate()
    expect(f.grants.list().grants).toHaveLength(0)
    const next = f.run(first.sessionId),
      q = await pending(f)
    f.approvals.decide(q.id, decision(q), 'desktop')
    await next.run
    const file = required(f.kernels.list()[0]?.sessionFile),
      bytes = readFileSync(file)
    await f.app.close()
    const restarted = await createApp({
      dataDir: join(f.directory, 'data'),
      port,
      development: true,
    })
    try {
      expect(restarted.get(SessionGrantService).list().grants).toEqual([])
      expect(restarted.get(KernelService).list()).toEqual([])
      expect(
        restarted
          .get(SessionStore)
          .history(first.sessionId)
          ?.approvals.filter((a) => a.parameters.kind === 'session-grant')
          .every((a) => !a.executable),
      ).toBe(true)
      expect(readFileSync(file)).toEqual(bytes)
    } finally {
      await restarted.close()
    }
  } finally {
    await f.close()
  }
})
test('sEC-03 grants list/revoke retain desktop, CSRF, origin, protocol and immutable-scope gates', async () => {
  const f = await setup()
  try {
    const first = f.run(),
      p = await pending(f)
    f.approvals.decide(p.id, decision(p), 'desktop')
    await first.run
    const desktop = await authorizedHeaders(f.app, port, 'desktop'),
      browser = await authorizedHeaders(f.app, port, 'browser'),
      headers = {
        ...desktop,
        origin: `http://127.0.0.1:${port}`,
        'x-piw-csrf': f.app.get(AccessService).snapshot(desktop.cookie).csrf ?? '',
        'x-piw-protocol': '1',
        'x-piw-capabilities': runtimeCapabilities.join(','),
      },
      payload = { sessionId: first.sessionId, grantId: null }
    expect((await f.app.inject({ url: '/api/chat/grants', headers: browser })).statusCode).toBe(403)
    expect(
      (await f.app.inject({ url: '/api/chat/grants?sessionId=bad', headers: desktop })).statusCode,
    ).toBe(400)
    await Promise.all(
      [
        { ...headers, 'x-piw-csrf': 'wrong' },
        { ...headers, origin: 'https://other.invalid' },
        { ...headers, 'x-piw-capabilities': 'execution-approval-v1' },
      ].map(async (invalid) => {
        expect(
          (
            await f.app.inject({
              method: 'POST',
              url: '/api/chat/grants/revoke',
              headers: invalid,
              payload,
            })
          ).statusCode,
        ).toBe(invalid['x-piw-capabilities'] === 'execution-approval-v1' ? 409 : 403)
      }),
    )
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/chat/grants/revoke',
          headers,
          payload: { ...payload, path: '*' },
        })
      ).statusCode,
    ).toBe(400)
    expect(f.grants.list().grants).toHaveLength(1)
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/chat/grants/revoke', headers, payload }))
        .statusCode,
    ).toBe(200)
    expect(f.grants.list().grants).toHaveLength(0)
  } finally {
    await f.close()
  }
})
