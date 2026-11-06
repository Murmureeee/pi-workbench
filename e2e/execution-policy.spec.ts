import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { denyFixtureApprovals } from '../apps/daemon/test/helpers/decisions.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

/** Fixture selects only the local model response and seeds owned text before dispatch.
 * No synthetic tool events or renderer transport replacement supply the result. */
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-guard-ui-'))
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  denyFixtureApprovals(app)
  const kernels = app.get(KernelService),
    original = kernels.prompt.bind(kernels),
    store = app.get(SessionStore),
    events = app.get(EventService)
  let prompts = 0
  kernels.prompt = (id, cwd, input, options) => {
    prompts++
    writeFileSync(
      join(cwd, 'readme.txt'),
      '真实中文受限读取\nSDK_SAFE_READ api_key=fixture-guard-secret',
    )
    writeFileSync(join(cwd, '.env'), 'PRIVATE_FILE_MUST_STAY_UNREAD')
    return original(
      id,
      cwd,
      { ...input, fixture: input.text.includes('拒绝') ? 'guard-denied' : 'guard-read' },
      options,
    )
  }
  const desktop = await launchWorkspaceDesktop(directory, app)
  return {
    desktop,
    kernels,
    store,
    events,
    prompts: () => prompts,
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

test('SEC-01 actual Electron safe-read card shows host risk/final digest and redacted SDK result; settings and reload do not repeat execution', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('验证中文受限读取')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length).toBe(1)
    const session = f.store.managedSessions()[0]
    if (!session) {
      throw new Error('Missing read session')
    }
    await expect
      .poll(() => f.store.submissions(session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    const pane = page.locator('.retained-session:not([hidden])'),
      card = pane.locator('[data-tool-id="guard-0"]')
    await card.getByRole('button').focus()
    await page.keyboard.press('Enter')
    await expect(card).toContainText('L0 · 受限读取自动')
    await expect(card).toContainText('SDK_SAFE_READ')
    await expect(card).not.toContainText('fixture-guard-secret')
    const tool = f.events.snapshot(session.id)?.turns[0]?.tools[0]
    expect(tool?.risk?.digest).toMatch(/^[a-f\d]{64}$/)
    if (!tool?.risk) {
      throw new Error('Missing host risk')
    }
    await expect(card.getByLabel('宿主风险裁决')).toContainText(tool.risk.digest)
    const file = f.kernels.list()[0]?.sessionFile
    if (!file) {
      throw new Error('Missing actual SDK history')
    }
    const before = readFileSync(file)
    expect(before.toString()).toContain('fixture-guard-secret')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    await expect(card).toContainText('SDK_SAFE_READ')
    await page.reload()
    await expect(card).toContainText('SDK_SAFE_READ')
    expect(f.prompts()).toBe(1)
    expect(readFileSync(file)).toEqual(before)
  } finally {
    await f.close()
  }
})

test('SEC-01 actual Electron dangerous final calls stay denied without files, disclose highest risk and fit light/dark narrow layouts', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('拒绝写入、组合命令、凭证和越界')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length).toBe(1)
    const session = f.store.managedSessions()[0]
    if (!session) {
      throw new Error('Missing denied session')
    }
    await expect
      .poll(() => f.store.submissions(session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    const pane = page.locator('.retained-session:not([hidden])')
    await expect(pane.locator('[data-tool-id]')).toHaveCount(4)
    const card = pane.locator('[data-tool-id="guard-1"]')
    await card.getByRole('button').click()
    await expect(card).toContainText('L3 · 须明确审批')
    await expect(card).toContainText('单次高风险')
    await expect(card).toContainText('未执行')
    expect(existsSync(join(session.cwd, 'MUST-NOT-EXIST'))).toBe(false)
    expect(JSON.stringify(f.events.snapshot(session.id))).not.toContain(
      'PRIVATE_FILE_MUST_STAY_UNREAD',
    )
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(card).toBeInViewport()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 760 })
    await card.scrollIntoViewIfNeeded()
    await expect(card.getByLabel('宿主风险裁决')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '展开导航', exact: true }).click()
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    const input = page.getByRole('textbox', { name: '任务内容' })
    await input.fill('独立草稿')
    await expect(input).toHaveValue('独立草稿')
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})
