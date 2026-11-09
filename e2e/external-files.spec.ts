/* oxlint-disable no-await-in-loop -- Native editor and profile operations share a real isolated fixture. */
import type { DesktopBridge } from '../packages/shared/dist/index.js'

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { externalProgram } from '../apps/daemon/test/helpers/external-program.js'
import { setupChanges } from './helpers/change-fixture.js'

type Fixture = Awaited<ReturnType<typeof setupChanges>>
declare global {
  interface Window {
    piWorkbench?: DesktopBridge
  }
}
const reader = (f: Fixture) => f.page.getByRole('region', { name: '只读代码阅读', exact: true })
const controls = (f: Fixture) =>
  reader(f).getByRole('region', { name: '外部文件操作', exact: true })
async function browse(f: Fixture, name: string) {
  await f.page.getByRole('button', { name: '浏览与查找文件', exact: true }).click()
  await f.page.getByRole('textbox', { name: '文件名或相对路径', exact: true }).fill(name)
  const browser = f.page.getByRole('region', { name: '授权文件浏览', exact: true })
  await browser.getByRole('button', { name, exact: true }).click()
  await browser.getByRole('button', { name: '只读查看代码', exact: true }).click()
  await expect(reader(f)).toBeVisible()
}
async function settings(f: Fixture) {
  const panel = controls(f)
  await panel.getByText('编辑器设置', { exact: true }).click()
  return panel
}
async function select(f: Fixture, path: string, adapter = 'vscode') {
  const panel = await settings(f)
  await panel.getByLabel('选择程序时采用的参数格式', { exact: true }).selectOption(adapter)
  await f.desktop.setSelection(path)
  await panel.getByRole('button', { name: '选择其它编辑器…', exact: true }).click()
  await expect(panel).toContainText('编辑器选择已保存')
}

test('FILE-06 Electron native selection fixture and real process receive exact Unicode path/line arguments without sending a draft', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, true)
  try {
    const program = externalProgram(f.root),
      path = join(f.cwd, '中文 & code.ts')
    writeFileSync(path, 'const 中文=1\nconst second=2\n')
    const s = await f.send('外部编辑器参数验收')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await f.page.getByRole('textbox', { name: '任务内容' }).fill('保留未发送中文草稿')
    await browse(f, '中文 & code.ts')
    let panel = await settings(f)
    await panel.getByRole('button', { name: '选择其它编辑器…', exact: true }).click()
    await expect(panel).toContainText('操作已取消')
    await panel.getByText('编辑器设置', { exact: true }).click()
    await select(f, program.path)
    expect(existsSync(program.path + '.args')).toBe(false)
    await reader(f).getByRole('button', { name: '选择第 2 行', exact: true }).click()
    panel = controls(f)
    await panel.getByRole('button', { name: '在 IDE 中打开', exact: true }).click()
    await expect(panel).toContainText('已请求 IDE 打开核验后的路径')
    const argv = readFileSync(program.path + '.args', 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((encoded) => Buffer.from(encoded, 'base64').toString())
    expect(argv).toEqual(['--new-window', '--goto', path + ':2'])
    await f.page.getByRole('button', { name: '关闭代码阅读', exact: true }).click()
    await f.page.getByRole('button', { name: '关闭文件浏览', exact: true }).click()
    await expect(f.page.getByRole('textbox', { name: '任务内容' })).toHaveValue(
      '保留未发送中文草稿',
    )
    expect(f.sends()).toBe(1)
  } finally {
    await f.close()
  }
})

test('FILE-06 Electron program failure/missing recovery, system association diagnostics, themes and same-profile restart never replay opens', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, true)
  try {
    const program = externalProgram(f.root),
      path = join(f.cwd, '说明.txt')
    writeFileSync(path, 'one\ntwo\n')
    const s = await f.send('外部失败恢复')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await browse(f, '说明.txt')
    await select(f, program.fail, 'path')
    let panel = controls(f)
    await panel.getByRole('button', { name: '在 IDE 中打开', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('报告失败')
    unlinkSync(program.fail)
    await panel.getByRole('button', { name: '刷新编辑器状态', exact: true }).click()
    await expect(panel).toContainText('不存在')
    await f.desktop.setSelection(program.path)
    await panel.getByRole('button', { name: '选择其它编辑器…', exact: true }).click()
    await expect(panel).toContainText('编辑器选择已保存')
    await panel.getByRole('button', { name: '在文件管理器定位', exact: true }).click()
    await expect.poll(() => f.desktop.shellCalls.length).toBe(1)
    expect(f.desktop.shellCalls[0]).toEqual({ action: 'reveal', path })
    await f.desktop.setShellFailure('explicit OS association failure fixture')
    await panel.getByRole('button', { name: '使用系统程序打开', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('系统关联打开失败')
    await f.desktop.setShellFailure('')
    await panel.getByRole('button', { name: '使用系统程序打开', exact: true }).click()
    await expect(panel).toContainText('系统已接收打开请求')
    await f.page.setViewportSize({ width: 802, height: 961 })
    for (const theme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme: theme })
      await f.page.screenshot({
        path: join(
          process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest',
          `file06-${theme}-narrow.png`,
        ),
        animations: 'disabled',
      })
    }
    expect(existsSync(program.path + '.args')).toBe(false)
    await f.restart()
    await f.open(s.id)
    await browse(f, '说明.txt')
    panel = controls(f)
    await expect(panel).toContainText('自选程序')
    expect(f.desktop.shellCalls).toEqual([])
    expect(existsSync(program.path + '.args')).toBe(false)
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('FILE-06 Electron delayed private proof, queue ownership, cancel, duplicate ID and view switch preserve the actual background kernel', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, true)
  try {
    writeFileSync(join(f.cwd, '等待.txt'), 'current')
    const s = await f.send('保持 外部打开后台隔离')
    await f.ready(s.id)
    const before = f.kernels.list().find((k) => k.sessionId === s.id)!
    await browse(f, '等待.txt')
    const panel = controls(f)
    f.desktop.holdExternal()
    await panel.getByRole('button', { name: '在文件管理器定位', exact: true }).click()
    await expect.poll(() => f.desktop.proofCount()).toBe(1)
    await panel.getByRole('button', { name: '取消外部打开', exact: true }).click()
    await expect(panel).toContainText('已请求取消')
    f.desktop.releaseExternal()
    await expect(panel).toContainText('操作已取消')
    expect(f.desktop.shellCalls).toEqual([])
    const id = randomUUID()
    const request = {
      id,
      input: {
        target: { sessionId: s.id },
        source: { path: '等待.txt' },
        action: 'reveal' as const,
        line: 1,
      },
    }
    const first = await f.page.evaluate((q) => window.piWorkbench!.openFileExternally(q), request)
    expect(first).toMatchObject({ status: 'requested' })
    const duplicate = await f.page.evaluate(
      (q) => window.piWorkbench!.openFileExternally(q),
      request,
    )
    expect(duplicate).toMatchObject({ status: 'failed' })
    f.desktop.holdExternal()
    await panel.getByRole('button', { name: '在文件管理器定位', exact: true }).click()
    await expect.poll(() => f.desktop.proofCount()).toBe(3)
    await f.page.getByRole('button', { name: '关闭代码阅读', exact: true }).click()
    f.desktop.releaseExternal()
    await expect.poll(() => f.desktop.shellCalls.length).toBe(1)
    expect(f.kernels.list().find((k) => k.sessionId === s.id)).toMatchObject({
      pid: before.pid,
      epoch: before.epoch,
      state: 'running',
    })
    expect(f.sends()).toBe(1)
    await f.stop(s.id)
  } finally {
    await f.close()
  }
})

test('FILE-06 Electron rejects malformed privileges, other window and wrong origin; changed/deleted targets fail before shell handoff', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, true)
  try {
    const path = join(f.cwd, '版本.txt')
    writeFileSync(path, 'before\n')
    const s = await f.send('外部路径重验')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await browse(f, '版本.txt')
    const panel = controls(f)
    f.desktop.holdExternal()
    await panel.getByRole('button', { name: '在文件管理器定位', exact: true }).click()
    await expect.poll(() => f.desktop.proofCount()).toBe(1)
    writeFileSync(path, 'changed externally\n')
    f.desktop.releaseExternal()
    await expect(panel.getByRole('alert')).toContainText('版本已变化')
    expect(f.desktop.shellCalls).toEqual([])
    expect(
      await f.page.evaluate(async () => {
        const bridge = window.piWorkbench
        if (!bridge) {
          throw Error('fixed bridge missing')
        }
        const method: unknown = Reflect.get(bridge, 'openFileExternally')
        if (typeof method !== 'function') {
          throw Error('fixed bridge missing')
        }
        const result: unknown = await Reflect.apply(method, bridge, [
          { id: crypto.randomUUID(), input: { command: 'powershell' } },
        ])
        return result
      }),
    ).toMatchObject({ status: 'failed' })
    expect(await f.desktop.wrongWindow(randomUUID())).toMatchObject({ status: 'failed' })
    await f.page.goto('http://localhost:5173')
    expect(await f.page.evaluate(() => window.piWorkbench!.editorStatus())).toBeNull()
    expect(
      await f.page.evaluate(() =>
        window.piWorkbench!.configureEditor({ id: crypto.randomUUID(), adapter: 'auto' }),
      ),
    ).toMatchObject({ status: 'failed' })
    await f.open(s.id)
    unlinkSync(path)
    const deleted = await f.page.evaluate(
      (id) =>
        window.piWorkbench!.openFileExternally({
          id: crypto.randomUUID(),
          input: {
            target: { sessionId: id },
            source: { path: '版本.txt' },
            action: 'reveal',
            line: 1,
          },
        }),
      s.id,
    )
    expect(deleted).toMatchObject({ status: 'failed' })
    expect(f.desktop.shellCalls).toEqual([])
  } finally {
    await f.close()
  }
})

test('FILE-06 Electron full navigation invalidates a held handoff and busy ownership remains until its actual completion', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(undefined, true)
  try {
    writeFileSync(join(f.cwd, '导航.txt'), 'current file')
    const s = await f.send('外部导航失效')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const q = {
      id: randomUUID(),
      input: {
        target: { sessionId: s.id },
        source: { path: '导航.txt' },
        action: 'reveal' as const,
        line: 1,
      },
    }
    f.desktop.holdExternal()
    await f.page.evaluate((request) => {
      void window.piWorkbench!.openFileExternally(request)
      return true
    }, q)
    await expect.poll(() => f.desktop.proofCount()).toBe(1)
    const busy = await f.page.evaluate(
      (request) => window.piWorkbench!.openFileExternally(request),
      { ...q, id: randomUUID() },
    )
    expect(busy).toMatchObject({ status: 'failed' })
    expect(busy && typeof busy === 'object' && 'message' in busy ? busy.message : '').toContain(
      '尚未结束',
    )
    await f.page.reload()
    f.desktop.releaseExternal()
    // A rejected missing target proves the previous main-process operation has drained;
    // an immediate zero shell count alone could miss a later handoff.
    await expect
      .poll(async () => {
        const result = await f.page.evaluate(
          (request) => window.piWorkbench!.openFileExternally(request),
          { ...q, id: randomUUID(), input: { ...q.input, source: { path: 'not-present.txt' } } },
        )
        return result && typeof result === 'object' && 'message' in result ? result.message : ''
      })
      .toContain('已变化')
    expect(f.desktop.shellCalls).toEqual([])
    expect(f.sends()).toBe(1)
  } finally {
    await f.close()
  }
})
