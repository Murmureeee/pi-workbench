import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { gitStatusSchema } from '@pi-workbench/shared'

import { ChangeService } from '../dist/modules/changes/change.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { GitStatusService } from '../dist/modules/workspaces/git-status.service.js'
import { WorkspaceEnvironmentService } from '../dist/modules/workspaces/workspace-environment.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'
import { setupChangeFixture } from './helpers/change-fixture.js'
import { fixtureGit as git } from './helpers/git.js'

type Fixture = Awaited<ReturnType<typeof setupChangeFixture>>
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function metadata(root: string, sub = '.git'): Record<string, string> {
  return Object.fromEntries(
    readdirSync(join(root, sub), { withFileTypes: true }).flatMap((entry) => {
      const path = join(sub, entry.name)
      return entry.isDirectory()
        ? Object.entries(metadata(root, path))
        : [[path, sha(readFileSync(join(root, path))) + ':' + statSync(join(root, path)).mtimeMs]]
    }),
  )
}
async function fixture() {
  const f = await setupChangeFixture()
  const opened = await f.app.get(WorkspaceService).open(f.cwd)
  if (!opened.ok) {
    throw new Error('Fixture directory rejected')
  }
  const workspaceId = opened.workspace.id
  return {
    ...f,
    get app() {
      return f.app
    },
    restart: f.restart,
    inspect: () => f.app.get(GitStatusService).inspect({ workspaceId }),
    workspaceId,
  }
}
function init(f: Fixture) {
  git(f.cwd, 'init', '--initial-branch=main')
  writeFileSync(join(f.cwd, 'a.txt'), 'committed\n')
  writeFileSync(join(f.cwd, 'dirty.txt'), 'committed\n')
  git(f.cwd, 'add', '.')
  git(f.cwd, 'commit', '-m', 'local baseline')
}

test('gIT-01 actual staged/unstaged/untracked, Unicode spaces and rename preserve every Git metadata byte and mtime', async () => {
  const f = await fixture()
  try {
    init(f)
    writeFileSync(join(f.cwd, 'a.txt'), 'staged\n')
    git(f.cwd, 'add', 'a.txt')
    writeFileSync(join(f.cwd, 'a.txt'), 'unstaged after staged\n')
    git(f.cwd, 'mv', 'dirty.txt', '中文 新名称.txt')
    writeFileSync(join(f.cwd, '未跟踪 文件.txt'), 'untracked')
    const before = metadata(f.cwd),
      result = gitStatusSchema.parse(await f.inspect())
    expect(result).toMatchObject({ state: 'ready', complete: true })
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'a.txt', index: 'M', worktree: 'M', source: 'unknown' }),
        expect.objectContaining({ path: '中文 新名称.txt', index: 'R', previousPath: 'dirty.txt' }),
        expect.objectContaining({ path: '未跟踪 文件.txt', untracked: true }),
      ]),
    )
    expect(metadata(f.cwd)).toEqual(before)
    expect(existsSync(join(f.cwd, '.git', 'index.lock'))).toBe(false)
    await f.inspect()
    expect(metadata(f.cwd)).toEqual(before)
  } finally {
    await f.close()
  }
})

test('gIT-01 non-Git, unborn, detached, deleted files and broken index diagnostics refresh against actual disk', async () => {
  const f = await fixture()
  try {
    expect((await f.inspect()).state).toBe('not_repository')
    git(f.cwd, 'init', '--initial-branch=中文分支')
    writeFileSync(join(f.cwd, 'a'), 'new')
    git(f.cwd, 'add', 'a')
    expect(await f.inspect()).toMatchObject({
      state: 'ready',
      git: { head: { kind: 'branch', name: '中文分支', commit: null } },
      entries: [{ index: 'A' }],
    })
    git(f.cwd, 'commit', '-m', 'first')
    git(f.cwd, 'checkout', '--detach')
    unlinkSync(join(f.cwd, 'a'))
    expect(await f.inspect()).toMatchObject({
      state: 'ready',
      git: { head: { kind: 'detached' } },
      entries: [{ worktree: 'D' }],
    })
    const index = readFileSync(join(f.cwd, '.git', 'index'))
    writeFileSync(join(f.cwd, '.git', 'index'), 'broken')
    expect(await f.inspect()).toMatchObject({ state: 'unavailable', entries: [] })
    writeFileSync(join(f.cwd, '.git', 'index'), index)
    expect((await f.inspect()).state).toBe('ready')
  } finally {
    await f.close()
  }
})

test('gIT-01 current-cwd subtree and physical aliases never enumerate sibling content or change registry recency', async () => {
  const f = await fixture()
  try {
    init(f)
    mkdirSync(join(f.cwd, 'sub'))
    writeFileSync(join(f.cwd, 'outside.txt'), 'sibling')
    writeFileSync(join(f.cwd, 'sub', 'inside.txt'), 'inside')
    const ws = f.app.get(WorkspaceService),
      registered = await ws.open(join(f.cwd, 'sub'))
    if (!registered.ok) {
      throw new Error('Subdirectory rejected')
    }
    const alias = join(f.root, 'alias')
    symlinkSync(join(f.cwd, 'sub'), alias, 'junction')
    const same = await ws.open(alias)
    expect(same.ok && same.workspace.id).toBe(registered.workspace.id)
    const recent = ws.recent()
    const result = await f.app
      .get(GitStatusService)
      .inspect({ workspaceId: registered.workspace.id })
    expect(result.entries.map((e) => e.path)).toEqual(['inside.txt'])
    expect(ws.recent()).toEqual(recent)
    expect(readFileSync(join(f.cwd, 'outside.txt'), 'utf8')).toBe('sibling')
  } finally {
    await f.close()
  }
})

test('gIT-01 real SDK write preserves prior dirty content labels, tool chain and later external mixture across restart', async () => {
  const f = await fixture()
  try {
    init(f)
    writeFileSync(join(f.cwd, 'APPROVED.txt'), 'committed')
    writeFileSync(join(f.cwd, '.env'), 'private fixture baseline')
    git(f.cwd, 'add', '.')
    git(f.cwd, 'commit', '-m', 'tool target')
    writeFileSync(join(f.cwd, '.env'), 'private fixture current')
    writeFileSync(join(f.cwd, 'dirty.txt'), 'dirty before round')
    writeFileSync(join(f.cwd, 'APPROVED.txt'), 'prior dirty tool target')
    const sessionId = randomUUID(),
      turnId = randomUUID()
    const run = f.app.get(KernelService).prompt(sessionId, f.cwd, {
      turnId,
      text: 'Git source actual SDK local fixture',
      fixture: 'approval-write',
    })
    void run.catch(() => undefined)
    await vi.waitFor(() => expect(f.app.get(ApprovalService).list(sessionId)).toHaveLength(1), {
      timeout: 20000,
    })
    const approval = f.app.get(ApprovalService).list(sessionId)[0]
    if (!approval) {
      throw new Error('Expected actual SDK approval')
    }
    f.app.get(ApprovalService).decide(
      approval.id,
      {
        sessionId,
        epoch: approval.epoch,
        turnId,
        digest: approval.risk.digest,
        policyVersion: approval.risk.policyVersion,
        action: 'allow-once',
        reason: 'isolated actual write',
        acceptIrreversible: true,
      },
      'local-desktop',
    )
    await run
    await vi.waitFor(
      () =>
        expect(f.app.get(ChangeService).history(sessionId).rounds[0]?.final.status).toBe('ready'),
      { timeout: 20000 },
    )
    const before = metadata(f.cwd),
      state = await f.inspect()
    expect(state.entries.find((e) => e.path === '.env')).toMatchObject({
      source: 'unknown',
      baselinePresent: null,
    })
    expect(state.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'dirty.txt',
          source: 'baseline-retained',
          baselinePresent: true,
          baselineDiffersFromGit: true,
        }),
        expect.objectContaining({
          path: 'APPROVED.txt',
          source: 'tool-observed',
          baselinePresent: true,
          baselineDiffersFromGit: true,
        }),
      ]),
    )
    writeFileSync(
      join(f.cwd, 'APPROVED.txt'),
      readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8') + '\nexternal edit',
    )
    expect((await f.inspect()).entries.find((e) => e.path === 'APPROVED.txt')?.source).toBe('mixed')
    expect(metadata(f.cwd)).toEqual(before)
    await f.restart()
    expect(f.app.get(KernelService).list()).toHaveLength(0)
    expect((await f.inspect()).entries.find((e) => e.path === 'APPROVED.txt')?.source).toBe('mixed')
    expect(metadata(f.cwd)).toEqual(before)
  } finally {
    await f.close()
  }
}, 40000)

test('gIT-01 repository executable filters and fsmonitor never run from read-only inspection', async () => {
  const f = await fixture()
  try {
    init(f)
    const marker = join(f.root, 'SCRIPT_RAN')
    git(f.cwd, 'config', 'core.fsmonitor', `echo unsafe > "${marker}"`)
    const before = metadata(f.cwd)
    expect((await f.inspect()).state).toBe('ready')
    expect(metadata(f.cwd)).toEqual(before)
    expect(existsSync(marker)).toBe(false)
    git(f.cwd, 'config', 'filter.evil.clean', `echo unsafe > "${marker}"`)
    writeFileSync(join(f.cwd, '.gitattributes'), '*.txt filter=evil\n')
    const filtered = await f.inspect()
    expect(filtered).toMatchObject({ state: 'unavailable', entries: [] })
    expect(filtered.diagnostic).toContain('过滤器')
    expect(existsSync(marker)).toBe(false)
  } finally {
    await f.close()
  }
})

test('gIT-01 merge conflicts and bounded 500-item list remain honest and read-only', async () => {
  const f = await fixture()
  try {
    init(f)
    git(f.cwd, 'checkout', '-b', 'other')
    writeFileSync(join(f.cwd, 'a.txt'), 'other branch')
    git(f.cwd, 'commit', '-am', 'other')
    git(f.cwd, 'checkout', 'main')
    writeFileSync(join(f.cwd, 'a.txt'), 'main branch')
    git(f.cwd, 'commit', '-am', 'main')
    expect(() => git(f.cwd, 'merge', 'other')).toThrow(/Command failed/)
    const conflict = await f.inspect()
    expect(conflict.entries.find((e) => e.path === 'a.txt')).toMatchObject({
      conflict: true,
      index: 'U',
      worktree: 'U',
    })
    for (let i = 0; i < 510; i++) {
      writeFileSync(join(f.cwd, `untracked-${i}.txt`), 'x')
    }
    const before = metadata(f.cwd),
      limited = await f.inspect()
    expect(limited).toMatchObject({ state: 'ready', complete: false })
    expect(limited.entries).toHaveLength(500)
    expect(metadata(f.cwd)).toEqual(before)
  } finally {
    await f.close()
  }
})

test('gIT-01 paired desktop transport rejects browser/raw paths/unknown targets and never creates a session', async () => {
  const f = await fixture()
  try {
    const desktop = await authorizedHeaders(f.app, 24477, 'desktop'),
      browser = await authorizedHeaders(f.app, 24477, 'browser')
    const url = `/api/git/status?workspaceId=${f.workspaceId}`
    expect((await f.app.inject({ url, headers: desktop })).statusCode).toBe(200)
    expect((await f.app.inject({ url, headers: browser })).statusCode).toBe(403)
    expect(
      (await f.app.inject({ url: '/api/git/status?path=D:/', headers: desktop })).statusCode,
    ).toBe(400)
    expect(
      (await f.app.inject({ url: `/api/git/status?sessionId=${randomUUID()}`, headers: desktop }))
        .statusCode,
    ).toBe(404)
    expect(f.app.get(KernelService).list()).toHaveLength(0)
  } finally {
    await f.close()
  }
})

test('gIT-01 changes during source observation invalidate the whole result even when porcelain XY stays unchanged', async () => {
  const f = await fixture()
  try {
    init(f)
    const t = f.start()
    await vi.waitFor(
      () =>
        expect(f.app.get(ChangeService).history(t.sessionId).rounds[0]?.baseline.status).not.toBe(
          'pending',
        ),
      { timeout: 20000 },
    )
    const baseline = f.app.get(ChangeService).history(t.sessionId).rounds[0]?.baseline
    if (baseline?.status !== 'ready') {
      throw new Error(JSON.stringify(baseline))
    }
    writeFileSync(join(f.cwd, 'a.txt'), 'final external fixture')
    await f.app.get(KernelService).abort(t.sessionId, t.turnId)
    await t.promise
    await vi.waitFor(
      () =>
        expect(f.app.get(ChangeService).history(t.sessionId).rounds[0]?.final.status).toBe('ready'),
      { timeout: 20000 },
    )
    const service = f.app.get(WorkspaceEnvironmentService),
      inspect = service.inspect.bind(service)
    let calls = 0
    vi.spyOn(service, 'inspect').mockImplementation(async (target) => {
      if (++calls === 2) {
        writeFileSync(join(f.cwd, 'a.txt'), 'changed while observing with the same XY')
      }
      return inspect(target)
    })
    const changed = await f.inspect()
    expect(changed).toMatchObject({ state: 'unavailable', entries: [] })
    expect(changed.diagnostic).toContain('文件已改变')
    vi.restoreAllMocks()
    expect((await f.inspect()).state).toBe('ready')
  } finally {
    await f.close()
  }
}, 40000)

test('gIT-01 nested submodule changes are explicitly incomplete and never scanned as a clean whole repository', async () => {
  const f = await fixture()
  try {
    init(f)
    const source = join(f.root, 'submodule-source')
    mkdirSync(source)
    git(source, 'init', '--initial-branch=main')
    writeFileSync(join(source, 'nested.txt'), 'submodule baseline')
    git(source, 'add', '.')
    git(source, 'commit', '-m', 'submodule baseline')
    git(f.cwd, '-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'module')
    git(f.cwd, 'commit', '-am', 'register module')
    writeFileSync(join(f.cwd, 'module', 'nested.txt'), 'external dirty submodule')
    const before = metadata(f.cwd),
      state = await f.inspect()
    expect(state).toMatchObject({ state: 'ready', complete: false })
    expect(state.diagnostic).toContain('子模块状态未扫描')
    expect(metadata(f.cwd)).toEqual(before)
  } finally {
    await f.close()
  }
})
