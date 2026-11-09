import { mkdirSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { ApprovalService } from '../apps/daemon/dist/modules/security/approval.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { setupChanges } from './helpers/change-fixture.js'
import { openConfiguration, openEnvironment } from './helpers/workbench.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('UX-01 Electron defaults to conversation, keyboard disclosures preserve IME drafts and settings return in light and narrow dark', async () => {
  const f = await setupChanges(),
    { page } = f
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  mkdirSync(evidence, { recursive: true })
  try {
    await page.setViewportSize({ width: 1920, height: 1080 })
    const configuration = page.getByRole('button', { name: '会话配置', exact: true }),
      environment = page.getByRole('button', { name: '环境与权限', exact: true }),
      box = page.getByRole('textbox', { name: '任务内容' })
    await expect(configuration).toHaveAttribute('aria-expanded', 'false')
    await expect(environment).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByLabel('项目', { exact: true })).not.toBeVisible()
    await expect(
      page.getByRole('region', { name: '工作区与 Git 环境', exact: true }),
    ).not.toBeVisible()
    await expect(page.getByRole('region', { name: '工作区信任与恢复', exact: true })).toHaveCount(0)
    await expect(box).toBeInViewport()
    await page.screenshot({ path: `${evidence}/layout-new-light-1920.png`, animations: 'disabled' })
    await configuration.focus()
    await configuration.press('Enter')
    await expect(configuration).toHaveAttribute('aria-expanded', 'true')
    await page.getByLabel('模型', { exact: true }).selectOption({ label: '离线思考夹具 · 仅文本' })
    await page.getByLabel('思考级别', { exact: true }).selectOption('high')
    await configuration.click()
    await expect(page.getByText('无项目 · 离线思考模型 · high', { exact: true })).toBeVisible()
    await box.fill('布局整理后的中文草稿')
    await box.dispatchEvent('compositionstart')
    await box.press('Enter')
    await box.dispatchEvent('compositionend')
    // Synthetic composition does not open the OS candidate window: Chromium's
    // default Enter inserts a newline, while the application must not submit.
    await expect(box).toHaveValue('布局整理后的中文草稿\n')
    expect(f.sends()).toBe(0)
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByLabel('外观主题').selectOption('dark')
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    await page.setViewportSize({ width: 800, height: 760 })
    await expect(configuration).toHaveAttribute('aria-expanded', 'false')
    await expect(box).toHaveValue('布局整理后的中文草稿\n')
    await expect(box).toBeInViewport()
    await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeInViewport()
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width)
    await page.screenshot({ path: `${evidence}/layout-new-dark-800.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '离线验收 · 真实传输关闭', exact: true }).click()
    await expect(
      page.getByText('当前回复来自真实 pi SDK 与本地 HTTP 固定样本，未调用真实提供商，费用未知。'),
    ).toBeVisible()
    await expect(box).toBeInViewport()
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('UX-01 disclosures are session bookmarks across eviction and renderer reload without stopping or re-sending background SDK work', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(),
    { page } = f
  try {
    const a = await f.send('保持布局后台任务')
    await f.ready(a.id)
    await expect
      .poll(() => f.kernels.list().find((kernel) => kernel.sessionId === a.id)?.pid)
      .toBeGreaterThan(0)
    const original = f.kernels.list().find((kernel) => kernel.sessionId === a.id)
    await openEnvironment(page)
    await openConfiguration(page)
    await page.getByRole('textbox', { name: '任务内容' }).fill('后台会话自己的草稿')
    const b = await f.send('另一个会话'),
      c = await f.send('第三个会话'),
      d = await f.send('第四个会话')
    expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4)
    await expect(page.getByRole('button', { name: '环境与权限', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(page.getByRole('button', { name: '会话配置', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    const sends = f.sends()
    await f.open(a.id)
    await expect(page.getByRole('button', { name: '环境与权限', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.getByRole('button', { name: '会话配置', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('后台会话自己的草稿')
    await page.reload()
    await expect(page.getByRole('button', { name: '环境与权限', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('后台会话自己的草稿')
    expect(f.kernels.list().find((kernel) => kernel.sessionId === a.id)).toMatchObject({
      pid: original?.pid,
      epoch: original?.epoch,
      cwd: a.cwd,
    })
    expect(f.sends()).toBe(sends)
    await f.stop(a.id)
  } finally {
    await f.close()
  }
})

test('UX-01 collapsed details retain actual final approval, failed recovery, file access and historical review', async () => {
  const f = await setupChanges(),
    { page } = f
  mkdirSync(evidence, { recursive: true })
  try {
    await page.setViewportSize({ width: 1920, height: 1080 })
    const session = await f.send('范围写入，核对折叠界面的审批'),
      approval = page.getByRole('region', { name: '执行前审批', exact: true })
    await expect.poll(() => f.app.get(ApprovalService).list().length, { timeout: 20000 }).toBe(1)
    await expect(page.getByRole('button', { name: '环境与权限', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(approval).toBeVisible()
    await expect(
      approval.getByRole('button', { name: '拒绝本次调用', exact: true }),
    ).toBeInViewport()
    await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeInViewport()
    await approval.getByRole('button', { name: '查看最终参数与调用身份', exact: true }).click()
    await expect(approval).toContainText('APPROVED.txt')
    await page.screenshot({
      path: `${evidence}/layout-approval-light-1920.png`,
      animations: 'disabled',
    })
    await approval.getByRole('button', { name: '拒绝本次调用', exact: true }).click()
    await expect
      .poll(() => f.changes.history(session.id).rounds[0]?.outcome, { timeout: 20000 })
      .not.toBe('active')
    await page.getByRole('button', { name: '浏览与查找文件', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '文件与快速定位' })).toBeVisible()
    await page.getByRole('button', { name: '关闭文件浏览', exact: true }).click()
    await f.versions()
    await f.review()
    await expect(page.getByRole('button', { name: '关闭修改审查', exact: true })).toBeVisible()
    await page.screenshot({
      path: `${evidence}/layout-review-light-1920.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    await page.route('**/api/workspaces/availability?**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"布局验收目录故障"}',
      }),
    )
    await expect(page.getByText('目录状态未同步，发送暂不可用', { exact: true })).toBeVisible()
    await expect(page.getByText('目录状态未同步，发送暂不可用', { exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '环境与权限', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await page.screenshot({
      path: `${evidence}/layout-recovery-light-1920.png`,
      animations: 'disabled',
    })
  } finally {
    await f.close()
  }
})
