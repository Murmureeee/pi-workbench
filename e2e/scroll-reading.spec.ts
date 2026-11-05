import type { Locator } from '@playwright/test'

import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { sessionViewsSchema } from '../packages/shared/dist/index.js'
import { renderingDesktop } from './helpers/rendering.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

async function position(viewport: Locator) {
  return viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const first = [...element.querySelectorAll<HTMLElement>('[data-reading-id]')].find(
      (item) => item.getBoundingClientRect().bottom > bounds.top,
    )
    return {
      top: element.scrollTop,
      end: element.scrollHeight - element.clientHeight - element.scrollTop,
      anchor: first?.dataset.readingId,
      offset: first ? first.getBoundingClientRect().top - bounds.top : 0,
    }
  })
}

test('OBS-04 actual Electron/SDK paced deltas preserve reading, count messages once, and resume follow only on explicit latest', async () => {
  test.setTimeout(100000)
  const f = await renderingDesktop(2),
    { page } = f.desktop
  const pane = page.locator('.retained-session:not([hidden])')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const a = await f.send('长内容作为回看基础')
    const viewport = pane.getByLabel('受管会话消息')
    await viewport.press('End')
    await expect
      .poll(async () => {
        const views = sessionViewsSchema.parse(
          JSON.parse(
            await page.evaluate(() => sessionStorage.getItem('piw-session-views-v1') ?? '{}'),
          ),
        )
        return Object.values(views[a.id]?.seenMessages ?? {}).includes('completed')
      })
      .toBe(true)
    await viewport.press('Home')
    await expect.poll(async () => (await position(viewport)).top).toBe(0)
    await viewport.evaluate((element) => element.scrollTo({ top: 900, behavior: 'instant' }))
    await expect.poll(async () => (await position(viewport)).top).toBe(900)
    const before = await position(viewport)
    const input = pane.getByLabel('任务内容')
    await input.fill('回看时保留的草稿')
    await input.focus()
    const receipt = await f.sessions.submit({
      requestId: randomUUID(),
      sessionId: a.id,
      configuration: a.configuration,
      text: '持续滚动：受控本地 SSE，不是真实提供商',
      retryOf: null,
    })
    const reply = pane.locator('.message-body').last()
    await expect(reply).toContainText('离线流式第003段', { timeout: 15000 })
    const latest = pane.getByRole('button', { name: '返回最新消息', exact: true })
    await expect(latest).toHaveText('2 条新消息 · 返回最新')
    expect((await position(viewport)).anchor).toBe(before.anchor)
    expect(Math.abs((await position(viewport)).offset - before.offset)).toBeLessThan(3)
    await expect(input).toBeFocused()
    await expect
      .poll(
        async () =>
          sessionViewsSchema.parse(
            JSON.parse(
              await page.evaluate(() => sessionStorage.getItem('piw-session-views-v1') ?? '{}'),
            ),
          )[a.id]?.reading.conversation?.follow,
      )
      .toBe(false)
    await latest.focus()
    await page.keyboard.press('Enter')
    await expect(viewport).toBeFocused()
    await expect.poll(async () => (await position(viewport)).end).toBeLessThan(40)
    await expect(latest).toHaveAttribute('data-active', 'false')
    await expect(reply).toContainText('离线流式第008段')
    await expect.poll(async () => (await position(viewport)).end).toBeLessThan(40)
    await viewport.press('Home')
    await input.focus()
    await expect(reply).toContainText('离线流式第012段')
    await expect(latest).toHaveText('1 条新消息 · 返回最新')
    await expect(reply).toContainText('离线流式第016段')
    await expect(latest).toHaveText('1 条新消息 · 返回最新')
    await expect.poll(async () => (await position(viewport)).top).toBe(0)
    await expect(input).toBeFocused()
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({
      path: join(evidence, 'scroll-reading-light.png'),
      animations: 'disabled',
    })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.setViewportSize({ width: 800, height: 760 })
    await expect(latest).toHaveText('1 条新消息 · 返回最新')
    await page.screenshot({
      path: join(evidence, 'scroll-reading-dark-800.png'),
      animations: 'disabled',
    })
    const b = await f.sessions.submit({
      requestId: randomUUID(),
      sessionId: null,
      configuration: a.configuration,
      text: '后台完成不抢当前会话',
      retryOf: null,
    })
    // Narrow navigation is explicitly opened; background status never opens it.
    await page.setViewportSize({ width: 1920, height: 1080 })
    await pane.getByTitle(b.session.title, { exact: true }).click()
    await expect(pane.getByLabel('受管会话消息')).toContainText('OBS01_RENDER_END')
    await pane.getByLabel('任务内容').fill('B 的独立草稿')
    await pane.getByLabel('任务内容').focus()
    const pid = f.kernels.list().find((row) => row.sessionId === a.id)?.pid
    expect(pid).toBeTruthy()
    await expect
      .poll(() => f.store.submission(receipt.submission.requestId)?.status, { timeout: 80000 })
      .toBe('completed')
    await expect(pane.getByLabel('任务内容')).toBeFocused()
    await expect(pane.getByLabel('任务内容')).toHaveValue('B 的独立草稿')
    expect(f.kernels.list().find((row) => row.sessionId === a.id)?.pid).toBe(pid)
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(viewport).toContainText('OBS04_STREAM_END')
    await expect.poll(async () => (await position(viewport)).top).toBe(0)
    await expect(latest).toHaveText('1 条新消息 · 返回最新')
    await latest.click()
    await expect.poll(async () => (await position(viewport)).end).toBeLessThan(40)
    expect(f.prompts()).toBe(3)
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('OBS-04 Electron long-message expansion preserves anchor/offset and history bytes through eviction and reload', async () => {
  test.setTimeout(90000)
  const f = await renderingDesktop(),
    { page } = f.desktop
  const pane = page.locator('.retained-session:not([hidden])')
  try {
    const a = await f.send('长内容展开位置')
    const file = f.kernels.list().find((row) => row.sessionId === a.id)?.sessionFile
    if (!file) {
      throw new Error('Missing actual SDK history')
    }
    const beforeBytes = readFileSync(file)
    const viewport = pane.getByLabel('受管会话消息')
    const expand = pane.getByRole('button', { name: '展开完整消息', exact: true })
    await expand.scrollIntoViewIfNeeded()
    const before = await position(viewport)
    await expand.click()
    await expect(pane.locator('.message-body').last()).toContainText('第720段')
    await expect
      .poll(async () => Math.abs((await position(viewport)).offset - before.offset))
      .toBeLessThan(3)
    expect((await position(viewport)).anchor).toBe(before.anchor)
    expect((await position(viewport)).end).toBeGreaterThan(1000)
    await viewport.press('Home')
    await expect.poll(async () => (await position(viewport)).top).toBe(0)
    await viewport.evaluate((element) => element.scrollTo({ top: 1200, behavior: 'instant' }))
    await expect.poll(async () => (await position(viewport)).top).toBe(1200)
    const bookmark = await position(viewport)
    const next = async (text: string) => {
      await pane.getByRole('button', { name: '新会话', exact: true }).click()
      await f.send(text)
    }
    await next('乙视图')
    await next('丙视图')
    await next('丁视图')
    await expect(page.locator(`[data-session-view="${a.id}"]`)).toHaveCount(0)
    await expect(page.locator('[data-session-view]')).toHaveCount(3)
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(pane.getByRole('button', { name: '收起长消息', exact: true })).toBeAttached()
    await expect
      .poll(async () => Math.abs((await position(viewport)).offset - bookmark.offset))
      .toBeLessThan(3)
    await page.reload()
    await expect(pane.getByLabel('受管会话消息')).toContainText('第720段')
    await expect
      .poll(async () => Math.abs((await position(viewport)).offset - bookmark.offset))
      .toBeLessThan(3)
    await viewport.press('End')
    await pane.getByRole('button', { name: '收起长消息', exact: true }).click()
    await expect(pane.getByRole('button', { name: '展开完整消息', exact: true })).toBeInViewport()
    expect(readFileSync(file)).toEqual(beforeBytes)
    expect(f.prompts()).toBe(4)
  } finally {
    await f.close()
  }
})

test('OBS-04 Electron history pagination restores each page bookmark through reload', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  const pane = page.locator('.retained-session:not([hidden])')
  try {
    const a = await f.send('历史分页阅读')
    const file = f.kernels.list().find((row) => row.sessionId === a.id)?.sessionFile
    if (!file) {
      throw new Error('Missing SDK file')
    }
    await f.kernels.destroy(a.id)
    // Explicit synthetic file rows appended after SDK shutdown: pagination data, not SDK output.
    appendFileSync(
      file,
      Array.from({ length: 210 }, (_, index) =>
        JSON.stringify({
          type: 'message',
          id: `scroll-page-${index}`,
          parentId: index ? `scroll-page-${index - 1}` : null,
          message: {
            role: 'user',
            content: `分页样本第${index}条：` + '保持分页阅读现场。'.repeat(12),
          },
        }),
      ).join('\n') + '\n',
    )
    const beforeBytes = readFileSync(file)
    await pane.getByRole('button', { name: '历史记录', exact: true }).click()
    const viewport = pane.getByLabel('持久化历史')
    await expect(pane.getByLabel('历史载入状态')).toHaveText('本页 100 条消息')
    await viewport.press('Home')
    await expect.poll(async () => (await position(viewport)).top).toBe(0)
    await viewport.evaluate((element) => element.scrollTo({ top: 600, behavior: 'instant' }))
    await expect.poll(async () => (await position(viewport)).top).toBe(600)
    const latest = await position(viewport)
    await pane.getByRole('button', { name: '更早的消息', exact: true }).click()
    await expect(viewport).toContainText('分页样本第10条')
    await viewport.press('Home')
    await expect.poll(async () => (await position(viewport)).top).toBe(0)
    await viewport.evaluate((element) => element.scrollTo({ top: 300, behavior: 'instant' }))
    await expect.poll(async () => (await position(viewport)).top).toBe(300)
    const older = await position(viewport)
    await pane.getByRole('button', { name: '返回较新一页', exact: true }).click()
    await expect(viewport).toContainText('分页样本第209条')
    await expect
      .poll(async () => Math.abs((await position(viewport)).offset - latest.offset))
      .toBeLessThan(3)
    expect((await position(viewport)).anchor).toBe(latest.anchor)
    await pane.getByRole('button', { name: '更早的消息', exact: true }).click()
    await expect
      .poll(async () => Math.abs((await position(viewport)).offset - older.offset))
      .toBeLessThan(3)
    expect((await position(viewport)).anchor).toBe(older.anchor)
    await page.reload()
    await expect(viewport).toContainText('分页样本第10条')
    await expect
      .poll(async () => Math.abs((await position(viewport)).offset - older.offset))
      .toBeLessThan(3)
    await pane.getByRole('button', { name: '返回本页末尾', exact: true }).click()
    await expect.poll(async () => (await position(viewport)).end).toBeLessThan(40)
    expect(readFileSync(file)).toEqual(beforeBytes)
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('OBS-04 Electron background synthetic approval never focuses, changes session or opens a panel', async () => {
  const f = await renderingDesktop(2),
    { page } = f.desktop
  const pane = page.locator('.retained-session:not([hidden])')
  try {
    const a = await f.send('甲后台审批观察')
    const receipt = await f.sessions.submit({
      requestId: randomUUID(),
      sessionId: a.id,
      configuration: a.configuration,
      text: '保持运行：仅注入合成审批观察',
      retryOf: null,
    })
    await expect(pane.getByLabel('任务状态').last()).toHaveText('运行中', { timeout: 15000 })
    await pane.getByRole('button', { name: '新会话', exact: true }).click()
    const b = await f.send('乙继续阅读')
    await pane.getByLabel('任务内容').fill('乙的草稿与焦点')
    await pane.getByLabel('任务内容').focus()
    const events = f.events,
      snapshot = events.snapshot(a.id)
    if (!snapshot) {
      throw new Error('No runtime snapshot')
    }
    // Explicit synthetic observation over the real TCP subscription, no real tool/approval.
    events.publish(a.id, snapshot.epoch, receipt.submission.turnId, {
      type: 'approval.requested',
      approval: { id: 'obs04-synthetic-approval', command: '不执行的审批样本', cwd: a.cwd },
    })
    await expect(page.locator(`[data-session-view="${a.id}"]`)).toContainText('不执行的审批样本')
    await expect(pane).toHaveAttribute('data-session-view', b.id)
    await expect(pane.getByLabel('任务内容')).toBeFocused()
    await expect(pane.getByLabel('任务内容')).toHaveValue('乙的草稿与焦点')
    await expect(pane.getByLabel('会话历史与恢复')).toHaveCount(0)
    expect(f.prompts()).toBe(3)
  } finally {
    await f.close()
  }
})
