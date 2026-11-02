import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { TrustService } from '../apps/daemon/dist/modules/security/trust.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { workspaceOpenSchema } from '../packages/shared/dist/index.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-workspace-ui-'))
  const first = join(directory, '项目 Alpha'),
    second = join(directory, 'Project Beta'),
    alias = join(directory, 'Alias Alpha')
  mkdirSync(first)
  mkdirSync(second)
  symlinkSync(first, alias, process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(first, 'AGENTS.md'), 'Untrusted project text must remain untrusted.')
  const marker = join(directory, 'must-not-execute')
  mkdirSync(join(first, '.pi', 'extensions'), { recursive: true })
  writeFileSync(
    join(first, '.pi', 'extensions', 'unsafe.mjs'),
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe')`,
  )
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  try {
    const desktop = await launchWorkspaceDesktop(directory, app)
    return {
      directory,
      first,
      second,
      alias,
      app,
      desktop,
      marker,
      close: async () => {
        await desktop.close()
        await app.close()
        rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

test('WS-01 real Electron picker bridge opens/deduplicates/switches; cancellation and invalid paths preserve current view and running SDK task', async () => {
  const f = await fixture()
  const { page } = f.desktop
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.getByRole('link', { name: '打开工作区', exact: true }).click()
    await expect(page.getByRole('heading', { name: '工作区', exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => {
        const bridge: unknown = Reflect.get(window, 'piWorkbench')
        return bridge && typeof bridge === 'object' ? Object.keys(bridge) : []
      }),
    ).toEqual(['selectDirectory'])
    expect(await page.evaluate(() => 'require' in window || 'process' in window)).toBe(false)
    await page.getByRole('button', { name: '选择文件夹', exact: true }).click()
    await expect(page.getByLabel('工作区操作状态')).toContainText('已取消选择')
    expect(f.app.get(SessionStore).list()).toEqual([])
    await f.desktop.setSelection(f.first)
    await page.getByRole('button', { name: '选择文件夹', exact: true }).click()
    await expect(page.getByLabel('实际目录')).toHaveText(f.first)
    const firstId = await page.getByLabel('工作区标识').innerText()
    await expect(page.getByRole('heading', { name: '项目 Alpha', exact: true })).toBeFocused()
    await page.getByLabel('工作区目录', { exact: true }).fill(f.alias)
    await page.getByRole('button', { name: '打开路径', exact: true }).click()
    await expect(page.getByLabel('工作区操作状态')).toContainText('已复用既有工作区')
    await expect(page.getByLabel('工作区标识')).toHaveText(firstId)
    await expect(
      page.getByRole('navigation', { name: '本窗口已打开工作区' }).getByRole('button'),
    ).toHaveCount(1)
    expect(f.app.get(SessionStore).list()).toEqual([])
    const sessionId = randomUUID(),
      turnId = randomUUID(),
      kernels = f.app.get(KernelService),
      events = f.app.get(EventService)
    const run = kernels.prompt(sessionId, f.first, {
      turnId,
      text: 'background SDK local fixture',
      fixture: 'hold',
    })
    await expect.poll(() => events.snapshot(sessionId)?.turns.at(-1)?.text).toContain('OFFLINE_')
    const pid = kernels.list()[0]?.pid
    await page.getByLabel('工作区目录', { exact: true }).fill(f.second)
    await page.getByRole('button', { name: '打开路径', exact: true }).click()
    await expect(page.getByLabel('实际目录')).toHaveText(f.second)
    await page
      .getByRole('navigation', { name: '本窗口已打开工作区' })
      .getByRole('button', { name: '项目 Alpha', exact: true })
      .click()
    await expect(page.getByLabel('实际目录')).toHaveText(f.first)
    expect(kernels.list()[0]?.pid).toBe(pid)
    expect(events.snapshot(sessionId)?.turns.at(-1)?.phase).toBe('running')
    await page.getByLabel('工作区目录', { exact: true }).fill(join(f.directory, 'missing'))
    await page.getByRole('button', { name: '打开路径', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('目录不存在')
    await expect(page.getByLabel('工作区目录', { exact: true })).toBeFocused()
    await expect(page.getByLabel('实际目录')).toHaveText(f.first)
    expect(f.app.get(SessionStore).list()).toHaveLength(1)
    expect(f.app.get(TrustService).inspect().records).toEqual([])
    expect(existsSync(f.marker)).toBe(false)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/workspaces-light.png`,
      animations: 'disabled',
    })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 720 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/workspaces-dark-800.png`,
      animations: 'disabled',
    })
    await kernels.abort(sessionId, turnId)
    expect(await run).toMatchObject({ localRequests: 1, blockedNetworkAttempts: 0 })
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-01 Electron ignores stale responses, preserves selection on disconnect, and recovers a missing directory without phantom sessions', async () => {
  const f = await fixture(),
    { page } = f.desktop
  try {
    await page.goto('http://127.0.0.1:5173/?workspaces')
    await expect(page.getByRole('heading', { name: '工作区', exact: true })).toBeVisible()
    let release: (() => void) | undefined
    const held = new Promise<void>((done) => {
      release = done
    })
    let delayed = false
    await page.route('**/api/workspaces/open', async (route) => {
      if (workspaceOpenSchema.parse(route.request().postDataJSON()).path === f.first) {
        const response = await route.fetch()
        delayed = true
        await held
        await route.fulfill({ response })
      } else {
        await route.fallback()
      }
    })
    await page.getByLabel('工作区目录', { exact: true }).fill(f.first)
    await page.getByRole('button', { name: '打开路径', exact: true }).click()
    await expect.poll(() => delayed).toBe(true)
    await page.getByLabel('工作区目录', { exact: true }).fill(f.second)
    await page.getByRole('button', { name: '打开路径', exact: true }).click()
    await expect(page.getByLabel('实际目录')).toHaveText(f.second)
    const lateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/workspaces/open') &&
        workspaceOpenSchema.parse(response.request().postDataJSON()).path === f.first,
    )
    release?.()
    await lateResponse
    await expect(page.getByLabel('实际目录')).toHaveText(f.second)
    renameSync(f.second, `${f.second}-moved`)
    await page.getByRole('button', { name: '重新校验', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('目录不存在')
    await expect(page.getByLabel('当前工作区')).toContainText('需要重新校验')
    renameSync(`${f.second}-moved`, f.second)
    await page.getByRole('button', { name: '重新校验', exact: true }).click()
    await expect(page.getByLabel('当前工作区')).toContainText('上次校验可读写')
    await page.route('**/api/workspaces/validate', (route) => route.abort('connectionrefused'))
    await page.getByRole('button', { name: '重新校验', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('连接未确认')
    await expect(page.getByLabel('实际目录')).toHaveText(f.second)
    await page.unroute('**/api/workspaces/validate')
    await page.getByRole('button', { name: '重新校验', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByLabel('工作区目录', { exact: true }).fill(f.first)
    // Program-generated IME event is a regression check, not a physical Chinese IME claim.
    await page
      .getByLabel('工作区目录', { exact: true })
      .dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await expect(page.getByLabel('实际目录')).toHaveText(f.second)
    expect(f.app.get(SessionStore).list()).toEqual([])
    await page.getByRole('link', { name: '查看资源信任', exact: true }).click()
    await expect(page.getByRole('heading', { name: '项目与资源信任' })).toBeVisible()
    await expect(page.getByLabel('待检查的本机目录')).toHaveValue(f.second)
    expect(f.app.get(TrustService).inspect().records).toEqual([])
  } finally {
    await f.close()
  }
})
