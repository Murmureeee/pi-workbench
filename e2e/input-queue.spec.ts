import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { renderingDesktop } from './helpers/rendering.js'

test('INPUT-06 actual Electron explains append/steer order and only delivers after the real SDK boundary', async () => {
  test.setTimeout(100000)
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('队列边界原生链路')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length, { timeout: 20000 }).toBe(1)
    const session = f.store.managedSessions()[0]
    if (!session) {
      throw new Error('Missing queue session')
    }
    const pane = page.locator('.retained-session:not([hidden])'),
      queue = pane.getByRole('region', { name: '引导与追加队列' })
    await page.getByRole('textbox', { name: '任务内容' }).fill('先追加的下一轮任务')
    await expect(queue.getByRole('button', { name: '追加下一轮' })).toBeVisible()
    await queue.getByRole('button', { name: '追加下一轮' }).click()
    await expect(queue).toContainText('先追加的下一轮任务')
    await page.getByRole('textbox', { name: '任务内容' }).fill('后输入的当前轮引导')
    await queue.getByRole('button', { name: '引导当前轮' }).click()
    await expect(queue).toContainText('后输入的当前轮引导')
    expect(f.prompts()).toBe(1)
    expect(f.store.inputQueue(session.id).map((row) => row.status)).toEqual(['queued', 'queued'])
    await expect
      .poll(() => f.store.submissions(session.id).map((row) => row.status), { timeout: 70000 })
      .toEqual(['completed', 'completed'])
    await expect(queue.getByText(/已送达/)).toHaveCount(2)
    expect(
      f.store
        .history(session.id)
        ?.messages.filter((row) => row.role === 'user')
        .map((row) => row.text),
    ).toEqual(['队列边界原生链路', '后输入的当前轮引导', '先追加的下一轮任务'])
    expect(f.prompts()).toBe(2)
    await page.reload()
    await expect(
      page.getByRole('region', { name: '引导与追加队列' }).getByText(/已送达/),
    ).toHaveCount(2)
    expect(f.prompts()).toBe(2)
  } finally {
    await f.close()
  }
})

test('INPUT-06 Electron edit failures/CAS retain text; stop and reload hold queue, background updates never steal focus', async () => {
  test.setTimeout(60000)
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 可编辑输入')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length, { timeout: 20000 }).toBe(1)
    const session = f.store.managedSessions()[0]
    if (!session) {
      throw new Error('Missing queue session')
    }
    const path = `**/api/chat/sessions/${session.id}/queue`
    const pane = page.locator('.retained-session:not([hidden])'),
      queue = pane.getByRole('region', { name: '引导与追加队列' })
    await page.getByRole('textbox', { name: '任务内容' }).fill('需要编辑的追加')
    let releaseEnqueue: (() => void) | undefined
    const enqueueGate = new Promise<void>((resolve) => {
      releaseEnqueue = resolve
    })
    await page.route(path, async (route) => {
      if (route.request().method() === 'POST') {
        await enqueueGate
      }
      await route.fallback()
    })
    await queue.getByRole('button', { name: '追加下一轮' }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('临时更改后的草稿')
    await page.getByRole('textbox', { name: '任务内容' }).fill('需要编辑的追加')
    releaseEnqueue?.()
    await expect(queue).toContainText('需要编辑的追加')
    await expect(queue.getByRole('button', { name: '追加下一轮' })).toBeEnabled()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('需要编辑的追加')
    await page.unroute(path)
    await queue.getByRole('button', { name: '编辑待发消息', exact: true }).click()
    await queue.getByRole('textbox', { name: '编辑待发消息' }).evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
      )
    })
    await expect(queue.getByRole('textbox', { name: '编辑待发消息' })).toBeVisible()
    await queue.getByRole('textbox', { name: '编辑待发消息' }).press('Escape')
    await expect(queue.getByRole('textbox', { name: '编辑待发消息' })).toHaveCount(0)
    await queue.getByRole('button', { name: '编辑待发消息', exact: true }).click()
    await queue.getByRole('textbox', { name: '编辑待发消息' }).fill('编辑失败仍保留')
    await page.route(path, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 503, json: { message: '队列写入失败验收' } })
      } else {
        await route.fallback()
      }
    })
    await queue.getByRole('button', { name: '保存待发消息' }).click()
    await expect(queue.getByRole('alert')).toContainText('队列写入失败验收')
    await expect(queue.getByRole('textbox', { name: '编辑待发消息' })).toHaveValue('编辑失败仍保留')
    await page.unroute(path)
    const row = f.store.inputQueue(session.id)[0]
    if (!row) {
      throw new Error('Missing editable input')
    }
    await f.sessions.inputCommand(session.id, {
      action: 'edit',
      id: row.id,
      revision: row.revision,
      text: '另一客户端已更新',
    })
    await queue.getByRole('button', { name: '保存待发消息' }).click()
    await expect(queue.getByRole('alert')).toContainText('版本')
    await expect(queue.getByRole('textbox', { name: '编辑待发消息' })).toHaveValue('编辑失败仍保留')
    await expect(queue.getByText('另一客户端已更新', { exact: true })).toBeVisible()
    await queue.getByRole('button', { name: '取消编辑' }).click()
    await queue.getByRole('button', { name: '编辑待发消息', exact: true }).click()
    await expect(queue.getByRole('textbox', { name: '编辑待发消息' })).toHaveValue(
      '另一客户端已更新',
    )
    await queue.getByRole('textbox', { name: '编辑待发消息' }).fill('核对后保存')
    await queue.getByRole('button', { name: '保存待发消息' }).click()
    await expect.poll(() => f.store.inputQueue(session.id)[0]?.text).toBe('核对后保存')
    await expect(queue.getByRole('textbox', { name: '编辑待发消息' })).toHaveCount(0)
    await page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect(queue).toContainText('已暂停 · 不自动执行')
    await expect.poll(() => f.store.submissions(session.id)[0]?.status).toBe('aborted')
    await page.reload()
    await expect(page.getByRole('region', { name: '引导与追加队列' })).toContainText('已暂停')
    expect(f.prompts()).toBe(1)
    const directory = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
    mkdirSync(directory, { recursive: true })
    await page.setViewportSize({ width: 800, height: 760 })
    const messageBounds = await pane.getByRole('region', { name: '受管会话消息' }).boundingBox()
    expect(messageBounds?.height).toBeGreaterThanOrEqual(120)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.screenshot({ path: join(directory, 'input-06-light-800.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: join(directory, 'input-06-dark-800.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '展开导航', exact: true }).click()
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('前台草稿保留')
    await page.getByRole('textbox', { name: '任务内容' }).focus()
    const held = f.store.inputQueue(session.id)[0]
    if (!held) {
      throw new Error('Missing held input')
    }
    await f.sessions.inputCommand(session.id, {
      action: 'cancel',
      id: held.id,
      revision: held.revision,
    })
    await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('前台草稿保留')
  } finally {
    await f.close()
  }
})
