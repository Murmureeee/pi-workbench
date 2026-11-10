/* oxlint-disable no-await-in-loop -- Version races and physical mutations must run sequentially inside the isolated fixture. */
import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { Redactor } from '@pi-workbench/shared'

import { resolveHostPreview } from '../dist/modules/files/file-host.js'
import { FileService } from '../dist/modules/files/file.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { setupChangeFixture } from './helpers/change-fixture.js'

const noop = () => undefined
async function fixture() {
  const f = await setupChangeFixture(),
    w = await f.app.get(WorkspaceService).open(f.cwd)
  if (!w.ok) {
    throw Error('preview fixture root failed')
  }
  const files = f.app.get(FileService),
    target = { workspaceId: w.workspace.id }
  return {
    ...f,
    files,
    target,
    input: (path: string, version?: string) => ({
      target,
      source: { path },
      ...(version ? { version } : {}),
    }),
  }
}
test('fILE-07 actual Unicode long-path frozen bytes match FILE-02 version; external rewrite, replacement and deletion refuse old versions', async () => {
  const f = await fixture()
  try {
    const dir = join(f.cwd, ...Array.from({ length: 5 }, (_, i) => '长目录' + i + 'a'.repeat(42)))
    mkdirSync(dir, { recursive: true })
    const path = join(dir, '中文产物.html'),
      text = '\ufeff<h1>真实 HTML</h1>\r\n'
    writeFileSync(path, text)
    const input = f.input(path),
      reading = await f.files.read(input),
      snapshot = await f.files.preview(input)
    expect(snapshot.version).toBe(reading.version)
    expect(Buffer.from(snapshot.content, 'base64').toString('utf8')).toBe(text)
    expect(snapshot).toMatchObject({
      absolutePath: path,
      source: 'current-disk-uncertain',
      bytes: Buffer.byteLength(text),
    })
    writeFileSync(path, '<p>external</p>')
    await expect(f.files.preview(f.input(path, snapshot.version))).rejects.toThrow('外部变化')
    const rewritten = await f.files.preview(input)
    renameSync(path, path + '.old')
    writeFileSync(path, '<p>external</p>')
    await expect(f.files.preview(f.input(path, rewritten.version))).rejects.toThrow('外部变化')
    unlinkSync(path)
    await expect(f.files.preview(input)).rejects.toThrow(/.+/)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})
test('fILE-07 no traversal, private source, junction, hard link or cross-root handle expands authorization', async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.cwd, 'safe.html'), '<p>safe</p>')
    writeFileSync(join(f.root, 'outside.html'), '<p>outside</p>')
    linkSync(join(f.cwd, 'safe.html'), join(f.cwd, 'hard.html'))
    symlinkSync(f.root, join(f.cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const path of [
      '../outside.html',
      join(f.root, 'outside.html'),
      'escape/outside.html',
      'hard.html',
      '.git/config',
      'safe.html:stream',
    ]) {
      await expect(f.files.preview(f.input(path))).rejects.toThrow(/.+/)
    }
    unlinkSync(join(f.cwd, 'hard.html'))
    const node = (await f.files.list(f.target)).entries.find((n) => n.name === 'safe.html')!
    const other = join(f.root, 'second')
    mkdirSync(other)
    const ws = await f.app.get(WorkspaceService).open(other)
    if (!ws.ok) {
      throw Error('other fixture root failed')
    }
    await expect(
      f.files.preview({ target: { workspaceId: ws.workspace.id }, source: { file: node.id } }),
    ).rejects.toThrow(/.+/)
  } finally {
    await f.close()
  }
})
test('fILE-07 rejects oversized, malformed, binary and redaction-sensitive HTML without a partial or transformed original', async () => {
  const f = await fixture()
  try {
    for (const [name, bytes] of [
      ['large.html', Buffer.alloc(256 * 1024 + 1, 65)],
      ['encoding.html', Buffer.from([255, 254])],
      ['binary.html', Buffer.from([0, 1])],
      ['key.html', Buffer.from('<p>sk-proj-' + 'a'.repeat(60) + '</p>')],
      ['text.txt', Buffer.from('text')],
    ] as const) {
      writeFileSync(join(f.cwd, name), bytes)
      await expect(f.files.preview(f.input(name))).rejects.toThrow(/.+/)
    }
  } finally {
    await f.close()
  }
})
test('fILE-07 desktop-only private IPC rechecks identity after IO and refuses restarted or browser pairing', async () => {
  const f = await fixture(),
    redactor = new Redactor()
  let now = 1000
  const access = new AccessService(24477, redactor, () => now),
    restarted = new AccessService(24477, redactor)
  const cookie = (kind: 'desktop' | 'browser') =>
    access.redeem(access.issueTicket(kind).code, 'fixture')!.cookie.split(';')[0]
  try {
    writeFileSync(join(f.cwd, 'safe.html'), '<h1>safe</h1>')
    const q = {
      type: 'host-preview',
      id: randomUUID(),
      cookie: cookie('desktop'),
      input: f.input('safe.html'),
    }
    expect(await resolveHostPreview(access, f.files, redactor, q)).toMatchObject({ ok: true })
    expect(
      await resolveHostPreview(access, f.files, redactor, { ...q, cookie: cookie('browser') }),
    ).toMatchObject({ ok: false })
    expect(await resolveHostPreview(restarted, f.files, redactor, q)).toMatchObject({ ok: false })
    expect(
      await resolveHostPreview(access, f.files, redactor, { ...q, url: 'file:///' }),
    ).toBeNull()
    const original = f.files.preview.bind(f.files)
    vi.spyOn(f.files, 'preview').mockImplementation(async (input) => {
      const result = await original(input)
      now += 8 * 60 * 60 * 1000 + 1
      return result
    })
    const expired = await resolveHostPreview(access, f.files, redactor, q)
    expect(expired?.ok).toBe(false)
    expect(expired && !expired.ok ? expired.message : '').toContain('检查期间')
  } finally {
    access.close()
    restarted.close()
    await f.close()
  }
})
test('fILE-07 bounded preview IO retains all four slots through cancellation and drains before shutdown', async () => {
  const f = await fixture()
  let release: () => void = noop
  try {
    writeFileSync(join(f.cwd, 'safe.html'), '<p>safe</p>')
    const ws = f.app.get(WorkspaceService),
      original = ws.environmentDirectory.bind(ws),
      gate = new Promise<void>((r) => {
        release = r
      })
    vi.spyOn(ws, 'environmentDirectory').mockImplementation(async (...args) => {
      await gate
      return original(...args)
    })
    const pending = Promise.allSettled(
      Array.from({ length: 4 }, () => f.files.preview(f.input('safe.html'))),
    )
    await expect(f.files.preview(f.input('safe.html'))).rejects.toThrow('繁忙')
    let closed = false
    const closing = f.files.close().then(() => {
      closed = true
      return undefined
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    await expect(f.files.preview(f.input('safe.html'))).rejects.toThrow('关闭')
    release()
    expect((await pending).every((r) => r.status === 'fulfilled')).toBe(true)
    await closing
    expect(closed).toBe(true)
  } finally {
    release()
    await f.close()
  }
})
