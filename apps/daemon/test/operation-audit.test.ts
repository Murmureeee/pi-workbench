import type { ExecutionApproval } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { accessSnapshotSchema, auditExportSchema, auditPageSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { AuditService } from '../dist/modules/security/audit.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionGrantService } from '../dist/modules/security/session-grant.service.js'
import { TrustService } from '../dist/modules/security/trust.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

const port = 24419
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Required actual audit fixture missing')
  }
  return value
}
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-audit-')),
    cwd = join(directory, 'cwd'),
    dataDir = join(directory, 'data')
  mkdirSync(cwd)
  let app = await createApp({ dataDir, port, development: true })
  return {
    directory,
    cwd,
    dataDir,
    get app() {
      return app
    },
    get audit() {
      return app.get(AuditService)
    },
    get database() {
      return app.get(WorkspaceDatabase)
    },
    run: async () => {
      const sessionId = randomUUID(),
        turnId = randomUUID(),
        run = app.get(KernelService).prompt(sessionId, cwd, {
          turnId,
          text: 'offline audit tool fixture',
          fixture: 'approval-write',
        })
      await expect
        .poll(() => app.get(ApprovalService).list(sessionId).length, { timeout: 15000 })
        .toBe(1)
      return { sessionId, run, p: required(app.get(ApprovalService).list(sessionId)[0]) }
    },
    restart: async () => {
      await app.close()
      app = await createApp({ dataDir, port, development: true })
    },
    close: async () => {
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
function command(
  p: ExecutionApproval,
  action: 'allow-session' | 'allow-once' | 'deny' = 'allow-session',
  reason = '明确验收决定',
) {
  return {
    sessionId: p.sessionId,
    epoch: p.epoch,
    turnId: p.turnId,
    digest: p.risk.digest,
    policyVersion: p.risk.policyVersion,
    action,
    reason,
    acceptIrreversible: action !== 'deny',
  }
}
function synthetic(audit: AuditService, sessionId: string | null, index: number) {
  audit.record({
    kind: 'approval',
    objectId: `synthetic-${index}`,
    sessionId,
    source: 'synthetic-fixture',
    actor: null,
    risk: 'unknown',
    decision: 'synthetic-observation',
    scope: `fixture ${index}`,
    reason: 'explicit host fixture; not execution',
  })
}

test('sEC-09 real SDK approval/grant audit binds object, risk, actor, exact scope/time; durable data and reads are redacted, originals never authorize', async () => {
  const f = await setup()
  try {
    const secret = 'sec09-private-fixture-value'
    f.app.get(SecurityService).redactor.remember(secret)
    const { sessionId, p, run } = await f.run(),
      actor = randomUUID()
    f.app
      .get(ApprovalService)
      .decide(p.id, command(p, 'allow-session', `人类决定 ${secret}`), actor)
    await run
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
    const grant = required(f.app.get(SessionGrantService).list(sessionId).grants[0])
    f.app.get(SessionGrantService).revoke(sessionId, grant.id, `撤销 ${secret}`, actor)
    const page = f.audit.page({ sessionId })
    expect(page.entries).toHaveLength(4)
    expect(page.entries.map((e) => e.decision)).toEqual([
      'revoked',
      'allowed',
      'created',
      'pending',
    ])
    const allowed = required(page.entries.find((e) => e.decision === 'allowed'))
    expect(allowed).toMatchObject({ objectId: p.id, risk: 'L2', source: 'human', actor, sessionId })
    expect(allowed.scope).toContain(p.risk.digest)
    expect(allowed.scope).toContain(f.cwd.replaceAll('\\', '\\\\'))
    expect(allowed.at).toBeGreaterThanOrEqual(p.createdAt)
    expect(JSON.stringify(page)).not.toContain(secret)
    expect(
      JSON.stringify(f.database.sqlite.prepare('SELECT data FROM operation_audit').all()),
    ).not.toContain(secret)
    const ids = page.entries.map((e) => e.id)
    await f.restart()
    expect(f.audit.page({ sessionId }).entries.map((e) => e.id)).toEqual(ids)
    expect(f.app.get(SessionGrantService).list().grants).toEqual([])
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(
      f.app
        .get(SessionStore)
        .history(sessionId)
        ?.approvals.every((a) => !a.executable),
    ).toBe(true)
  } finally {
    await f.close()
  }
})

test('sEC-09 actual SQLite audit failure rolls back allowed decision and blocks the real SDK side effect', async () => {
  const f = await setup()
  try {
    const { p, run, sessionId } = await f.run()
    f.database.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON operation_audit
      WHEN json_extract(NEW.data, '$.decision') = 'allowed' BEGIN SELECT RAISE(ABORT, 'audit fixture disk error'); END`)
    expect(() =>
      f.app.get(ApprovalService).decide(p.id, command(p, 'allow-once'), randomUUID()),
    ).toThrow('audit fixture disk error')
    await run
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(f.audit.page({ sessionId }).entries.map((e) => e.decision)).not.toContain('allowed')
    expect(
      f.app
        .get(SessionStore)
        .history(sessionId)
        ?.approvals.some((a) => a.decision === 'allowed'),
    ).toBe(false)
    expect(f.audit.page({}).warning).toContain('审计写入未完成')
    const second = await f.run()
    expect(() =>
      f.app
        .get(ApprovalService)
        .decide(second.p.id, command(second.p, 'allow-session'), randomUUID()),
    ).toThrow('audit fixture disk error')
    await second.run
    expect(f.app.get(SessionGrantService).list().grants).toEqual([])
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
  } finally {
    await f.close()
  }
})

test('sEC-09 session/client revocation remains effective when real audit inserts fail, with explicit lost-audit warnings', async () => {
  const f = await setup()
  try {
    const { p, run, sessionId } = await f.run(),
      approvals = f.app.get(ApprovalService),
      actor = randomUUID()
    approvals.decide(p.id, command(p), actor)
    await run
    const access = f.app.get(AccessService),
      ticket = access.issueTicket('browser'),
      client = required(access.redeem(ticket.code, 'audit revoke fixture'))
    let disconnected = false
    access.observe(client.cookie.split(';')[0], () => {
      disconnected = true
    })
    f.database.sqlite.exec(`CREATE TRIGGER fail_revoke_audit BEFORE INSERT ON operation_audit
      WHEN json_extract(NEW.data, '$.decision') = 'revoked' OR json_extract(NEW.data, '$.decision') = 'invalidated'
      BEGIN SELECT RAISE(ABORT, 'revoke audit fixture failure'); END`)
    f.app.get(SessionGrantService).revoke(sessionId, null, 'explicit test revoke', actor)
    expect(f.app.get(SessionGrantService).list(sessionId).grants).toEqual([])
    expect(f.app.get(SessionGrantService).list(sessionId).auditWarning).toContain('保存失败')
    expect(access.revoke(client.client.info.id, actor)).toBe(true)
    expect(disconnected).toBe(true)
    expect(access.authenticate(client.cookie.split(';')[0])).toBeUndefined()
    expect(f.audit.page({}).warning).toContain('缺失记录不会伪造补齐')
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
  } finally {
    await f.close()
  }
})

test('sEC-09 resource consent and audit share a real transaction; duplicate grants/revokes do not fabricate events', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'AGENTS.md'), 'untrusted project instruction fixture')
    const trust = f.app.get(TrustService),
      resource = required(trust.inspect(f.cwd).resources.find((r) => r.kind === 'context'))
    const input = {
      project: f.cwd,
      id: resource.id,
      fingerprint: resource.fingerprint,
      confirmed: true,
    }
    f.database.sqlite.exec(
      "CREATE TRIGGER fail_trust_audit BEFORE INSERT ON operation_audit BEGIN SELECT RAISE(ABORT, 'trust audit fixture failure'); END",
    )
    expect(() => trust.grant(input, randomUUID())).toThrow('trust audit fixture failure')
    expect(trust.inspect(f.cwd).records).toHaveLength(0)
    f.database.sqlite.exec('DROP TRIGGER fail_trust_audit')
    const actor = randomUUID(),
      record = trust.grant(input, actor)
    expect(trust.grant(input, actor).recordId).toBe(record.recordId)
    trust.revoke(record.recordId, actor)
    trust.revoke(record.recordId, actor)
    expect(f.audit.page({ kind: 'resource-trust' }).entries.map((e) => e.decision)).toEqual([
      'revoked',
      'granted',
    ])
    expect(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8')).toBe(
      'untrusted project instruction fixture',
    )
  } finally {
    await f.close()
  }
})

test('sEC-09 failed pairing never creates a client; resource revocation remains durable after audit failure', async () => {
  const f = await setup()
  try {
    const access = f.app.get(AccessService),
      ticket = access.issueTicket('browser')
    writeFileSync(join(f.cwd, 'AGENTS.md'), 'explicit resource fixture')
    const trust = f.app.get(TrustService),
      resource = required(trust.inspect(f.cwd).resources.find((r) => r.kind === 'context'))
    const record = trust.grant(
      { project: f.cwd, id: resource.id, fingerprint: resource.fingerprint, confirmed: true },
      randomUUID(),
    )
    f.database.sqlite.exec(
      "CREATE TRIGGER fail_all_audit BEFORE INSERT ON operation_audit BEGIN SELECT RAISE(ABORT, 'audit storage fixture unavailable'); END",
    )
    expect(() => access.redeem(ticket.code, 'explicit fixture')).toThrow(
      'audit storage fixture unavailable',
    )
    expect(access.list()).toEqual([])
    expect(trust.revoke(record.recordId, randomUUID())).toBe(true)
    expect(trust.inspect(f.cwd).records[0]?.revokedAt).not.toBeNull()
    expect(f.audit.page({}).warning).toContain('权限变更已生效')
    await f.restart()
    expect(f.app.get(TrustService).inspect(f.cwd).records[0]?.revokedAt).not.toBeNull()
    expect(f.app.get(AccessService).list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('sEC-09 stable bounded filtering/export excludes later appends and newly known secrets without rewriting originals', async () => {
  const f = await setup()
  try {
    const sessionId = randomUUID()
    for (let i = 0; i < 115; i++) {
      synthetic(f.audit, i % 2 ? sessionId : null, i)
    }
    const headers = await authorizedHeaders(f.app, port, 'desktop'),
      first = auditPageSchema.parse(
        (await f.app.inject({ url: `/api/audit?sessionId=${sessionId}`, headers })).json(),
      )
    expect(first.entries).toHaveLength(50)
    const cursor = required(first.nextBefore ?? undefined)
    synthetic(f.audit, sessionId, 999)
    const query = `sessionId=${sessionId}&snapshot=${first.snapshot}&before=${cursor}`,
      exported = auditExportSchema.parse(
        (await f.app.inject({ url: `/api/audit/export?${query}`, headers })).json(),
      )
    expect(exported.page.entries).toHaveLength(7)
    expect(exported.page.entries.some((e) => e.objectId === 'synthetic-999')).toBe(false)
    expect(new Set([...first.entries, ...exported.page.entries].map((e) => e.id)).size).toBe(57)
    expect(exported).toMatchObject({ redacted: true, format: 'piw-audit-v1' })
    const secret = 'newly-known-fixture-secret'
    f.audit.record({
      kind: 'client-access',
      objectId: 'redaction-fixture',
      sessionId: null,
      source: 'synthetic-fixture',
      actor: null,
      risk: 'unknown',
      decision: 'synthetic-observation',
      scope: secret,
      reason: 'not actual client pairing',
    })
    f.app.get(SecurityService).redactor.remember(secret)
    const safe = await f.app.inject({ url: '/api/audit/export?kind=client-access', headers })
    expect(safe.body).not.toContain(secret)
    expect(
      f.database.sqlite
        .prepare('SELECT data FROM operation_audit WHERE kind = ?')
        .all('client-access')
        .some((r) => JSON.stringify(r).includes(secret)),
    ).toBe(true)
  } finally {
    await f.close()
  }
})

test('sEC-09 no audit mutation routes, desktop access only, immutable SQLite rows and invalid filters fail closed', async () => {
  const f = await setup()
  try {
    const desktop = await authorizedHeaders(f.app, port, 'desktop'),
      browser = await authorizedHeaders(f.app, port)
    expect((await f.app.inject({ url: '/api/audit', headers: browser })).statusCode).toBe(403)
    expect(
      (await f.app.inject({ url: '/api/audit', headers: { host: `127.0.0.1:${port}` } }))
        .statusCode,
    ).toBe(401)
    expect(
      (await f.app.inject({ url: '/api/audit?sessionId=invalid', headers: desktop })).statusCode,
    ).toBe(400)
    expect((await f.app.inject({ url: '/api/audit?before=-1', headers: desktop })).statusCode).toBe(
      400,
    )
    const csrf = accessSnapshotSchema.parse(
      (await f.app.inject({ url: '/api/access', headers: desktop })).json(),
    ).csrf
    if (typeof csrf !== 'string') {
      throw new Error('Missing paired CSRF')
    }
    const mutations = await Promise.all(
      (['POST', 'PUT', 'DELETE'] as const).map((method) =>
        f.app.inject({
          method,
          url: '/api/audit',
          headers: { ...desktop, origin: `http://127.0.0.1:${port}`, 'x-piw-csrf': csrf },
          payload: {},
        }),
      ),
    )
    for (const response of mutations) {
      expect(response.statusCode).toBe(404)
    }
    expect(() => f.database.sqlite.exec("UPDATE operation_audit SET data='{}'")).toThrow(
      'append-only',
    )
    expect(() => f.database.sqlite.exec('DELETE FROM operation_audit')).toThrow(
      'originals are retained',
    )
    expect(f.audit.page({}).entries).toHaveLength(2)
  } finally {
    await f.close()
  }
})
