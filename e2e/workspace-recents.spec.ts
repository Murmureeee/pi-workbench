import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { TrustService } from '../apps/daemon/dist/modules/security/trust.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-recent-ui-')), seed = true) {
  const first = join(directory, '中文 Alpha'),
    second = join(directory, 'Beta')
  if (seed) {
    mkdirSync(first)
    mkdirSync(second)
    writeFileSync(join(first, '用户文件.txt'), '必须保留的用户内容')
  }
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const service = app.get(WorkspaceService)
  if (seed) {
    assert((await service.open(first)).ok)
    assert((await service.open(second)).ok)
  }
  const desktop = await launchWorkspaceDesktop(directory, app)
  const { page } = desktop
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/?workspaces')
  await expect(page.getByRole('heading', { name: '最近工作区', exact: true })).toBeVisible()
  const row = (id: string) => page.locator(`[data-recent-workspace="${id}"]`)
  const menu = async (id: string, label: string) => {
    await row(id)
      .getByRole('button', { name: /^工作区菜单：/ })
      .click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  return {
    app,
    service,
    desktop,
    page,
    directory,
    first,
    second,
    row,
    menu,
    errors,
    close: async (remove = true) => {
      await desktop.close()
      await app.close()
      if (remove) {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
}

test('WS-02 actual Electron persists recent order/custom names across full app restart, with prefill/cancel and light/dark/narrow layouts', async () => {
  const f = await fixture()
  let restarted: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    const [b, a] = f.service.recent().entries
    assert(a && b)
    await expect(f.page.locator('[data-recent-workspace]').first()).toHaveAttribute(
      'data-recent-workspace',
      b.id,
    )
    await f.menu(a.id, '重命名工作区')
    const input = f.page.getByLabel('工作区显示名', { exact: true })
    await expect(input).toHaveValue(a.name)
    await expect(input).toBeFocused()
    expect(
      await input.evaluate(
        (element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!,
      ),
    ).toBe(a.name.length)
    await input.fill('取消不保存')
    await input.press('Escape')
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    expect(f.service.recent().entries.find((entry) => entry.id === a.id)?.name).toBe(a.name)
    await f.menu(a.id, '重命名工作区')
    await input.fill('工作台开发 🧪')
    await input.press('Enter')
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    await expect(f.row(a.id)).toContainText('工作台开发 🧪')
    await expect(f.page.locator('[data-recent-workspace]').first()).toHaveAttribute(
      'data-recent-workspace',
      b.id,
    )
    await f
      .row(a.id)
      .getByRole('button', { name: /^打开工作区：/ })
      .click()
    await expect(f.page.getByLabel('实际目录')).toHaveText(f.first)
    await expect(f.page.locator('[data-recent-workspace]').first()).toHaveAttribute(
      'data-recent-workspace',
      a.id,
    )
    const before = f.service.recent()
    await f.page.getByRole('button', { name: '重新校验', exact: true }).click()
    await expect(f.page.getByLabel('工作区操作状态')).toContainText('已复用')
    expect(f.service.recent()).toEqual(before)
    await f.page.setViewportSize({ width: 1920, height: 1080 })
    await f.page.emulateMedia({ colorScheme: 'light' })
    await f.page.screenshot({
      path: `${evidence}/workspace-recents-light.png`,
      animations: 'disabled',
    })
    await f.page.emulateMedia({ colorScheme: 'dark' })
    await f.page.setViewportSize({ width: 800, height: 760 })
    expect(
      await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const currentBounds = await f.page.getByLabel('当前工作区', { exact: true }).boundingBox()
    const recentBounds = await f.page
      .getByRole('heading', { name: '最近工作区', exact: true })
      .boundingBox()
    assert(currentBounds && recentBounds)
    expect(currentBounds.y + currentBounds.height).toBeLessThanOrEqual(recentBounds.y)
    await f.page.getByRole('heading', { name: '最近工作区', exact: true }).scrollIntoViewIfNeeded()
    await f.page.screenshot({
      path: `${evidence}/workspace-recents-dark-800.png`,
      animations: 'disabled',
    })
    await f.close(false)
    restarted = await fixture(f.directory, false)
    await expect(restarted.row(a.id)).toContainText('工作台开发 🧪')
    await expect(restarted.page.locator('[data-recent-workspace]').first()).toHaveAttribute(
      'data-recent-workspace',
      a.id,
    )
    expect(restarted.service.recent()).toEqual(before)
    expect(restarted.app.get(KernelService).list()).toEqual([])
    expect(restarted.app.get(SessionStore).list()).toEqual([])
    expect(f.errors).toEqual([])
    expect(restarted.errors).toEqual([])
  } finally {
    if (restarted) {
      await restarted.close()
    } else {
      await f.close()
    }
  }
})

test('WS-02 Electron retains failed rename and conflicts, validates Unicode and does not save or cancel during synthetic IME', async () => {
  const f = await fixture()
  try {
    const a = f.service.recent().entries.find((entry) => entry.canonicalPath === f.first)
    assert(a)
    await f.menu(a.id, '重命名工作区')
    const input = f.page.getByLabel('工作区显示名', { exact: true })
    await input.fill('🧪'.repeat(81))
    await expect(f.page.getByRole('button', { name: '保存名称', exact: true })).toBeDisabled()
    await input.fill('保存失败后保留 🧪')
    await input.dispatchEvent('compositionstart')
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
    await expect(f.page.getByRole('dialog', { name: '重命名工作区' })).toBeVisible()
    expect(f.service.recent().entries.find((entry) => entry.id === a.id)?.name).toBe(a.name)
    await input.dispatchEvent('compositionend')
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      "CREATE TRIGGER fail_name BEFORE UPDATE OF custom_name ON workspaces BEGIN SELECT RAISE(FAIL, 'offline UI write failure'); END",
    )
    await f.page.getByRole('button', { name: '保存名称', exact: true }).click()
    await expect(f.page.getByRole('alert')).toContainText('工作区记录未能保存')
    await expect(input).toHaveValue('保存失败后保留 🧪')
    expect(f.service.recent().entries.find((entry) => entry.id === a.id)?.name).toBe(a.name)
    await f.page.screenshot({
      path: `${evidence}/workspace-recents-failure.png`,
      animations: 'disabled',
    })
    db.exec('DROP TRIGGER fail_name')
    await f.page.getByRole('button', { name: '保存名称', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    await expect(f.row(a.id)).toContainText('保存失败后保留 🧪')
    await f.menu(a.id, '重命名工作区')
    await input.fill('我的冲突编辑')
    const latest = f.service.recent().entries.find((entry) => entry.id === a.id)
    assert(latest)
    expect(
      f.service.rename({ id: a.id, name: '其他客户端名称', expectedRevision: latest.revision }).ok,
    ).toBe(true)
    await f.page.getByRole('button', { name: '保存名称', exact: true }).click()
    await expect(
      f.page.getByRole('alert').filter({ hasText: '工作区记录已更新' }).first(),
    ).toBeVisible()
    await expect(input).toHaveValue('我的冲突编辑')
    await f.page.getByRole('button', { name: '核对最新记录后继续', exact: true }).click()
    await expect(input).toHaveValue('我的冲突编辑')
    await f.page.getByRole('button', { name: '保存名称', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    await expect(f.row(a.id)).toContainText('我的冲突编辑')
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-02 Electron diagnoses moved directories, rejects a different identity, explicitly saves picker relocation and hides/restores recent records without deleting files', async () => {
  const f = await fixture()
  try {
    const a = f.service.recent().entries.find((entry) => entry.canonicalPath === f.first)
    assert(a)
    const moved = join(f.directory, '移动后的中文 Alpha')
    renameSync(f.first, moved)
    await f
      .row(a.id)
      .getByRole('button', { name: /^打开工作区：/ })
      .click()
    await expect(f.page.getByRole('alert')).toContainText('目录不存在')
    await expect(f.row(a.id)).toContainText('目录不可用')
    await f.menu(a.id, '重新定位工作区')
    const input = f.page.getByLabel('新的目录位置', { exact: true })
    await expect(input).toHaveValue(f.first)
    await input.fill(f.second)
    await f.page.getByRole('button', { name: '保存位置', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toContainText('另一个目录')
    expect(f.service.lookup(a.id)?.canonicalPath).toBe(f.first)
    await f.desktop.setSelection(moved)
    await f.page.getByRole('button', { name: '选择新的文件夹', exact: true }).click()
    await expect(input).toHaveValue(moved)
    expect(f.service.lookup(a.id)?.canonicalPath).toBe(f.first)
    await f.page.getByRole('button', { name: '保存位置', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    expect(f.service.recent().entries.find((entry) => entry.id === a.id)?.lastOpenedAt).toBe(
      a.lastOpenedAt,
    )
    await expect(f.row(a.id)).toContainText(moved)
    await f
      .row(a.id)
      .getByRole('button', { name: /^打开工作区：/ })
      .click()
    await expect(f.page.getByLabel('实际目录')).toHaveText(moved)
    await f.menu(a.id, '从最近移除')
    await expect(f.page.getByRole('alertdialog')).toContainText('后台任务继续运行')
    await f.page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(f.row(a.id)).toBeVisible()
    await f.menu(a.id, '从最近移除')
    await f.page.getByRole('button', { name: '确认移除最近记录', exact: true }).click()
    await expect(f.row(a.id)).toHaveCount(0)
    await expect(f.page.getByLabel('实际目录')).toHaveText(moved)
    expect(readFileSync(join(moved, '用户文件.txt'), 'utf8')).toBe('必须保留的用户内容')
    expect(f.service.lookup(a.id)?.canonicalPath).toBe(moved)
    await f.page.getByLabel('工作区目录', { exact: true }).fill(moved)
    await f.page.getByRole('button', { name: '打开路径', exact: true }).click()
    await expect(f.row(a.id)).toBeVisible()
    expect(f.app.get(SessionStore).list()).toEqual([])
    expect(f.app.get(TrustService).inspect().records).toEqual([])
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-02 Electron remove/rename/switch and disconnected recent reads preserve a real background SDK task and its cwd', async () => {
  const f = await fixture()
  const kernels = f.app.get(KernelService),
    events = f.app.get(EventService)
  const id = randomUUID(),
    turnId = randomUUID()
  const run = kernels.prompt(id, f.first, {
    turnId,
    text: 'WS-02 background local fixture',
    fixture: 'hold',
  })
  try {
    await expect.poll(() => events.snapshot(id)?.turns.at(-1)?.text).toContain('OFFLINE_')
    const pid = kernels.list().find((kernel) => kernel.sessionId === id)?.pid
    assert(pid)
    const a = f.service.recent().entries.find((entry) => entry.canonicalPath === f.first)
    assert(a)
    await f.menu(a.id, '从最近移除')
    await f.page.getByRole('button', { name: '确认移除最近记录', exact: true }).click()
    await expect(f.row(a.id)).toHaveCount(0)
    await f.page.getByRole('button', { name: '打开工作区：Beta', exact: true }).click()
    await expect(f.page.getByLabel('实际目录')).toHaveText(f.second)
    expect(kernels.list().find((kernel) => kernel.sessionId === id)?.pid).toBe(pid)
    expect(events.snapshot(id)?.turns.at(-1)?.phase).toBe('running')
    expect(
      f.app
        .get(SessionStore)
        .list()
        .find((session) => session.id === id)?.cwd,
    ).toBe(f.first)
    await f.page.route('**/api/workspaces/recent', (route) => route.abort('connectionrefused'))
    await f.page.getByRole('button', { name: '刷新最近列表', exact: true }).click()
    await expect(f.page.getByRole('alert')).toContainText('最近列表未能更新')
    await expect(f.page.getByLabel('实际目录')).toHaveText(f.second)
    expect(kernels.list().find((kernel) => kernel.sessionId === id)?.pid).toBe(pid)
    await f.page.unroute('**/api/workspaces/recent')
    await f.page.getByRole('button', { name: '刷新最近列表', exact: true }).click()
    await expect(f.page.getByRole('alert')).toHaveCount(0)
    expect(existsSync(join(f.first, '用户文件.txt'))).toBe(true)
    await kernels.abort(id, turnId)
    expect(await run).toMatchObject({ localRequests: 1, blockedNetworkAttempts: 0 })
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
    await run.catch(() => undefined)
  }
})
