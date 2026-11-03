import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

/** Actual installed SDK catalog, synthetic pi config, real daemon/HTTP/desktop host identity.
 * No provider server or model session is needed. HTTP failures below are fault injection.
 */
async function fixture(configured = true) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-model-discovery-ui-')),
    source = join(directory, 'pi')
  mkdirSync(source)
  const marker = join(directory, 'must-not-run')
  const models = {
    providers: {
      'local-proxy': {
        name: '现有编码服务',
        api: 'openai-completions',
        baseUrl: 'https://fixture.invalid/v1',
        apiKey: 'fixture-model-secret-2973',
        models: Array.from({ length: 24 }, (_, index) => ({
          id: `code-${index}`,
          name: `代码模型 ${index}`,
          reasoning: true,
          contextWindow: 64000,
          maxTokens: 2048,
        })),
      },
      expired: {
        api: 'openai-completions',
        baseUrl: 'https://fixture.invalid/v1',
        models: [{ id: 'expired-code' }],
      },
      command: {
        api: 'not-installed-api',
        baseUrl: 'https://fixture.invalid/v1',
        apiKey: `!node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')"`,
        models: [{ id: 'unknown-api' }],
      },
    },
  }
  writeFileSync(join(source, 'models.json'), '// Native pi JSONC\n' + JSON.stringify(models))
  writeFileSync(
    join(source, 'auth.json'),
    JSON.stringify({
      expired: {
        type: 'oauth',
        access: 'fixture-private-access',
        refresh: 'fixture-private-refresh',
        expires: 1,
      },
    }),
  )
  writeFileSync(
    join(source, 'settings.json'),
    JSON.stringify({ defaultProvider: 'local-proxy', defaultModel: 'code-0' }),
  )
  const app = await createApp({
    dataDir: join(directory, 'data'),
    port: 4318,
    development: true,
    ...(configured ? { piAgentDir: source } : {}),
  })
  await app.listen(4318, '127.0.0.1')
  try {
    const desktop = await launchWorkspaceDesktop(directory, app)
    return {
      directory,
      source,
      models,
      marker,
      app,
      desktop,
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

test('MODEL-01 Electron discovers actual SDK/config sources, capabilities, expiry and command refusal; search, keyboard, themes and bounded lists', async () => {
  const f = await fixture(),
    { page } = f.desktop
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const before = readdirSync(f.source).map((name) => [
    name,
    readFileSync(join(f.source, name), 'utf8'),
  ])
  try {
    await page.getByRole('link', { name: '模型与提供商', exact: true }).click()
    await expect(page.getByRole('heading', { name: '模型与提供商', exact: true })).toBeVisible()
    await expect(page.getByLabel('模型同步状态')).toHaveText('模型目录已同步')
    await expect(page.getByLabel('模型配置来源')).toContainText(f.source)
    await expect(page.getByLabel('模型配置来源')).toContainText('models.json · 已读取')
    await expect(page.getByLabel('模型配置来源')).toContainText(
      'local-proxy / code-0 · 已在本地目录找到',
    )
    const local = page.getByRole('region', { name: '提供商 local-proxy', exact: true })
    await expect(local).toContainText('已配置 · 未联网验证')
    await expect(local).toContainText('上下文 64,000 token')
    await expect(local).toContainText('工作台真实传输未开放')
    await expect(local.getByRole('listitem')).toHaveCount(10)
    await local.getByRole('button', { name: /显示更多 local-proxy 模型/ }).click()
    await expect(local.getByRole('listitem')).toHaveCount(24)
    await expect(page.getByRole('region', { name: '提供商 expired', exact: true })).toContainText(
      '凭证已过期',
    )
    await expect(page.getByRole('region', { name: '提供商 command', exact: true })).toContainText(
      '命令型凭证未执行',
    )
    await expect(page.getByRole('region', { name: '提供商 command', exact: true })).toContainText(
      '当前 SDK 未提供此 API 的实现',
    )
    expect(await page.locator('body').innerText()).not.toMatch(
      /fixture-model-secret|fixture-private|writeFileSync/,
    )
    await page.getByLabel('搜索提供商或模型').fill('missing-name')
    await expect(page.getByText('没有匹配的模型或提供商')).toBeVisible()
    await page.getByLabel('搜索提供商或模型').fill('代码模型 23')
    await expect(local.getByRole('listitem')).toHaveCount(1)
    await page.getByLabel('搜索提供商或模型').fill('openai')
    await page.getByRole('button', { name: '仅看已有配置', exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: '仅看已有配置', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('region', { name: '提供商 openai', exact: true })).toContainText(
      '环境 / 平台认证未检查',
    )
    await page.getByRole('button', { name: '仅看已有配置', exact: true }).click()
    await page.getByLabel('搜索提供商或模型').fill('')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/models-light.png`,
      animations: 'disabled',
    })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 720 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `${process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'}/models-dark-800.png`,
      animations: 'disabled',
    })
    expect(f.app.get(SessionStore).list()).toEqual([])
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(existsSync(f.marker)).toBe(false)
    expect(
      readdirSync(f.source).map((name) => [name, readFileSync(join(f.source, name), 'utf8')]),
    ).toEqual(before)
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('MODEL-01 Electron retains stale data on disconnect, recovers updated/invalid config and ignores results after leaving the view', async () => {
  const f = await fixture(),
    { page } = f.desktop
  try {
    await page.goto('http://127.0.0.1:5173/?models')
    await expect(page.getByLabel('模型同步状态')).toHaveText('模型目录已同步')
    await page.route('**/api/models', (route) => route.fulfill({ status: 503, body: '{}' }))
    await page.getByRole('button', { name: '刷新模型目录', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(['本地发现', '以下为上次状态'])
    await expect(
      page.getByRole('region', { name: '提供商 local-proxy', exact: true }),
    ).toContainText('现有编码服务')
    await page.unroute('**/api/models')
    f.models.providers['local-proxy'].name = '更新后的服务'
    writeFileSync(join(f.source, 'models.json'), JSON.stringify(f.models))
    await page.getByRole('button', { name: '刷新模型目录', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '提供商 local-proxy', exact: true }),
    ).toContainText('更新后的服务')
    writeFileSync(join(f.source, 'models.json'), '{broken')
    await page.getByRole('button', { name: '刷新模型目录', exact: true }).click()
    await expect(page.getByLabel('模型配置来源')).toContainText('models.json · 格式无效')
    await expect(page.getByText('部分配置不可用', { exact: true })).toBeVisible()
    writeFileSync(join(f.source, 'models.json'), JSON.stringify(f.models))
    await page.getByRole('button', { name: '刷新模型目录', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '提供商 local-proxy', exact: true }),
    ).toBeVisible()
    let release: (() => void) | undefined
    const delayed = new Promise<void>((done) => {
      release = done
    })
    await page.route('**/api/models', async (route) => {
      const response = await route.fetch()
      await delayed
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '刷新模型目录', exact: true }).click()
    await expect(page.getByLabel('模型同步状态')).toHaveText('正在读取本地模型目录')
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    release?.()
    await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
    expect(f.app.get(SessionStore).list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('MODEL-01 unconnected Electron stays offline and offers SDK catalog without inferring other-product account access', async () => {
  const f = await fixture(false),
    { page } = f.desktop
  try {
    await page.getByRole('link', { name: '模型与提供商', exact: true }).click()
    await expect(page.getByText('尚无已有提供商配置', { exact: true })).toBeVisible()
    await expect(page.getByLabel('模型配置来源')).toContainText('PIW_PI_AGENT_DIR')
    await expect(page.getByText(/其他产品账号不会自动赋予 pi/)).toBeVisible()
    await page.getByRole('button', { name: '仅看已有配置', exact: true }).click()
    await page.getByLabel('搜索提供商或模型').fill('openai')
    await expect(page.getByRole('region', { name: '提供商 openai', exact: true })).toContainText(
      '环境 / 平台认证未检查',
    )
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})
