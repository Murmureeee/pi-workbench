import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { renderingDesktop } from './helpers/rendering.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('OBS-06 actual Electron/SDK public reasoning is collapsed, redacted, copyable and downloadable; privacy survives refresh', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    const session = await f.send('公开思考 · 中文验收')
    const card = page
      .locator('.retained-session:not([hidden])')
      .getByRole('region', { name: '上游思考信息' })
    const trigger = card.getByRole('button', { name: '上游提供的思考信息', exact: true })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(card).not.toContainText('先核对输入')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(card).toContainText('先核对输入')
    await expect(card).toContainText('«redacted»')
    await expect(card).not.toContainText('fixture-only-secret')
    await card.getByRole('button', { name: '复制公开思考文本', exact: true }).click()
    await expect(card.getByRole('status').or(card.locator('output'))).toHaveText(
      '已复制公开思考文本',
    )
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('先核对输入')
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(
      'fixture-only-secret',
    )
    const downloaded = page.waitForEvent('download')
    await card.getByRole('link', { name: '下载公开思考文本', exact: true }).click()
    const path = await (await downloaded).path()
    expect(path && readFileSync(path, 'utf8')).toContain('先核对输入')
    expect(path && readFileSync(path, 'utf8')).not.toContain('fixture-only-secret')
    await trigger.focus()
    await page.keyboard.press('Space')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await page.goto('http://127.0.0.1:5173/?credentials')
    await page.getByRole('button', { name: '隐藏公开思考正文', exact: true }).click()
    await page.reload()
    await expect(
      page.getByRole('button', { name: '允许显示公开思考正文', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.goto(`http://127.0.0.1:5173/?session=${session.id}`)
    await expect(
      page.getByRole('button', { name: '上游提供的思考信息', exact: true }),
    ).toBeDisabled()
    await expect(page.locator('main')).not.toContainText('先核对输入')
    await expect(page.getByRole('button', { name: '复制公开思考文本', exact: true })).toHaveCount(0)
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('OBS-06 actual Electron states, late/cross-session isolation, background focus and light/dark narrow windows', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const first = await f.send('没有思考的普通回复')
    await expect(page.getByLabel('思考信息状态')).toContainText('未声明支持')
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 等待响应')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length).toBe(2)
    const second = f.store.managedSessions().find((s) => s.id !== first.id)!
    await expect.poll(() => f.events.snapshot(second.id)?.turns[0]?.text).toBe('OFFLINE_')
    const snapshot = f.events.snapshot(second.id)!,
      turn = snapshot.turns[0]
    if (!turn) {
      throw new Error('Missing active turn')
    }
    const pane = page.locator('.retained-session:not([hidden])')
    f.events.publish(second.id, snapshot.epoch, turn.id, {
      type: 'reasoning.updated',
      reasoning: { status: 'not-provided' },
    })
    await expect(pane.getByLabel('思考信息状态')).toContainText('未提供')
    f.events.publish(second.id, snapshot.epoch, turn.id, {
      type: 'reasoning.updated',
      reasoning: { status: 'unavailable' },
    })
    await expect(pane.getByLabel('思考信息状态')).toContainText('不可展示')
    await expect(pane.getByRole('button', { name: '上游提供的思考信息', exact: true })).toHaveCount(
      0,
    )
    // The result may still be unread when leaving immediately after completion.
    // Its native title identifies the same row regardless of the unread badge.
    await pane.getByTitle(first.title, { exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('草稿焦点保持')
    await page.getByRole('textbox', { name: '任务内容' }).focus()
    f.events.publish(second.id, snapshot.epoch, turn.id, {
      type: 'reasoning.updated',
      reasoning: { status: 'provided', text: '后台公开观察，合成夹具', truncated: false },
    })
    await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
    await expect(pane).not.toContainText('后台公开观察')
    expect(f.kernels.list().find((k) => k.sessionId === second.id)?.state).toBe('running')
    await page.getByRole('button', { name: `${second.title} 运行中`, exact: true }).click()
    const trigger = pane.getByRole('button', { name: '上游提供的思考信息', exact: true })
    await trigger.click()
    await expect(pane).toContainText('后台公开观察')
    mkdirSync(evidence, { recursive: true })
    const capture = async (colorScheme: 'light' | 'dark') => {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 800, height: 760 })
      // An explicit reading gesture releases the expansion bookmark before moving
      // to another control. Programmatic scroll alone can race its resize restore.
      await pane.getByLabel('受管会话消息', { exact: true }).press('Home')
      await trigger.scrollIntoViewIfNeeded()
      await trigger.focus()
      await expect(trigger).toBeVisible()
      await expect(trigger).toBeInViewport()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await page.screenshot({
        path: join(evidence, `obs-06-${colorScheme}-narrow.png`),
        fullPage: true,
      })
    }
    await capture('light')
    await capture('dark')
    await f.kernels.abort(second.id, turn.id)
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})
