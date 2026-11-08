import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { fileListingSchema } from '@pi-workbench/shared'

import { FileService } from '../dist/modules/files/file.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'
import { setupChangeFixture } from './helpers/change-fixture.js'
import { fixtureGit as git } from './helpers/git.js'

const noop = () => undefined
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected actual fixture entry')
  }
  return value
}
async function fixture() {
  const f = await setupChangeFixture(),
    ws = f.app.get(WorkspaceService)
  const opened = await ws.open(f.cwd)
  if (!opened.ok) {
    throw Error('File fixture directory rejected')
  }
  return {
    ...f,
    get app() {
      return f.app
    },
    restart: f.restart,
    target: { workspaceId: opened.workspace.id },
    get files() {
      return f.app.get(FileService)
    },
  }
}
test('fILE-01 real lazy pages, Unicode/long paths, fresh metadata location and unchanged registry/Git bytes', async () => {
  const f = await fixture()
  try {
    git(f.cwd, 'init')
    const folder = join(f.cwd, '中文 空格')
    mkdirSync(folder)
    for (let i = 0; i < 205; i++) {
      writeFileSync(join(folder, `文件-${i}.txt`), 'actual file')
    }
    const long = '长路径'.repeat(32)
    mkdirSync(join(folder, long))
    mkdirSync(join(folder, long, long))
    writeFileSync(join(folder, long, long, '目标.ts'), 'export const real = 1')
    const recent = f.app.get(WorkspaceService).recent(),
      head = readFileSync(join(f.cwd, '.git', 'HEAD'))
    const root = fileListingSchema.parse(await f.files.list(f.target))
    const id = root.entries.find((e) => e.name === '中文 空格')!.id
    const a = await f.files.list(f.target, id)
    expect(a.entries).toHaveLength(100)
    expect(a.complete).toBe(false)
    const b = await f.files.list(f.target, a.directory.id, a.cursor!)
    const c = await f.files.list(f.target, b.directory.id, b.cursor!)
    expect(new Set([...a.entries, ...b.entries, ...c.entries].map((e) => e.path)).size).toBe(206)
    expect(c.complete).toBe(true)
    const narrow = await f.app.get(WorkspaceService).open(join(folder, long))
    if (!narrow.ok) {
      throw new Error('Explicit long-path scope rejected')
    }
    const searchTarget = { workspaceId: narrow.workspace.id }
    const search = await f.files.search(searchTarget, '目标.ts')
    expect(search.entries).toHaveLength(1)
    const location = await f.files.locate(searchTarget, required(search.entries[0]).id)
    expect(location.absolutePath).toBe(join(folder, long, long, '目标.ts'))
    expect(location.file.size).toBe(21)
    expect(
      f.app
        .get(WorkspaceService)
        .recent()
        .entries.find((e) => e.id === f.target.workspaceId),
    ).toEqual(recent.entries.find((e) => e.id === f.target.workspaceId))
    expect(readFileSync(join(f.cwd, '.git', 'HEAD'))).toEqual(head)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})
test('fILE-01 Git ignored/default skips remain visible in explicit tree, absent from search; private/link/hardlinks never followed', async () => {
  const f = await fixture()
  try {
    git(f.cwd, 'init')
    writeFileSync(join(f.cwd, '.gitignore'), 'ignored/\n*.cache\n')
    for (const dir of ['ignored', 'node_modules', '.ssh']) {
      mkdirSync(join(f.cwd, dir))
      writeFileSync(join(f.cwd, dir, 'needle.ts'), 'fixture')
    }
    writeFileSync(join(f.cwd, 'needle.ts'), 'visible')
    writeFileSync(join(f.cwd, '.env'), 'do not read')
    const outside = join(f.root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'escaped.ts'), 'outside')
    symlinkSync(outside, join(f.cwd, 'escape'), 'junction')
    linkSync(join(f.cwd, 'needle.ts'), join(f.cwd, 'hard.ts'))
    const root = await f.files.list(f.target)
    expect(root.entries.find((e) => e.name === 'ignored')).toMatchObject({
      ignored: 'yes',
      availability: 'available',
    })
    expect(root.entries.find((e) => e.name === 'node_modules')).toMatchObject({ scanSkipped: true })
    expect(root.entries.find((e) => e.name === '.env')?.availability).toBe('private')
    expect(root.entries.find((e) => e.name === 'escape')?.availability).toBe('link')
    expect(root.entries.find((e) => e.name === 'hard.ts')?.availability).toBe('unsupported')
    const ignored = await f.files.list(f.target, root.entries.find((e) => e.name === 'ignored')!.id)
    expect(ignored.entries.map((e) => e.name)).toEqual(['needle.ts'])
    expect((await f.files.search(f.target, 'needle')).entries).toEqual([]) // visible file has 2 hard links
    await expect(
      f.files.locate(f.target, root.entries.find((e) => e.name === 'escape')!.id),
    ).rejects.toThrow('文件或目录')
    await expect(
      f.files.locate(f.target, root.entries.find((e) => e.name === '.env')!.id),
    ).rejects.toThrow('文件或目录')
    expect(readFileSync(join(outside, 'escaped.ts'), 'utf8')).toBe('outside')
  } finally {
    await f.close()
  }
})
test('fILE-01 changed directory rejects old pagination; replaced file handle cannot locate successor and fresh root recovers', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 110; i++) {
      writeFileSync(join(f.cwd, `${i}.txt`), 'before')
    }
    const first = await f.files.list(f.target)
    writeFileSync(join(f.cwd, 'new.txt'), 'external create')
    await expect(f.files.list(f.target, first.directory.id, first.cursor!)).rejects.toThrow('分页')
    const node = required(first.entries[0])
    renameSync(join(f.cwd, node.path), join(f.cwd, 'moved.txt'))
    writeFileSync(join(f.cwd, node.path), 'replacement')
    await expect(f.files.locate(f.target, node.id)).rejects.toThrow('文件或目录')
    expect((await f.files.search(f.target, 'new.txt')).entries[0]?.name).toBe('new.txt')
  } finally {
    await f.close()
  }
})
test('fILE-01 target-bound handles, physical aliases and subtree roots cannot disclose siblings; restart invalidates handles', async () => {
  const f = await fixture()
  try {
    mkdirSync(join(f.cwd, 'sub'))
    writeFileSync(join(f.cwd, 'sub', 'inside.ts'), 'in')
    writeFileSync(join(f.cwd, 'sibling.ts'), 'out')
    const opened = await f.app.get(WorkspaceService).open(join(f.cwd, 'sub'))
    if (!opened.ok) {
      throw Error('sub root rejected')
    }
    symlinkSync(join(f.cwd, 'sub'), join(f.root, 'alias'), 'junction')
    const alias = await f.app.get(WorkspaceService).open(join(f.root, 'alias'))
    expect(alias.ok && alias.workspace.id).toBe(opened.workspace.id)
    const target = { workspaceId: opened.workspace.id },
      r = await f.files.list(target)
    expect(r.entries.map((e) => e.name)).toEqual(['inside.ts'])
    await expect(f.files.locate(f.target, required(r.entries[0]).id)).rejects.toThrow('文件或目录')
    await f.restart()
    await expect(f.files.locate(target, required(r.entries[0]).id)).rejects.toThrow('文件或目录')
    expect((await f.files.list(target)).entries.map((e) => e.name)).toEqual(['inside.ts'])
  } finally {
    await f.close()
  }
})
test('fILE-01 real Windows ACL denial is explicit and restoration recovers browsing', async () => {
  const f = await fixture(),
    blocked = join(f.cwd, 'blocked')
  mkdirSync(blocked)
  writeFileSync(join(blocked, 'inside.ts'), 'real ACL')
  const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
  }).match(/S-1-[\d-]+/)?.[0]
  if (!sid) {
    throw Error('Actual Windows SID required')
  }
  const acl = (...args: string[]) =>
    execFileSync('icacls', [blocked, ...args], { windowsHide: true, stdio: 'pipe' })
  try {
    const before = await f.files.list(f.target),
      id = before.entries.find((e) => e.name === 'blocked')!.id
    acl('/deny', `*${sid}:(RD)`)
    await expect(f.files.list(f.target, id)).rejects.toThrow('文件或目录')
    expect(
      (await f.files.list(f.target)).entries.find((e) => e.name === 'blocked')?.availability,
    ).toBe('inaccessible')
    acl('/remove:d', `*${sid}`)
    expect((await f.files.list(f.target, id)).entries[0]?.name).toBe('inside.ts')
  } finally {
    acl('/remove:d', `*${sid}`)
    await f.close()
  }
})
test('fILE-01 cancelled IO retains four slots until actual fixture gate settles, then releases; SDK background survives', async () => {
  const f = await fixture()
  let release: () => void = noop
  try {
    const run = f.start()
    await f.ready(run.sessionId)
    const kernel = f.app.get(KernelService),
      before = kernel.list().find((k) => k.sessionId === run.sessionId)
    const ws = f.app.get(WorkspaceService),
      original = ws.environmentDirectory.bind(ws)
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const spy = vi.spyOn(ws, 'environmentDirectory').mockImplementation(async (...args) => {
      await gate
      return original(...args)
    })
    const abort = new AbortController()
    const pending = Array.from({ length: 4 }, () =>
      f.files.list(f.target, undefined, undefined, abort.signal),
    )
    const settled = Promise.allSettled(pending)
    abort.abort()
    await expect(f.files.list(f.target)).rejects.toThrow('繁忙')
    release()
    expect((await settled).every((r) => r.status === 'rejected')).toBe(true)
    spy.mockRestore()
    expect((await f.files.list(f.target)).directory.kind).toBe('directory')
    expect(kernel.list().find((k) => k.sessionId === run.sessionId)).toMatchObject({
      pid: before?.pid,
      epoch: before?.epoch,
      state: 'running',
    })
    await kernel.abort(run.sessionId, run.turnId)
    await run.promise
  } finally {
    release()
    await f.close()
  }
})
test('fILE-01 bounded search reports partial results and does not scan dependency children', async () => {
  const f = await fixture()
  try {
    mkdirSync(join(f.cwd, 'node_modules'))
    for (let i = 0; i < 5100; i++) {
      writeFileSync(join(f.cwd, 'node_modules', `${i}.txt`), 'skip')
    }
    writeFileSync(join(f.cwd, 'target.ts'), 'visible')
    expect(await f.files.search(f.target, 'target')).toMatchObject({
      visited: 2,
      complete: true,
      entries: [{ name: 'target.ts' }],
    })
    for (let i = 0; i < 110; i++) {
      writeFileSync(join(f.cwd, `match-${i}.ts`), 'bounded')
    }
    const limited = await f.files.search(f.target, 'match-')
    expect(limited.complete).toBe(false)
    // Either the time limit or the result cap may stop a real scan first, especially
    // under the complete suite's IO load. Both must preserve an honest partial result.
    expect(limited.entries.length).toBeLessThanOrEqual(100)
    expect(limited.entries.every((entry) => entry.name.startsWith('match-'))).toBe(true)
    expect(limited.diagnostic).toContain('限额')
  } finally {
    await f.close()
  }
})
test('fILE-01 actual HTTP pairing boundary rejects browser/raw paths and malformed cursors without SDK or metadata writes', async () => {
  const f = await fixture()
  try {
    const browser = await authorizedHeaders(f.app, 24477),
      desktop = await authorizedHeaders(f.app, 24477, 'desktop')
    const url = '/api/files/list?workspaceId=' + f.target.workspaceId
    expect((await f.app.inject({ url, headers: browser })).statusCode).toBe(403)
    expect(
      (await f.app.inject({ url: url + '&path=../outside', headers: desktop })).statusCode,
    ).toBe(400)
    expect(
      (await f.app.inject({ url: url + '&cursor=' + randomUUID(), headers: desktop })).statusCode,
    ).toBe(409)
    const r = await f.app.inject({ url, headers: desktop })
    expect(r.statusCode).toBe(200)
    expect(fileListingSchema.parse(r.json()).root).toBe(f.cwd)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('fILE-01 coordinated daemon exit drains actual pending file IO before closing SQLite and rejects new reads', async () => {
  const f = await fixture()
  let release: () => void = noop
  try {
    const ws = f.app.get(WorkspaceService),
      original = ws.environmentDirectory.bind(ws)
    const gate = new Promise<void>((done) => {
      release = done
    })
    vi.spyOn(ws, 'environmentDirectory').mockImplementation(async (...args) => {
      await gate
      return original(...args)
    })
    const storeClose = vi.spyOn(f.app.get(SessionStore), 'close')
    const readerClose = vi.spyOn(f.files, 'close')
    const pending = f.files.list(f.target)
    const closing = f.app.close()
    await vi.waitFor(() => expect(readerClose).toHaveBeenCalledOnce())
    await expect(f.files.list(f.target)).rejects.toThrow('正在关闭')
    expect(storeClose).not.toHaveBeenCalled()
    release()
    expect((await pending).directory.kind).toBe('directory')
    await closing
    expect(storeClose).toHaveBeenCalledOnce()
  } finally {
    release()
    await f.close()
  }
})
