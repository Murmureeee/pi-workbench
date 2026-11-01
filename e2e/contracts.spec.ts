import type { Fixture } from '../packages/shared/dist/index.js'

import { expect, test } from '@playwright/test'

import { fixtureFor } from '../packages/agent-adapter/dist/fake-kernel.js'

const evidenceDirectory = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('OPS-08 offline fixture: duplicate deltas preserve Unicode and output beyond 64 KiB', async ({
  page,
}) => {
  const body = `${'长输出👩‍💻\n'.repeat(10000)}结尾完整`
  const fixture = fixtureFor('running')
  const delta = { ...fixture.events[1], payload: { type: 'delta', text: body } }
  await page.route('**/api/lab/scenes/running', (route) =>
    route.fulfill({ json: { ...fixture, events: [fixture.events[0], delta, delta] } }),
  )
  await page.goto('/')
  await page.getByLabel('离线状态样本').selectOption('running')
  await expect(page.getByLabel('对话消息')).toContainText('结尾完整')
  const answer = page.getByLabel('对话消息').getByText(body, { exact: true })
  await expect(answer).toHaveCount(1)
  expect(await answer.textContent()).toBe(body)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('OPS-08 offline fixture: a sequence gap pauses input and explicit resync restores content', async ({
  page,
}) => {
  let broken = true
  const fixture = fixtureFor('running')
  await page.route('**/api/lab/scenes/running', (route) =>
    route.fulfill({
      json: broken
        ? {
            ...fixture,
            events: fixture.events.map((value) => ({
              ...value,
              seq: value.seq === 2 ? 3 : value.seq,
            })),
          }
        : fixture,
    }),
  )
  await page.goto('/')
  const input = page.getByRole('textbox', { name: '任务内容' })
  await input.fill('保留草稿')
  await page.getByLabel('离线状态样本').selectOption('running')
  await expect(page.getByText('需要重新同步会话', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeDisabled()
  await expect(input).toHaveValue('保留草稿')
  await page.screenshot({ path: `${evidenceDirectory}/contract-gap.png`, animations: 'disabled' })
  broken = false
  await page.getByRole('button', { name: '重新同步状态' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('需要重新同步会话', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('对话消息')).toContainText('我会先检查')
  await expect(input).toHaveValue('保留草稿')
})

test('OPS-08 offline fixture: a delayed response cannot replace the selected view or its draft', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/lab/scenes/approval', async (route) => {
    await gate
    await route.fulfill({ json: fixtureFor('approval') })
  })
  await page.goto('/')
  const samples = page.getByLabel('离线状态样本')
  const input = page.getByRole('textbox', { name: '任务内容' })
  try {
    await input.fill('当前查看的草稿')
    await samples.selectOption('approval')
    await expect(page.getByText('正在读取离线状态样本…')).toBeVisible()
    await samples.selectOption('new')
    release()
    await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
    await expect(page.getByLabel('执行前审批')).toHaveCount(0)
    await expect(input).toHaveValue('当前查看的草稿')
    // Revisit after completion: actual cached component state remains usable.
    await samples.selectOption('approval')
    await expect(page.getByLabel('执行前审批')).toBeVisible()
  } finally {
    release()
  }
})

test('OPS-08 offline fixture: unknown payload fails validation without changing the draft', async ({
  page,
}) => {
  const fixture = fixtureFor('running')
  await page.route('**/api/lab/scenes/running', (route) =>
    route.fulfill({
      json: {
        ...fixture,
        events: [
          ...fixture.events,
          {
            ...fixture.events[0],
            seq: 3,
            payload: { type: 'unknown-tool', command: 'must-not-run' },
          },
        ],
      },
    }),
  )
  await page.goto('/')
  await page.getByRole('textbox', { name: '任务内容' }).fill('无效数据也保留')
  await page.getByLabel('离线状态样本').selectOption('running')
  await expect(page.getByText('服务数据格式不兼容', { exact: true })).toBeVisible()
  await page.screenshot({
    path: `${evidenceDirectory}/contract-mismatch.png`,
    animations: 'disabled',
  })
  await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('无效数据也保留')
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeDisabled()
})

test('OPS-08 synthetic renderer fault: actual boundary keeps composer usable and returns to new view', async ({
  page,
}) => {
  // Replace only the optional conversation renderer. Real SceneContent/Alert/Button/composer run.
  await page.route('**/src/features/conversation/conversation.tsx*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'export function Conversation() { throw new Error("OPS-08 synthetic renderer fault") }',
    }),
  )
  await page.goto('/')
  const input = page.getByRole('textbox', { name: '任务内容' })
  await input.fill('渲染失败后保留')
  await page.getByLabel('离线状态样本').selectOption('running')
  await expect(page.getByText('消息显示失败', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('渲染失败后保留')
  await page.getByLabel('主题', { exact: true }).selectOption('dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '返回新会话' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: `${evidenceDirectory}/contract-renderer-390-dark.png`,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '返回新会话' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
  await expect(input).toHaveValue('渲染失败后保留')
  await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeEnabled()
})

test('OPS-08 offline fixture: an unknown command is shown as literal text and causes no execution requests', async ({
  page,
}) => {
  const commands: string[] = []
  const fixture: Fixture = fixtureFor('approval')
  for (const value of fixture.events) {
    if (value.payload.type === 'approval') {
      value.payload.command = '<unknown::tool> $(do-not-execute) <script>bad()</script>'
    }
  }
  await page.route('**/api/lab/scenes/approval', (route) => route.fulfill({ json: fixture }))
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) {
      commands.push(request.url())
    }
  })
  await page.goto('/')
  await page.getByLabel('离线状态样本').selectOption('approval')
  await expect(page.getByLabel('执行前审批')).toContainText('<script>bad()</script>')
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(page.getByText('已拒绝执行', { exact: true })).toBeVisible()
  expect(commands).toEqual([])
})
