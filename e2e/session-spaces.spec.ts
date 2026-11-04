import type { Route } from '@playwright/test'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function forward(route: Route) {
  const url = new URL(route.request().url())
  return route.fetch({
    url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
    headers: {
      ...route.request().headers(),
      host: '127.0.0.1:4318',
      origin: 'http://127.0.0.1:5173',
    },
  })
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-spaces-ui-')),
    dataDir = join(directory, 'data'),
    projectPath = join(directory, 'project'),
    pi = join(directory, 'pi')
  mkdirSync(projectPath)
  mkdirSync(pi)
  writeFileSync(join(projectPath, 'AGENTS.md'), 'previous project must not inherit')
  writeFileSync(join(pi, 'AGENTS.md'), 'explicit global fixture context')
  let app = await createApp({ dataDir, port: 4318, development: true, piAgentDir: pi })
  await app.listen(4318, '127.0.0.1')
  const opened = await app.get(WorkspaceService).open(projectPath)
  assert(opened.ok)
  const project = await app
    .get(ProjectService)
    .create({ requestId: randomUUID(), name: '归属目标项目', workspaceId: opened.workspace.id })
  let desktop = await launchWorkspaceDesktop(directory, app)
  const wire = async () => {
    await desktop.context.addInitScript(() => {
      const Native = window.WebSocket
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          const endpoint = new URL(url)
          if (endpoint.pathname === '/api/events') {
            endpoint.port = '4318'
          }
          super(endpoint, protocols)
        }
      }
    })
  }
  await wire()
  return {
    directory,
    dataDir,
    pi,
    projectPath,
    project,
    get app() {
      return app
    },
    get desktop() {
      return desktop
    },
    restart: async () => {
      await desktop.close()
      await app.close()
      app = await createApp({ dataDir, port: 4318, development: true, piAgentDir: pi })
      await app.listen(4318, '127.0.0.1')
      desktop = await launchWorkspaceDesktop(directory, app)
      await wire()
    },
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
const active = (page: Awaited<ReturnType<typeof fixture>>['desktop']['page']) =>
  page.locator('.retained-session:not([hidden])')
async function send(page: Awaited<ReturnType<typeof fixture>>['desktop']['page'], text: string) {
  const pane = active(page)
  await pane.getByRole('textbox', { name: '任务内容' }).fill(text)
  await pane.getByRole('button', { name: '发送任务' }).click()
  await expect(pane.getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
}
async function inspect(
  page: Awaited<ReturnType<typeof fixture>>['desktop']['page'],
  title: string,
) {
  await active(page)
    .getByRole('button', { name: `标题菜单：${title}` })
    .click()
  await page.getByRole('menuitem', { name: '执行空间与项目归属' }).click()
  return page.getByRole('dialog', { name: '执行空间与项目归属' })
}

test('SESSION-07 Electron global new never inherits project cwd; metadata association preserves artifacts and origin across real app restart', async () => {
  const f = await fixture()
  try {
    let page = f.desktop.page
    await active(page).getByLabel('项目', { exact: true }).selectOption(f.project.id)
    await send(page, '之前的项目会话')
    await active(page).getByRole('button', { name: '新会话', exact: true }).click()
    await expect(active(page).getByLabel('项目', { exact: true })).toHaveValue('')
    await send(page, '持久独立空间')
    const session = f.app
      .get(SessionStore)
      .managedSessions()
      .find((row) => row.title === '持久独立空间')!
    expect(session.cwd).toBe(join(f.dataDir, 'standalone', session.id))
    const artifact = join(session.cwd, '外部验收夹具.txt')
    writeFileSync(artifact, 'external fixture artifact, not SDK tool output')
    let dialog = await inspect(page, session.title)
    await expect(dialog.getByText('持久独立目录', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('执行空间实际目录')).toHaveText(session.cwd)
    await expect(dialog.getByRole('region', { name: '会话能力来源' })).toBeVisible()
    await expect(dialog.getByText('显式全局来源 · context', { exact: true })).toBeVisible()
    await expect(dialog.getByText('未确认或已变化，未加载', { exact: true })).toBeVisible()
    await expect(dialog.getByText(join(f.projectPath, 'AGENTS.md'), { exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: '仅调整项目归属', exact: true }).click()
    await page.getByRole('menuitemradio', { name: new RegExp(f.project.name) }).click()
    await dialog.getByRole('button', { name: '确认仅调整归属' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(active(page).locator('.thread-identity')).toContainText(f.project.name)
    await expect(active(page).locator('.thread-identity')).toContainText(session.cwd)
    expect(readFileSync(artifact, 'utf8')).toContain('external fixture')
    expect(existsSync(join(f.projectPath, '外部验收夹具.txt'))).toBe(false)
    await page.reload()
    dialog = await inspect(page, session.title)
    await expect(dialog.getByLabel('执行空间原始来源')).toContainText('项目 ID：无项目')
    await page.screenshot({
      path: `${evidence}/session-space-origin-light.png`,
      animations: 'disabled',
    })
    await dialog.getByRole('button', { name: '返回会话' }).click()
    await f.restart()
    page = f.desktop.page
    expect(f.app.get(KernelService).list()).toEqual([])
    await active(page).getByTitle(session.title, { exact: true }).click()
    dialog = await inspect(page, session.title)
    await expect(dialog.getByLabel('执行空间实际目录')).toHaveText(session.cwd)
    await expect(dialog.getByLabel('执行空间原始来源')).toContainText('项目 ID：无项目')
    expect(readFileSync(artifact, 'utf8')).toContain('external fixture')
    expect(f.app.get(KernelService).list()).toEqual([])
    await dialog.getByRole('button', { name: '仅调整项目归属' }).click()
    await page.getByRole('menuitemradio', { name: '无项目', exact: true }).click()
    await dialog.getByRole('button', { name: '确认仅调整归属' }).click()
    await expect(
      active(page)
        .getByRole('region', { name: '最近无项目会话' })
        .getByTitle(session.title, { exact: true }),
    ).toBeVisible()
    await send(page, '重启后仍使用独立目录续发')
    expect(
      f.app
        .get(SessionStore)
        .managedSessions()
        .find((row) => row.id === session.id)?.cwd,
    ).toBe(session.cwd)
  } finally {
    await f.close()
  }
})

test('SESSION-07 Electron keeps choices on real SQLite failure and requires explicit version reconciliation for concurrent attribution', async () => {
  const f = await fixture(),
    { page } = f.desktop
  try {
    await send(page, '归属失败恢复')
    const session = f.app.get(SessionStore).managedSessions()[0],
      db = f.app.get(WorkspaceDatabase).sqlite
    assert(session)
    const dialog = await inspect(page, session.title)
    await dialog.getByRole('button', { name: '仅调整项目归属' }).click()
    await page.getByRole('menuitemradio', { name: new RegExp(f.project.name) }).click()
    db.exec(
      "CREATE TRIGGER reject_ui_membership BEFORE UPDATE OF project_id ON session_configurations BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END",
    )
    await dialog.getByRole('button', { name: '确认仅调整归属' }).click()
    await expect(dialog.getByText('保存结果待核对', { exact: false })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '仅调整项目归属' })).toContainText(
      f.project.name,
    )
    expect(f.app.get(SessionStore).managedSessions()[0]?.configuration.projectId).toBeNull()
    db.exec('DROP TRIGGER reject_ui_membership')
    let optionsFail = true
    await f.desktop.context.route('**/api/chat/options', async (route) => {
      if (optionsFail) {
        await route.fulfill({ status: 503, json: { message: 'fixture options unavailable' } })
      } else {
        await route.fulfill({ response: await forward(route) })
      }
    })
    await expect(dialog.getByText('项目列表未同步', { exact: true })).toBeVisible({
      timeout: 20000,
    })
    await expect(dialog.getByRole('button', { name: '确认仅调整归属' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '仅调整项目归属' })).toContainText(
      f.project.name,
    )
    optionsFail = false
    await dialog.getByRole('button', { name: '重新核对项目列表' }).click()
    await expect(dialog.getByText('项目列表未同步', { exact: true })).not.toBeVisible()
    f.app.get(SessionService).setProject(session.id, {
      expectedVersion: 1,
      project: { id: f.project.id, revision: f.project.revision },
    })
    f.app.get(SessionService).setProject(session.id, { expectedVersion: 2, project: null })
    await expect(dialog.getByText('归属或目标项目已更新', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '确认仅调整归属' })).toBeDisabled()
    await dialog.getByRole('button', { name: '使用最新版本继续整理' }).click()
    await dialog.getByRole('button', { name: '确认仅调整归属' }).click()
    await expect(dialog).not.toBeVisible()
    expect(f.app.get(SessionStore).managedSessions()[0]?.configuration.projectId).toBe(f.project.id)
    expect(f.app.get(SessionStore).origin(session.id)?.projectId).toBeNull()
  } finally {
    await f.close()
  }
})

test('SESSION-07 Electron isolates late inspection, recovers read failure, and keeps source controls usable in light/dark narrow windows', async () => {
  const f = await fixture(),
    { page, context } = f.desktop
  let release: (() => void) | undefined
  try {
    await send(page, '独立空间甲')
    await active(page).getByRole('button', { name: '新会话', exact: true }).click()
    await send(page, '独立空间乙')
    const [a, b] = f.app.get(SessionStore).managedSessions()
    assert(a && b)
    const path = `**/api/chat/sessions/${a.id}/space`
    let started = false
    const held = new Promise<void>((done) => {
      release = done
    })
    await context.route(path, async (route) => {
      const response = await forward(route)
      started = true
      await held
      await route.fulfill({ response }).catch(() => undefined)
    })
    await page.goto(`http://127.0.0.1:5173/?session=${a.id}`)
    await inspect(page, a.title)
    await expect.poll(() => started).toBe(true)
    await page.goto(`http://127.0.0.1:5173/?session=${b.id}`)
    let fail = true
    await context.route(`**/api/chat/sessions/${b.id}/space`, async (route) => {
      if (fail) {
        await route.abort('failed')
      } else {
        await route.fulfill({ response: await forward(route) })
      }
    })
    const dialog = await inspect(page, b.title)
    await expect(dialog.getByText('执行空间未同步', { exact: true })).toBeVisible()
    release?.()
    await expect(dialog.getByText(a.cwd, { exact: true })).toHaveCount(0)
    fail = false
    await dialog.getByRole('button', { name: '重新核对执行空间' }).click()
    await expect(dialog.getByLabel('执行空间实际目录')).toHaveText(b.cwd)
    await page.setViewportSize({ width: 800, height: 720 })
    await dialog.getByRole('button', { name: '仅调整项目归属' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitemradio', { name: '无项目', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.screenshot({
      path: `${evidence}/session-space-light-800.png`,
      animations: 'disabled',
    })
    await dialog.getByRole('button', { name: '返回会话' }).click()
    await page.getByRole('link', { name: '打开设置', exact: true }).click()
    await page.getByLabel('外观主题').selectOption('dark')
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    const dark = await inspect(page, b.title)
    await expect(dark.getByLabel('执行空间实际目录')).toHaveText(b.cwd)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(dark.getByRole('button', { name: '返回会话' })).toBeInViewport()
    await page.screenshot({
      path: `${evidence}/session-space-dark-800.png`,
      animations: 'disabled',
    })
    await dark.getByRole('button', { name: '返回会话' }).click()
    expect(f.app.get(SessionStore).submissions(b.id)).toHaveLength(1)
  } finally {
    release?.()
    await f.close()
  }
})

test('SESSION-07 a late association receipt preserves a newer membership and cannot close a reopened dialog', async () => {
  const f = await fixture(),
    { page, context } = f.desktop
  let release: (() => void) | undefined
  try {
    await send(page, '迟到归属甲')
    await active(page).getByRole('button', { name: '新会话', exact: true }).click()
    await send(page, '迟到归属乙')
    const a = f.app
      .get(SessionStore)
      .managedSessions()
      .find((row) => row.title === '迟到归属甲')!
    let saved = false,
      delivered = false
    const held = new Promise<void>((done) => {
      release = done
    })
    await context.route(`**/api/chat/sessions/${a.id}/project`, async (route) => {
      const response = await forward(route)
      saved = true
      await held
      await route.fulfill({ response })
      delivered = true
    })
    await active(page).getByTitle(a.title, { exact: true }).click()
    const original = await inspect(page, a.title)
    await original.getByRole('button', { name: '仅调整项目归属' }).click()
    await page.getByRole('menuitemradio', { name: new RegExp(f.project.name) }).click()
    await original.getByRole('button', { name: '确认仅调整归属' }).click()
    await expect.poll(() => saved).toBe(true)
    await page.goBack()
    await expect(active(page).locator('.thread-identity')).toContainText('迟到归属乙')
    await active(page).getByTitle(a.title, { exact: true }).click()
    const reopened = await inspect(page, a.title)
    await expect(reopened.getByRole('button', { name: '仅调整项目归属' })).toContainText(
      f.project.name,
    )
    f.app.get(SessionService).setProject(a.id, { expectedVersion: 2, project: null })
    await expect(reopened.getByText('归属或目标项目已更新', { exact: true })).toBeVisible()
    await expect(active(page).locator('.thread-identity')).toContainText('无项目')
    release?.()
    await expect.poll(() => delivered).toBe(true)
    await expect(reopened.getByRole('button', { name: '使用最新版本继续整理' })).toBeVisible()
    await expect(active(page).locator('.thread-identity')).toContainText('无项目')
    expect(
      f.app
        .get(SessionStore)
        .managedSessions()
        .find((row) => row.id === a.id)?.membershipVersion,
    ).toBe(3)
  } finally {
    release?.()
    await f.close()
  }
})
