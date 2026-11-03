import { expect, test } from '@playwright/test'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('settings navigation keeps conversation state and theme; private views remain paired', async ({
  page,
}) => {
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1') {
      external.push(request.url())
    }
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: '任务内容' }).fill('切换设置后保留的草稿')
  await page.getByLabel('离线状态样本').selectOption('review')
  await expect(page.getByRole('complementary', { name: '修改审查面板' })).toBeVisible()
  await page.getByRole('link', { name: '设置', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeFocused()
  await page.getByLabel('外观主题').selectOption('dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('link', { name: '凭证与隐私', exact: true }).click()
  await expect(page.getByRole('heading', { name: '连接本机工作台' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('link', { name: '外观', exact: true }).click()
  await expect(page.getByLabel('外观主题')).toHaveValue('dark')
  await page.getByRole('link', { name: '返回工作台', exact: true }).click()
  await expect(page.getByRole('link', { name: '设置', exact: true })).toBeFocused()
  await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('切换设置后保留的草稿')
  await expect(page.getByRole('complementary', { name: '修改审查面板' })).toBeVisible()
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.reload()
  await expect(page.getByLabel('外观主题')).toHaveValue('dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(errors).toEqual([])
  expect(external).toEqual([])
})

test('settings search, keyboard and narrow navigation remain usable in light and dark', async ({
  page,
}) => {
  await page.goto('/?settings=appearance')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.getByLabel('搜索设置').fill('不存在的分类')
  await expect(page.getByText('没有匹配的设置', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await expect(page.getByRole('link', { name: '外观', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.screenshot({ path: `${evidence}/settings-light.png`, animations: 'disabled' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: '资源状态', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '连接本机工作台' })).toBeVisible()
  await expect(page.getByRole('link', { name: '资源状态', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('link', { name: '外观', exact: true }).click()
  await page.getByLabel('外观主题').focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('外观主题')).toHaveValue('light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.screenshot({ path: `${evidence}/settings-narrow.png`, animations: 'disabled' })
})
