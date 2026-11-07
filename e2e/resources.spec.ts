import type { Page } from '@playwright/test'

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { authorizePage } from './helpers/access.js'

const port = 4318,
  evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function routeResources(page: Page) {
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

test('CORE-07 actual SDK queue: browser shows limits, FIFO positions and cancellation without owning execution', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-resources-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  try {
    // This scenario proves model-slot FIFO. Directory contention has its own suite;
    // independent roots prevent WS-04 from satisfying this test through another queue.
    const roots = { a: join(directory, 'a'), b: join(directory, 'b'), c: join(directory, 'c') }
    Object.values(roots).forEach((path) => mkdirSync(path))
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    const kernels = app.get(KernelService),
      first = randomUUID(),
      second = randomUUID(),
      third = randomUUID(),
      firstTurn = randomUUID(),
      secondTurn = randomUUID(),
      thirdTurn = randomUUID()
    const run = kernels.prompt(first, roots.a, {
      turnId: firstTurn,
      text: 'real SDK held stream',
      fixture: 'hold',
    })
    await expect
      .poll(() => kernels.list().find((item) => item.sessionId === first)?.state)
      .toBe('running')
    const secondRun = kernels
      .prompt(second, roots.b, { turnId: secondTurn, text: 'cancel before SDK admission' })
      .catch((error: unknown) => error)
    const thirdRun = kernels.prompt(third, roots.c, {
      turnId: thirdTurn,
      text: 'next real SDK task',
    })
    await routeResources(page)
    await page.goto('/?resources')
    await expect(page.getByLabel('资源同步状态')).toHaveText('资源已同步')
    await expect(page.getByLabel('资源限额')).toContainText('内核 1 / 3')
    await expect(page.getByLabel('资源限额')).toContainText('模型任务 1 / 1')
    await expect(page.getByLabel('资源限额')).toContainText('终端预算 6 · 待接入')
    const queue = page.getByLabel('资源等待队列')
    await expect(queue).toContainText('模型队列 · 第 1 位 · 模型任务名额已满')
    await expect(queue).toContainText('模型队列 · 第 2 位 · 模型任务名额已满')
    await expect(queue).toContainText(second)
    await expect(queue).toContainText(third)
    await page.screenshot({ path: `${evidence}/resources-fifo.png`, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${evidence}/resources-dark-390.png`, animations: 'disabled' })
    await kernels.abort(second, secondTurn)
    expect(await secondRun).toMatchObject({ name: 'AbortError' })
    await expect(queue).not.toContainText(second)
    await expect(queue).toContainText('模型队列 · 第 1 位')
    // Leaving a read-only view must not cancel real daemon work.
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    expect(kernels.list().find((item) => item.sessionId === first)?.state).toBe('running')
    await kernels.abort(first, firstTurn)
    expect(await run).toMatchObject({ outcome: 'aborted' })
    expect(await thirdRun).toMatchObject({ outcome: 'completed', localRequests: 1 })
    await page.goto('/?resources')
    await expect(page.getByLabel('资源等待队列')).toContainText('当前没有等待请求。')
    expect(kernels.list().some((item) => item.sessionId === second)).toBe(false)
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('CORE-07 actual components preserve stale state on failed/incompatible reads and keyboard refresh recovers', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-resource-error-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  try {
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    await routeResources(page)
    await page.goto('/?resources')
    await expect(page.getByLabel('资源同步状态')).toHaveText('资源已同步')
    // Explicit HTTP fault injection only; normal resource state comes from the actual daemon.
    await page.route('**/api/kernels/resources', (route) =>
      route.fulfill({ status: 503, body: 'unavailable' }),
    )
    await expect(page.getByLabel('资源同步状态')).toHaveText('资源同步失败')
    await expect(page.getByRole('alert')).toContainText('以下保留上次读取的状态')
    await expect(page.getByLabel('资源限额')).toContainText('内核 0 / 3')
    await page.route('**/api/kernels/resources', (route) =>
      route.fulfill({ json: { version: 999 } }),
    )
    await expect(page.getByRole('alert')).toContainText('资源协议不兼容')
    await page.screenshot({ path: `${evidence}/resources-unavailable.png`, animations: 'disabled' })
    await page.unroute('**/api/kernels/resources')
    await routeResources(page)
    await page.getByRole('button', { name: '刷新资源状态', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('资源同步状态')).toHaveText('资源已同步')
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
