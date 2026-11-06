import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { renderingDesktop } from './helpers/rendering.js'
const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('MODEL-07 actual Electron merges a lost request and pushed model error, exposes zero retry policy and reconciles without resending', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    const session = await f.send('模型策略正常基线')
    await page.route('**/api/chat/submissions/*', (route) => route.abort('failed'))
    await page.route('**/api/chat/submit', async (route) => {
      await route.fetch({
        url: 'http://127.0.0.1:4318/api/chat/submit',
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      await route.abort('failed')
    })
    await page.getByRole('textbox', { name: '任务内容' }).fill('模型错误 · 丢失回执验收')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect
      .poll(() => f.store.submissions(session.id).at(-1)?.status, { timeout: 20000 })
      .toBe('failed')
    const pane = page.locator('.retained-session:not([hidden])')
    await expect(pane.getByRole('alert').filter({ hasText: 'Offline fixture error' })).toHaveCount(
      1,
    )
    await expect(pane.getByRole('alert')).toHaveCount(1)
    await expect(pane).not.toContainText('fixture-model-error-secret')
    await expect(pane.getByLabel('模型重试策略').last()).toContainText(
      '模型请求 1 次 · 自动重试 0 次 · 重试上限 0',
    )
    await expect(pane.getByLabel('发送反馈')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue(
      '模型错误 · 丢失回执验收',
    )
    await page.unroute('**/api/chat/submissions/*')
    await page.unroute('**/api/chat/submit')
    await pane.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('')
    expect(f.prompts()).toBe(2)
    await page.reload()
    await expect(page.getByLabel('模型重试策略').last()).toContainText('重试上限 0')
    expect(f.prompts()).toBe(2)
  } finally {
    await f.close()
  }
})

test('MODEL-07 synthetic wait deadlines never retry, preserve completed/denied tools, isolate focus and remain stoppable in actual Electron', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    const first = await f.send('正常基线 · 后台焦点')
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 等待策略样本')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length).toBe(2)
    const session = f.store.managedSessions().find((row) => row.id !== first.id)!
    await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.text).toBe('OFFLINE_')
    const snapshot = f.events.snapshot(session.id)!,
      turn = snapshot.turns[0]
    if (!turn) {
      throw new Error('Missing active fixture turn')
    }
    const pid = f.kernels.list().find((row) => row.sessionId === session.id)?.pid
    f.events.attach(session.id, snapshot.epoch, 'synthetic-ipc-fixture')
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'turn.started',
      messageId: turn.messageId,
      prompt: turn.prompt,
    })
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'tool.updated',
      tool: { id: 'done', name: 'write', status: 'completed', summary: '合成观察：已完成一次' },
    })
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'tool.updated',
      tool: { id: 'denied', name: 'bash', status: 'denied', summary: '合成观察：拒绝保持有效' },
    })
    // The synthetic replacement resets the cursor; retain the real client's monotonic
    // protection and establish a fresh read-only observer before timed fixture updates.
    await page.reload()
    await expect(
      page.locator('.retained-session:not([hidden])').getByLabel('会话同步状态'),
    ).toHaveText('已同步')
    const request = {
      attempts: 2,
      retryCount: 1,
      retryLimit: 2,
      state: 'waiting' as const,
      waitUntil: Date.now() + 3000,
      error: 'synthetic rate limit api_key=sample-secret',
    }
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'model.updated',
      modelRequest: request,
    })
    const pane = page.locator('.retained-session:not([hidden])')
    await expect(pane.getByLabel('模型等待状态')).toContainText('距宿主等待期限')
    await expect(pane.getByLabel('模型等待状态')).toContainText('等待服务确认', { timeout: 7000 })
    expect(f.prompts()).toBe(2)
    expect(f.kernels.list().find((row) => row.sessionId === session.id)?.pid).toBe(pid)
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'model.updated',
      modelRequest: { ...request, waitUntil: null },
    })
    await expect(pane.getByLabel('模型等待状态')).toContainText('等待期限未知')
    await expect(pane).not.toContainText('sample-secret')
    expect(f.events.snapshot(session.id)?.turns[0]?.tools.map((tool) => tool.status)).toEqual([
      'completed',
      'denied',
    ])
    await pane.getByTitle(first.title, { exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('前台草稿不受迟到等待影响')
    await page.getByRole('textbox', { name: '任务内容' }).focus()
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'model.updated',
      modelRequest: { ...request, waitUntil: Date.now() - 1000 },
    })
    await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
    await expect(pane.getByLabel('模型等待状态')).toHaveCount(0)
    await page.getByRole('button', { name: `${session.title} 运行中`, exact: true }).click()
    await expect(pane.getByLabel('模型等待状态')).toContainText('等待服务确认')
    mkdirSync(evidence, { recursive: true })
    const capture = async (colorScheme: 'light' | 'dark') => {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 800, height: 760 })
      await pane.getByLabel('模型等待状态').scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: join(evidence, `model-07-${colorScheme}-800.png`),
        fullPage: true,
      })
    }
    await capture('light')
    await capture('dark')
    await page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(session.id)[0]?.status).toBe('aborted')
    await expect(pane.getByLabel('任务状态')).toContainText('已停止')
    await expect(pane.getByLabel('模型等待状态')).toHaveCount(0)
    expect(f.prompts()).toBe(2)
  } finally {
    await f.close()
  }
})
