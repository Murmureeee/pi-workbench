import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { submissionListSchema } from '../packages/shared/dist/index.js'
import { renderingDesktop } from './helpers/rendering.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('OBS-02 actual Electron observes one current stage, synthetic tool/approval/compaction/retry cannot complete or dismiss, late updates preserve focus', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    const first = await f.send('阶段基线')
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 阶段观察')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length).toBe(2)
    const session = f.store.managedSessions().find((s) => s.id !== first.id)!
    await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.stage).toBe('streaming')
    const snapshot = f.events.snapshot(session.id)!,
      turn = snapshot.turns[0],
      pid = f.kernels.list().find((s) => s.sessionId === session.id)?.pid
    if (!turn) {
      throw new Error('Missing active SDK fixture turn')
    }
    const pane = page.locator('.retained-session:not([hidden])'),
      stage = pane.getByRole('region', { name: '当前运行阶段', exact: true })
    await expect(stage).toHaveCount(1)
    await expect(stage).toContainText('接收模型回复')
    f.events.attach(session.id, snapshot.epoch, 'synthetic-ipc-fixture')
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'turn.started',
      messageId: turn.messageId,
      prompt: turn.prompt,
    })
    // A synthetic journal replacement restarts its cursor. A fresh observer avoids asking
    // production code to accept a regressed cursor within the real SDK generation.
    await page.reload()
    await expect(pane.getByLabel('会话同步状态')).toHaveText('已同步')
    const publish = (payload: Parameters<typeof f.events.publish>[3]) =>
      f.events.publish(session.id, snapshot.epoch, turn.id, payload)
    const submissionRoute = `**/api/chat/sessions/${session.id}/submissions`
    let terminalReads = 0
    await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible()
    // Explicit transport-order fixture: a newer terminal HTTP read arrives while the
    // delayed observation still has active compaction. The real SDK task stays running.
    await page.route(submissionRoute, async (route) => {
      const response = await route.fetch({
        url: `http://127.0.0.1:4318/api/chat/sessions/${session.id}/submissions`,
        headers: { ...route.request().headers(), host: '127.0.0.1:4318' },
      })
      const result = submissionListSchema.parse(await response.json())
      for (const item of result.submissions) {
        if (item.turnId === turn.id) {
          item.status = 'completed'
        }
      }
      await route.fulfill({ response, json: result })
      terminalReads++
    })
    publish({ type: 'stage.updated', stage: 'compacting' })
    await expect(stage).toContainText('压缩上下文')
    await expect.poll(() => terminalReads).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toHaveCount(0)
    await expect(stage).not.toContainText('本轮已结束')
    await expect(stage.getByRole('button', { name: '隐藏状态提示' })).toHaveCount(0)
    await page.unroute(submissionRoute)
    await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible()
    publish({ type: 'stage.updated', stage: 'preparing-tools' })
    await expect(stage).toContainText('准备工具参数')
    publish({
      type: 'tool.updated',
      tool: {
        id: 'synthetic-tool',
        name: 'write',
        status: 'running',
        summary: '合成观察；没有执行写入',
      },
    })
    publish({ type: 'stage.updated', stage: 'streaming' })
    await expect(stage).toContainText('执行工具')
    publish({
      type: 'approval.requested',
      approval: { id: 'synthetic-approval', command: '合成观察', cwd: session.cwd },
    })
    await expect(stage).toContainText('等待审批')
    publish({ type: 'approval.resolved', approvalId: 'synthetic-approval' })
    publish({
      type: 'tool.updated',
      tool: {
        id: 'synthetic-tool',
        name: 'write',
        status: 'denied',
        summary: '合成拒绝；没有执行写入',
      },
    })
    publish({
      type: 'model.updated',
      modelRequest: {
        attempts: 2,
        retryCount: 1,
        retryLimit: 2,
        state: 'waiting',
        waitUntil: Date.now() - 1,
        error: '合成错误 api_key=stage-secret',
      },
    })
    await expect(stage).toContainText('等待重试')
    await expect(stage.getByLabel('模型等待状态')).toContainText('等待服务确认')
    await expect(pane.getByRole('alert').filter({ hasText: '合成错误' })).toHaveCount(1)
    await expect(pane).not.toContainText('stage-secret')
    expect(f.prompts()).toBe(2)
    await pane.getByTitle(first.title, { exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('前台草稿阶段隔离')
    await page.getByRole('textbox', { name: '任务内容' }).focus()
    publish({ type: 'stage.updated', stage: 'compacting' })
    await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
    await expect(pane).not.toContainText('压缩上下文')
    expect(f.kernels.list().find((s) => s.sessionId === session.id)?.pid).toBe(pid)
    await pane.getByTitle(session.title, { exact: true }).click()
    const capture = async (colorScheme: 'light' | 'dark') => {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 800, height: 760 })
      await expect(stage).toBeInViewport()
      expect(
        (await pane.getByRole('region', { name: '受管会话消息' }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(120)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      mkdirSync(evidence, { recursive: true })
      await page.screenshot({
        path: join(evidence, `obs-02-${colorScheme}-800.png`),
        fullPage: true,
      })
    }
    await capture('light')
    await capture('dark')
    await page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(session.id)[0]?.status).toBe('aborted')
    await expect(stage).toContainText('本轮已停止')
    await expect(stage.getByLabel('模型等待状态')).toHaveCount(0)
  } finally {
    await f.close()
  }
})

test('OBS-02 Electron failed stop remains unknown with same SDK PID; confirmation and terminal dismissal never change durable results', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 中止确认')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length).toBe(1)
    const session = f.store.managedSessions()[0]
    if (!session) {
      throw new Error('Missing stop fixture session')
    }
    await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.stage).toBe('streaming')
    const pid = f.kernels.list()[0]?.pid,
      abort = f.kernels.abort.bind(f.kernels)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    f.kernels.abort = async () => {
      await gate
      throw new Error('injected failure')
    }
    const pane = page.locator('.retained-session:not([hidden])'),
      stage = pane.getByRole('region', { name: '当前运行阶段', exact: true })
    await page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect(stage).toContainText('正在请求停止')
    release()
    await expect(stage).toContainText('停止结果未知')
    await expect(stage.getByRole('button', { name: '隐藏状态提示' })).toHaveCount(0)
    await expect(pane.getByRole('alert')).toHaveCount(1)
    expect(f.store.submissions(session.id)[0]?.status).toBe('executing')
    expect(f.kernels.list()[0]?.pid).toBe(pid)
    f.kernels.abort = abort
    await page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(session.id)[0]?.status).toBe('aborted')
    await expect(stage).toContainText('本轮已停止')
    const before = f.store.submissions(session.id)
    await stage.getByRole('button', { name: '隐藏状态提示', exact: true }).click()
    await expect(stage).toHaveCount(0)
    expect(f.store.submissions(session.id)).toEqual(before)
    expect(f.prompts()).toBe(1)
    await page.reload()
    await expect(stage).toContainText('本轮已停止')
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('OBS-02 Electron queued follow-up handoff has no false completed phase and terminal feedback is keyed by operation', async () => {
  test.setTimeout(90000)
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('队列边界 · 阶段交接')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.store.managedSessions().length).toBe(1)
    const session = f.store.managedSessions()[0],
      pane = page.locator('.retained-session:not([hidden])'),
      stage = pane.getByRole('region', { name: '当前运行阶段', exact: true })
    if (!session) {
      throw new Error('Missing continuation fixture session')
    }
    await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 后续阶段')
    await expect(page.getByRole('button', { name: '追加下一轮', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '追加下一轮', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('')
    await page.evaluate(() => {
      const samples: string[] = []
      const timer = setInterval(() => {
        const element = document.querySelector('.retained-session:not([hidden]) [data-stage]')
        if (element) {
          samples.push(element.getAttribute('data-stage') ?? '')
        }
        document.documentElement.dataset.stageSamples = JSON.stringify(samples)
      }, 20)
      Object.assign(window, { stageSampleTimer: timer })
    })
    await expect.poll(() => f.store.submissions(session.id).length, { timeout: 60000 }).toBe(2)
    const next = f.store.submissions(session.id)[1]
    if (!next) {
      throw new Error('Missing queued continuation submission')
    }
    await expect(stage).toHaveAttribute('data-operation-id', next.requestId)
    await expect(stage).toHaveAttribute('data-stage', 'streaming')
    const samples = await page.evaluate(() => {
      const timer: unknown = Reflect.get(window, 'stageSampleTimer')
      if (typeof timer === 'number') {
        clearInterval(timer)
      }
      return document.documentElement.dataset.stageSamples ?? ''
    })
    expect(samples).not.toContain('completed')
    expect(f.prompts()).toBe(2)
    await page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(session.id)[1]?.status).toBe('aborted')
    await expect(stage).toContainText('本轮已停止')
  } finally {
    await f.close()
  }
})
