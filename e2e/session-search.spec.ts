import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { seedSearchSession } from '../apps/daemon/test/helpers/search.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function fixture(count = 3) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-search-ui-')),
    data = join(directory, 'data')
  mkdirSync(data)
  const app = await createApp({ dataDir: data, port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const projectService = app.get(ProjectService)
  const a = await projectService.create({
      requestId: randomUUID(),
      name: '同名项目',
      workspaceId: null,
    }),
    b = await projectService.create({
      requestId: randomUUID(),
      name: '同名项目',
      workspaceId: null,
    })
  const first = await seedSearchSession(
    app,
    data,
    '中文标题甲',
    Array.from({ length: 132 }, (_, index) =>
      index === 4
        ? '芝麻用户定位 中文长历史'
        : index === 5
          ? '芝麻助手定位 答复'
          : `历史上下文 ${index}`,
    ),
    a.id,
  )
  const second = await seedSearchSession(
    app,
    data,
    '中文标题乙',
    ['另一用户输入', '尾部秘密 api_key=redact-me-search 后文助手可见'],
    b.id,
  )
  const third = await seedSearchSession(app, data, '无项目备忘', ['无项目用户内容', '独立会话回答'])
  const store = app.get(SessionStore)
  store.organize(third.session.id, {
    action: 'archive',
    archived: true,
    expectedRevision: store.organizations().find((row) => row.sessionId === third.session.id)!
      .revision,
  })
  await Promise.all(
    Array.from({ length: Math.max(0, count - 3) }, (_, index) =>
      seedSearchSession(app, data, `分页最近 ${index + 3}`),
    ),
  )
  const desktop = await launchWorkspaceDesktop(directory, app),
    { page } = desktop
  await page.setViewportSize({ width: 1920, height: 1080 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dialog = page.getByRole('dialog'),
    input = page.getByRole('textbox', { name: '标题或消息正文', exact: true })
  const open = async () => {
    await page.keyboard.press('Control+k')
    await expect(dialog).toBeVisible()
    await expect(input).toBeFocused()
  }
  return {
    app,
    directory,
    first,
    second,
    third,
    a,
    b,
    store,
    desktop,
    page,
    errors,
    dialog,
    input,
    open,
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('SESSION-12 Electron searches Chinese title/user/assistant and opens the precise old message without creating a run or losing the draft', async () => {
  const f = await fixture()
  try {
    const composer = f.page.getByRole('textbox', { name: '任务内容', exact: true })
    await composer.fill('未发送草稿保留')
    await f.open()
    await f.input.fill('芝麻用户定位')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
    await expect(f.dialog.getByRole('button', { name: /用户正文命中/ })).toContainText(
      '芝麻用户定位',
    )
    await f.input.press('ArrowDown')
    await expect(f.dialog.getByRole('button', { name: /用户正文命中/ })).toBeFocused()
    await f.page.keyboard.press('Enter')
    await expect(f.dialog).toHaveCount(0)
    const target = f.page.locator('[data-search-located="true"]')
    await expect(target).toContainText('芝麻用户定位')
    await expect(target).toBeInViewport()
    await expect(f.page.getByLabel('历史载入状态')).toContainText('本页')
    await f.page.getByRole('button', { name: '新会话', exact: true }).click()
    await expect(composer).toHaveValue('未发送草稿保留')
    await f.open()
    await f.input.fill('芝麻助手定位')
    await expect(f.dialog.getByRole('button', { name: /助手正文命中/ })).toBeVisible()
    await f.input.press('Enter')
    await expect(f.page.locator('[data-search-located="true"]')).toContainText('芝麻助手定位')
    await f.open()
    await f.input.fill('中文标题乙')
    await f.dialog.getByRole('button', { name: /标题命中/ }).click()
    await expect(f.page).toHaveURL(new RegExp(`session=${f.second.session.id}$`))
    await expect(f.page.getByRole('button', { name: '历史记录', exact: true })).toBeVisible()
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(f.store.managedSessions()).toHaveLength(3)
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('SESSION-12 Electron project/status/time/archive filters, empty clear and redacted snippets work in light/dark narrow layouts', async () => {
  const f = await fixture()
  try {
    await f.open()
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 2 个会话')
    const project = f.page.getByLabel('项目范围', { exact: true })
    await expect(project.locator('option')).toHaveCount(4)
    await project.selectOption(f.a.id)
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
    await expect(f.dialog.getByRole('button', { name: /最近会话/ })).toContainText(
      f.a.id.slice(0, 8),
    )
    await project.selectOption('none')
    await expect(f.page.getByText('没有匹配的会话', { exact: true })).toBeVisible()
    await f.page.getByLabel('归档范围', { exact: true }).selectOption('all')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
    await expect(f.dialog.getByRole('button', { name: /最近会话/ })).toContainText('已归档')
    await f.page.getByRole('button', { name: '清除筛选', exact: true }).click()
    await f.page.getByLabel('会话状态', { exact: true }).selectOption('failed')
    await expect(f.page.getByText('没有匹配的会话', { exact: true })).toBeVisible()
    await f.page.getByLabel('会话状态', { exact: true }).selectOption('completed')
    await f.page.getByLabel('更新时间起始', { exact: true }).fill('2099-01-01')
    await expect(f.page.getByText('没有匹配的会话', { exact: true })).toBeVisible()
    await f.page.getByLabel('更新时间截止', { exact: true }).fill('2000-01-01')
    await expect(f.page.getByLabel('搜索状态')).toContainText('起始日期不能晚于')
    await f.page.getByRole('button', { name: '清除筛选', exact: true }).click()
    await f.input.fill('后文助手可见')
    await expect(f.dialog.getByRole('button', { name: /助手正文命中/ })).toContainText('«redacted»')
    await expect(f.dialog).not.toContainText('redact-me-search')
    await f.page.screenshot({
      path: `${evidence}/session-12-search-light-1920.png`,
      animations: 'disabled',
    })
    await f.page.emulateMedia({ colorScheme: 'dark' })
    await f.page.setViewportSize({ width: 800, height: 800 })
    await expect(f.page.locator('html')).toHaveClass(/dark/)
    const width = await f.page.evaluate(() => innerWidth)
    const bounds = await f.dialog.boundingBox()
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
    await f.page.screenshot({
      path: `${evidence}/session-12-search-dark-800.png`,
      animations: 'disabled',
    })
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('SESSION-12 Electron paginates recent results, resets page on filters and refreshes rename/archive/project removal while open', async () => {
  const f = await fixture(24)
  try {
    await f.open()
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 23 个会话 · 第 1 页')
    await expect(f.dialog.locator('.session-search-result')).toHaveCount(20)
    const before = await f.dialog.locator('.session-search-result').allTextContents()
    await f.page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(f.page.getByLabel('搜索状态')).toContainText('第 2 页')
    await expect(f.dialog.locator('.session-search-result')).toHaveCount(3)
    const after = await f.dialog.locator('.session-search-result').allTextContents()
    expect(new Set([...before, ...after]).size).toBe(23)
    await f.input.fill('中文标题甲')
    await expect(f.page.getByLabel('搜索状态')).toContainText('第 1 页')
    f.app
      .get(SessionService)
      .rename(f.first.session.id, { title: '改名已更新检索', expectedVersion: 1 })
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 0 个会话')
    await f.input.fill('改名已更新检索')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
    await f.page.getByLabel('项目范围', { exact: true }).selectOption(f.a.id)
    f.app
      .get(SessionService)
      .organizeProject(f.a.id, { action: 'remove', expectedRevision: f.a.revision })
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 0 个会话')
    await f.page.getByLabel('项目范围', { exact: true }).selectOption('none')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
    f.store.organize(f.first.session.id, {
      action: 'archive',
      archived: true,
      expectedRevision: f.store.organizations().find((row) => row.sessionId === f.first.session.id)!
        .revision,
    })
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 0 个会话')
    await f.page.getByLabel('归档范围', { exact: true }).selectOption('archived')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
  } finally {
    await f.close()
  }
})

test('SESSION-12 Electron debounces 200ms, isolates late A/B/A and closed queries, retains filters after failure, protects synthetic IME', async () => {
  const f = await fixture()
  try {
    await f.open()
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 2 个会话')
    const requests: string[] = []
    const heldResponses: { release: () => void }[] = []
    let holdQuery = '中文标题甲',
      fail = false
    await f.page.route('**/api/chat/search?**', async (route) => {
      const url = new URL(route.request().url()),
        q = url.searchParams.get('q') ?? ''
      requests.push(q)
      if (fail) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '离线查询失败夹具' }),
        })
        return
      }
      const response = await route.fetch({
        url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      if (holdQuery && q === holdQuery) {
        holdQuery = ''
        await new Promise<void>((done) => {
          heldResponses.push({ release: done })
        })
      }
      await route.fulfill({ response })
    })
    await f.input.fill('中')
    await f.page.waitForTimeout(70)
    await f.input.fill('中文')
    await f.page.waitForTimeout(70)
    await f.input.fill('中文标题甲')
    await f.page.waitForTimeout(100)
    expect(requests).toEqual([])
    await expect.poll(() => heldResponses.length).toBe(1)
    await f.input.fill('中文标题乙')
    await expect(f.dialog.getByRole('button', { name: /中文标题乙.*标题命中/ })).toBeVisible()
    heldResponses.shift()?.release()
    await f.page.waitForTimeout(250)
    await expect(f.dialog.getByRole('button', { name: /中文标题甲.*标题命中/ })).toHaveCount(0)
    await f.input.fill('中文标题甲')
    await expect(f.dialog.getByRole('button', { name: /中文标题甲.*标题命中/ })).toBeVisible()
    expect(requests).not.toContain('中')
    expect(requests).not.toContain('中文')
    await f.input.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
    )
    await f.input.fill('组合中尚未查询')
    const count = requests.length
    await f.input.press('Enter')
    await f.input.press('Escape')
    await f.page.waitForTimeout(250)
    expect(requests).toHaveLength(count)
    await expect(f.dialog).toBeVisible()
    await f.input.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
    )
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 0 个会话')
    fail = true
    await f.input.fill('查询失败保留')
    await expect(f.page.getByText('搜索暂不可用', { exact: true })).toBeVisible()
    await expect(f.input).toHaveValue('查询失败保留')
    const failedRequests = requests.length
    await f.page.waitForTimeout(2200)
    expect(requests).toHaveLength(failedRequests)
    fail = false
    await f.page.getByRole('button', { name: '重试搜索', exact: true }).click()
    await expect(f.page.getByText('搜索暂不可用', { exact: true })).toHaveCount(0)
    await f.input.press('Escape')
    await expect(f.dialog).toHaveCount(0)
    await expect(f.page.getByRole('textbox', { name: '任务内容', exact: true })).toBeFocused()
    await f.open()
    await expect(f.input).toHaveValue('')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 2 个会话')
    holdQuery = '中文标题乙'
    await f.input.fill('中文标题乙')
    await expect.poll(() => heldResponses.length).toBe(1)
    await f.input.press('Escape')
    await expect(f.dialog).toHaveCount(0)
    await f.open()
    heldResponses.shift()?.release()
    await expect(f.input).toHaveValue('')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 2 个会话')
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})
