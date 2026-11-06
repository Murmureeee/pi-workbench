import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

test('MODEL-05 Electron verifies per-turn counters, unknown reports, failure recovery, draft, keyboard and narrow layout', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-usage-ui-'))
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  const kernels = app.get(KernelService),
    original = kernels.prompt.bind(kernels),
    store = app.get(SessionStore)
  let prompts = 0
  kernels.prompt = (id, cwd, input, options) => {
    prompts++
    return original(id, cwd, { ...input, fixture: prompts === 1 ? 'usage' : 'reply' }, options)
  }
  await app.listen(4318, '127.0.0.1')
  const desktop = await launchWorkspaceDesktop(directory, app),
    page = desktop.page
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('中文用量验收')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => store.managedSessions().length).toBe(1)
    const session = store.managedSessions()[0]
    if (!session) {
      throw new Error('No managed session')
    }
    await expect
      .poll(() => store.submissions(session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    const trigger = page.getByRole('button', { name: '上下文与用量', exact: true }),
      dialog = page.getByRole('dialog', { name: '上下文与用量' })
    await trigger.click()
    await expect(dialog).toContainText('144 Token')
    await expect(dialog).toContainText('8,192 Token')
    await dialog.getByText('piw-offline / fixture · 总计 144 Token', { exact: true }).click()
    await expect(dialog).toContainText('费用未知 · 价格来源未知 · 价格时间未知')
    await expect(dialog.getByLabel('会话用量汇总')).toContainText('已记录 96')
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await page.getByRole('textbox', { name: '任务内容' }).fill('未报告用量的轮次')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect
      .poll(() => store.submissions(session.id)[1]?.status, { timeout: 20000 })
      .toBe('completed')
    await page.getByRole('textbox', { name: '任务内容' }).fill('草稿与用量独立')
    await trigger.click()
    await expect(dialog.getByLabel('会话用量汇总')).toContainText('2 轮')
    await expect(dialog.getByLabel('会话用量汇总')).toContainText('已记录 144 · 未知 1 次')
    await expect(dialog).toContainText('最近已提交请求总计 未知 Token')
    await page.route('**/api/chat/sessions/*/usage*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"用量故障夹具"}',
      }),
    )
    await expect(dialog).toContainText('用量未同步', { timeout: 15000 })
    await page.unroute('**/api/chat/sessions/*/usage*')
    await dialog.getByRole('button', { name: '重新读取用量' }).click()
    await expect(dialog.getByText('用量未同步', { exact: true })).not.toBeVisible()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 760 })
    const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({ path: `${evidence}/model-05-dark-narrow.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('草稿与用量独立')
    await page.reload()
    await page.getByRole('button', { name: '上下文与用量', exact: true }).click()
    await expect(dialog.getByLabel('会话用量汇总')).toContainText('已记录 144 · 未知 1 次')
    expect(prompts).toBe(2)
  } finally {
    await desktop.close()
    await app.close()
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
