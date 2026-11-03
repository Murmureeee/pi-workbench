import type { Page } from '@playwright/test'

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { authorizePage } from './helpers/access.js'

const port = 4318,
  evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
const secret = 'synthetic-browser-credential-94e7'

/** Browser uses actual HTTP and native TCP WS to one isolated daemon. Only credentials and
 * approval observations are synthetic; the app, output policy and browser components are real.
 */
async function routeDaemon(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url())
    const response = await route.fetch({
      url: `http://127.0.0.1:${port}${path.pathname}${path.search}`,
      headers: {
        ...route.request().headers(),
        host: `127.0.0.1:${port}`,
        origin: 'http://127.0.0.1:5173',
      },
    })
    await route.fulfill({ response })
  })
  await page.addInitScript((socketPort) => {
    const NativeSocket = window.WebSocket
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const endpoint = new URL(url)
        if (endpoint.pathname === '/api/events') {
          endpoint.port = String(socketPort)
        }
        super(endpoint, protocols)
      }
    }
  }, port)
}

function config(directory: string) {
  const path = join(directory, 'pi')
  mkdirSync(path)
  writeFileSync(
    join(path, 'auth.json'),
    JSON.stringify({
      existing: { type: 'api_key', key: secret },
      expired: {
        type: 'oauth',
        access: 'synthetic-access',
        refresh: 'synthetic-refresh',
        expires: 1,
      },
      command: { type: 'api_key', key: '!echo should-not-execute' },
    }),
  )
  return path
}

test('SEC-06 actual credential status page shows metadata only, handles errors and keyboard refresh, dark/narrow layout', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-security-'))
  const app = await createApp({
    dataDir: join(directory, 'data'),
    port,
    development: true,
    piAgentDir: config(directory),
  })
  const responses: string[] = [],
    consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('response', (response) => {
    if (response.url().includes('/api/security/credentials') && response.ok()) {
      void response.text().then(
        (body) => responses.push(body),
        () => responses.push('response-unavailable'),
      )
    }
  })
  try {
    await app.listen(port, '127.0.0.1')
    await authorizePage(page, app)
    await routeDaemon(page)
    await page.goto('/?credentials')
    await expect(page.getByLabel('凭证同步状态')).toHaveText('凭证状态已同步')
    await expect(page.getByLabel('提供商凭证状态')).toContainText('已配置 · 未联网验证')
    await expect(page.getByLabel('提供商凭证状态')).toContainText('凭证已过期')
    await expect(page.getByLabel('提供商凭证状态')).toContainText('命令型凭证未执行')
    await expect(page.getByRole('main').locator('input')).toHaveCount(0)
    await expect(page.getByLabel('搜索设置')).toHaveAttribute('type', 'search')
    expect(await page.locator('body').innerText()).not.toContain(secret)
    await page.screenshot({ path: `${evidence}/credentials-light.png`, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${evidence}/credentials-dark-390.png`, animations: 'disabled' })
    expect(
      JSON.stringify(
        await page.evaluate(() => ({
          local: Object.keys(localStorage).map((key) => localStorage.getItem(key)),
          session: Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)),
        })),
      ),
    ).not.toContain(secret)
    expect(responses.length).toBeGreaterThan(0)
    expect(responses.join('')).not.toContain(secret)
    expect(consoleErrors).toEqual([])
    // Explicit HTTP fault injection; a stale successful result is never presented as current.
    await page.route('**/api/security/credentials', (route) =>
      route.fulfill({ status: 503, body: 'unavailable' }),
    )
    await page.getByRole('button', { name: '刷新凭证状态' }).click()
    await expect(page.getByLabel('凭证同步状态')).toHaveText('凭证状态同步失败')
    await expect(page.getByRole('alert').first()).toContainText('以下为上次状态')
    await page.unroute('**/api/security/credentials')
    await page.getByRole('button', { name: '刷新凭证状态' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('凭证同步状态')).toHaveText('凭证状态已同步')
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SEC-06 synthetic split-secret, stopped output and approval observations stay redacted over actual WebSocket and reload', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-redaction-'))
  const app = await createApp({
    dataDir: join(directory, 'data'),
    port,
    development: true,
    piAgentDir: config(directory),
  })
  const frames: string[] = []
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      frames.push(String(payload))
    })
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
      prompt: `synthetic prompt ${secret}`,
    })
    await routeDaemon(page)
    await page.goto(`/?observe=${sessionId}`)
    await expect(page.getByLabel('同步状态')).toContainText('已同步')
    for (const text of ['prefix ', 'synthetic-browser-', 'credential-', '94e7', ' suffix ']) {
      events.publish(sessionId, epoch, turnId, { type: 'message.delta', messageId: 'm', text })
    }
    events.publish(sessionId, epoch, turnId, {
      type: 'approval.requested',
      approval: { id: 'a', command: `curl --token ${secret}`, cwd: directory },
    })
    await expect(page.getByText(/curl --token/)).toContainText('«redacted»')
    expect(await page.locator('body').innerText()).not.toContain(secret)
    await page.screenshot({ path: `${evidence}/redacted-approval.png`, animations: 'disabled' })
    events.publish(sessionId, epoch, turnId, { type: 'turn.finished', outcome: 'completed' })
    await expect(page.getByText('prefix «redacted» suffix', { exact: false })).toBeVisible()
    expect(frames.join('')).not.toContain(secret)
    await page.reload()
    await expect(page.getByText('prefix «redacted» suffix', { exact: false })).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain(secret)
    expect(events.snapshot(sessionId)?.turns[0]?.text).toContain(secret)
    const stoppedTurn = randomUUID(),
      stoppedMessage = `${stoppedTurn}:assistant`,
      partial = secret.slice(0, -4)
    events.publish(sessionId, epoch, stoppedTurn, {
      type: 'turn.started',
      messageId: stoppedMessage,
      prompt: 'synthetic stopped credential fragment',
    })
    events.publish(sessionId, epoch, stoppedTurn, {
      type: 'message.delta',
      messageId: stoppedMessage,
      text: `stopped ${partial}`,
    })
    events.publish(sessionId, epoch, stoppedTurn, { type: 'turn.finished', outcome: 'aborted' })
    await expect(page.getByLabel('轮次状态').last()).toHaveText('本轮已停止')
    expect(frames.join('')).not.toContain(partial)
    expect(await page.locator('body').innerText()).not.toContain(partial)
    await page.reload()
    await expect(page.getByLabel('轮次状态').last()).toHaveText('本轮已停止')
    expect(await page.locator('body').innerText()).not.toContain(partial)
    expect(events.snapshot(sessionId)?.turns.at(-1)?.text).toBe(`stopped ${partial}`)
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
