import type { RuntimeSnapshot } from '../packages/shared/dist/index.js'

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { renderingDesktop } from './helpers/rendering.js'
import { toolFixtures, toolSecret } from './helpers/tools.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

async function startTools(f: Awaited<ReturnType<typeof renderingDesktop>>) {
  const { page } = f.desktop
  await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 合成工具观察')
  await page.getByRole('button', { name: '发送任务', exact: true }).click()
  await expect.poll(() => f.store.managedSessions().length).toBe(1)
  const session = f.store.managedSessions()[0]
  if (!session) {
    throw new Error('Missing tool session')
  }
  await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.text).toBe('OFFLINE_')
  const snapshot = f.events.snapshot(session.id)
  const turn = snapshot?.turns[0]
  if (!snapshot || !turn) {
    throw new Error('Missing active observation')
  }
  f.security.redactor.remember(toolSecret)
  for (const tool of toolFixtures(session.cwd)) {
    f.events.publish(session.id, snapshot.epoch, turn.id, { type: 'tool.updated', tool })
  }
  return { session, snapshot, turn }
}

test('OBS-03 actual Electron read-only Trace: nested identity, result-before-start, explicit outcomes/unknown metrics, safe structures and keyboard', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  const errors: string[] = [],
    remote: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().startsWith('https://invalid.example')) {
      remote.push(request.url())
    }
  })
  try {
    const { session } = await startTools(f)
    const pane = page.locator('.retained-session:not([hidden])')
    await expect(pane.locator('[data-tool-id]')).toHaveCount(12)
    const child = pane.getByRole('region', { name: '工具调用 read-child', exact: true })
    await expect(child).toHaveAttribute('data-tool-depth', '1')
    const childToggle = child.getByRole('button', {
      name: 'read · 已完成 · read-child',
      exact: true,
    })
    await childToggle.focus()
    await page.keyboard.press('Enter')
    await expect(childToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(child).toContainText('只读样本🙂')
    await expect(child).toContainText('src/中文.ts · 请求从第 2 行开始 · 请求最多 4 行')
    await expect(child).not.toContainText('sample-key-hidden')
    await childToggle.focus()
    await page.keyboard.press('Space')
    await expect(childToggle).toHaveAttribute('aria-expanded', 'false')
    const command = pane.locator('[data-tool-id="command"]')
    await command.getByRole('button').click()
    await expect(command.locator('dd').last()).toHaveText('未知')
    await expect(command.locator('dd').nth(4)).toHaveText('未知')
    const failure = pane.locator('[data-tool-id="failure"]')
    await failure.getByRole('button').click()
    await expect(failure).toContainText('12.5 ms')
    await expect(failure.locator('dd').last()).toHaveText('7')
    await expect(
      pane.getByRole('button', { name: 'write · 已拒绝 · denied', exact: true }),
    ).toBeVisible()
    await expect(
      pane.getByRole('button', { name: 'custom-cancelled · 已取消 · cancelled', exact: true }),
    ).toBeVisible()
    const unknown = pane.locator('[data-tool-id="unknown"]')
    await unknown.getByRole('button').click()
    await expect(unknown).toContainText('未知结构')
    await expect(unknown).toContainText('父调用尚不可用')
    await expect(unknown.getByLabel('工具结果')).toContainText('<script>')
    await expect(unknown.locator('img,script')).toHaveCount(0)
    const cycle = pane.locator('[data-tool-id="cycle-a"]')
    await cycle.getByRole('button').click()
    await expect(cycle).toContainText('循环')
    expect(remote).toEqual([])
    expect(errors).toEqual([])
    expect(existsSync(join(session.cwd, 'not-created.txt'))).toBe(false)
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('OBS-03 actual Electron long redacted output expands without changing source, Diff remains observation, light/dark narrow layouts stay bounded', async () => {
  const f = await renderingDesktop(),
    { page } = f.desktop
  try {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1920, height: 1080 })
    const runtimeErrors = await page.evaluateHandle(() => {
      const errors: string[] = []
      window.addEventListener('error', (event) => errors.push(event.message))
      return errors
    })
    const { session, snapshot, turn } = await startTools(f)
    const pane = page.locator('.retained-session:not([hidden])'),
      mcp = pane.locator('[data-tool-id="mcp"]')
    const before = f.events.snapshot(session.id)
    await mcp.getByRole('button').click()
    await expect(mcp).toContainText('本机合成服务 / lookup')
    await expect(mcp).not.toContainText('OBS03_TOOL_OUTPUT_END')
    await mcp.getByRole('button', { name: '展开完整消息', exact: true }).click()
    await expect(mcp).toContainText('OBS03_TOOL_OUTPUT_END')
    await expect(mcp).not.toContainText(toolSecret)
    await mcp.getByRole('button', { name: '收起长消息', exact: true }).click()
    await expect(mcp.getByRole('button', { name: '展开完整消息', exact: true })).toBeInViewport()
    await mcp.getByRole('button', { name: 'custom-lookup · 已完成 · mcp', exact: true }).click()
    const edit = pane.locator('[data-tool-id="edit"]')
    await edit.getByRole('button').click()
    await expect(edit.getByLabel('工具 Diff')).toContainText('-旧行\n+新行')
    await expect(edit.getByLabel('工具 Diff')).toContainText('尚未关联可回滚账本')
    await expect(edit.getByRole('button', { name: /回滚/ })).toHaveCount(0)
    const truncated = pane.locator('[data-tool-id="truncated"]')
    await truncated.getByRole('button').click()
    await expect(truncated).toContainText('工具已截断输出')
    const file = f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.sessionFile
    if (!file) {
      throw new Error('Missing native history')
    }
    const bytes = readFileSync(file)
    mkdirSync(evidence, { recursive: true })
    const diff = edit.getByLabel('工具 Diff'),
      diffText = diff.locator('pre')
    await pane.getByLabel('受管会话消息').press('Home')
    await diff.getByRole('heading').scrollIntoViewIfNeeded()
    await expect(diff.getByRole('heading')).toBeInViewport()
    await diffText.scrollIntoViewIfNeeded()
    await expect(diffText).toBeInViewport({ ratio: 0.7 })
    await page.screenshot({
      path: join(evidence, 'tool-timeline-light.png'),
      animations: 'disabled',
    })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 760 })
    await pane.getByLabel('受管会话消息').press('Home')
    await diff.getByRole('heading').scrollIntoViewIfNeeded()
    await expect(diff.getByRole('heading')).toBeInViewport()
    await diffText.scrollIntoViewIfNeeded()
    await expect(diffText).toBeInViewport({ ratio: 0.7 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: join(evidence, 'tool-timeline-dark-800.png'),
      animations: 'disabled',
    })
    expect(f.events.snapshot(session.id)).toEqual(before)
    expect(readFileSync(file)).toEqual(bytes)
    expect(snapshot.epoch).toBe(f.events.snapshot(session.id)?.epoch)
    expect(await runtimeErrors.jsonValue()).toEqual([])
    await runtimeErrors.dispose()
    await f.kernels.abort(session.id, turn.id)
  } finally {
    await f.close()
  }
})

test('OBS-03 actual Electron expansion survives 3-view eviction/reload; background observations and reused call IDs cannot change current focus or another turn', async () => {
  const f = await renderingDesktop(2),
    { page } = f.desktop
  try {
    const { session, snapshot, turn } = await startTools(f)
    const pane = page.locator('.retained-session:not([hidden])')
    const childToggle = () =>
      pane
        .locator('[data-tool-id="read-child"]')
        .getByRole('button', { name: 'read · 已完成 · read-child', exact: true })
    await childToggle().click()
    const pid = f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.pid
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    const second = await f.send('第二会话工具隔离')
    const state = f.events.snapshot(second.id),
      active = state?.turns[0]
    if (!state || !active) {
      throw new Error('Missing second turn')
    }
    // Restored synthetic snapshot is observation-only; no new prompt or tool invocation.
    const other: RuntimeSnapshot = {
      ...state,
      epoch: randomUUID(),
      source: 'synthetic-ipc-fixture',
      turns: [
        {
          ...active,
          tools: [
            {
              id: 'read-child',
              name: 'read',
              status: 'completed',
              parameters: '{"path":"other.txt"}',
              summary: '另一个轮次的相同ID',
              origin: 'synthetic-fixture',
            },
          ],
        },
      ],
    }
    f.events.restore(other)
    await expect(childToggle()).toHaveAttribute('aria-expanded', 'false')
    const input = pane.getByRole('textbox', { name: '任务内容' })
    await input.fill('当前会话独立草稿')
    await input.focus()
    f.events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'tool.updated',
      tool: {
        id: 'background',
        name: 'background',
        status: 'completed',
        summary: '后台新工具观察',
        origin: 'synthetic-fixture',
      },
    })
    await expect(input).toBeFocused()
    await expect(pane).toHaveAttribute('data-session-view', second.id)
    await expect(input).toHaveValue('当前会话独立草稿')
    const sendNext = async (name: string) => {
      await page.getByRole('button', { name: '新会话', exact: true }).click()
      await f.send(name)
    }
    await sendNext('第三会话工具淘汰')
    await sendNext('第四会话工具淘汰')
    await expect(page.locator(`[data-session-view="${session.id}"]`)).toHaveCount(0)
    await pane.getByTitle(session.title, { exact: true }).click()
    await expect(childToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.pid).toBe(pid)
    await page.reload()
    await expect(childToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(f.prompts()).toBe(4)
    await f.kernels.abort(session.id, turn.id)
    await pane.getByRole('button', { name: '历史记录', exact: true }).click()
    await expect(
      pane.getByLabel('持久化历史').locator('[data-tool-id="read-child"]'),
    ).toContainText('只读样本🙂')
    expect(f.prompts()).toBe(4)
    await pane.getByRole('button', { name: '返回对话', exact: true }).click()
    await pane
      .getByRole('textbox', { name: '任务内容' })
      .fill('保持运行 · 同会话新轮次的相同调用ID')
    await pane.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.events.snapshot(session.id)?.turns.length).toBe(2)
    await expect.poll(() => f.events.snapshot(session.id)?.turns.at(-1)?.text).toBe('OFFLINE_')
    const next = f.events.snapshot(session.id)?.turns.at(-1)
    if (!next) {
      throw new Error('Missing next turn')
    }
    f.events.publish(session.id, snapshot.epoch, next.id, {
      type: 'tool.updated',
      tool: {
        id: 'read-child',
        name: 'read',
        status: 'completed',
        parameters: '{"path":"next.txt"}',
        summary: '新轮次结果',
        origin: 'synthetic-fixture',
      },
    })
    const sameId = pane.locator('[data-tool-id="read-child"]')
    await expect(sameId).toHaveCount(2)
    await expect(
      sameId.first().getByRole('button', { name: 'read · 已完成 · read-child', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(
      sameId.last().getByRole('button', { name: 'read · 已完成 · read-child', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(f.prompts()).toBe(5)
    await f.kernels.abort(session.id, next.id)
  } finally {
    await f.close()
  }
})
