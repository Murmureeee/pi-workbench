import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../apps/daemon/dist/modules/security/approval.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Required Electron fixture value missing')
  }
  return value
}
async function setup(tool = false) {
  mkdirSync(evidence, { recursive: true })
  const directory = mkdtempSync(join(tmpdir(), 'piw-model-control-ui-')),
    app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  const kernels = app.get(KernelService),
    original = kernels.prompt.bind(kernels)
  let prompts = 0
  kernels.prompt = (id, cwd, input, options) => {
    prompts++
    return original(id, cwd, { ...input, fixture: tool ? 'approval-write' : 'reply' }, options)
  }
  await app.listen(4318, '127.0.0.1')
  const desktop = await launchWorkspaceDesktop(directory, app),
    page = desktop.page,
    store = app.get(SessionStore)
  await page.getByRole('textbox', { name: '任务内容' }).fill('MODEL03 中文模型验收')
  await page.getByRole('button', { name: '发送任务', exact: true }).click()
  await expect.poll(() => store.managedSessions().length).toBe(1)
  const session = required(store.managedSessions()[0])
  await expect(page.getByRole('button', { name: '模型与思考设置', exact: true })).toBeEnabled()
  return {
    app,
    kernels,
    store,
    page,
    session,
    prompts: () => prompts,
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

test('MODEL-03 actual Electron idle switch, supported levels, failed save retains input and focus, refresh retains selection', async () => {
  const f = await setup(),
    { page } = f
  try {
    await expect
      .poll(() => f.store.submissions(f.session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    await page.getByRole('textbox', { name: '任务内容' }).fill('不丢失的中文草稿')
    const trigger = page.getByRole('button', { name: '模型与思考设置', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '模型与思考设置' })
    await expect(dialog.getByLabel('思考级别').locator('option[value="high"]')).toBeDisabled()
    await dialog.getByLabel('切换模型').selectOption('fixture-reasoning')
    await dialog.getByLabel('思考级别').selectOption('high')
    await expect(dialog.getByLabel('思考级别').locator('option[value="xhigh"]')).toBeDisabled()
    const path = '**/api/chat/sessions/*/model'
    await page.route(path, async (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"message":"夹具保存失败"}',
          })
        : route.fallback(),
    )
    await dialog.getByRole('button', { name: '保存模型配置' }).click()
    await expect(dialog).toContainText('夹具保存失败')
    await expect(dialog.getByLabel('思考级别')).toHaveValue('high')
    expect(f.store.modelState(f.session.id).requested.thinking).toBe('off')
    await page.unroute(path)
    await dialog.getByRole('button', { name: '保存模型配置' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await expect(page.getByLabel('模型生效状态')).toContainText('已生效：fixture-reasoning / high')
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('不丢失的中文草稿')
    expect(f.prompts()).toBe(1)
    await page.reload()
    await expect(page.getByLabel('模型生效状态')).toContainText('fixture-reasoning / high')
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('MODEL-03 actual Electron pending tool request, CAS conflict, same process continuation, dark narrow dialog', async () => {
  const f = await setup(true),
    { page } = f
  try {
    const approvals = f.app.get(ApprovalService)
    await expect.poll(() => approvals.list().length, { timeout: 20000 }).toBe(1)
    const original = required(f.kernels.list()[0])
    await page.getByRole('button', { name: '模型与思考设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '模型与思考设置' })
    await dialog.getByLabel('切换模型').selectOption('fixture-reasoning')
    await dialog.getByLabel('思考级别').selectOption('medium')
    f.store.changeModel(
      f.session.id,
      {
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
      1,
      true,
    )
    await expect(dialog).toContainText('配置版本已变化')
    await expect(dialog.getByRole('button', { name: '保存模型配置' })).toBeDisabled()
    await dialog.getByRole('button', { name: '使用最新版本继续编辑' }).click()
    await expect(dialog.getByLabel('思考级别')).toHaveValue('medium')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 760 })
    await page.screenshot({ path: `${evidence}/model-03-dark-narrow.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: '保存模型配置' }).click()
    await expect(page.getByLabel('模型生效状态')).toContainText(
      '待生效：fixture-reasoning / medium',
    )
    await page.getByRole('button', { name: '拒绝本次调用', exact: true }).click()
    await expect
      .poll(() => f.store.submissions(f.session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    await expect(page.getByLabel('模型生效状态')).toContainText(
      '已生效：fixture-reasoning / medium',
    )
    expect(f.kernels.list()[0]).toMatchObject({
      pid: original.pid,
      epoch: original.epoch,
      cwd: original.cwd,
    })
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})
