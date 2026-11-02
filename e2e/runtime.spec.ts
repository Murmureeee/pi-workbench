import type { Page } from '@playwright/test'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { authorizePage } from './helpers/access.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
const port = 4318

/** Test-only URL routing: REST is forwarded to an isolated daemon, browser WebSocket remains
 * native TCP to that same daemon. No generated frame or fake client reducer is used here.
 */
async function routeObserver(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const response = await route.fetch({
      url: `http://127.0.0.1:${port}${path}`,
      headers: {
        ...route.request().headers(),
        host: `127.0.0.1:${port}`,
        origin: 'http://127.0.0.1:5173',
      },
    })
    await route.fulfill({ response })
  })
  await page.addInitScript((socketPort) => {
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const endpoint = new URL(url)
        endpoint.port = String(socketPort)
        super(endpoint, protocols)
      }
    }
  }, port)
}

test('CORE-05 real local SDK: two browser clients reconnect to the same complete messages and tools', async ({
  page,
  context,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-events-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  const second = await context.newPage()
  try {
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    const kernels = app.get(KernelService),
      sessionId = randomUUID()
    await kernels.open(sessionId, directory)
    await Promise.all([routeObserver(page), routeObserver(second)])
    await Promise.all([page.goto(`/?observe=${sessionId}`), second.goto(`/?observe=${sessionId}`)])
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    await expect(second.getByLabel('同步状态')).toHaveText('已同步')
    const turnId = randomUUID()
    const run = kernels.prompt(sessionId, directory, {
      turnId,
      text: '真实 SDK 本地流式与中止',
      fixture: 'hold',
    })
    await expect(page.getByLabel('实时会话消息')).toContainText('OFFLINE_')
    await page.getByRole('button', { name: '断开观察', exact: true }).click()
    await second.getByRole('button', { name: '断开观察', exact: true }).click()
    expect(kernels.list()[0]?.state).toBe('running')
    await kernels.abort(sessionId, turnId)
    expect(await run).toMatchObject({ outcome: 'aborted' })
    await kernels.prompt(sessionId, directory, {
      turnId: randomUUID(),
      text: '未知工具拒绝',
      fixture: 'unknown-tool',
    })
    await Promise.all([
      page.getByRole('button', { name: '重新连接', exact: true }).click(),
      second.getByRole('button', { name: '重新连接', exact: true }).click(),
    ])
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    await expect(second.getByLabel('同步状态')).toHaveText('已同步')
    await expect(page.getByLabel('实时会话消息').locator('article')).toHaveCount(2)
    await expect(
      page.getByLabel('实时会话消息').getByText('OFFLINE_', { exact: true }),
    ).toHaveCount(1)
    await expect(page.getByLabel('实时会话消息').locator('pre')).toHaveCount(1)
    await expect
      .poll(() => second.getByLabel('实时会话消息').innerText())
      .toBe(await page.getByLabel('实时会话消息').innerText())
    await expect(page.getByRole('button', { name: '发送任务（尚未开放）' })).toBeDisabled()
    await page.screenshot({ path: `${evidence}/runtime-two-clients.png`, animations: 'disabled' })
    await second.emulateMedia({ colorScheme: 'dark' })
    await second.setViewportSize({ width: 390, height: 844 })
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await second.getByRole('button', { name: '断开观察', exact: true }).focus()
    await second.keyboard.press('Enter')
    await expect(second.getByLabel('同步状态')).toHaveText('观察已断开')
    await second.screenshot({ path: `${evidence}/runtime-dark-390.png`, animations: 'disabled' })
  } finally {
    await second.close()
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('CORE-05 synthetic observations: buffer exhaustion and live gap resync complete Unicode content; automatic reconnect retains cursor', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-resync-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  try {
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    const events = app.get(EventService),
      sessionId = randomUUID(),
      epoch = randomUUID(),
      turnId = randomUUID()
    events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
    events.publish(sessionId, epoch, turnId, {
      type: 'turn.started',
      prompt: '合成契约样本，不执行工具',
      messageId: 'm',
    })
    await routeObserver(page)
    await page.goto(`/?observe=${sessionId}`)
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    await page.getByRole('button', { name: '断开观察', exact: true }).click()
    const long = '你👩‍💻\ne\u0301'.repeat(12000)
    events.publish(sessionId, epoch, turnId, { type: 'message.delta', messageId: 'm', text: long })
    // Exhaust retained records while offline: current snapshot remains complete.
    for (let i = 0; i < 1025; i++) {
      events.publish(sessionId, epoch, turnId, { type: 'message.delta', messageId: 'm', text: 'x' })
    }
    await page.getByRole('button', { name: '重新连接', exact: true }).click()
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    await expect(page.getByLabel('实时会话消息')).toContainText('x'.repeat(1025))
    // Bypass only the journal callback to simulate a dropped live network envelope.
    let dropped = false
    const webSockets = app.getHttpAdapter().getInstance().websocketServer.clients
    for (const socket of webSockets) {
      const send = socket.send.bind(socket)
      socket.send = (data) => {
        if (!dropped && typeof data === 'string' && data.includes('message.delta')) {
          dropped = true
          return
        }
        send(data)
      }
    }
    events.publish(sessionId, epoch, turnId, {
      type: 'message.delta',
      messageId: 'm',
      text: '丢失后仍应恢复',
    })
    events.publish(sessionId, epoch, turnId, { type: 'turn.finished', outcome: 'completed' })
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    await expect(page.getByLabel('实时会话消息')).toContainText('丢失后仍应恢复')
    const snapshot = events.snapshot(sessionId)
    await expect(
      page
        .getByLabel('实时会话消息')
        .getByText(`${long}${'x'.repeat(1025)}丢失后仍应恢复`, { exact: true }),
    ).toHaveCount(1)
    // A real TCP close (without the user pressing disconnect) exercises automatic reconnect.
    for (const socket of webSockets) {
      socket.close(1012, 'synthetic network disconnect')
    }
    await expect(page.getByLabel('同步状态')).toHaveText('观察已断开')
    await expect(page.getByLabel('同步状态')).toHaveText('已同步', { timeout: 10000 })
    await expect(page.getByLabel('会话游标')).toHaveText(`${epoch} / ${snapshot?.seq}`)
    await page.screenshot({ path: `${evidence}/runtime-resync.png`, animations: 'disabled' })
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('CORE-05 incompatible version/capabilities blocks observation changes and keeps existing content', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-version-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  try {
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    const events = app.get(EventService),
      sessionId = randomUUID(),
      epoch = randomUUID()
    events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
    events.publish(sessionId, epoch, randomUUID(), {
      type: 'turn.started',
      messageId: 'm',
      prompt: '保留现有内容',
    })
    await routeObserver(page)
    await page.goto(`/?observe=${sessionId}`)
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    const checkMismatch = async (hello: ReturnType<EventService['hello']>) => {
      await page.getByRole('button', { name: '断开观察', exact: true }).click()
      await page.route('**/api/protocol', (route) => route.fulfill({ json: hello }))
      await page.getByRole('button', { name: '重新连接', exact: true }).click()
      await expect(page.getByLabel('同步状态')).toHaveText('版本或能力不兼容')
      await expect(page.getByText('保留现有内容', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '发送任务（尚未开放）' })).toBeDisabled()
    }
    await checkMismatch({ ...events.hello(), protocolVersion: 2 })
    await checkMismatch({ ...events.hello(), capabilities: ['snapshots'] })
    await page.screenshot({ path: `${evidence}/runtime-incompatible.png`, animations: 'disabled' })
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('CORE-05 synthetic observations: a late snapshot cannot replace a newer request or runtime generation', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-race-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    const events = app.get(EventService),
      sessionId = randomUUID(),
      epoch = randomUUID(),
      turnId = randomUUID()
    events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
    events.publish(sessionId, epoch, turnId, {
      type: 'turn.started',
      messageId: 'm',
      prompt: '旧运行时',
    })
    const oldSnapshot = events.snapshot(sessionId)
    await routeObserver(page)
    let requested = false
    await page.route('**/api/sessions/*/snapshot', async (route) => {
      if (!requested) {
        requested = true
        await gate
        await route.fulfill({ json: oldSnapshot })
      } else {
        const response = await route.fetch({
          url: `http://127.0.0.1:${port}/api/sessions/${sessionId}/snapshot`,
          headers: { host: `127.0.0.1:${port}` },
        })
        await route.fulfill({ response })
      }
    })
    await page.goto(`/?observe=${sessionId}`)
    await expect.poll(() => requested).toBe(true)
    await page.getByRole('button', { name: '断开观察', exact: true }).click()
    events.publish(sessionId, epoch, turnId, {
      type: 'message.delta',
      messageId: 'm',
      text: '新请求完整内容',
    })
    events.publish(sessionId, epoch, turnId, { type: 'turn.finished', outcome: 'completed' })
    await page.getByRole('button', { name: '重新连接', exact: true }).click()
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    release()
    await expect(page.getByText('新请求完整内容', { exact: true })).toBeVisible()
    const nextEpoch = randomUUID()
    events.attach(sessionId, nextEpoch, 'synthetic-ipc-fixture')
    events.publish(sessionId, nextEpoch, randomUUID(), {
      type: 'turn.started',
      messageId: 'new-m',
      prompt: '新代际，重新同步',
    })
    await expect(page.getByText('新代际，重新同步', { exact: true })).toBeVisible()
    await expect(page.getByText('旧运行时', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    await expect(page.getByLabel('会话游标')).toHaveText(`${nextEpoch} / 1`)
  } finally {
    release()
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
