import type { ManagedSession } from '../packages/shared/dist/index.js'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-library-ui-')), seed = true) {
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const store = app.get(SessionStore),
    service = app.get(SessionService),
    kernels = app.get(KernelService)
  try {
    if (seed) {
      await Promise.all(
        ['甲', '乙', '丙'].map(async (letter) => {
          const receipt = await service.submit({
            requestId: randomUUID(),
            sessionId: null,
            configuration: {
              projectId: null,
              workspaceId: null,
              model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
              thinking: 'off',
            },
            text:
              `${letter} 会话\n` +
              Array.from(
                { length: 55 },
                (_, i) => `${letter} 阅读段落 ${i}，保持中段阅读位置。`,
              ).join('\n'),
            retryOf: null,
          })
          await expect
            .poll(() => store.submission(receipt.submission.requestId)?.status, { timeout: 15000 })
            .toBe('completed')
        }),
      )
    }
    const sessions = store.managedSessions()
    const desktop = await launchWorkspaceDesktop(directory, app)
    await desktop.context.addInitScript(() => {
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
    await desktop.page.reload()
    const pane = desktop.page.locator('.retained-session:not([hidden])')
    const row = (id: string) => pane.locator(`[data-library-session="${id}"]`)
    const menu = async (session: ManagedSession, label: string) => {
      await row(session.id)
        .getByRole('button', { name: `会话菜单：${session.title}`, exact: true })
        .click()
      await desktop.page.getByRole('menuitem', { name: label, exact: true }).click()
    }
    const meta = (id: string) => {
      const result = store.organizations().find((item) => item.sessionId === id)
      if (!result) {
        throw new Error('Missing organization')
      }
      return result
    }
    return {
      directory,
      app,
      store,
      service,
      kernels,
      desktop,
      sessions,
      pane,
      row,
      menu,
      meta,
      close: async (remove = true) => {
        await desktop.close()
        await app.close()
        if (remove) {
          rmSync(directory, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

test('SESSION-03 Electron pin/unread/archive survive real daemon and Electron restart; restore keeps content and does not start kernels', async () => {
  test.setTimeout(90000)
  let f = await fixture()
  const a = f.sessions[0]
  if (!a) {
    throw new Error('No session')
  }
  try {
    await f.menu(a, '置顶会话')
    await expect(f.pane.getByRole('region', { name: '已置顶会话' })).toContainText(a.title)
    await f.menu(a, '归档会话')
    await f.desktop.page.getByRole('button', { name: '确认归档', exact: true }).click()
    await expect(f.row(a.id)).toHaveCount(0)
    await f.pane.getByRole('button', { name: '已归档', exact: true }).click()
    await expect(f.row(a.id)).toContainText('未读')
    const saved = f.meta(a.id)
    await f.close(false)
    f = await fixture(f.directory, false)
    expect(f.meta(a.id)).toEqual(saved)
    expect(f.kernels.list()).toEqual([])
    await f.pane.getByRole('button', { name: '已归档', exact: true }).click()
    await expect(f.row(a.id)).toContainText(a.title)
    await f.row(a.id).getByTitle(a.title, { exact: true }).click()
    await expect(f.pane.getByText('此会话已归档', { exact: true })).toBeVisible()
    await f.pane.getByLabel('任务内容').fill('归档会话草稿保留')
    await expect(f.pane.getByRole('button', { name: '发送任务' })).toBeDisabled()
    await f.menu(a, '恢复会话')
    await expect(f.desktop.page.getByRole('alertdialog')).toContainText('不会启动任务或恢复旧审批')
    await f.desktop.page.getByRole('button', { name: '确认恢复', exact: true }).click()
    await expect.poll(() => f.meta(a.id).archived).toBe(false)
    expect(f.kernels.list()).toEqual([])
    await f.pane.getByRole('button', { name: '返回会话', exact: true }).click()
    await expect(f.pane.getByRole('region', { name: '已置顶会话' })).toContainText(a.title)
    await expect(f.pane.getByLabel('任务内容')).toHaveValue('归档会话草稿保留')
    await f.menu(a, '取消置顶')
    await expect(f.pane.getByRole('region', { name: '已置顶会话' })).toHaveCount(0)
  } finally {
    await f.close()
  }
})

test('SESSION-03 Electron unread stays at the saved middle; latest and explicit read clear it, manual unread survives polling', async () => {
  test.setTimeout(90000)
  const f = await fixture(),
    { page } = f.desktop,
    [a, b] = f.sessions
  if (!a || !b) {
    throw new Error('No sessions')
  }
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await f.row(b.id).getByTitle(b.title, { exact: true }).click()
    await expect(f.pane.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
    await expect.poll(() => f.meta(b.id).unread).toBe(false)
    await f.pane.getByLabel('受管会话消息').press('Home')
    await expect
      .poll(() => f.pane.getByLabel('受管会话消息').evaluate((el) => el.scrollTop))
      .toBe(0)
    await f.row(a.id).getByTitle(a.title, { exact: true }).click()
    const receipt = await f.service.submit({
      requestId: randomUUID(),
      sessionId: b.id,
      configuration: b.configuration,
      text: '乙的后台新结果',
      retryOf: null,
    })
    await expect
      .poll(() => f.store.submission(receipt.submission.requestId)?.status, { timeout: 15000 })
      .toBe('completed')
    await expect(f.row(b.id)).toContainText('未读')
    await f.row(b.id).getByTitle(b.title, { exact: true }).click()
    await expect(f.pane.getByLabel('受管会话消息')).toContainText('乙的后台新结果')
    await page.waitForResponse((response) => response.url().endsWith('/api/chat/organization'))
    await expect(f.row(b.id)).toContainText('未读')
    await f.pane.getByLabel('受管会话消息').press('End')
    await expect.poll(() => f.meta(b.id).unread).toBe(false)
    await f.menu(b, '标记未读')
    await expect(f.row(b.id)).toContainText('未读')
    await page.waitForResponse((response) => response.url().endsWith('/api/chat/organization'))
    await page.waitForResponse((response) => response.url().endsWith('/api/chat/organization'))
    expect(f.meta(b.id).unread).toBe(true)
    await f.menu(b, '标记已读')
    await expect.poll(() => f.meta(b.id).unread).toBe(false)
    await f.menu(b, '置顶会话')
    await page.screenshot({ path: `${evidence}/session-library-light.png`, animations: 'disabled' })
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByLabel('外观主题').selectOption('dark')
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await f.menu(a, '归档会话')
    await page.screenshot({
      path: `${evidence}/session-library-dark-dialog.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.setViewportSize({ width: 800, height: 720 })
    await f.pane.getByRole('button', { name: '展开导航', exact: true }).click()
    await f
      .row(b.id)
      .getByRole('button', { name: `会话菜单：${b.title}`, exact: true })
      .focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: '取消置顶', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `${evidence}/session-library-dark-800.png`,
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('SESSION-03 Electron running archive cancel leaves the same SDK PID; explicit stop settles before separate confirmation', async () => {
  test.setTimeout(90000)
  const f = await fixture(),
    { page } = f.desktop,
    [a, b] = f.sessions
  if (!a || !b) {
    throw new Error('No sessions')
  }
  const original = f.kernels.prompt.bind(f.kernels)
  f.kernels.prompt = (id, cwd, prompt, options) =>
    original(id, cwd, { ...prompt, fixture: 'hold' }, options)
  try {
    await f.row(a.id).getByTitle(a.title, { exact: true }).click()
    await f.pane.getByLabel('任务内容').fill('运行中归档必须先停止')
    await f.pane.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect(f.pane.getByLabel('任务状态').last()).toHaveText('运行中', { timeout: 15000 })
    const pid = f.kernels.list().find((row) => row.sessionId === a.id)?.pid
    await f.row(b.id).getByTitle(b.title, { exact: true }).click()
    await f.menu(a, '归档会话')
    await expect(page.getByRole('alertdialog')).toContainText('先处理任务，再归档')
    await expect(page.getByRole('button', { name: '确认归档', exact: true })).toBeDisabled()
    await page.screenshot({
      path: `${evidence}/session-library-running-archive.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect(f.kernels.list().find((row) => row.sessionId === a.id)).toMatchObject({
      pid,
      state: 'running',
    })
    expect(f.meta(a.id).archived).toBe(false)
    await f.menu(a, '归档会话')
    await page.getByRole('button', { name: '停止当前任务', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认归档', exact: true })).toBeEnabled()
    expect(f.meta(a.id).archived).toBe(false)
    expect(f.store.submissions(a.id).at(-1)?.status).toBe('aborted')
    await page.getByRole('button', { name: '确认归档', exact: true }).click()
    await expect(f.row(a.id)).toHaveCount(0)
    await f.pane.getByRole('button', { name: '已归档', exact: true }).click()
    await expect(f.row(a.id)).toContainText('未读')
    expect(f.service.activity().find((row) => row.id === a.id)?.running).toBe(false)
    expect(page.url()).toContain(b.id)
  } finally {
    f.kernels.prompt = original
    await f.close()
  }
})

test('SESSION-03 Electron failed saves stay honest; delayed lists cannot undo a saved pin and hidden view portals close', async () => {
  test.setTimeout(90000)
  const f = await fixture(),
    { page } = f.desktop,
    [a, b] = f.sessions
  if (!a || !b) {
    throw new Error('No sessions')
  }
  let release!: () => void,
    waiting = false,
    intercept = true
  const gate = new Promise<void>((done) => {
    release = done
  })
  try {
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      "CREATE TRIGGER fail_library BEFORE UPDATE ON session_organization BEGIN SELECT RAISE(ABORT, 'offline test write failure'); END",
    )
    await f.menu(a, '置顶会话')
    await expect(f.pane.getByRole('alert')).toContainText('整理状态未能保存')
    expect(f.meta(a.id).pinned).toBe(false)
    db.exec('DROP TRIGGER fail_library')
    await page.context().route('**/api/chat/organization', async (route) => {
      if (!intercept) {
        await route.fallback()
        return
      }
      intercept = false
      const response = await route.fetch({
        url: 'http://127.0.0.1:4318/api/chat/organization',
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      waiting = true
      await gate
      await route.fulfill({ response })
    })
    await expect.poll(() => waiting).toBe(true)
    await f.menu(a, '置顶会话')
    await expect.poll(() => f.meta(a.id).pinned).toBe(true)
    release()
    await expect(f.pane.getByRole('region', { name: '已置顶会话' })).toContainText(a.title)
    await f.row(b.id).getByTitle(b.title, { exact: true }).click()
    await f.row(a.id).getByTitle(a.title, { exact: true }).click()
    await f.menu(a, '归档会话')
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(b.id))
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.goForward()
    await expect(page).toHaveURL(new RegExp(a.id))
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(f.meta(a.id).archived).toBe(false)
  } finally {
    release?.()
    await f.close()
  }
})

test('SESSION-03 Electron a failed SDK result becomes unread in the background, clears when displayed and never retries automatically', async () => {
  const f = await fixture(),
    { page } = f.desktop,
    [a, b] = f.sessions
  if (!a || !b) {
    throw new Error('No sessions')
  }
  const original = f.kernels.prompt.bind(f.kernels)
  let calls = 0
  f.kernels.prompt = (id, cwd, prompt, options) => {
    calls++
    return original(id, cwd, { ...prompt, fixture: 'error' }, options)
  }
  try {
    await f.row(b.id).getByTitle(b.title, { exact: true }).click()
    await f.menu(a, '标记已读')
    const result = await f.service.submit({
      requestId: randomUUID(),
      sessionId: a.id,
      configuration: a.configuration,
      text: '本地 HTTP 失败验收',
      retryOf: null,
    })
    await expect
      .poll(() => f.store.submission(result.submission.requestId)?.status, { timeout: 15000 })
      .toBe('failed')
    await expect(f.row(a.id)).toContainText('未读')
    await f.row(a.id).getByTitle(a.title, { exact: true }).click()
    await expect(f.pane.getByLabel('任务状态').last()).toHaveText('本轮失败')
    await f.pane.getByLabel('受管会话消息').press('End')
    await expect.poll(() => f.meta(a.id).unread).toBe(false)
    await expect(f.pane.getByRole('button', { name: '明确重试此任务', exact: true })).toBeVisible()
    await page.screenshot({
      path: `${evidence}/session-library-failed-result.png`,
      animations: 'disabled',
    })
    expect(calls).toBe(1)
  } finally {
    f.kernels.prompt = original
    await f.close()
  }
})
