import type { FileHandle } from 'node:fs/promises'

/* oxlint-disable no-await-in-loop -- actual filesystem cases share one isolated fixture and require sequential cleanup. */
import { randomUUID } from 'node:crypto'
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { fileReadingSchema, Redactor } from '@pi-workbench/shared'

import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { readFileSnapshot } from '../dist/modules/files/file-reading.js'
import { FileService } from '../dist/modules/files/file.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'
import { setupChangeFixture } from './helpers/change-fixture.js'
import { fixtureGit as git } from './helpers/git.js'

type ReadPrototype = {
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number; buffer: Buffer }>
}
const isReadPrototype = (value: unknown): value is ReadPrototype =>
  typeof value === 'object' && value !== null && 'read' in value && typeof value.read === 'function'

const noop = () => undefined
async function fixture() {
  const f = await setupChangeFixture(),
    ws = await f.app.get(WorkspaceService).open(f.cwd)
  if (!ws.ok) {
    throw Error('reading scope rejected')
  }
  return {
    ...f,
    get app() {
      return f.app
    },
    target: { workspaceId: ws.workspace.id },
    get files() {
      return f.app.get(FileService)
    },
  }
}
test('fILE-02 actual UTF8/BOM/CRLF lines, opaque handle and absolute Unicode path share byte version without Git writes', async () => {
  const f = await fixture()
  try {
    git(f.cwd, 'init')
    writeFileSync(join(f.cwd, '中文 code.ts'), '\ufeffconst 中文 = 1\r\nconst second = 2\r\n')
    const head = readFileSync(join(f.cwd, '.git', 'HEAD'))
    const listing = await f.files.list(f.target),
      node = listing.entries.find((n) => n.name === '中文 code.ts')
    if (!node) {
      throw Error('file missing')
    }
    const a = fileReadingSchema.parse(
        await f.files.read({ target: f.target, source: { file: node.id } }),
      ),
      b = await f.files.read({
        target: f.target,
        source: { path: join(f.cwd, '中文 code.ts') },
        version: a.version!,
      })
    expect(a).toMatchObject({
      status: 'ready',
      lines: ['const 中文 = 1', 'const second = 2', ''],
      absolutePath: join(f.cwd, '中文 code.ts'),
    })
    expect(b.version).toBe(a.version)
    expect(readFileSync(join(f.cwd, '.git', 'HEAD'))).toEqual(head)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})
test('fILE-02 binary, invalid encoding, size/line limits and multiline redaction decline content honestly', async () => {
  const f = await fixture()
  try {
    const cases: [string, Buffer | string, string][] = [
      ['binary.dat', Buffer.from([0, 1, 2]), 'binary'],
      ['legacy.txt', Buffer.from([0xff, 0xfe, 0xa1]), 'encoding'],
      ['huge.ts', 'x'.repeat(256 * 1024 + 1), 'too_large'],
      ['lines.ts', 'a\n'.repeat(10001), 'too_large'],
      [
        'key.txt',
        '-----BEGIN PRIVATE KEY-----\nTEST ONLY\n-----END PRIVATE KEY-----',
        'redacted_lines',
      ],
    ]
    for (const [path, bytes, status] of cases) {
      writeFileSync(join(f.cwd, path), bytes)
      const data = await f.files.read({ target: f.target, source: { path } })
      expect(data.status).toBe(status)
      expect(data.lines).toEqual([])
    }
    writeFileSync(
      join(f.cwd, 'redacted.ts'),
      'api_key = "isolated-secret-marker"\nexport const x=1',
    )
    expect(
      (await f.files.read({ target: f.target, source: { path: 'redacted.ts' } })).lines,
    ).toEqual(['api_key = "«redacted»"', 'export const x=1'])
  } finally {
    await f.close()
  }
})
test('fILE-02 actual external mutation, replacement and deletion never return old code as current; explicit fresh read recovers', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'code.ts')
    writeFileSync(path, 'first\nsecond')
    const a = await f.files.read({ target: f.target, source: { path: 'code.ts' } })
    writeFileSync(path, 'external\nchanged')
    const stale = await f.files.read({
      target: f.target,
      source: { path: 'code.ts' },
      version: a.version!,
    })
    expect(stale).toMatchObject({ status: 'changed', lines: [] })
    const b = await f.files.read({ target: f.target, source: { path: 'code.ts' } })
    expect(b.lines).toEqual(['external', 'changed'])
    renameSync(path, join(f.cwd, 'old.ts'))
    writeFileSync(path, 'replacement')
    expect(
      (await f.files.read({ target: f.target, source: { path: 'code.ts' }, version: b.version! }))
        .status,
    ).toBe('changed')
    unlinkSync(path)
    await expect(f.files.read({ target: f.target, source: { path: 'code.ts' } })).rejects.toThrow(
      '已变化',
    )
  } finally {
    await f.close()
  }
})
test('fILE-02 real path hints cannot expand registered root or follow junctions/hardlinks/private/alternate stream paths', async () => {
  const f = await fixture()
  try {
    const outside = join(f.root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.ts'), 'outside')
    symlinkSync(outside, join(f.cwd, 'linked'), 'junction')
    writeFileSync(join(f.cwd, 'one.ts'), 'inside')
    linkSync(join(f.cwd, 'one.ts'), join(f.cwd, 'hard.ts'))
    writeFileSync(join(f.cwd, '.env'), 'private')
    for (const path of [
      '../outside/secret.ts',
      join(outside, 'secret.ts'),
      'linked/secret.ts',
      'hard.ts',
      '.env',
      'one.ts:stream',
    ]) {
      await expect(f.files.read({ target: f.target, source: { path } })).rejects.toThrow(
        /已变化|无效|授权/,
      )
    }
    const other = await f.app.get(WorkspaceService).open(outside)
    if (!other.ok) {
      throw Error('outside fixture scope')
    }
    const own = await f.files.list({ workspaceId: other.workspace.id })
    const otherFile = own.entries[0]
    if (!otherFile) {
      throw Error('outside file missing')
    }
    await expect(
      f.files.read({ target: f.target, source: { file: otherFile.id } }),
    ).rejects.toThrow(/已变化|无效|授权/)
  } finally {
    await f.close()
  }
})
test('fILE-02 actual SDK/SQLite/independent ledger history stays immutable when opening modified current code after restart', async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.cwd, 'code.ts'), 'baseline\n')
    const turn = await f.collect(() => writeFileSync(join(f.cwd, 'code.ts'), 'round result\n'))
    const review = f.app.get(ChangeReviewService),
      list = await review.list(turn.turnId, 0)
    const file = list.files[0]
    if (!file) {
      throw Error('diff missing')
    }
    const diff = await review.diff(turn.turnId, file.id),
      round = f.app.get(ChangeService).history(turn.sessionId)
    writeFileSync(join(f.cwd, 'code.ts'), 'later external\n')
    expect((await f.files.read({ target: f.target, source: { path: 'code.ts' } })).lines).toContain(
      'later external',
    )
    expect(await review.diff(turn.turnId, file.id)).toEqual(diff)
    await f.restart()
    expect(f.app.get(ChangeService).history(turn.sessionId)).toEqual(round)
    expect(await f.app.get(ChangeReviewService).diff(turn.turnId, file.id)).toEqual(diff)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})
test('fILE-02 actual HTTP is desktop paired and validates malformed input, unknown session and expected version', async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.cwd, 'read.ts'), 'actual')
    const desktop = await authorizedHeaders(f.app, 24477, 'desktop'),
      browser = await authorizedHeaders(f.app, 24477),
      url = '/api/files/read?' + new URLSearchParams({ ...f.target, path: 'read.ts' })
    expect((await f.app.inject({ url, headers: browser })).statusCode).toBe(403)
    const response = await f.app.inject({ url, headers: desktop })
    expect(response.statusCode).toBe(200)
    expect(fileReadingSchema.parse(response.json()).lines).toEqual(['actual'])
    expect((await f.app.inject({ url: url + '&version=no', headers: desktop })).statusCode).toBe(
      400,
    )
    expect(
      (await f.app.inject({ url: url + '&file=' + randomUUID(), headers: desktop })).statusCode,
    ).toBe(400)
    expect(
      (
        await f.app.inject({
          url: '/api/files/read?sessionId=' + randomUUID() + '&path=read.ts',
          headers: desktop,
        })
      ).statusCode,
    ).toBe(409)
  } finally {
    await f.close()
  }
})
test('fILE-02 cancelled snapshot checks return no bytes and shared read admission retains actual work until settled', async () => {
  const f = await fixture()
  let release: () => void = noop
  try {
    writeFileSync(join(f.cwd, 'read.ts'), 'actual')
    const signal = new AbortController()
    signal.abort()
    await expect(
      readFileSnapshot(f.cwd, 'read.ts', new Redactor(), undefined, signal.signal),
    ).rejects.toThrow(/abort/i)
    const ws = f.app.get(WorkspaceService),
      original = ws.environmentDirectory.bind(ws),
      gate = new Promise<void>((r) => {
        release = r
      })
    vi.spyOn(ws, 'environmentDirectory').mockImplementation(async (...args) => {
      await gate
      return original(...args)
    })
    const requests = Array.from({ length: 4 }, () =>
      f.files.read({ target: f.target, source: { path: 'read.ts' } }, signal.signal),
    )
    const done = Promise.allSettled(requests)
    await expect(f.files.list(f.target)).rejects.toThrow('繁忙')
    release()
    expect((await done).every((r) => r.status === 'rejected')).toBe(true)
  } finally {
    release()
    await f.close()
  }
})

// A real descriptor is read; only its completion hook injects a disk change before
// the production post-read proof. This is fault injection, not SDK provenance.
test('fILE-02 descriptor completion mutation/replacement rejects the entire read without mixed bytes', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'race.ts')
    writeFileSync(path, 'A'.repeat(8192))
    const descriptor = await open(path, 'r')
    const prototype: unknown = Object.getPrototypeOf(descriptor)
    if (!isReadPrototype(prototype)) {
      throw Error('Installed Node FileHandle read method missing')
    }
    const original = prototype.read
    await descriptor.close()
    let changed = false
    const spy = vi.spyOn(prototype, 'read').mockImplementation(async function (
      this: FileHandle,
      ...args: Parameters<typeof original>
    ) {
      const result = await original.apply(this, args)
      if (!changed) {
        changed = true
        writeFileSync(path, 'B'.repeat(8192))
      }
      return result
    })
    try {
      await expect(readFileSnapshot(f.cwd, 'race.ts', new Redactor())).rejects.toThrow(
        '读取期间文件变化',
      )
      expect(changed).toBe(true)
    } finally {
      spy.mockRestore()
    }
    expect(readFileSync(path, 'utf8')).toBe('B'.repeat(8192))
  } finally {
    await f.close()
  }
})
