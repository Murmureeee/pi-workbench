import type { Page } from '@playwright/test'

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { trustInspectSchema } from '../packages/shared/dist/index.js'
import { authorizePage } from './helpers/access.js'

const port = 4318,
  evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function routeDaemon(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({
      url: `http://127.0.0.1:${port}${url.pathname}${url.search}`,
      headers: {
        ...route.request().headers(),
        host: `127.0.0.1:${port}`,
        origin: 'http://127.0.0.1:5173',
      },
    })
    await route.fulfill({ response })
  })
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-trust-')),
    project = join(directory, 'project')
  mkdirSync(join(project, '.pi', 'extensions'), { recursive: true })
  writeFileSync(
    join(project, 'AGENTS.md'),
    '<svg onload="alert(1)">external reference</svg>\nBROWSER_CONTEXT_ORIGINAL',
  )
  writeFileSync(
    join(project, '.pi', 'extensions', 'unsafe.mjs'),
    'throw new Error("must not import")',
  )
  writeFileSync(
    join(project, '.pi', 'settings.json'),
    JSON.stringify({ packages: ['npm:untrusted-example@1.0.0'] }),
  )
  return { directory, project }
}

test('SEC-07 actual UI reviews sources, confirms per version, persists across reload and revokes; light/dark/narrow and keyboard', async ({
  page,
}) => {
  const f = fixture(),
    app = await createApp({ dataDir: join(f.directory, 'data'), port, development: true })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  try {
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    await routeDaemon(page)
    await page.goto('/')
    await page.getByRole('link', { name: '资源信任', exact: true }).click()
    await expect(page.getByLabel('信任同步状态')).toHaveText('信任信息已同步')
    await expect(page.getByLabel('信任记录')).toContainText('尚无信任记录')
    await page.getByLabel('待检查的本机目录').fill(f.project)
    await page.getByLabel('待检查的本机目录').press('Enter')
    await expect(page.getByLabel('发现的资源')).toContainText('第三方声明')
    await expect(page.getByLabel('发现的资源')).toContainText('原生扩展')
    await expect(page.getByLabel('发现的资源')).toContainText('未信任')
    const review = page.getByRole('button', { name: '查看并确认 · 上下文文本', exact: true })
    await review.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('资源信任确认')).toBeFocused()
    await expect(page.getByLabel('资源信任确认')).toBeInViewport()
    await expect(page.getByLabel('资源信任确认')).toContainText('BROWSER_CONTEXT_ORIGINAL')
    await expect(page.getByLabel('资源信任确认').locator('svg')).toHaveCount(0)
    await expect(page.getByLabel('信任记录')).toContainText('尚无信任记录')
    await page.getByRole('button', { name: '确认信任此版本', exact: true }).click()
    await expect(page.getByLabel('信任记录')).toContainText('已记录 · 每轮核验')
    await expect(page.getByLabel('发现的资源')).toContainText('下轮可加载')
    await page.getByRole('main').evaluate((element) => element.scrollTo(0, 0))
    await page.screenshot({
      path: `${evidence}/trust-light.png`,
      animations: 'disabled',
      fullPage: true,
    })
    await page.reload()
    await expect(page.getByLabel('信任记录')).toContainText('AGENTS.md')
    await page.getByRole('button', { name: '撤销此项信任', exact: true }).click()
    await expect(page.getByLabel('信任记录')).toContainText('已撤销')
    await expect(page.getByLabel('信任同步状态')).toContainText('后续轮次不再复用')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: '展开导航', exact: true }).click()
    await page.getByRole('link', { name: '资源信任', exact: true }).click()
    await expect(page.getByLabel('信任记录')).toContainText('已撤销')
    await page.getByRole('main').evaluate((element) => element.scrollBy(0, 10000))
    expect(await page.getByRole('main').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${evidence}/trust-dark-390.png`, animations: 'disabled' })
    expect(errors).toEqual([])
    expect(existsSync(join(f.project, 'must-not-execute'))).toBe(false)
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(f.directory, { recursive: true, force: true })
  }
})

test('SEC-07 stale preview cannot approve replacement; offline errors disable consent and late scope result cannot replace current directory', async ({
  page,
}) => {
  const f = fixture(),
    app = await createApp({ dataDir: join(f.directory, 'data'), port, development: true })
  try {
    const other = join(f.directory, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'AGENTS.md'), 'OTHER_SCOPE_CONTEXT')
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    await routeDaemon(page)
    await page.goto('/?trust')
    await page.getByLabel('待检查的本机目录').fill(f.project)
    await page.getByRole('button', { name: '检查资源来源', exact: true }).click()
    await page.getByRole('button', { name: '查看并确认 · 上下文文本', exact: true }).click()
    writeFileSync(join(f.project, 'AGENTS.md'), 'REPLACEMENT_CONTENT')
    // Server reinspects even before the periodic refresh observes the replacement.
    await page.getByRole('button', { name: '确认信任此版本', exact: true }).click()
    await expect(page.getByRole('alert').last()).toContainText('请刷新')
    await expect(page.getByLabel('信任记录')).toContainText('尚无信任记录')
    await page.getByRole('button', { name: '刷新来源与记录' }).click()
    await page.getByRole('button', { name: '查看并确认 · 上下文文本', exact: true }).click()
    await expect(page.getByLabel('资源信任确认')).toContainText('REPLACEMENT_CONTENT')
    await page.route('**/api/trust/inspect', (route) =>
      route.fulfill({ status: 503, body: 'offline-fixture' }),
    )
    await page.getByRole('button', { name: '刷新来源与记录' }).click()
    await expect(page.getByLabel('信任同步状态')).toHaveText('信任信息同步失败')
    await expect(
      page.getByRole('button', { name: '查看并确认 · 上下文文本', exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole('alert').last()).toContainText('上次信息')
    await page.unroute('**/api/trust/inspect')
    let release!: () => void
    const delayed = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/trust/inspect', async (route) => {
      const body: unknown = route.request().postDataJSON()
      if (trustInspectSchema.parse(body).project === f.project) {
        await delayed
      }
      await route.fallback()
    })
    // Start a refresh for the former scope, then choose another one while it is pending.
    await page.getByRole('button', { name: '刷新来源与记录' }).click()
    await page.getByLabel('待检查的本机目录').fill(other)
    await page.getByRole('button', { name: '检查资源来源', exact: true }).click()
    await expect(page.getByLabel('发现的资源')).toContainText(other)
    release()
    await page.getByRole('button', { name: '查看并确认 · 上下文文本', exact: true }).click()
    await expect(page.getByLabel('资源信任确认')).toContainText('OTHER_SCOPE_CONTEXT')
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(f.directory, { recursive: true, force: true })
  }
})
