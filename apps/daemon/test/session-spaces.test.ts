import type { SessionSubmit } from '@pi-workbench/shared'

import assert from 'node:assert/strict'
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

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accessSnapshotSchema,
  runtimeCapabilities,
  sessionSearchQuerySchema,
  sessionSpaceSchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SearchService } from '../dist/modules/search/search.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { TrustService } from '../dist/modules/security/trust.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { ProjectService } from '../dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'

const directories: string[] = [],
  apps: Awaited<ReturnType<typeof createApp>>[] = [],
  port = 24428
const budget = readFileSync('docs/validation/live-validation-budget.json')
const command = (
  projectId: string | null = null,
  workspaceId: string | null = null,
): SessionSubmit => ({
  requestId: randomUUID(),
  sessionId: null,
  text: '无项目独立空间验证',
  retryOf: null,
  configuration: {
    projectId,
    workspaceId,
    model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
    thinking: 'off',
  },
})
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-session-spaces-'))) {
  directories.push(directory)
  const pi = join(directory, 'pi'),
    projectPath = join(directory, 'project')
  mkdirSync(pi, { recursive: true })
  mkdirSync(projectPath, { recursive: true })
  const app = await createApp({
    dataDir: join(directory, 'data'),
    piAgentDir: pi,
    port,
    development: true,
  })
  apps.push(app)
  const service = app.get(SessionService),
    store = app.get(SessionStore),
    kernels = app.get(KernelService),
    projects = app.get(ProjectService),
    trust = app.get(TrustService),
    workspaces = app.get(WorkspaceService),
    db = app.get(WorkspaceDatabase).sqlite
  const settled = (requestId: string) =>
    vi.waitFor(() => assert.equal(store.submission(requestId)?.status, 'completed'), {
      timeout: 15000,
    })
  const create = async () => {
    const row = await service.submit(command())
    await settled(row.submission.requestId)
    return row
  }
  const target = async () => {
    const ws = await workspaces.open(projectPath)
    assert(ws.ok)
    return projects.create({
      requestId: randomUUID(),
      name: '仅整理归属目标',
      workspaceId: ws.workspace.id,
    })
  }
  const pair = async (kind: 'desktop' | 'browser') => {
    const ticket = app.get(AccessService).issueTicket(kind)
    const headers = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` }
    const response = await app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers,
      payload: { code: ticket.code, label: 'space fixture' },
    })
    const cookie = String(response.headers['set-cookie']).split(';')[0] ?? ''
    const access = accessSnapshotSchema.parse(
      (
        await app.inject({ method: 'GET', url: '/api/access', headers: { ...headers, cookie } })
      ).json(),
    )
    return {
      ...headers,
      cookie,
      'x-piw-csrf': access.csrf ?? '',
      'x-piw-protocol': '1',
      'x-piw-capabilities': runtimeCapabilities.join(','),
    }
  }
  return {
    directory,
    pi,
    projectPath,
    app,
    service,
    store,
    kernels,
    projects,
    trust,
    workspaces,
    db,
    settled,
    create,
    target,
    pair,
  }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of new Set(directories.splice(0))) {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(readFileSync('docs/validation/live-validation-budget.json'), budget)
})

describe('SESSION-07 real standalone directories, SQLite, SDK/local fixture and source boundaries', () => {
  it('does not inherit a previous project or its global consent; only explicitly confirmed current-cwd text reaches the SDK', async () => {
    const f = await fixture(),
      target = await f.target()
    writeFileSync(join(f.projectPath, 'AGENTS.md'), 'PREVIOUS_PROJECT_MUST_NOT_INHERIT')
    writeFileSync(join(f.pi, 'AGENTS.md'), 'EXPLICIT_GLOBAL_CONTEXT_73b1')
    const global = f.trust
      .inspect(f.projectPath)
      .resources.find((row) => row.origin === 'user' && row.kind === 'context')!
    f.trust.grant(
      { project: f.projectPath, id: global.id, fingerprint: global.fingerprint, confirmed: true },
      randomUUID(),
    )
    const previous = await f.service.submit(command(target.id, target.workspaceId))
    await f.settled(previous.submission.requestId)
    const a = await f.create()
    expect(a.session.cwd).toBe(join(f.directory, 'data', 'standalone', a.session.id))
    const space = await f.service.space(a.session.id)
    expect(space).toMatchObject({
      standalone: true,
      projectId: null,
      policy: 'host-tools-disabled',
      origin: { provenance: 'created', projectId: null },
    })
    expect(space.resources.some((row) => row.path.startsWith(f.projectPath))).toBe(false)
    expect(space.resources.find((row) => row.path === global.path)).toMatchObject({
      trust: 'untrusted',
      enabledNextTurn: false,
      loadedNow: false,
    })
    const ask = async () => {
      const prompt = f.kernels.prompt.bind(f.kernels)
      vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, input, options) =>
        prompt(id, cwd, { ...input, fixture: 'trust-context' }, options),
      )
      const next = await f.service.submit({ ...command(), sessionId: a.session.id })
      await f.settled(next.submission.requestId)
      let text = ''
      for (const message of f.store.history(a.session.id)?.messages ?? []) {
        if (message.role === 'assistant') {
          text = message.text
        }
      }
      return text
    }
    expect(await ask()).not.toContain('EXPLICIT_GLOBAL_CONTEXT_73b1')
    const current = space.resources.find((row) => row.path === global.path)!
    const grant = f.trust.grant(
      { project: a.session.cwd, id: current.id, fingerprint: current.fingerprint, confirmed: true },
      randomUUID(),
    )
    expect(await ask()).toContain('EXPLICIT_GLOBAL_CONTEXT_73b1')
    expect(await ask()).not.toContain('PREVIOUS_PROJECT_MUST_NOT_INHERIT')
    f.trust.revoke(grant.recordId)
    expect(await ask()).not.toContain('EXPLICIT_GLOBAL_CONTEXT_73b1')
    expect(
      (await f.service.space(a.session.id)).resources.find((row) => row.id === current.id)
        ?.enabledNextTurn,
    ).toBe(false)
  })

  it('preserves real artifacts, source, history, accepted input and the same background PID when associating and removing a project', async () => {
    const f = await fixture(),
      target = await f.target(),
      a = await f.create(),
      b = await f.create()
    expect(a.session.cwd).not.toBe(b.session.cwd)
    const artifact = join(a.session.cwd, '验收夹具产物.txt')
    // Explicit externally written artifact fixture; disabled SDK tools did not create it.
    writeFileSync(artifact, 'standalone artifact persists unchanged')
    const origin = f.store.origin(a.session.id),
      recent = f.workspaces.recent(),
      records = f.trust.inspect().records
    const prompt = f.kernels.prompt.bind(f.kernels)
    vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, input, options) =>
      prompt(id, cwd, { ...input, fixture: 'hold' }, options),
    )
    const input = { ...command(), sessionId: a.session.id, text: 'explicit local hold' }
    const held = await f.service.submit(input)
    await vi.waitFor(
      () =>
        expect(f.kernels.list().find((row) => row.sessionId === a.session.id)?.state).toBe(
          'running',
        ),
      { timeout: 10000 },
    )
    const running = f.kernels.list().find((row) => row.sessionId === a.session.id)!
    const moved = f.service.setProject(a.session.id, {
      expectedVersion: 1,
      project: { id: target.id, revision: target.revision },
    })
    expect(moved).toMatchObject({
      cwd: a.session.cwd,
      workspaceId: a.session.workspaceId,
      membershipVersion: 2,
      configuration: { projectId: target.id, workspaceId: null },
    })
    expect(f.kernels.list().find((row) => row.sessionId === a.session.id)).toMatchObject({
      pid: running.pid,
      epoch: running.epoch,
      state: 'running',
      cwd: a.session.cwd,
    })
    expect((await f.service.submit(input)).submission.requestId).toBe(held.submission.requestId)
    expect(f.store.submissions(a.session.id)).toHaveLength(2)
    f.service.organizeProject(target.id, { action: 'remove', expectedRevision: target.revision })
    expect(f.store.managedSessions().find((row) => row.id === a.session.id)).toMatchObject({
      membershipVersion: 3,
      configuration: { projectId: null },
      cwd: a.session.cwd,
    })
    expect(f.store.origin(a.session.id)).toEqual(origin)
    expect(readFileSync(artifact, 'utf8')).toBe('standalone artifact persists unchanged')
    expect(existsSync(join(f.projectPath, '验收夹具产物.txt'))).toBe(false)
    expect(f.workspaces.recent()).toEqual(recent)
    expect(f.trust.inspect().records).toEqual(records)
    await f.kernels.abort(a.session.id, held.submission.turnId)
    await vi.waitFor(() =>
      expect(f.store.submission(held.submission.requestId)?.status).toBe('aborted'),
    )
  })

  it('restores standalone files, history and organization after actual daemon restart without opening a kernel or replaying a prompt', async () => {
    const f = await fixture(),
      a = await f.create(),
      target = await f.target()
    writeFileSync(join(a.session.cwd, 'artifact.txt'), 'external fixture artifact')
    const before = f.store.history(a.session.id),
      origin = f.store.origin(a.session.id)
    f.service.setProject(a.session.id, {
      expectedVersion: 1,
      project: { id: target.id, revision: target.revision },
    })
    f.service.setProject(a.session.id, { expectedVersion: 2, project: null })
    await f.app.close()
    const next = await fixture(f.directory)
    expect(next.kernels.list()).toEqual([])
    expect((await next.service.space(a.session.id)).origin).toEqual(origin)
    expect(next.store.history(a.session.id)?.messages).toEqual(before?.messages)
    expect(readFileSync(join(a.session.cwd, 'artifact.txt'), 'utf8')).toBe(
      'external fixture artifact',
    )
    const result = next.app
      .get(SearchService)
      .search(sessionSearchQuerySchema.parse({ project: 'none' }))
    expect(result.results.map((row) => row.sessionId)).toContain(a.session.id)
    expect(next.kernels.list()).toEqual([])
    const continued = await next.service.submit({ ...command(), sessionId: a.session.id })
    await next.settled(continued.submission.requestId)
    expect(continued.session.cwd).toBe(a.session.cwd)
  })

  it('rejects stale/ABA and target versions, rolls back a failed membership save, and leaves immutable provenance intact', async () => {
    const f = await fixture(),
      a = await f.create(),
      target = await f.target(),
      origin = f.store.origin(a.session.id)
    const move = { expectedVersion: 1, project: { id: target.id, revision: target.revision } }
    f.db.exec(
      "CREATE TRIGGER fail_membership BEFORE UPDATE OF project_id ON session_configurations BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END",
    )
    expect(() => f.service.setProject(a.session.id, move)).toThrow('归属未能保存')
    expect(f.store.managedSessions()[0]?.membershipVersion).toBe(1)
    f.db.exec('DROP TRIGGER fail_membership')
    f.service.setProject(a.session.id, move)
    f.service.setProject(a.session.id, { expectedVersion: 2, project: null })
    expect(() => f.service.setProject(a.session.id, move)).toThrow('归属已更新')
    await f.projects.edit(target.id, {
      action: 'edit',
      expectedRevision: target.revision,
      name: '目标已变化',
      workspaceId: target.workspaceId,
    })
    expect(() => f.service.setProject(a.session.id, { ...move, expectedVersion: 3 })).toThrow(
      '项目已更新',
    )
    expect(f.store.origin(a.session.id)).toEqual(origin)
    expect(f.store.submissions(a.session.id)).toHaveLength(1)
  })

  it('migrates an actual previous schema as observed provenance, preserving files and JSONL without inventing an original project', async () => {
    const f = await fixture(),
      a = await f.create()
    const history = f.store.history(a.session.id)?.messages
    writeFileSync(join(a.session.cwd, 'kept.txt'), 'old artifact')
    f.db.exec(
      'DROP TABLE session_origins; ALTER TABLE session_configurations DROP COLUMN membership_version; ALTER TABLE session_turns DROP COLUMN model_request; DROP TABLE operation_audit; DROP TABLE session_model_settings; DROP TABLE directory_rounds; DROP TABLE change_rounds; DROP TABLE change_tool_observations; DROP TABLE change_rollbacks; DROP TABLE change_decisions; DROP TABLE input_references; DELETE FROM __drizzle_migrations WHERE created_at >= 1793780000000',
    )
    await f.app.close()
    const next = await fixture(f.directory)
    expect((await next.service.space(a.session.id)).origin).toMatchObject({
      cwd: a.session.cwd,
      projectId: null,
      provenance: 'legacy-observed',
    })
    expect(next.store.history(a.session.id)?.messages).toEqual(history)
    expect(readFileSync(join(a.session.cwd, 'kept.txt'), 'utf8')).toBe('old artifact')
    expect(next.kernels.list()).toEqual([])
  })

  it('uses desktop-only, Host/Origin/CSRF/protocol and strict IDs; returns source metadata through redaction and rejects changed directory identity', async () => {
    const f = await fixture(),
      a = await f.create(),
      desktop = await f.pair('desktop'),
      browser = await f.pair('browser')
    const url = `/api/chat/sessions/${a.session.id}/space`,
      postUrl = `/api/chat/sessions/${a.session.id}/project`
    const post = (
      headers: Record<string, string>,
      payload: Record<string, unknown> = { expectedVersion: 1, project: null },
    ) => f.app.inject({ method: 'POST', url: postUrl, headers, payload })
    expect(
      (await f.app.inject({ method: 'GET', url, headers: { host: desktop.host } })).statusCode,
    ).toBe(401)
    expect((await f.app.inject({ method: 'GET', url, headers: browser })).statusCode).toBe(403)
    expect((await post(browser)).statusCode).toBe(403)
    expect((await post({ ...desktop, 'x-piw-csrf': '' })).statusCode).toBe(403)
    expect((await post({ ...desktop, origin: 'https://invalid.test' })).statusCode).toBe(403)
    expect((await post({ ...desktop, host: 'invalid.test' })).statusCode).toBe(403)
    expect((await post({ ...desktop, 'x-piw-protocol': '0' })).statusCode).toBe(409)
    expect(
      (await post(desktop, { expectedVersion: 1, project: null, cwd: f.projectPath })).statusCode,
    ).toBe(400)
    const snapshot = sessionSpaceSchema.parse(
      (await f.app.inject({ method: 'GET', url, headers: desktop })).json(),
    )
    expect(snapshot.resources).toEqual([])
    expect(snapshot.policy).toBe('host-tools-disabled')
    await f.kernels.destroy(a.session.id)
    renameSync(a.session.cwd, a.session.cwd + '-moved')
    mkdirSync(a.session.cwd)
    writeFileSync(join(a.session.cwd, 'AGENTS.md'), 'REPLACEMENT_MUST_NOT_BE_READ')
    const rejected = await f.app.inject({ method: 'GET', url, headers: desktop })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.body).not.toContain('REPLACEMENT_MUST_NOT_BE_READ')
    expect(f.store.origin(a.session.id)?.cwd).toBe(a.session.cwd)
  })
})
