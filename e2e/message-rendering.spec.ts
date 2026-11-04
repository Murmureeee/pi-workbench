import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { renderingDesktop } from './helpers/rendering.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

function noop(): void {}

test('OBS-01 actual Electron/SDK safe Markdown, tables, lazy highlighting, unknown and incomplete fences', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  await page.setViewportSize({ width: 1920, height: 1080 })
  const remote: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith('https://example.com')) {
      remote.push(r.url())
    }
  })
  try {
    await f.send('富文本验收')
    const body = page.locator('.retained-session:not([hidden]) .message-body').last()
    await expect(body.getByRole('heading', { name: '离线内容验收' })).toBeVisible()
    await expect(body.locator('strong')).toHaveText('加粗')
    await expect(body.locator('li')).toHaveCount(2)
    await expect(body.getByRole('table')).toContainText('中文表格')
    await expect(body.getByRole('link')).toHaveCount(1)
    await expect(body.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(body.locator('script,img,svg,iframe,object')).toHaveCount(0)
    expect(await page.evaluate(() => Object.hasOwn(window, '__OBS01_UNSAFE'))).toBe(false)
    expect(remote).toEqual([])
    await expect(body.getByLabel('代码：typescript').first()).toHaveAttribute(
      'data-highlighted',
      'true',
      { timeout: 20000 },
    )
    await expect(body.getByLabel('代码：typescript').last()).toHaveAttribute(
      'data-highlighted',
      'false',
    )
    await expect(body.getByLabel('代码：unknown-offline-language')).toContainText(
      '<unsafe>未知语言原文</unsafe>',
    )
    await expect(body.getByLabel('代码：mermaid')).toContainText('图示未启用')
    await body.getByRole('button', { name: '纯文本显示', exact: true }).click()
    await expect(body.locator('pre.message-plain')).toContainText('<script>window.__OBS01_UNSAFE')
    await body.getByRole('button', { name: '格式化显示', exact: true }).click()
    await expect(body.getByRole('table')).toBeVisible()
    mkdirSync(evidence, { recursive: true })
    await body.getByRole('heading', { name: '离线内容验收' }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: join(evidence, 'message-rendering-light.png'),
      animations: 'disabled',
    })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.setViewportSize({ width: 800, height: 760 })
    await expect(page.getByRole('textbox', { name: '任务内容' })).toBeVisible()
    await body.getByRole('heading', { name: '离线内容验收' }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: join(evidence, 'message-rendering-dark-800.png'),
      animations: 'disabled',
    })
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('OBS-01 long SDK content expands and collapses without changing original history or requests', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    await f.send('长内容验收')
    const path = join(f.directory, 'data', 'kernels')
    const histories = () =>
      Object.fromEntries(
        readdirSync(path, { recursive: true, encoding: 'utf8' })
          .filter((n) => n.endsWith('.jsonl'))
          .map((n) => [n, readFileSync(join(path, n), 'utf8')]),
      )
    const before = histories()
    const body = page.locator('.retained-session:not([hidden]) .message-body').last()
    await expect(body).not.toContainText('OBS01_RENDER_END')
    await body.getByRole('button', { name: '展开完整消息' }).click()
    await expect(body).toContainText('OBS01_RENDER_END')
    await expect(body.locator('.message-plain')).toContainText('第720段')
    await body.getByRole('button', { name: '收起长消息' }).click()
    await expect(body).not.toContainText('OBS01_RENDER_END')
    expect(histories()).toEqual(before)
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('OBS-01 optional highlighting failure and late module load preserve new safe source', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  let release: () => void = noop
  const gate = new Promise<void>((done) => {
    release = done
  })
  let requested = false
  try {
    await page.route(/shiki_bundle_web/, async (route) => {
      requested = true
      await gate
      await route.abort()
    })
    await f.send('高亮失败验收')
    await expect.poll(() => requested).toBe(true)
    const body = page.locator('.retained-session:not([hidden]) .message-body').last()
    await expect(body.getByLabel('代码：typescript').first()).toContainText('greeting')
    await body.getByRole('button', { name: '纯文本显示', exact: true }).click()
    release()
    await expect(body.locator('.message-plain')).toContainText('OBS01_RENDER_END')
    await body.getByRole('button', { name: '格式化显示', exact: true }).click()
    await expect(body.getByLabel('代码：typescript').first()).toHaveAttribute(
      'data-highlighted',
      'false',
    )
    await expect(body).toContainText('高亮暂不可用')
  } finally {
    release()
    await f.close()
  }
})

test('OBS-01 failed optional Markdown chunk keeps escaped original text readable', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    await page.route('**/markdown-body.tsx', (route) => route.abort())
    await f.send('格式回退验收')
    const body = page.locator('.retained-session:not([hidden]) .message-body').last()
    await expect(body).toContainText('格式显示失败，已保留纯文本')
    await expect(body.locator('.message-plain')).toContainText('<script>window.__OBS01_UNSAFE')
    await expect(body.locator('script,img,svg')).toHaveCount(0)
  } finally {
    await f.close()
  }
})
