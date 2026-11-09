import type { Route } from '@playwright/test'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { fixtureGit as git } from '../apps/daemon/test/helpers/git.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'
import { openConfiguration, openEnvironment } from './helpers/workbench.js'

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
  const directory = mkdtempSync(join(tmpdir(), 'piw-environment-ui-')),
    a = join(directory, '中文 A'),
    b = join(directory, '中文 B'),
    plain = join(directory, '普通目录')
  mkdirSync(a)
  mkdirSync(b)
  mkdirSync(plain)
  git(a, 'init', '-b', '功能/主分支')
  git(a, 'commit', '--allow-empty', '-m', 'baseline')
  git(b, 'init', '-b', 'beta')
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const workspaces = app.get(WorkspaceService),
    store = app.get(SessionStore)
  const desktop = await launchWorkspaceDesktop(directory, app),
    { page } = desktop
  // Use the same isolated daemon for real TCP WS and REST; no simulated runtime frames.
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
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const environment = page.getByRole('region', { name: '工作区与 Git 环境' }),
    status = environment.getByLabel('Git 状态', { exact: true })
  const open = async (path: string) => {
    await page.getByLabel('工作区目录', { exact: true }).fill(path)
    await page.getByRole('button', { name: '打开路径', exact: true }).click()
    await expect(page.getByLabel('实际目录', { exact: true })).toHaveText(path)
  }
  return {
    directory,
    a,
    b,
    plain,
    app,
    workspaces,
    store,
    desktop,
    page,
    errors,
    environment,
    status,
    open,
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('WS-03 Electron observes actual cwd/repository, external branch and detached changes, non-Git, nested repositories, keyboard and themes', async () => {
  const f = await fixture()
  try {
    await f.page.setViewportSize({ width: 1920, height: 1080 })
    await f.page.goto('http://127.0.0.1:5173/?workspaces')
    await f.open(f.a)
    await expect(f.status).toHaveText('功能/主分支')
    await expect(f.environment.getByLabel('Git 仓库', { exact: true })).toHaveText(`仓库：${f.a}`)
    await f.page.screenshot({
      path: `${evidence}/environment-light-1920.png`,
      animations: 'disabled',
    })
    git(f.a, 'switch', '-c', '切换/新分支')
    await expect(f.status).toHaveText('切换/新分支', { timeout: 7000 })
    git(f.a, 'switch', '--detach')
    await expect(f.status).toHaveText(`detached · ${git(f.a, 'rev-parse', 'HEAD').slice(0, 12)}`, {
      timeout: 7000,
    })
    await f.open(f.b)
    await expect(f.status).toHaveText('beta · 尚无提交')
    await f.open(f.plain)
    await expect(f.status).toHaveText('非 Git 目录')
    await expect(f.environment.getByLabel('Git 仓库', { exact: true })).toHaveCount(0)
    const nested = join(f.a, 'nested')
    mkdirSync(nested)
    git(nested, 'init', '-b', 'nested')
    await f.open(nested)
    await expect(f.status).toHaveText('nested · 尚无提交')
    await f.environment.getByRole('button', { name: '刷新环境标识' }).focus()
    await f.page.keyboard.press('Enter')
    await expect(f.status).toHaveText('nested · 尚无提交')
    expect(f.store.list()).toEqual([])
    expect(f.app.get(KernelService).list()).toEqual([])
    await f.page.getByRole('link', { name: '返回工作台', exact: true }).click()
    await f.page.getByRole('link', { name: '设置', exact: true }).click()
    await f.page.getByLabel('外观主题').selectOption('dark')
    await f.page.goto('http://127.0.0.1:5173/?workspaces')
    await f.page.setViewportSize({ width: 800, height: 720 })
    await f.open(nested)
    await expect(f.status).toHaveText('nested · 尚无提交')
    await expect(f.page.locator('html')).toHaveClass(/dark/)
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await f.page.screenshot({
      path: `${evidence}/environment-dark-800.png`,
      animations: 'disabled',
    })
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-03 Electron isolates delayed previous workspace responses and removes stale branch labels on failure/retry', async () => {
  const f = await fixture()
  let captured = false
  let release: (() => void) | undefined
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await f.page.goto('http://127.0.0.1:5173/?workspaces')
    const first = await f.workspaces.open(f.a)
    assert(first.ok)
    await f.desktop.context.route('**/api/workspaces/environment?*', async (route) => {
      if (
        new URL(route.request().url()).searchParams.get('workspaceId') === first.workspace.id &&
        !captured
      ) {
        const response = await forward(route)
        captured = true
        await delayed
        await route.fulfill({ response })
      } else {
        await route.fallback()
      }
    })
    await f.open(f.a)
    await expect.poll(() => captured).toBe(true)
    await f.open(f.b)
    await expect(f.status).toHaveText('beta · 尚无提交')
    release?.()
    await expect(f.status).toHaveText('beta · 尚无提交')
    await expect(f.environment).not.toContainText('功能/主分支')
    await f.desktop.context.unroute('**/api/workspaces/environment?*')
    await f.desktop.context.route('**/api/workspaces/environment?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Explicit offline fault' }),
      }),
    )
    await f.environment.getByRole('button', { name: '刷新环境标识' }).click()
    await expect(f.status).toHaveText('未同步')
    await expect(f.environment).not.toContainText('beta')
    await expect(f.environment.getByRole('alert')).toContainText('恢复本地连接')
    await f.desktop.context.unroute('**/api/workspaces/environment?*')
    await f.environment.getByRole('button', { name: '刷新环境标识' }).click()
    await expect(f.status).toHaveText('beta · 尚无提交')
    expect(f.errors).toEqual([])
  } finally {
    release?.()
    await f.close()
  }
})

test('WS-03 Electron keeps saved cwd and background SDK PID when viewing other repositories; return/reload uses current HEAD', async () => {
  const f = await fixture()
  try {
    const opened = await f.workspaces.open(f.a)
    assert(opened.ok)
    const kernels = f.app.get(KernelService),
      prompt = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, command, options) =>
      prompt(id, cwd, { ...command, fixture: 'hold' }, options)
    const receipt = await f.app.get(SessionService).submit({
      requestId: randomUUID(),
      sessionId: null,
      configuration: {
        projectId: null,
        workspaceId: opened.workspace.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
      text: '明确标记的本地 SDK 持续任务',
      retryOf: null,
    })
    await f.page.goto(`http://127.0.0.1:5173/?session=${receipt.session.id}`)
    await openEnvironment(f.page)
    await expect(f.status).toHaveText('功能/主分支')
    await expect(f.environment.getByLabel('环境执行目录', { exact: true })).toHaveText(f.a)
    await expect.poll(() => kernels.list()[0]?.pid).toBeGreaterThan(0)
    await expect
      .poll(() => f.app.get(EventService).snapshot(receipt.session.id)?.turns.at(-1)?.text, {
        timeout: 15000,
      })
      .toContain('OFFLINE_')
    await expect(f.page.getByLabel('任务状态')).toHaveText('运行中')
    const before = kernels.list()[0]
    await f.page.setViewportSize({ width: 1920, height: 1080 })
    await f.page.screenshot({
      path: `${evidence}/environment-session-light-1920.png`,
      animations: 'disabled',
    })
    await f.page.goto('http://127.0.0.1:5173/?workspaces')
    await f.open(f.b)
    await expect(f.status).toHaveText('beta · 尚无提交')
    expect(kernels.list()[0]).toMatchObject({ pid: before?.pid, epoch: before?.epoch, cwd: f.a })
    git(f.a, 'switch', '-c', '返回后新分支')
    await f.page.goto(`http://127.0.0.1:5173/?session=${receipt.session.id}`)
    await expect(f.status).toHaveText('返回后新分支')
    await f.page.reload()
    await expect(f.status).toHaveText('返回后新分支')
    expect(f.store.managedSessions()[0]?.cwd).toBe(f.a)
    expect(kernels.list()[0]).toMatchObject({ pid: before?.pid, epoch: before?.epoch, cwd: f.a })
    await kernels.abort(receipt.session.id, receipt.submission.turnId)
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-03 Electron permits actual first-send/continuation in a non-Git directory and does not invent a directory before send', async () => {
  const f = await fixture()
  try {
    await openEnvironment(f.page)
    await expect(f.status).toHaveText('尚未创建目录')
    expect(f.store.list()).toEqual([])
    await openConfiguration(f.page)
    await f.page.getByText('执行目录：独立目录', { exact: true }).click()
    await f.page.getByLabel('目录绝对路径（可选）', { exact: true }).fill(f.plain)
    await f.page.getByRole('button', { name: '校验此目录', exact: true }).click()
    await expect(f.status).toHaveText('非 Git 目录')
    await expect(f.environment).toContainText('待用目录')
    const box = f.page.getByRole('textbox', { name: '任务内容' })
    await box.fill('非 Git 的真实本地夹具会话')
    await f.page.getByRole('button', { name: '发送任务' }).click()
    await openEnvironment(f.page)
    await expect(f.page.getByLabel('任务状态')).toHaveText('本轮已结束', { timeout: 15000 })
    await expect(f.status).toHaveText('非 Git 目录')
    await expect(f.environment).toContainText('实际 cwd')
    expect(f.store.managedSessions()[0]?.cwd).toBe(f.plain)
    await box.fill('同目录续发')
    await f.page.getByRole('button', { name: '发送任务' }).click()
    const saved = f.store.managedSessions()[0]
    assert(saved)
    await expect.poll(() => f.store.submissions(saved.id).length).toBe(2)
    await expect
      .poll(() => f.store.submissions(saved.id).at(-1)?.status, { timeout: 15000 })
      .toBe('completed')
    await expect(f.page.getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
    await expect(f.page.getByLabel('受管会话消息')).toContainText('同目录续发')
    expect(f.store.managedSessions()).toHaveLength(1)
    await f.page.setViewportSize({ width: 390, height: 844 })
    await expect(f.status).toHaveText('非 Git 目录')
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await f.page.screenshot({
      path: `${evidence}/environment-session-narrow.png`,
      animations: 'disabled',
    })
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-03 Electron distinguishes submodule, superproject and linked worktree; long branch labels remain bounded', async () => {
  const f = await fixture()
  try {
    git(f.b, 'commit', '--allow-empty', '-m', 'module baseline')
    git(f.a, '-c', 'protocol.file.allow=always', 'submodule', 'add', f.b, 'module')
    const sub = join(f.a, 'module'),
      linked = join(f.directory, 'linked'),
      longBranch = `feature/${'长分支名称'.repeat(14)}`
    git(f.a, 'worktree', 'add', '-b', longBranch, linked)
    await f.page.goto('http://127.0.0.1:5173/?workspaces')
    await f.open(sub)
    await expect(f.status).toHaveText('beta')
    await expect(f.environment.getByLabel('Git 子模块', { exact: true })).toHaveText(
      `子模块 · 主仓库：${f.a}`,
    )
    await f.open(f.a)
    await expect(f.status).toHaveText('功能/主分支')
    await expect(f.environment.getByLabel('Git 子模块', { exact: true })).toHaveCount(0)
    await f.open(linked)
    await expect(f.status).toHaveText(longBranch)
    await expect(f.environment.getByLabel('Git 仓库', { exact: true })).toHaveText(
      `仓库：${linked}`,
    )
    await f.page.setViewportSize({ width: 390, height: 844 })
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})
