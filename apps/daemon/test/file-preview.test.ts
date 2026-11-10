/* oxlint-disable no-await-in-loop -- Version races and physical mutations must run sequentially inside the isolated fixture. */
import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { Redactor } from '@pi-workbench/shared'

import { previewJpeg, previewPdf, previewPng } from '../../../e2e/helpers/preview-files.js'
import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
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
  const target = { workspaceId: w.workspace.id }
  return {
    ...f,
    get app() {
      return f.app
    },
    get files() {
      return f.app.get(FileService)
    },
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
      ['vector.svg', Buffer.from('<svg/>')],
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

test('fILE-04 actual PNG, JPEG, PDF and strict UTF-8 text retain exact binary bytes, identity version and explicit uncertain current-disk provenance', async () => {
  const f = await fixture()
  try {
    for (const [name, kind, bytes] of [
      ['中文图片.png', 'png', previewPng()],
      ['照片.jpg', 'jpeg', previewJpeg()],
      ['报告.pdf', 'pdf', previewPdf()],
      ['说明.md', 'text', Buffer.from('\ufeff# 纯文本\r\n<script>not code</script>')],
    ] as const) {
      writeFileSync(join(f.cwd, name), bytes)
      const snapshot = await f.files.preview(f.input(name))
      expect(snapshot).toMatchObject({
        kind,
        bytes: bytes.length,
        source: 'current-disk-uncertain',
      })
      expect(Buffer.from(snapshot.content, 'base64')).toEqual(bytes)
      expect(snapshot.version).toBe((await f.files.read(f.input(name))).version)
    }
  } finally {
    await f.close()
  }
})

test('fILE-04 binary original over text limit has a complete stable version and verified handoff; same-length writes, replacements and deletion refuse the preview version', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, '大报告.pdf'),
      bytes = Buffer.from(
        previewPdf()
          .toString()
          .replace('%%EOF', ' '.repeat(300000) + '%%EOF'),
      )
    writeFileSync(path, bytes)
    const snapshot = await f.files.preview(f.input(path))
    expect(snapshot.bytes).toBe(bytes.length)
    expect(Buffer.from(snapshot.content, 'base64')).toEqual(bytes)
    const input = { ...f.input(path, snapshot.version), action: 'system' as const, line: 1 }
    expect(await f.files.externalTarget(input)).toMatchObject({ kind: 'file', action: 'system' })
    writeFileSync(path, Buffer.from(bytes).fill(32, 50, 60))
    await expect(f.files.externalTarget(input)).rejects.toThrow('版本已变化')
    await expect(f.files.preview(f.input(path, snapshot.version))).rejects.toThrow('外部变化')
    writeFileSync(path, bytes)
    const b = await f.files.preview(f.input(path))
    renameSync(path, path + '.old')
    writeFileSync(path, bytes)
    await expect(f.files.preview(f.input(path, b.version))).rejects.toThrow('外部变化')
    unlinkSync(path)
    await expect(f.files.preview(f.input(path, b.version))).rejects.toThrow(/.+/)
  } finally {
    await f.close()
  }
})

test('fILE-04 unsupported, signature mismatch, oversize and secret originals fail without content; private verification returns no raw bytes', async () => {
  const f = await fixture(),
    access = new AccessService(24477, new Redactor())
  try {
    for (const [name, bytes] of [
      ['fake.png', Buffer.from('<html>fake</html>')],
      ['fake.pdf', Buffer.from('%PDF-1.7 no EOF')],
      ['huge.jpg', Buffer.alloc(8 * 1024 * 1024 + 1)],
      ['vector.svg', Buffer.from('<svg/>')],
      ['key.txt', Buffer.from('sk-proj-' + 'a'.repeat(60))],
    ] as const) {
      writeFileSync(join(f.cwd, name), bytes)
      await expect(f.files.preview(f.input(name))).rejects.toThrow(/.+/)
    }
    writeFileSync(join(f.cwd, 'safe.png'), previewPng())
    const original = await f.files.preview(f.input('safe.png'))
    const result = await resolveHostPreview(access, f.files, new Redactor(), {
      type: 'host-preview',
      id: randomUUID(),
      checkOnly: true,
      cookie: access.redeem(access.issueTicket('desktop').code, 'fixture')!.cookie.split(';')[0],
      input: f.input('safe.png', original.version),
    })
    expect(result).toMatchObject({ ok: true, verification: { version: original.version } })
    expect(result).not.toHaveProperty('snapshot')
    expect(JSON.stringify(result)).not.toContain(original.content)
  } finally {
    access.close()
    await f.close()
  }
})

test('fILE-04 current disk artifact preview never rewrites actual SDK/SQLite/ledger historical versions or fills missing historical content after restart', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, '历史产物.html')
    writeFileSync(path, '<h1>baseline</h1>')
    const turn = await f.collect(() => writeFileSync(path, '<h1>round artifact</h1>'))
    const review = f.app.get(ChangeReviewService),
      list = await review.list(turn.turnId, 0)
    if (!list.files[0]) {
      throw Error('artifact history fixture missing')
    }
    const diff = await review.diff(turn.turnId, list.files[0].id),
      history = f.app.get(ChangeService).history(turn.sessionId)
    writeFileSync(path, '<h1>current external version</h1>')
    const current = await f.files.preview(f.input(path))
    expect(Buffer.from(current.content, 'base64').toString()).toContain('current external')
    expect(current.source).toBe('current-disk-uncertain')
    expect(await review.diff(turn.turnId, list.files[0].id)).toEqual(diff)
    unlinkSync(path)
    await expect(f.files.preview(f.input(path))).rejects.toThrow(/.+/)
    await f.restart()
    expect(f.app.get(ChangeService).history(turn.sessionId)).toEqual(history)
    expect(await f.app.get(ChangeReviewService).diff(turn.turnId, list.files[0].id)).toEqual(diff)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})
