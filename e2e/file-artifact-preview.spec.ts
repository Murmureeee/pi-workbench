/* oxlint-disable no-await-in-loop -- Real files, isolated windows and version races share one actual Electron fixture. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { setupChanges } from './helpers/change-fixture.js'
import { previewJpeg, previewPdf, previewPng } from './helpers/preview-files.js'

type Fixture = Awaited<ReturnType<typeof setupChanges>>
const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
const open = (f: Fixture, sessionId: string, path: string, id = randomUUID()) =>
  f.page.evaluate(
    (q) =>
      window.piWorkbench!.previewFile({
        id: q.id,
        input: { target: { sessionId: q.sessionId }, source: { path: q.path } },
      }),
    { sessionId, path, id },
  )
const inspect = (f: Fixture, code: string, index = 0) => f.desktop.previewControl('js', code, index)
const headers = (f: Fixture) => f.desktop.previewControl('headers')
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function browse(f: Fixture, name: string) {
  await f.page.getByRole('button', { name: '浏览与查找文件', exact: true }).click()
  await f.page.getByRole('textbox', { name: '文件名或相对路径', exact: true }).fill(name)
  const browser = f.page.getByRole('region', { name: '授权文件浏览', exact: true })
  await browser.getByRole('button', { name, exact: true }).click()
  await browser.getByRole('button', { name: '只读查看代码', exact: true }).click()
}

test('FILE-04 actual PNG JPEG PDF HTML and text previews display verified pixels or inert text, real path/provenance/version, and zero PDF action requests', async () => {
  test.setTimeout(150000)
  const f = await setupChanges(undefined, true)
  let requests = 0
  const trap = createServer((_q, r) => {
    requests++
    r.end('blocked')
  })
  await new Promise<void>((r) => trap.listen(0, '127.0.0.1', r))
  const address = trap.address()
  if (!address || typeof address === 'string') {
    throw Error('PDF action trap failed')
  }
  try {
    const s = await f.send('实际文件产物预览')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const sources = [
      ['中文图片.png', previewPng(), 1],
      ['照片.jpg', previewJpeg(), 1],
      ['报告.pdf', previewPdf(2, `http://127.0.0.1:${address.port}/pdf-action`), 2],
      [
        '说明.md',
        Buffer.from('# 纯文本\n<script>window.ran=true</script>\n[link](http://127.0.0.1:1)'),
        0,
      ],
      ['页面.html', Buffer.from('<h1>静态 HTML</h1><script>window.ran=true</script>'), 0],
    ] as const
    const results: unknown[] = []
    for (const [name, bytes, images] of sources) {
      writeFileSync(join(f.cwd, name), bytes)
      expect(await open(f, s.id, name)).toMatchObject({ status: 'requested' })
      const checked = await headers(f)
      expect(checked).toEqual([
        expect.objectContaining({ text: expect.stringContaining(join(f.cwd, name)) }),
      ])
      expect(JSON.stringify(checked)).toContain('修改来源未判定')
      expect(JSON.stringify(checked)).toContain('不代表历史产物版本')
      expect(JSON.stringify(checked)).toMatch(/[a-f0-9]{64}/)
      const content = await inspect(
        f,
        `({text:document.body.innerText,images:Array.from(document.images,i=>({width:i.naturalWidth,height:i.naturalHeight,loaded:i.complete})),script:typeof window.ran,bridge:typeof window.piWorkbench,node:typeof process})`,
      )
      expect(content).toMatchObject({ script: 'undefined', bridge: 'undefined', node: 'undefined' })
      await expect
        .poll(() =>
          inspect(
            f,
            'Array.from(document.images,i=>i.complete&&i.naturalWidth>0).filter(Boolean).length',
          ),
        )
        .toBe(images)
      if (name.endsWith('.md')) {
        expect(await inspect(f, 'document.querySelector("pre").textContent')).toContain(
          '<script>window.ran=true</script>',
        )
      }
      if (name.endsWith('.png')) {
        expect(
          await inspect(
            f,
            '({w:document.images[0].naturalWidth,h:document.images[0].naturalHeight})',
          ),
        ).toEqual({ w: 48, h: 32 })
      }
      if (name.endsWith('.jpg')) {
        expect(
          await inspect(
            f,
            '({w:document.images[0].naturalWidth,h:document.images[0].naturalHeight})',
          ),
        ).toEqual({ w: 32, h: 24 })
      }
      if (name.endsWith('.pdf')) {
        expect(await inspect(f, 'document.body.innerText')).toContain('第 2 页／共 2 页')
        const screenshot = await f.desktop.previewControl('screenshot')
        if (typeof screenshot !== 'string') {
          throw Error('actual PDF screenshot missing')
        }
        writeFileSync(
          join(evidence, 'artifact-pdf-rendered.png'),
          Buffer.from(screenshot, 'base64'),
        )
      }
      results.push({ name, header: checked, content })
      await f.desktop.previewControl('closeAll')
    }
    const long = join(
      f.cwd,
      ...Array.from({ length: 5 }, (_, i) => '长图片目录' + i + 'a'.repeat(40)),
    )
    mkdirSync(long, { recursive: true })
    writeFileSync(join(long, '长路径.png'), previewPng())
    expect(await open(f, s.id, join(long, '长路径.png'))).toMatchObject({ status: 'requested' })
    expect(await headers(f)).toEqual([
      expect.objectContaining({ text: expect.stringContaining(join(long, '长路径.png')) }),
    ])
    expect(requests).toBe(0)
    writeFileSync(
      join(evidence, 'artifact-preview-results.json'),
      JSON.stringify(
        {
          source: 'actual Electron/native Windows PDF, authored local fixtures; CDP observations',
          results,
          requests,
          providerRequests: 0,
        },
        null,
        2,
      ),
    )
    expect(f.sends()).toBe(1)
  } finally {
    await f.close()
    await new Promise<void>((r, j) => trap.close((e) => (e ? j(e) : r())))
  }
})

test('FILE-04 native original menu revalidates the preview version and live checks hide changed replaced or deleted files without auto-replacing snapshots', async () => {
  test.setTimeout(150000)
  const f = await setupChanges(undefined, true)
  try {
    const path = join(f.cwd, '原件.png')
    writeFileSync(path, previewPng())
    const s = await f.send('原件版本校验')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    expect(await open(f, s.id, path)).toMatchObject({ status: 'requested' })
    await f.desktop.previewControl('original', 'reveal')
    await expect.poll(() => f.desktop.shellCalls).toEqual([{ action: 'reveal', path }])
    await expect
      .poll(async () => JSON.stringify(await headers(f)))
      .toContain('已请求文件管理器定位')
    await f.desktop.previewControl('original', 'system')
    await expect.poll(() => f.desktop.shellCalls.length).toBe(2)
    const changed = Buffer.from(previewPng())
    changed[45] = (changed[45] ?? 0) ^ 1
    writeFileSync(path, changed)
    await f.desktop.previewControl('original', 'reveal')
    await expect.poll(async () => JSON.stringify(await headers(f))).toContain('旧内容已隐藏')
    expect(await f.desktop.previewControl('list')).toEqual([])
    expect(f.desktop.shellCalls).toHaveLength(2)
    await f.desktop.previewControl('closeAll')
    writeFileSync(path, previewPng())
    expect(await open(f, s.id, path)).toMatchObject({ status: 'requested' })
    renameSync(path, path + '.old')
    writeFileSync(path, previewPng())
    await expect
      .poll(async () => JSON.stringify(await headers(f)), { timeout: 10000 })
      .toContain('旧内容已隐藏')
    expect(await f.desktop.previewControl('list')).toEqual([])
    await f.desktop.previewControl('closeAll')
    expect(await open(f, s.id, path)).toMatchObject({ status: 'requested' })
    unlinkSync(path)
    await expect
      .poll(async () => JSON.stringify(await headers(f)), { timeout: 10000 })
      .toContain('旧内容已隐藏')
    expect(f.desktop.shellCalls).toHaveLength(2)
  } finally {
    await f.close()
  }
})

test('FILE-04 unsupported corrupt oversized and PDF page-limit files provide usable fallback; held cancellation and navigation produce no late window and recover', async () => {
  test.setTimeout(150000)
  const f = await setupChanges(undefined, true)
  try {
    const s = await f.send('预览失败恢复')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    for (const [path, bytes, reason] of [
      ['矢量.svg', Buffer.from('<svg/>'), /不支持/],
      ['损坏.png', previewPng().subarray(0, 40), /损坏|完整/],
      ['像素超限.png', previewPng(9000, 9000), /像素限额/],
      ['过大.pdf', Buffer.alloc(8 * 1024 * 1024 + 1), /限额/],
      ['页数超限.pdf', previewPdf(13), /12 页/],
      ['损坏.pdf', Buffer.from('%PDF-1.7\nbroken\n%%EOF'), /损坏/],
    ] as const) {
      writeFileSync(join(f.cwd, path), bytes)
      expect(await open(f, s.id, path)).toMatchObject({
        status: 'failed',
        message: expect.stringMatching(reason),
      })
      expect(await headers(f)).toEqual([])
    }
    await browse(f, '矢量.svg')
    await f.page.getByRole('button', { name: '隔离文件预览', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '隔离文件预览', exact: true })).toContainText(
      '不支持',
    )
    await expect(
      f.page.getByRole('button', { name: '在文件管理器定位', exact: true }),
    ).toBeEnabled()
    await f.page.getByRole('button', { name: '关闭代码阅读', exact: true }).click()
    writeFileSync(join(f.cwd, '恢复.pdf'), previewPdf())
    f.desktop.holdExternal()
    const before = f.desktop.proofCount(),
      id = randomUUID(),
      pending = open(f, s.id, '恢复.pdf', id)
    await expect.poll(() => f.desktop.proofCount()).toBe(before + 1)
    await f.page.evaluate((requestId) => window.piWorkbench!.cancelPreview(requestId), id)
    f.desktop.releaseExternal()
    expect(await pending).toMatchObject({ status: 'cancelled' })
    expect(await headers(f)).toEqual([])
    expect(await open(f, s.id, '恢复.pdf')).toMatchObject({ status: 'requested' })
    await f.desktop.previewControl('closeAll')
    f.desktop.holdExternal()
    const count = f.desktop.proofCount(),
      late = open(f, s.id, '恢复.pdf').catch(() => null)
    await expect.poll(() => f.desktop.proofCount()).toBe(count + 1)
    await f.page.reload()
    f.desktop.releaseExternal()
    await late
    await expect.poll(() => headers(f)).toEqual([])
    await f.open(s.id)
    expect(await open(f, s.id, '恢复.pdf')).toMatchObject({ status: 'requested' })
  } finally {
    await f.close()
  }
})

test('FILE-04 raster assets remain isolated from other previews and host, with actual background PID, light/dark narrow layouts and same-profile restart restoring no preview', async () => {
  test.setTimeout(150000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, '隔离.png'), previewPng())
    const s = await f.send('预览主会话')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const background = await f.send('保持 FILE-04 后台任务', true)
    await f.ready(background.id)
    const running = f.kernels.list().find((k) => k.sessionId === background.id)
    expect(running?.pid).toBeGreaterThan(0)
    await f.open(s.id)
    expect(await open(f, s.id, '隔离.png')).toMatchObject({ status: 'requested' })
    const firstAsset = await inspect(f, 'document.images[0].src')
    expect(await open(f, s.id, '隔离.png')).toMatchObject({ status: 'requested' })
    expect(
      await inspect(
        f,
        `({bridge:typeof window.piWorkbench,node:typeof process,opener:window.opener===null})`,
        1,
      ),
    ).toEqual({ bridge: 'undefined', node: 'undefined', opener: true })
    await inspect(f, `document.images[0].src=${JSON.stringify(firstAsset)}`, 1)
    await expect.poll(() => inspect(f, 'document.images[0].naturalWidth', 1)).toBe(0)
    await f.desktop.previewControl('resize')
    await f.desktop.previewControl('appearance', 'dark')
    await expect.poll(async () => JSON.stringify(await headers(f))).toContain('"scheme":"dark"')
    await f.desktop.previewControl('appearance', 'light')
    await expect.poll(async () => JSON.stringify(await headers(f))).toContain('"scheme":"light"')
    expect(f.kernels.list().find((k) => k.sessionId === background.id)).toMatchObject({
      pid: running?.pid,
      epoch: running?.epoch,
      state: 'running',
    })
    await f.desktop.previewControl('crash')
    await expect(f.page.getByRole('textbox', { name: '任务内容' })).toBeVisible()
    expect(f.kernels.list().find((k) => k.sessionId === background.id)).toMatchObject({
      pid: running?.pid,
      epoch: running?.epoch,
      state: 'running',
    })
    await f.stop(background.id)
    await f.restart()
    expect(await headers(f)).toEqual([])
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toEqual([])
    await f.open(s.id)
    expect(await open(f, s.id, '隔离.png')).toMatchObject({ status: 'requested' })
  } finally {
    await f.close()
  }
})

test('FILE-04 normal Electron quit during actual PDF rendering drains its owned native helper before exit', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, '退出中的报告.pdf'), previewPdf(12))
    const s = await f.send('PDF 正常退出收尾')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const pending = open(f, s.id, '退出中的报告.pdf').catch(() => null)
    await expect.poll(() => f.desktop.pdfHelpers.length).toBe(1)
    expect(f.desktop.pdfHelpers.some(alive)).toBe(true)
    f.desktop.requestQuit()
    expect(await f.desktop.waitForExit()).toBe(0)
    await pending
    expect(f.desktop.pdfHelpers.some(alive)).toBe(false)
  } finally {
    await f.close()
  }
})
