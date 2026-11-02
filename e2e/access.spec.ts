import type { Page } from '@playwright/test'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { AccessService } from '../apps/daemon/dist/modules/security/access.service.js'

const port = 4318,
  evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

/** Only the endpoint is rerouted. Form submission, cookies, HTTP validation and WebSocket
 * traffic use the actual daemon; no generated auth response or fake client reducer is used.
 */
async function routeDaemon(page: Page) {
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

async function pair(page: Page, access: AccessService, label: string) {
  const ticket = access.issueTicket()
  await page.goto(`/?clients#pair=${ticket.code}`)
  await expect(page.getByLabel('配对令牌')).toHaveValue(ticket.code)
  expect(new URL(page.url()).hash).toBe('')
  await page.getByLabel('客户端名称').fill(label)
  await page.getByRole('button', { name: '连接此浏览器' }).click()
  await expect(page.getByRole('heading', { name: '已连接的客户端' })).toBeVisible()
  return ticket
}

test('SEC-08 actual pairing form: fragment is removed, keyboard/IME guard, HttpOnly identity, revocation and one-use error in light/dark narrow layouts', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-access-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await app.listen(port, '127.0.0.1')
    await routeDaemon(page)
    await page.goto('/?clients')
    await expect(page.getByRole('heading', { name: '连接本机工作台' })).toBeVisible()
    const ticket = app.get(AccessService).issueTicket()
    await page.goto(`/?clients#pair=${ticket.code}`)
    await expect(page.getByLabel('配对令牌')).toHaveValue(ticket.code)
    expect(new URL(page.url()).hash).toBe('')
    await page.reload()
    await expect(page.getByLabel('配对令牌')).toHaveValue('')
    await page.getByLabel('配对令牌').fill(ticket.code)
    const label = page.getByLabel('客户端名称')
    await label.fill('我的浏览器')
    // Synthesized composition event covers the guard, not a claim of physical Windows IME QA.
    await label.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    expect(app.get(AccessService).list()).toEqual([])
    await expect(page.getByRole('button', { name: '连接此浏览器' })).toBeEnabled()
    await label.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '已连接的客户端' })).toBeVisible()
    await expect(page.getByLabel('客户端列表')).toContainText('我的浏览器')
    const cookie = (await page.context().cookies()).find(
      (item) => item.name === `piw_client_${port}`,
    )
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api', expires: -1 })
    const storage = await page.evaluate(() =>
      JSON.stringify({
        local: Object.keys(localStorage).map((key) => localStorage.getItem(key)),
        session: Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)),
        cookie: document.cookie,
      }),
    )
    expect(storage).not.toContain(ticket.code)
    expect(storage).not.toContain(cookie?.value)
    await page.screenshot({ path: `${evidence}/clients-light.png`, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('html')).toHaveClass(/dark/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${evidence}/clients-dark-390.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '撤销 我的浏览器', exact: true }).click()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect(app.get(AccessService).list()).toHaveLength(1)
    await page.getByRole('button', { name: '撤销 我的浏览器', exact: true }).click()
    await page.getByRole('button', { name: '确认撤销', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '连接本机工作台' })).toBeVisible()
    await expect(page.getByText('我的浏览器', { exact: true })).toHaveCount(0)
    await page.getByLabel('配对令牌').fill(ticket.code)
    await page.getByRole('button', { name: '连接此浏览器' }).click()
    await expect(page.getByRole('alert').last()).toContainText('已使用或已过期')
    await page.screenshot({ path: `${evidence}/pairing-dark-390.png`, animations: 'disabled' })
    expect(errors).toEqual([])
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SEC-08 independent browsers: live WS revocation keeps actual SDK task alive; daemon restart requires fresh pairing for both identities', async ({
  page,
  browser,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-revocation-'))
  let app = await createApp({ dataDir: directory, port, development: true })
  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' }),
    second = await secondContext.newPage()
  try {
    await app.listen(port, '127.0.0.1')
    await Promise.all([routeDaemon(page), routeDaemon(second)])
    await pair(page, app.get(AccessService), '浏览器 A')
    await pair(second, app.get(AccessService), '浏览器 B')
    expect(app.get(AccessService).list()).toHaveLength(2)
    const kernels = app.get(KernelService),
      sessionId = randomUUID(),
      turnId = randomUUID()
    await kernels.open(sessionId, directory)
    let closed = false
    page.on('websocket', (socket) => {
      if (socket.url().includes('/api/events')) {
        socket.on('close', () => {
          closed = true
        })
      }
    })
    await page.goto(`/?observe=${sessionId}`)
    await expect(page.getByLabel('同步状态')).toHaveText('已同步')
    const run = kernels.prompt(sessionId, directory, {
      turnId,
      text: 'local held SDK stream',
      fixture: 'hold',
    })
    await expect(page.getByLabel('实时会话消息')).toContainText('OFFLINE_')
    await second.getByRole('button', { name: '撤销 浏览器 A', exact: true }).click()
    await second.getByRole('button', { name: '确认撤销', exact: true }).click()
    await expect(page.getByRole('heading', { name: '连接本机工作台' })).toBeVisible()
    expect(closed).toBe(true)
    expect(kernels.list()[0]?.state).toBe('running')
    await second.goto(`/?observe=${sessionId}`)
    await expect(second.getByLabel('实时会话消息')).toContainText('OFFLINE_')
    await kernels.abort(sessionId, turnId)
    expect(await run).toMatchObject({ outcome: 'aborted' })
    await expect(second.getByLabel('轮次状态').last()).toHaveText('本轮已停止')
    const oldTicket = app.get(AccessService).issueTicket()
    await app.close()
    app = await createApp({ dataDir: directory, port, development: true })
    await app.listen(port, '127.0.0.1')
    await second.reload()
    await expect(second.getByRole('heading', { name: '连接本机工作台' })).toBeVisible()
    await second.getByLabel('配对令牌').fill(oldTicket.code)
    await second.getByRole('button', { name: '连接此浏览器' }).click()
    await expect(second.getByRole('alert').last()).toContainText('已使用或已过期')
    await pair(second, app.get(AccessService), '浏览器 B 新授权')
    await second.goto(`/?history=${sessionId}`)
    await expect(second.getByLabel('历史载入状态')).toContainText('消息')
    expect(app.get(KernelService).list()).toEqual([])
    expect(app.get(AccessService).list()).toHaveLength(1)
  } finally {
    await page.goto('about:blank')
    await secondContext.close()
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
