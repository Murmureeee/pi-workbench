import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { workspaceEnvironmentSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { readGitEnvironment } from '../dist/modules/workspaces/git-environment.js'
import { WorkspaceEnvironmentService } from '../dist/modules/workspaces/workspace-environment.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { fixtureGit as git } from './helpers/git.js'

const apps: Awaited<ReturnType<typeof createApp>>[] = [],
  directories: string[] = []
const budget = readFileSync('docs/validation/live-validation-budget.json')
const port = 24408
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-environment-'))
  directories.push(directory)
  const cwd = join(directory, '中文仓库')
  mkdirSync(cwd)
  const app = await createApp({ dataDir: join(directory, 'data'), port, development: true })
  apps.push(app)
  const workspaces = app.get(WorkspaceService),
    environment = app.get(WorkspaceEnvironmentService)
  const opened = await workspaces.open(cwd)
  assert(opened.ok)
  const id = opened.workspace.id
  const inspect = () => environment.inspect({ workspaceId: id })
  const pair = async (kind: 'desktop' | 'browser') => {
    const ticket = app.get(AccessService).issueTicket(kind)
    const response = await app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
      payload: { code: ticket.code, label: 'Environment test' },
    })
    return {
      host: `127.0.0.1:${port}`,
      cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
    }
  }
  return { directory, cwd, app, workspaces, environment, id, inspect, pair }
}
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(readFileSync('docs/validation/live-validation-budget.json'), budget)
})

describe('WS-03 real Git, directory identity, SQLite and desktop-only observation', () => {
  it('discovers unborn branches, actual commits, branch changes and detached HEAD without changing metadata or index', async () => {
    const f = await fixture()
    git(f.cwd, 'init', '-b', 'main')
    expect((await f.inspect()).git).toMatchObject({
      status: 'repository',
      root: f.cwd,
      head: { kind: 'branch', name: 'main', commit: null },
    })
    git(f.cwd, 'commit', '--allow-empty', '-m', 'offline baseline')
    git(f.cwd, 'tag', 'main')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'baseline')
    git(f.cwd, 'add', 'tracked.txt')
    const index = readFileSync(join(f.cwd, '.git', 'index'))
    const before = f.workspaces.recent()
    const head = readFileSync(join(f.cwd, '.git', 'HEAD'))
    const reflog = readFileSync(join(f.cwd, '.git', 'logs', 'HEAD'))
    const current = workspaceEnvironmentSchema.parse(await f.inspect())
    expect(current.git).toMatchObject({
      status: 'repository',
      head: { kind: 'branch', name: 'main', commit: git(f.cwd, 'rev-parse', 'HEAD') },
    })
    expect(readFileSync(join(f.cwd, '.git', 'HEAD'))).toEqual(head)
    expect(readFileSync(join(f.cwd, '.git', 'logs', 'HEAD'))).toEqual(reflog)
    expect(readFileSync(join(f.cwd, '.git', 'index'))).toEqual(index)
    expect(f.workspaces.recent()).toEqual(before)
    expect(f.app.get(KernelService).list()).toEqual([])
    git(f.cwd, 'switch', '-c', '功能/中文')
    expect((await f.inspect()).git).toMatchObject({ head: { kind: 'branch', name: '功能/中文' } })
    git(f.cwd, 'switch', '--detach')
    expect((await f.inspect()).git).toMatchObject({
      head: { kind: 'detached', commit: git(f.cwd, 'rev-parse', 'HEAD') },
    })
  })

  it('distinguishes a non-Git parent, nested repositories and sibling repositories by the actual cwd', async () => {
    const f = await fixture()
    const a = join(f.cwd, 'A'),
      b = join(f.cwd, 'B'),
      child = join(a, 'src')
    mkdirSync(child, { recursive: true })
    mkdirSync(b)
    git(a, 'init', '-b', 'alpha')
    git(b, 'init', '-b', 'beta')
    expect((await f.inspect()).git).toEqual({ status: 'not_repository' })
    await Promise.all(
      [
        [child, 'alpha'],
        [b, 'beta'],
      ].map(async ([path, branch]) => {
        assert(path && branch)
        const opened = await f.workspaces.open(path)
        assert(opened.ok)
        expect(
          (await f.environment.inspect({ workspaceId: opened.workspace.id })).git,
        ).toMatchObject({
          status: 'repository',
          root: path === child ? a : b,
          head: { name: branch },
        })
      }),
    )
    git(child, 'init', '-b', 'nested')
    expect(await readGitEnvironment(child)).toMatchObject({
      status: 'repository',
      root: child,
      head: { name: 'nested' },
    })
  })

  it('identifies actual submodules and linked worktrees without conflating their HEAD or Git directory', async () => {
    const f = await fixture(),
      source = join(f.directory, 'source'),
      linked = join(f.directory, 'linked')
    mkdirSync(source)
    git(source, 'init', '-b', 'module-main')
    git(source, 'commit', '--allow-empty', '-m', 'module')
    git(f.cwd, 'init', '-b', 'main')
    git(f.cwd, 'commit', '--allow-empty', '-m', 'parent')
    git(f.cwd, '-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'modules/child')
    const sub = join(f.cwd, 'modules', 'child')
    expect(await readGitEnvironment(sub)).toMatchObject({
      status: 'repository',
      root: sub,
      superprojectRoot: f.cwd,
      gitDirectory: join(f.cwd, '.git', 'modules', 'modules', 'child'),
      head: { name: 'module-main' },
    })
    git(f.cwd, 'worktree', 'add', '-b', 'linked-head', linked)
    expect(await readGitEnvironment(linked)).toMatchObject({
      status: 'repository',
      root: linked,
      gitDirectory: join(f.cwd, '.git', 'worktrees', 'linked'),
      head: { name: 'linked-head' },
    })
  })

  it('ignores inherited Git routing and never invokes configured fsmonitor or repository hooks', async () => {
    const f = await fixture(),
      other = join(f.directory, 'other'),
      marker = join(f.directory, 'executed')
    mkdirSync(other)
    git(f.cwd, 'init', '-b', 'correct')
    git(f.cwd, 'commit', '--allow-empty', '-m', 'base')
    git(other, 'init', '-b', 'wrong')
    const script = join(f.cwd, '.git', 'hooks', 'test-monitor')
    writeFileSync(script, `#!/bin/sh\necho unsafe > '${marker.replaceAll('\\', '/')}'\n`)
    git(f.cwd, 'config', 'core.fsmonitor', script)
    vi.stubEnv('GIT_DIR', join(other, '.git'))
    vi.stubEnv('GIT_WORK_TREE', other)
    expect((await f.inspect()).git).toMatchObject({ root: f.cwd, head: { name: 'correct' } })
    expect(existsSync(marker)).toBe(false)
    expect(readdirSync(f.cwd)).toEqual(['.git'])
  })

  it('keeps real session cwd and the same running SDK/local task when a different workspace is observed or the registration is relocated', async () => {
    const f = await fixture()
    git(f.cwd, 'init', '-b', 'original')
    const kernels = f.app.get(KernelService),
      prompt = kernels.prompt.bind(kernels)
    vi.spyOn(kernels, 'prompt').mockImplementationOnce((id, cwd, command, options) =>
      prompt(id, cwd, { ...command, fixture: 'hold' }, options),
    )
    const receipt = await f.app.get(SessionService).submit({
      requestId: randomUUID(),
      sessionId: null,
      configuration: {
        projectId: null,
        workspaceId: f.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
      text: 'fixture:hold',
      retryOf: null,
    })
    await vi.waitFor(() => expect(kernels.list()[0]?.pid).toBeTypeOf('number'), { timeout: 10000 })
    const before = kernels.list()[0]
    expect((await f.environment.inspect({ sessionId: receipt.session.id })).cwd).toBe(f.cwd)
    const other = join(f.directory, 'other')
    mkdirSync(other)
    const opened = await f.workspaces.open(other)
    assert(opened.ok)
    expect((await f.environment.inspect({ workspaceId: opened.workspace.id })).git.status).toBe(
      'not_repository',
    )
    expect(kernels.list()[0]).toMatchObject({ pid: before?.pid, epoch: before?.epoch, cwd: f.cwd })
    await kernels.abort(receipt.session.id, receipt.submission.turnId)
    await kernels.destroy(receipt.session.id)
    const moved = join(f.directory, 'moved')
    renameSync(f.cwd, moved)
    const row = f.workspaces.recent().entries.find((entry) => entry.id === f.id)!
    expect(
      (await f.workspaces.relocate({ id: f.id, expectedRevision: row.revision, path: moved })).ok,
    ).toBe(true)
    expect(await f.environment.inspect({ sessionId: receipt.session.id })).toMatchObject({
      cwd: f.cwd,
      workspacePath: moved,
      resolvedCwd: null,
      git: { code: 'directory_unavailable' },
    })
    expect(f.app.get(SessionStore).managedSessions()[0]?.cwd).toBe(f.cwd)
  })

  it('returns diagnostics for missing Git, broken Git metadata and replaced directories without stale branches', async () => {
    const f = await fixture()
    git(f.cwd, 'init', '-b', 'main')
    vi.stubEnv('PATH', '')
    expect((await f.inspect()).git).toMatchObject({ status: 'unavailable', code: 'git_missing' })
    vi.unstubAllEnvs()
    writeFileSync(join(f.cwd, '.git', 'HEAD'), 'invalid head\n')
    expect((await f.inspect()).git).toMatchObject({ status: 'unavailable', code: 'git_failed' })
    renameSync(f.cwd, join(f.directory, 'old'))
    mkdirSync(f.cwd)
    expect(await f.inspect()).toMatchObject({
      resolvedCwd: null,
      git: { status: 'unavailable', code: 'directory_unavailable' },
    })
  })

  it('rejects changes during inspection and coalesces identical observations without writing recency', async () => {
    const f = await fixture()
    git(f.cwd, 'init', '-b', 'main')
    const inspect = f.workspaces.environmentDirectory.bind(f.workspaces)
    const spy = vi
      .spyOn(f.workspaces, 'environmentDirectory')
      .mockImplementation(async (...args) => {
        if (spy.mock.calls.length === 2) {
          renameSync(f.cwd, join(f.directory, 'old'))
          mkdirSync(f.cwd)
        }
        return inspect(...args)
      })
    const first = f.inspect(),
      second = f.inspect()
    expect(first).toBe(second)
    expect((await first).git).toMatchObject({ status: 'unavailable', code: 'changed' })
  })

  it('requires desktop pairing and a single registered identity, redacts branch metadata and cannot accept a caller cwd', async () => {
    const f = await fixture()
    git(f.cwd, 'init', '-b', 'feature/api_key=redact-me-environment')
    const url = `/api/workspaces/environment?workspaceId=${f.id}`
    expect((await f.app.inject({ url, headers: { host: `127.0.0.1:${port}` } })).statusCode).toBe(
      401,
    )
    expect((await f.app.inject({ url, headers: await f.pair('browser') })).statusCode).toBe(403)
    const headers = await f.pair('desktop')
    await Promise.all(
      ['cwd=C:/', `workspaceId=${f.id}&sessionId=${randomUUID()}`, 'workspaceId=invalid'].map(
        async (query) => {
          expect(
            (await f.app.inject({ url: `/api/workspaces/environment?${query}`, headers }))
              .statusCode,
          ).toBe(400)
        },
      ),
    )
    const response = await f.app.inject({ url, headers })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).not.toContain('redact-me-environment')
    expect(response.body).toContain('«redacted»')
    expect(
      (
        await f.app.inject({
          url: `/api/workspaces/environment?workspaceId=${randomUUID()}`,
          headers,
        })
      ).statusCode,
    ).toBe(404)
    expect(f.app.get(SessionStore).list()).toEqual([])
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(resolve(f.cwd)).toBe(f.cwd)
  })
})
