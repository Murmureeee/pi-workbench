import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { AccessService } from '../apps/daemon/dist/modules/security/access.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { sessionReceiptSchema } from '../packages/shared/dist/index.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-titles-ui-'))
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const service = app.get(SessionService),
    store = app.get(SessionStore),
    kernels = app.get(KernelService)
  const receipt = await service.submit({
    requestId: randomUUID(),
    sessionId: null,
    text: '中文重命名验收',
    retryOf: null,
    configuration: {
      projectId: null,
      workspaceId: null,
      model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
      thinking: 'off',
    },
  })
  await expect
    .poll(() => store.submission(receipt.submission.requestId)?.status, { timeout: 15000 })
    .toBe('completed')
  const desktop = await launchWorkspaceDesktop(directory, app)
  const wire = async (target: typeof desktop) => {
    await target.context.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const endpoint = new URL(url)
          if (endpoint.pathname === '/api/events') {
            endpoint.port = '4318'
          }
          super(endpoint, protocols)
        }
      }
    })
    await target.page.reload()
  }
  await wire(desktop)
  const pane = desktop.page.locator('.retained-session:not([hidden])')
  const row = () => pane.locator(`[data-library-session="${receipt.session.id}"]`)
  const open = async (sidebar = false) => {
    if (sidebar) {
      await row()
        .getByRole('button', { name: /^会话菜单：/ })
        .click()
    } else {
      await pane.getByRole('button', { name: /^标题菜单：/ }).click()
    }
    await desktop.page.getByRole('menuitem', { name: '重命名会话', exact: true }).click()
    await expect(desktop.page.getByRole('dialog', { name: '重命名会话' })).toBeVisible()
  }
  await row().getByTitle(receipt.session.title, { exact: true }).click()
  return {
    app,
    directory,
    desktop,
    wire,
    pane,
    row,
    open,
    store,
    service,
    kernels,
    receipt,
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('SESSION-11 Electron prefill, Unicode limits, Enter/Escape, sidebar/header, theme and retained composer draft', async () => {
  const f = await fixture(),
    { page } = f.desktop
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await f.pane.getByLabel('任务内容').fill('重命名期间的会话草稿')
    await f.open()
    const input = page.getByRole('textbox', { name: '会话名称', exact: true })
    await expect(input).toHaveValue(f.receipt.session.title)
    await expect(input).toBeFocused()
    await expect
      .poll(() => input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!))
      .toBe(f.receipt.session.title.length)
    await input.fill('取消编辑')
    await input.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(f.store.titles()[0]?.titleVersion).toBe(1)
    await f.open(true)
    await input.fill(' \t ')
    await expect(page.getByRole('button', { name: '保存名称', exact: true })).toBeDisabled()
    await input.fill('😀'.repeat(81))
    await expect(page.getByRole('button', { name: '保存名称', exact: true })).toBeDisabled()
    await input.fill('  ' + '😀'.repeat(80) + '  ')
    await expect(page.getByRole('button', { name: '保存名称', exact: true })).toBeEnabled()
    await input.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(f.row()).toContainText('😀'.repeat(80))
    await expect(page).toHaveTitle('😀'.repeat(80) + ' · Pi Workbench')
    await f.open()
    await input.fill('一')
    await input.press('Enter')
    await expect(page).toHaveTitle('一 · Pi Workbench')
    await expect(f.pane.getByLabel('任务内容')).toHaveValue('重命名期间的会话草稿')
    await f.open(true)
    await page.screenshot({ path: `${evidence}/session-title-light.png`, animations: 'disabled' })
    await input.press('Escape')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByLabel('外观主题').selectOption('dark')
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await f.open()
    await page.screenshot({ path: `${evidence}/session-title-dark.png`, animations: 'disabled' })
    await page.setViewportSize({ width: 860, height: 720 })
    await page.screenshot({ path: `${evidence}/session-title-narrow.png`, animations: 'disabled' })
    await expect(page.getByRole('dialog')).toBeInViewport()
    await input.press('Escape')
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('SESSION-11 Electron failed/uncertain save retains input and old title until authority; synthetic composition never saves or cancels', async () => {
  const f = await fixture(),
    { page } = f.desktop,
    id = f.receipt.session.id
  const path = f.kernels.list().find((row) => row.sessionId === id)?.sessionFile
  if (!path) {
    throw new Error('No native history')
  }
  const bytes = readFileSync(path)
  let posts = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/title')) {
      posts++
    }
  })
  try {
    await f.open()
    const input = page.getByLabel('会话名称', { exact: true })
    await input.fill('拼音选词内容')
    await input.dispatchEvent('compositionstart')
    await input.press('Enter')
    await input.press('Escape')
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(posts).toBe(0)
    await input.dispatchEvent('compositionend')
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      "CREATE TRIGGER reject_title BEFORE UPDATE OF title ON session_configurations BEGIN SELECT RAISE(ABORT,'fixture write failure'); END",
    )
    await input.press('Enter')
    await expect(page.getByRole('alert')).toContainText('保存结果待核对')
    await expect(input).toHaveValue('拼音选词内容')
    await expect(f.row()).toContainText(f.receipt.session.title)
    expect(f.store.titles()[0]?.titleVersion).toBe(1)
    db.exec('DROP TRIGGER reject_title')
    await input.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(posts).toBe(2)
    await f.open()
    await input.fill('已保存但回执丢失')
    await f.desktop.context.route(
      '**/api/chat/sessions/*/title',
      async (route) => {
        const url = new URL(route.request().url())
        await route.fetch({
          url: `http://127.0.0.1:4318${url.pathname}`,
          headers: {
            ...route.request().headers(),
            host: '127.0.0.1:4318',
            origin: 'http://127.0.0.1:5173',
          },
        })
        await route.abort('connectionfailed')
      },
      { times: 1 },
    )
    await input.press('Enter')
    await expect(page.getByText('保存结果待核对', { exact: true })).toBeVisible()
    await expect(input).toHaveValue('已保存但回执丢失')
    await expect(f.row()).toContainText('已保存但回执丢失')
    await expect(page.getByRole('button', { name: '使用最新版本继续编辑' })).toBeVisible()
    expect(posts).toBe(3)
    expect(f.store.titles()[0]?.titleVersion).toBe(3)
    await input.press('Escape')
    expect(readFileSync(path)).toEqual(bytes)
  } finally {
    await f.close()
  }
})

test('SESSION-11 two real Electron clients and read-only browser synchronize, detect/rebase conflict and recover a missed notification', async ({
  browser,
}) => {
  test.setTimeout(90000)
  const f = await fixture(),
    id = f.receipt.session.id
  mkdirSync(join(f.directory, 'second'), { recursive: true })
  const other = await launchWorkspaceDesktop(join(f.directory, 'second'), f.app)
  const context = await browser.newContext()
  try {
    await f.wire(other)
    const otherPane = other.page.locator('.retained-session:not([hidden])')
    await otherPane
      .locator(`[data-library-session="${id}"]`)
      .getByTitle(f.receipt.session.title, { exact: true })
      .click()
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      const response = await route.fetch({
        url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      await route.fulfill({ response })
    })
    await context.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const endpoint = new URL(url)
          if (endpoint.pathname === '/api/events') {
            endpoint.port = '4318'
          }
          super(endpoint, protocols)
        }
      }
    })
    const observer = await context.newPage()
    const ticket = f.app.get(AccessService).issueTicket('browser')
    await observer.goto(`http://127.0.0.1:5173/?history=${id}#pair=${ticket.code}`)
    await observer.getByRole('button', { name: '连接此浏览器', exact: true }).click()
    await expect(observer.getByLabel('会话标题', { exact: true })).toHaveText(
      f.receipt.session.title,
    )
    await f.open()
    await f.desktop.page.getByLabel('会话名称', { exact: true }).fill('甲端保留编辑')
    await otherPane.getByRole('button', { name: /^标题菜单：/ }).click()
    await other.page.getByRole('menuitem', { name: '重命名会话', exact: true }).click()
    await other.page.getByLabel('会话名称', { exact: true }).fill('乙端已保存')
    await other.page.getByLabel('会话名称', { exact: true }).press('Enter')
    await expect(other.page.getByRole('dialog')).toHaveCount(0)
    await expect(observer.getByLabel('会话标题', { exact: true })).toHaveText('乙端已保存')
    await expect(f.desktop.page.getByText('标题已在其他客户端更新', { exact: true })).toBeVisible()
    await expect(f.desktop.page.getByLabel('会话名称', { exact: true })).toHaveValue('甲端保留编辑')
    await expect(
      f.desktop.page.getByRole('button', { name: '保存名称', exact: true }),
    ).toBeDisabled()
    await f.desktop.page.getByRole('button', { name: '使用最新版本继续编辑' }).click()
    await f.desktop.page.getByRole('button', { name: '保存名称', exact: true }).click()
    await expect(other.page).toHaveTitle('甲端保留编辑 · Pi Workbench')
    await expect(observer.getByLabel('会话标题', { exact: true })).toHaveText('甲端保留编辑')
    await other.context.setOffline(true)
    const latest = f.store.titles()[0]
    if (!latest) {
      throw new Error('No latest title')
    }
    f.service.rename(id, { title: '离线期间更新', expectedVersion: latest.titleVersion })
    await other.context.setOffline(false)
    await expect(other.page).toHaveTitle('离线期间更新 · Pi Workbench', { timeout: 20000 })
    await expect(otherPane.getByRole('button', { name: /^标题菜单：/ })).toContainText(
      '离线期间更新',
    )
    expect(f.store.titles()[0]).toMatchObject({ titleVersion: 4, titleSource: 'user' })
  } finally {
    await context.close()
    await other.close()
    await f.close()
  }
})

test('SESSION-11 Electron ignores stale title lists and an old continuation receipt after a committed manual rename', async () => {
  const f = await fixture(),
    { page, context } = f.desktop,
    id = f.receipt.session.id
  try {
    const staleTitles = { titles: f.store.titles() }
    await context.route('**/api/chat/sessions', (route) =>
      route.fulfill({ json: { sessions: [f.receipt.session] } }),
    )
    await context.route('**/api/session-titles', (route) => route.fulfill({ json: staleTitles }))
    await f.open()
    await page.getByLabel('会话名称', { exact: true }).fill('新人工标题保持')
    await page.getByLabel('会话名称', { exact: true }).press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForResponse((response) => response.url().endsWith('/api/chat/sessions'))
    await expect(f.row()).toContainText('新人工标题保持')
    await expect(page).toHaveTitle('新人工标题保持 · Pi Workbench')
    await context.route('**/api/chat/submit', async (route) => {
      const response = await route.fetch({
        url: 'http://127.0.0.1:4318/api/chat/submit',
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      const receipt = sessionReceiptSchema.parse(await response.json())
      await route.fulfill({ response, json: { ...receipt, session: f.receipt.session } })
    })
    await f.pane.getByLabel('任务内容').fill('旧标题回执隔离的续发')
    await f.pane.getByLabel('任务内容').press('Enter')
    await expect.poll(() => f.store.submissions(id).length).toBe(2)
    await expect(f.pane.getByLabel('任务内容')).toHaveValue('')
    await expect(f.row()).toContainText('新人工标题保持')
    await expect(page).toHaveTitle('新人工标题保持 · Pi Workbench')
    expect(f.store.titles()[0]).toMatchObject({ titleVersion: 2, titleSource: 'user' })
  } finally {
    await f.close()
  }
})
