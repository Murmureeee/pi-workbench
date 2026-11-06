import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { workspaceResultSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { TrustService } from '../dist/modules/security/trust.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-workspace-'))
  const project = join(directory, '中文 project')
  mkdirSync(project)
  writeFileSync(join(project, 'AGENTS.md'), 'Untrusted content must not be loaded.')
  const marker = join(directory, 'must-not-execute')
  mkdirSync(join(project, '.pi', 'extensions'), { recursive: true })
  writeFileSync(
    join(project, '.pi', 'extensions', 'unsafe.mjs'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe')`,
  )
  return { directory, project, marker, dataDir: join(directory, 'data') }
}

describe('WS-01 actual directory identity, SQLite and SDK isolation (no provider)', () => {
  it('deduplicates concurrent opens, dot segments, casing and junctions; survives daemon restart without creating sessions or trust', async () => {
    const f = fixture()
    let app = await createApp({ dataDir: f.dataDir, port: 4339 })
    try {
      const alias = join(f.directory, 'alias')
      symlinkSync(f.project, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const service = app.get(WorkspaceService)
      const [first, second, linked] = await Promise.all([
        service.open(f.project),
        service.open(`${f.project}/./`),
        service.open(alias),
      ])
      expect(first.ok && second.ok && linked.ok).toBe(true)
      if (!first.ok || !second.ok || !linked.ok) {
        throw new Error('Expected valid workspaces')
      }
      expect(new Set([first.workspace.id, second.workspace.id, linked.workspace.id]).size).toBe(1)
      expect(linked.workspace.canonicalPath).toBe(first.workspace.canonicalPath)
      const upper = await service.open(
        process.platform === 'win32' ? f.project.toUpperCase() : f.project,
      )
      expect(upper.ok && upper.workspace.id).toBe(first.workspace.id)
      expect(app.get(SessionStore).list()).toEqual([])
      expect(app.get(KernelService).list()).toEqual([])
      expect(app.get(TrustService).inspect().records).toEqual([])
      expect(existsSync(f.marker)).toBe(false)
      expect(
        readdirSync(f.project).filter((name) => name.startsWith('.pi-workbench-check-')),
      ).toEqual([])
      await app.close()
      app = await createApp({ dataDir: f.dataDir, port: 4339 })
      const restored = await app.get(WorkspaceService).open(alias)
      expect(restored.ok && restored.reused).toBe(true)
      expect(restored.ok && restored.workspace.id).toBe(first.workspace.id)
      expect(app.get(SessionStore).list()).toEqual([])
    } finally {
      await app.close()
      rmSync(f.directory, { recursive: true, force: true })
    }
  })

  it('diagnoses invalid, missing, file and stale/replaced directories without mutating old metadata; retry recovers', async () => {
    const f = fixture(),
      app = await createApp({ dataDir: f.dataDir, port: 4339 })
    try {
      const service = app.get(WorkspaceService)
      expect(await service.open('relative')).toMatchObject({ ok: false, code: 'invalid_path' })
      expect(await service.open(`${f.project}\0`)).toMatchObject({
        ok: false,
        code: 'invalid_path',
      })
      expect(await service.open(join(f.directory, 'missing'))).toMatchObject({
        ok: false,
        code: 'not_found',
      })
      expect(await service.open(join(f.project, 'AGENTS.md'))).toMatchObject({
        ok: false,
        code: 'not_directory',
      })
      expect(await service.validate(randomUUID())).toMatchObject({
        ok: false,
        code: 'unknown_workspace',
      })
      const opened = await service.open(f.project)
      if (!opened.ok) {
        throw new Error('Expected valid directory')
      }
      const moved = join(f.directory, 'moved')
      renameSync(f.project, moved)
      expect(await service.validate(opened.workspace.id)).toMatchObject({
        ok: false,
        code: 'not_found',
      })
      mkdirSync(f.project)
      expect(await service.validate(opened.workspace.id)).toMatchObject({
        ok: false,
        code: 'directory_changed',
      })
      const replacement = await service.open(f.project)
      expect(replacement.ok && replacement.workspace.id).not.toBe(opened.workspace.id)
      rmSync(f.project, { recursive: true })
      renameSync(moved, f.project)
      const restored = await service.validate(opened.workspace.id)
      expect(restored.ok && restored.workspace.id).toBe(opened.workspace.id)
      expect(app.get(SessionStore).list()).toEqual([])
      expect(app.get(KernelService).list()).toEqual([])
    } finally {
      await app.close()
      rmSync(f.directory, { recursive: true, force: true })
    }
  })

  it('uses actual Windows ACL denial to distinguish unreadable and unwritable paths, then recovers after restoring permission', async () => {
    // Real Windows ACL evidence, not chmod emulation or an injected EACCES exception.
    if (process.platform !== 'win32') {
      throw new Error('The WS-01 ACL acceptance test requires actual Windows permissions')
    }
    const f = fixture(),
      app = await createApp({ dataDir: f.dataDir, port: 4339 })
    const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
    }).match(/S-1-[\d-]+/)?.[0]
    if (!sid) {
      throw new Error('Windows user SID unavailable for ACL fixture')
    }
    const acl = (...args: string[]) =>
      execFileSync('icacls', [f.project, ...args], { windowsHide: true, stdio: 'pipe' })
    try {
      acl('/deny', `*${sid}:(WD)`)
      expect(await app.get(WorkspaceService).open(f.project)).toMatchObject({
        ok: false,
        code: 'not_writable',
      })
      acl('/remove:d', `*${sid}`)
      acl('/deny', `*${sid}:(RD)`)
      expect(await app.get(WorkspaceService).open(f.project)).toMatchObject({
        ok: false,
        code: 'not_readable',
      })
      acl('/remove:d', `*${sid}`)
      expect((await app.get(WorkspaceService).open(f.project)).ok).toBe(true)
      expect(app.get(SessionStore).list()).toEqual([])
      expect(
        readdirSync(f.project).filter((name) => name.startsWith('.pi-workbench-check-')),
      ).toEqual([])
    } finally {
      acl('/remove:d', `*${sid}`)
      await app.close()
      rmSync(f.directory, { recursive: true, force: true })
    }
  })

  it('fails closed on SQLite registration failure and preserves existing sessions, native history and resource trust across migration', async () => {
    const f = fixture(),
      sessionId = randomUUID()
    let app = await createApp({ dataDir: f.dataDir, port: 4339 })
    try {
      await app
        .get(KernelService)
        .prompt(sessionId, f.project, { turnId: randomUUID(), text: 'workspace migration history' })
      const native = app.get(KernelService).list()[0]?.sessionFile
      if (!native) {
        throw new Error('Expected real SDK local fixture history')
      }
      const bytes = readFileSync(native)
      const resource = app
        .get(TrustService)
        .inspect(f.project)
        .resources.find((item) => item.kind === 'context')
      if (!resource?.fingerprint) {
        throw new Error('Expected context resource')
      }
      app.get(TrustService).grant(
        {
          project: f.project,
          id: resource.id,
          fingerprint: resource.fingerprint,
          confirmed: true,
        },
        randomUUID(),
      )
      const database = app.get(WorkspaceDatabase)
      database.sqlite.exec(
        "CREATE TRIGGER deny_workspace BEFORE INSERT ON workspaces BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END",
      )
      expect(await app.get(WorkspaceService).open(f.project)).toMatchObject({
        ok: false,
        code: 'storage_failed',
      })
      database.sqlite.exec(
        'DROP TRIGGER deny_workspace; DROP TABLE session_origins; DROP TABLE session_organization; DROP TABLE session_submissions; DROP TABLE session_configurations; DROP TABLE projects; DROP TABLE workspaces; ALTER TABLE session_turns DROP COLUMN model_request; DROP TABLE operation_audit; DELETE FROM __drizzle_migrations WHERE created_at >= 1793609651034',
      )
      await app.close()
      app = await createApp({ dataDir: f.dataDir, port: 4339 })
      expect(app.get(SessionStore).list()).toHaveLength(1)
      expect(readFileSync(native)).toEqual(bytes)
      expect(app.get(TrustService).inspect(f.project).records).toHaveLength(1)
      expect((await app.get(WorkspaceService).open(f.project)).ok).toBe(true)
      expect(existsSync(f.marker)).toBe(false)
    } finally {
      await app.close()
      rmSync(f.directory, { recursive: true, force: true })
    }
  })

  it('uses the actual authenticated transport; unpaired/wrong Host/Origin/CSRF requests never register a directory', async () => {
    const f = fixture(),
      app = await createApp({ dataDir: f.dataDir, port: 4339 })
    try {
      const url = '/api/workspaces/open',
        payload = { path: f.project }
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            payload,
            headers: { host: '127.0.0.1:4339', origin: 'http://127.0.0.1:4339' },
          })
        ).statusCode,
      ).toBe(401)
      const headers = await authorizedHeaders(app, 4339)
      const identity = app.get(AccessService).snapshot(headers.cookie)
      const allowed = {
        ...headers,
        origin: 'http://127.0.0.1:4339',
        'x-piw-csrf': identity.csrf ?? '',
      }
      const rejected = await Promise.all(
        [
          { ...allowed, host: 'evil.example' },
          { ...allowed, origin: 'http://evil.example' },
          { ...allowed, 'x-piw-csrf': 'invalid' },
        ].map((bad) => app.inject({ method: 'POST', url, payload, headers: bad })),
      )
      expect(rejected.map((response) => response.statusCode)).toEqual([403, 403, 403])
      expect(
        app.get(WorkspaceDatabase).sqlite.prepare('SELECT COUNT(*) AS count FROM workspaces').get(),
      ).toEqual({ count: 0 })
      const response = await app.inject({ method: 'POST', url, payload, headers: allowed })
      expect(response.statusCode).toBe(200)
      expect(workspaceResultSchema.parse(response.json()).ok).toBe(true)
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            payload: { path: f.project, trust: true },
            headers: allowed,
          })
        ).statusCode,
      ).toBe(400)
      expect(app.get(SessionStore).list()).toEqual([])
      expect(app.get(TrustService).inspect().records).toEqual([])
    } finally {
      await app.close()
      rmSync(f.directory, { recursive: true, force: true })
    }
  })
})
