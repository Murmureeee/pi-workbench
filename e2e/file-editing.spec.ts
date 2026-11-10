/* oxlint-disable no-await-in-loop -- Actual Electron file/session operations are intentionally ordered. */
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { setupChanges } from './helpers/change-fixture.js'

type Fixture = Awaited<ReturnType<typeof setupChanges>>
const noop = () => undefined
const region = (f: Fixture) => f.page.getByRole('region', { name: '手动文件编辑', exact: true })
const text = (f: Fixture) => region(f).getByRole('textbox', { name: '文件编辑稿', exact: true })
async function browse(f: Fixture, name: string, edit = true, selection: string | RegExp = name) {
  await f.page.getByRole('button', { name: '浏览与查找文件', exact: true }).click()
  await f.page.getByRole('textbox', { name: '文件名或相对路径', exact: true }).fill(name)
  const browser = f.page.getByRole('region', { name: '授权文件浏览', exact: true })
  await browser.getByRole('button', { name: selection, exact: true }).click()
  await browser.getByRole('button', { name: '只读查看代码', exact: true }).click()
  if (edit) {
    await f.page.getByRole('button', { name: '手动编辑文件', exact: true }).click()
    await expect(text(f)).toBeVisible()
  }
}
async function close(f: Fixture) {
  await f.page.getByRole('button', { name: '关闭代码阅读', exact: true }).click()
  await f.page.getByRole('button', { name: '关闭文件浏览', exact: true }).click()
}
async function discard(f: Fixture) {
  await region(f).getByRole('button', { name: '丢弃编辑稿', exact: true }).click()
  await f.page.getByRole('button', { name: '明确丢弃稿件', exact: true }).click()
}

test('FILE-03 Electron exact BOM/CRLF manual editing undo and explicit save preserve bytes and report external source without another SDK send', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, false, true)
  try {
    const path = join(f.cwd, '中文编辑.ts')
    writeFileSync(path, '\ufeffconst 中文 = 1\r\nnext\r\n')
    const s = await f.send('手动编辑验收')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await browse(f, '中文编辑.ts')
    await expect(text(f)).toHaveValue('const 中文 = 1\nnext\n')
    await text(f).fill('const 中文 = 2\nnext\n')
    await expect(region(f)).toContainText('未保存')
    await region(f).getByRole('button', { name: '撤销编辑', exact: true }).click()
    await expect(text(f)).toHaveValue('const 中文 = 1\nnext\n')
    await text(f).fill('const 中文 = 3\nnext\n')
    await region(f).getByRole('button', { name: '保存文件', exact: true }).click()
    await expect(region(f)).toContainText('已保存为用户／外部修改')
    expect(readFileSync(path)).toEqual(Buffer.from('\ufeffconst 中文 = 3\r\nnext\r\n'))
    await expect(region(f)).toContainText('与保存基线相同')
    expect(f.sends()).toBe(1)
    await discard(f)
  } finally {
    await f.desktop.setUnloadChoice(1)
    await f.close()
  }
})

test('FILE-03 Electron external rewrite separate overwrite cancellation, another racing version, permission failure and deletion all preserve the draft', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, false, true)
  try {
    const path = join(f.cwd, '冲突.ts')
    writeFileSync(path, 'baseline')
    const s = await f.send('冲突验收')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await browse(f, '冲突.ts')
    await text(f).fill('我的未保存稿')
    writeFileSync(path, 'external one')
    await region(f).getByRole('button', { name: '保存文件', exact: true }).click()
    const dialog = f.page.getByRole('alertdialog', { name: '单独确认覆盖外部修改', exact: true })
    await expect(dialog).toBeVisible()
    expect(readFileSync(path, 'utf8')).toBe('external one')
    await dialog.getByRole('button', { name: '返回保留稿件', exact: true }).click()
    await expect(text(f)).toHaveValue('我的未保存稿')
    await region(f).getByRole('button', { name: '保存文件', exact: true }).click()
    await expect(dialog).toBeVisible()
    writeFileSync(path, 'external two')
    await dialog.getByRole('button', { name: '明确覆盖本次磁盘版本', exact: true }).click()
    await expect(dialog).toBeVisible()
    expect(readFileSync(path, 'utf8')).toBe('external two')
    await dialog.getByRole('button', { name: '明确覆盖本次磁盘版本', exact: true }).click()
    await expect(region(f)).toContainText('已保存为用户／外部修改')
    expect(readFileSync(path, 'utf8')).toBe('我的未保存稿')
    await text(f).fill('失败保留稿')
    chmodSync(path, 0o444)
    try {
      await region(f).getByRole('button', { name: '保存文件', exact: true }).click()
      await expect(region(f)).toContainText('失败')
      await expect(text(f)).toHaveValue('失败保留稿')
    } finally {
      chmodSync(path, 0o666)
    }
    unlinkSync(path)
    await region(f).getByRole('button', { name: '保存文件', exact: true }).click()
    await expect(text(f)).toHaveValue('失败保留稿')
    await discard(f)
  } finally {
    await f.desktop.setUnloadChoice(1)
    await f.close()
  }
})

test('FILE-03 Electron distinct drafts survive file/session switches, view eviction and refresh; unload cancellation retains the draft and restart drops window drafts', async () => {
  test.setTimeout(180000)
  const f = await setupChanges(undefined, false, true)
  try {
    writeFileSync(join(f.cwd, 'one.ts'), 'one')
    writeFileSync(join(f.cwd, 'two.ts'), 'two')
    const s = await f.send('编辑稿所属')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await browse(f, 'one.ts')
    await text(f).fill('first unsaved')
    await close(f)
    await browse(f, 'two.ts')
    await text(f).fill('second unsaved')
    await close(f)
    for (let i = 0; i < 3; i++) {
      const next = await f.send(`淘汰编辑视图${i}`)
      await expect.poll(() => f.changes.history(next.id).rounds[0]?.outcome).toBe('completed')
    }
    await f.page.locator(`[data-library-session="${s.id}"]`).getByRole('button').first().click()
    await browse(f, 'one.ts')
    await expect(text(f)).toHaveValue('first unsaved')
    await close(f)
    await f.desktop.setUnloadChoice(0)
    // A deliberately cancelled navigation need not complete a CDP reload promise.
    await f.page.reload({ timeout: 3000 }).catch((error: unknown) => {
      if (!(error instanceof Error) || !/(Timeout|ERR_ABORTED)/.test(error.message)) {
        throw error
      }
    })
    await expect.poll(() => f.desktop.unloadPrompts.length).toBeGreaterThan(0)
    await browse(f, 'two.ts')
    await expect(text(f)).toHaveValue('second unsaved')
    await close(f)
    const prompts = f.desktop.unloadPrompts.length
    f.desktop.requestQuit()
    await expect.poll(() => f.desktop.unloadPrompts.length).toBeGreaterThan(prompts)
    await browse(f, 'one.ts')
    await expect(text(f)).toHaveValue('first unsaved')
    await close(f)
    await f.desktop.setUnloadChoice(1)
    await f.page.reload()
    await browse(f, 'one.ts')
    await expect(text(f)).toHaveValue('first unsaved')
    await close(f)
    expect(readFileSync(join(f.cwd, 'one.ts'), 'utf8')).toBe('one')
    expect(readFileSync(join(f.cwd, 'two.ts'), 'utf8')).toBe('two')
    await f.restart()
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toEqual([])
    await f.open(s.id)
    await browse(f, 'one.ts')
    await expect(text(f)).toHaveValue('one')
    await discard(f)
  } finally {
    await f.desktop.setUnloadChoice(1)
    await f.close()
  }
})

test('FILE-03 Electron unsupported format and redaction downgrade, late opening and HTTP failure preserve ownership while SDK background and narrow themes remain usable', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, false, true)
  let release: () => void = noop
  try {
    for (const [name, value] of [
      ['mixed.ts', 'one\r\ntwo\n'],
      ['masked.ts', 'api_key = "fixture-secret-marker"'],
    ] as const) {
      writeFileSync(join(f.cwd, name), value)
    }
    writeFileSync(join(f.cwd, 'edit.ts'), 'baseline')
    const bg = await f.send('保持独立后台', true)
    await f.ready(bg.id)
    const original = f.kernels.list().find((k) => k.sessionId === bg.id)
    const s = await f.send('编辑降级主会话')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await browse(f, 'mixed.ts', false)
    await f.page.getByRole('button', { name: '手动编辑文件', exact: true }).click()
    await expect(region(f)).toContainText('混合换行')
    await expect(text(f)).toHaveCount(0)
    await close(f)
    await browse(f, 'masked.ts', false)
    await f.page.getByRole('button', { name: '手动编辑文件', exact: true }).click()
    await expect(region(f)).toContainText('脱敏')
    await expect(text(f)).toHaveCount(0)
    await close(f)
    await browse(f, 'edit.ts')
    await text(f).fill('preserved failure draft')
    await f.page.route('**/api/files/edit/save', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'explicit FILE03 storage failure' }),
      }),
    )
    await region(f).getByRole('button', { name: '保存文件', exact: true }).click()
    await expect(region(f)).toContainText('explicit FILE03 storage failure')
    await expect(text(f)).toHaveValue('preserved failure draft')
    await f.page.unroute('**/api/files/edit/save')
    await f.page.setViewportSize({ width: 802, height: 760 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme })
      await text(f).scrollIntoViewIfNeeded()
      await expect(text(f)).toBeVisible()
      await expect(region(f).getByRole('button', { name: '保存文件', exact: true })).toBeVisible()
    }
    expect(f.kernels.list().find((k) => k.sessionId === bg.id)).toMatchObject({
      pid: original?.pid,
      epoch: original?.epoch,
      state: 'running',
    })
    await discard(f)
    await close(f)
    const gate = new Promise<void>((r) => {
      release = r
    })
    let received = false
    await f.page.route('**/api/files/edit/open', async (route) => {
      const response = await route.fetch()
      received = true
      await gate
      await route.fulfill({ response }).catch(() => undefined)
    })
    await browse(f, 'edit.ts', false)
    await f.page.getByRole('button', { name: '手动编辑文件', exact: true }).click()
    await expect.poll(() => received).toBe(true)
    await close(f)
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await browse(f, 'mixed.ts', false)
    await expect(text(f)).toHaveCount(0)
    await close(f)
    await f.stop(bg.id)
  } finally {
    release()
    await f.desktop.setUnloadChoice(1)
    await f.close()
  }
})

test('FILE-03 Electron four bounded drafts keep long Chinese paths contained; a fifth draft is refused without eviction', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, false, true)
  try {
    f.page.setDefaultTimeout(10000)
    const long = join(
      f.cwd,
      ...Array.from({ length: 5 }, (_, i) => `长中文目录${i}${'a'.repeat(35)}`),
    )
    mkdirSync(long, { recursive: true })
    writeFileSync(join(long, '长路径.ts'), 'long baseline')
    for (const name of ['第二.ts', '第三.ts', '第四.ts', '第五.ts']) {
      writeFileSync(join(f.cwd, name), name)
    }
    const s = await f.send('编辑稿限额与路径布局')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await f.page.setViewportSize({ width: 802, height: 760 })
    await browse(f, '长路径.ts', true, /长路径\.ts$/)
    await text(f).fill('长路径未保存稿')
    await close(f)
    for (const name of ['第二.ts', '第三.ts', '第四.ts']) {
      await browse(f, name)
      await text(f).fill(`${name} 未保存稿`)
      await close(f)
    }
    await browse(f, '第五.ts', false)
    const recover = f.page.getByRole('button', { name: /^恢复文件编辑稿：/ })
    await expect(recover).toHaveCount(4)
    expect(
      await recover.evaluateAll((nodes) =>
        nodes.every((node) => node.scrollWidth <= node.clientWidth),
      ),
    ).toBe(true)
    await f.page.getByRole('button', { name: '手动编辑文件', exact: true }).click()
    await expect(region(f)).toContainText('已有 4 份编辑稿')
    await expect(text(f)).toHaveCount(0)
    await recover.filter({ hasText: '长路径.ts' }).click()
    await expect(text(f)).toHaveValue('长路径未保存稿')
    expect(readFileSync(join(long, '长路径.ts'), 'utf8')).toBe('long baseline')
    await discard(f)
  } finally {
    await f.desktop.setUnloadChoice(1)
    await f.close()
  }
})
