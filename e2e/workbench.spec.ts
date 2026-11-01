import { expect, test } from '@playwright/test'

const evidenceDirectory = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('本地服务已连接', { exact: true })).toBeVisible()
})

test('first send respects composition and Shift Enter; all traffic stays local', async ({
  page,
}) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1') {
      externalRequests.push(request.url())
    }
  })
  const input = page.getByRole('textbox', { name: '任务内容' })
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeDisabled()
  await input.fill('检查认证逻辑')
  await input.dispatchEvent('compositionstart')
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
  await input.dispatchEvent('compositionend')
  await input.fill('检查认证逻辑')
  await input.press('Shift+Enter')
  await input.press('x')
  await expect(input).toHaveValue('检查认证逻辑\nx')
  await input.press('Enter')
  await expect(page.getByLabel('离线状态样本')).toHaveValue('running')
  await expect(page.getByLabel('对话消息')).toContainText('检查认证逻辑\nx')
  await expect(input).toBeEmpty()
  await expect(page.getByText('假内核样本，不调用提供商')).toBeVisible()
  expect(externalRequests).toEqual([])
})

test('approval refusal and stop have distinct states; drafts survive switching', async ({
  page,
}) => {
  const samples = page.getByLabel('离线状态样本')
  const input = page.getByRole('textbox', { name: '任务内容' })
  await input.fill('保留这份草稿')
  await samples.selectOption('approval')
  await expect(page.getByLabel('执行前审批')).toContainText('pnpm test -- src/auth/session.test.ts')
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(page.getByText('已拒绝执行', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('保留这份草稿')
  await samples.selectOption('approval')
  await page.getByRole('button', { name: '允许一次', exact: true }).click()
  await expect(samples).toHaveValue('running')
  await page.getByRole('button', { name: '停止本轮', exact: true }).click()
  await expect(page.getByText('正在停止本轮', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeDisabled()
  await samples.selectOption('stopped')
  await expect(page.getByText('本轮已停止', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('保留这份草稿')
})

test('review opens a wide panel and closing restores conversation width', async ({ page }) => {
  await page.getByLabel('离线状态样本').selectOption('review')
  const panel = page.getByRole('complementary', { name: '修改审查面板' })
  await expect(panel).toBeVisible()
  const withPanel = await page.locator('.conversation-column').boundingBox()
  await expect(page.getByRole('button', { name: '接受此文件', exact: true })).toBeDisabled()
  await page.screenshot({ path: `${evidenceDirectory}/review-light.png`, animations: 'disabled' })
  await page.getByRole('button', { name: '关闭审查面板' }).click()
  await expect(panel).toHaveCount(0)
  const withoutPanel = await page.locator('.conversation-column').boundingBox()
  if (!withoutPanel || !withPanel) {
    throw new Error('Expected visible conversation bounds')
  }
  expect(withoutPanel.width).toBeGreaterThan(withPanel.width + 500)
  await page.getByRole('button', { name: '变更 2' }).click()
  await expect(panel).toBeVisible()
})

test('settling, error, and lost service are visible without losing drafts', async ({ page }) => {
  const samples = page.getByLabel('离线状态样本')
  await samples.selectOption('settling')
  await expect(page.getByText('回复已结束，正在检查变更')).toBeVisible()
  await samples.selectOption('error')
  await expect(page.getByText('请求未完成', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '手动重试' }).click()
  await expect(samples).toHaveValue('running')
  await samples.selectOption('new')
  const input = page.getByRole('textbox', { name: '任务内容' })
  await input.fill('服务断开也保留')
  await page.route('**/api/**', (route) => route.abort())
  await expect(page.getByText('无法连接本地服务', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(input).toHaveValue('服务断开也保留')
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeDisabled()
  await page.unroute('**/api/**')
  await page.getByRole('button', { name: '重连本地服务' }).click()
  await expect(page.getByText('本地服务已连接', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('服务断开也保留')
})

test('system, light and dark themes render at 1080p and 390px without overflow', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByLabel('主题', { exact: true }).selectOption('light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.screenshot({ path: `${evidenceDirectory}/new-light.png`, animations: 'disabled' })
  await page.getByLabel('主题', { exact: true }).selectOption('dark')
  await page.getByLabel('离线状态样本').selectOption('approval')
  await expect(page.getByLabel('执行前审批')).toBeVisible()
  await page.screenshot({ path: `${evidenceDirectory}/approval-dark.png`, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '展开导航' })).toBeVisible()
  await page.getByRole('button', { name: '展开导航' }).click()
  await expect(page.getByRole('complementary', { name: '项目与会话' })).toBeVisible()
  await page.getByRole('button', { name: '关闭导航遮罩' }).click({
    position: { x: 370, y: 100 },
  })
  await expect(page.getByRole('complementary', { name: '项目与会话' })).not.toBeVisible()
  await page.screenshot({ path: `${evidenceDirectory}/approval-390.png`, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByLabel('离线状态样本').selectOption('review')
  await expect(page.getByRole('button', { name: '关闭审查面板' })).toBeInViewport()
  await page.getByRole('button', { name: '关闭审查面板' }).click()
  await expect(page.getByRole('textbox', { name: '任务内容' })).toBeInViewport()
  expect(errors).toEqual([])
})
