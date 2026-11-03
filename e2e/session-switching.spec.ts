import type { Route } from '@playwright/test'

import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-switch-ui-')),
    pi = join(directory, 'pi'),
    legacy = join(pi, 'sessions', '--old--')
  mkdirSync(legacy, { recursive: true })
  const path = join(legacy, 'old.jsonl')
  writeFileSync(
    path,
    [
      {
        type: 'session',
        version: 3,
        id: 'old-native',
        cwd: 'D:\\旧目录',
        timestamp: '2026-10-01T00:00:00Z',
      },
      ...Array.from({ length: 106 }, (_, i) => ({
        type: 'message',
        id: `old-${i}`,
        parentId: i ? `old-${i - 1}` : null,
        message: { role: 'user', content: `旧记录 ${i}` },
      })),
    ]
      .map((item) => JSON.stringify(item))
      .join('\n') + '\n',
  )
  const app = await createApp({
    dataDir: join(directory, 'data'),
    port: 4318,
    development: true,
    piAgentDir: pi,
  })
  await app.listen(4318, '127.0.0.1')
  const store = app.get(SessionStore),
    service = app.get(SessionService),
    kernels = app.get(KernelService)
  try {
    const sessions = await Promise.all(
      ['A', 'B', 'C', 'D'].map(async (letter) => {
        const receipt = await service.submit({
          requestId: randomUUID(),
          sessionId: null,
          configuration: {
            projectId: null,
            workspaceId: null,
            model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
            thinking: 'off',
          },
          text:
            `${letter} 会话阅读段落\n` +
            Array.from({ length: 80 }, (_, i) => `${letter} 第 ${i} 行，保留当前阅读位置。`).join(
              '\n',
            ),
          retryOf: null,
        })
        await expect
          .poll(() => store.receipt(receipt.submission.requestId)?.submission, {
            timeout: 15000,
          })
          .toMatchObject({ status: 'completed', error: null })
        return receipt.session
      }),
    )
    const desktop = await launchWorkspaceDesktop(directory, app)
    // Native TCP WS to the same isolated daemon as REST; no mocked frames/reducer.
    await desktop.context.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const endpoint = new URL(url)
          if (endpoint.pathname === '/api/events') {
            endpoint.port = '4318'
          }
          super(endpoint, protocols)
        }
      }
    })
    await desktop.page.reload()
    return {
      directory,
      path,
      app,
      store,
      service,
      kernels,
      sessions,
      desktop,
      close: async () => {
        await desktop.close()
        await app.close()
        rmSync(directory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
async function forward(route: Route) {
  const url = new URL(route.request().url())
  return route.fetch({
    url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
    headers: {
      ...route.request().headers(),
      host: '127.0.0.1:4318',
      origin: 'http://127.0.0.1:5173',
    },
  })
}

test('SESSION-02 Electron evicts after three views and restores per-session drafts, anchors and panel after reload', async () => {
  test.setTimeout(90000)
  const f = await fixture(),
    { page } = f.desktop,
    [a, b, c, d] = f.sessions
  if (!a || !b || !c || !d) {
    throw new Error('Missing seeded sessions')
  }
  const pane = page.locator('.retained-session:not([hidden])')
  const open = async (title: string) => {
    await pane.getByTitle(title, { exact: true }).click()
    await expect(pane.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
  }
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await open(a.title)
    await pane.getByLabel('任务内容').fill('A 的未发送草稿')
    const viewport = pane.getByLabel('受管会话消息')
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(900)
    await viewport.press('Home')
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
    await viewport.evaluate((element) => element.scrollTo({ top: 900, behavior: 'instant' }))
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(900)
    const top = 900
    const before = await page.evaluate(() => sessionStorage.getItem('piw-session-views-v1'))
    await open(b.title)
    await pane.getByLabel('任务内容').fill('B 的草稿')
    await open(c.title)
    await open(d.title)
    await expect(page.locator('[data-session-view]')).toHaveCount(3)
    await expect(page.locator(`[data-session-view="${a.id}"]`)).toHaveCount(0)
    await open(a.title)
    await expect(pane.getByLabel('任务内容')).toHaveValue('A 的未发送草稿')
    writeFileSync(
      `${evidence}/session-reading-state.json`,
      JSON.stringify(
        {
          before,
          after: await page.evaluate(() => sessionStorage.getItem('piw-session-views-v1')),
          geometry: await viewport.evaluate((element) => ({
            top: element.scrollTop,
            height: element.clientHeight,
            scrollHeight: element.scrollHeight,
            anchors: [...element.querySelectorAll<HTMLElement>('[data-reading-id]')].map(
              (item) => ({
                id: item.dataset.readingId,
                top: item.getBoundingClientRect().top,
                height: item.getBoundingClientRect().height,
              }),
            ),
          })),
        },
        null,
        2,
      ),
    )
    await expect
      .poll(async () => Math.abs((await viewport.evaluate((element) => element.scrollTop)) - top))
      .toBeLessThan(8)
    await pane.getByRole('button', { name: '历史记录', exact: true }).click()
    await expect(pane.getByLabel('持久化历史')).toContainText('OFFLINE_OK')
    await page.reload()
    await expect(pane.getByLabel('持久化历史')).toContainText('OFFLINE_OK')
    await expect(pane.getByLabel('任务内容')).toHaveValue('A 的未发送草稿')
    await pane.getByRole('button', { name: '返回对话', exact: true }).click()
    await expect
      .poll(async () => Math.abs((await viewport.evaluate((element) => element.scrollTop)) - top))
      .toBeLessThan(8)
    await page.screenshot({
      path: `${evidence}/session-switch-restored-light.png`,
      animations: 'disabled',
    })
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByLabel('外观主题').selectOption('dark')
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await expect(pane.getByLabel('任务内容')).toHaveValue('A 的未发送草稿')
    await page.screenshot({
      path: `${evidence}/session-switch-restored-dark.png`,
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 800, height: 720 })
    await expect(pane.getByLabel('任务内容')).toHaveValue('A 的未发送草稿')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `${evidence}/session-switch-dark-800.png`,
      animations: 'disabled',
    })
    expect(f.store.submissions(a.id)).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('SESSION-02 Electron keeps a real SDK task/PID across eviction, socket reconnect and renderer reload; only explicit stop aborts', async () => {
  test.setTimeout(90000)
  const f = await fixture(),
    { page } = f.desktop,
    [a, b, c, d] = f.sessions
  if (!a || !b || !c || !d) {
    throw new Error('Missing sessions')
  }
  const pane = page.locator('.retained-session:not([hidden])'),
    original = f.kernels.prompt.bind(f.kernels)
  let calls = 0
  f.kernels.prompt = (id, cwd, prompt, options) => {
    calls++
    return original(id, cwd, { ...prompt, fixture: 'hold' }, options)
  }
  try {
    await pane.getByTitle(a.title, { exact: true }).click()
    await pane.getByLabel('任务内容').fill('持续后台任务')
    await pane.getByRole('button', { name: '发送任务' }).click()
    await expect(pane.getByLabel('任务状态').last()).toHaveText('运行中', { timeout: 15000 })
    const pid = f.kernels.resources().kernels.find((item) => item.sessionId === a.id)?.pid
    expect(pid).toBeGreaterThan(0)
    await pane.getByTitle(b.title, { exact: true }).click()
    await pane.getByTitle(c.title, { exact: true }).click()
    await pane.getByTitle(d.title, { exact: true }).click()
    await expect(page.locator(`[data-session-view="${a.id}"]`)).toHaveCount(0)
    await expect(page.locator('[data-session-view]')).toHaveCount(3)
    // Three retained runtime observers plus one app-owned, read-only title subscription.
    await expect
      .poll(() => f.app.getHttpAdapter().getInstance().websocketServer.clients.size)
      .toBeLessThanOrEqual(4)
    await expect(pane.getByTitle(a.title, { exact: true })).toContainText('运行中')
    await expect
      .poll(() =>
        pane
          .getByTitle(a.title, { exact: true })
          .locator('.session-activity')
          .evaluate((element) => {
            const label = element.getBoundingClientRect(),
              button = element.parentElement!.getBoundingClientRect()
            return label.left >= button.left && label.right <= button.right
          }),
      )
      .toBe(true)
    await page.screenshot({
      path: `${evidence}/session-background-sidebar.png`,
      animations: 'disabled',
    })
    expect(f.kernels.resources().kernels.find((item) => item.sessionId === a.id)).toMatchObject({
      pid,
      state: 'running',
    })
    await pane.getByLabel('任务内容').fill('D 的草稿保持焦点')
    const sockets = await page.context().newCDPSession(page)
    await sockets.send('Network.enable')
    // Force a real WS close through the owning daemon socket; reconnect never sends input.
    const raw = f.app.getHttpAdapter().getInstance().websocketServer
    for (const client of raw.clients) {
      client.close(1012, 'offline reconnect test')
    }
    await expect(pane.getByLabel('任务内容')).toBeFocused()
    await expect(pane.getByLabel('任务内容')).toHaveValue('D 的草稿保持焦点')
    await sockets.detach()
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(pane.getByLabel('任务状态').last()).toHaveText('运行中')
    await page.reload()
    await expect(pane.getByLabel('任务状态').last()).toHaveText('运行中')
    expect(f.kernels.resources().kernels.find((item) => item.sessionId === a.id)?.pid).toBe(pid)
    expect(calls).toBe(1)
    await pane.getByRole('button', { name: '停止本轮' }).click()
    await expect(pane.getByLabel('任务状态').last()).toHaveText('本轮已停止')
    expect(f.store.submissions(a.id)).toHaveLength(2)
    await page.screenshot({
      path: `${evidence}/session-background-recovered.png`,
      animations: 'disabled',
    })
  } finally {
    f.kernels.prompt = original
    await f.close()
  }
})

test('SESSION-02 Electron isolates evicted draft-directory and A-B-A history responses, restoring synthetic tool/reference context', async () => {
  test.setTimeout(90000)
  const f = await fixture(),
    { page } = f.desktop,
    [a, b, c, d] = f.sessions
  if (!a || !b || !c || !d) {
    throw new Error('Missing sessions')
  }
  const pane = page.locator('.retained-session:not([hidden])')
  let release!: () => void
  const gate = new Promise<void>((done) => {
    release = done
  })
  let waiting = false,
    intercept = true
  let releaseDirectory!: () => void,
    deliveredDirectory!: () => void,
    directoryWaiting = false
  const directoryGate = new Promise<void>((done) => {
    releaseDirectory = done
  })
  const directoryDelivered = new Promise<void>((done) => {
    deliveredDirectory = done
  })
  const oldDirectory = join(f.directory, 'old-directory'),
    newDirectory = join(f.directory, 'new-directory')
  mkdirSync(oldDirectory)
  mkdirSync(newDirectory)
  await page.route('**/api/workspaces/open', async (route) => {
    const response = await forward(route)
    const input: unknown = route.request().postDataJSON()
    const old =
      input !== null && typeof input === 'object' && 'path' in input && input.path === oldDirectory
    if (old) {
      directoryWaiting = true
      await directoryGate
    }
    await route.fulfill({ response }).catch(() => undefined)
    if (old) {
      deliveredDirectory()
    }
  })
  await page.route(`**/api/sessions/${a.id}/history?**`, async (route) => {
    const response = await forward(route)
    if (intercept) {
      intercept = false
      waiting = true
      await gate
    }
    await route.fulfill({ response }).catch(() => undefined)
  })
  try {
    await pane.getByText('执行目录：独立目录', { exact: true }).click()
    await pane.getByLabel('目录绝对路径（可选）').fill(oldDirectory)
    await pane.getByRole('button', { name: '校验此目录', exact: true }).click()
    await expect.poll(() => directoryWaiting).toBe(true)
    await pane.getByTitle(a.title, { exact: true }).click()
    await pane.getByTitle(b.title, { exact: true }).click()
    await pane.getByTitle(c.title, { exact: true }).click()
    await expect(page.locator('[data-session-view="new"]')).toHaveCount(0)
    await pane.getByRole('button', { name: '新会话', exact: true }).click()
    await pane.getByText('执行目录：独立目录', { exact: true }).click()
    await pane.getByLabel('目录绝对路径（可选）').fill(newDirectory)
    await pane.getByRole('button', { name: '校验此目录', exact: true }).click()
    await expect(pane.getByText(`执行目录：${newDirectory}`, { exact: true })).toBeVisible()
    releaseDirectory()
    await directoryDelivered
    // Let the delivered body and React's resulting layout settle before checking ownership.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    await expect(pane.getByText(`执行目录：${newDirectory}`, { exact: true })).toBeVisible()
    await pane.getByTitle(a.title, { exact: true }).click()
    await pane.getByRole('button', { name: '历史记录', exact: true }).click()
    await expect.poll(() => waiting).toBe(true)
    await pane.getByTitle(b.title, { exact: true }).click()
    await pane.getByLabel('任务内容').fill('B 不接收 A 的结果')
    await pane.getByTitle(c.title, { exact: true }).click()
    await pane.getByTitle(d.title, { exact: true }).click()
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(pane.getByLabel('持久化历史')).toContainText('A 第 0 行')
    release()
    await expect(pane.getByLabel('持久化历史')).not.toContainText('B 第 0 行')
    const snapshot = f.app.get(EventService).snapshot(a.id)
    const turn = snapshot?.turns[0]
    if (!snapshot || !turn) {
      throw new Error('Missing real runtime snapshot')
    }
    // Synthetic completed observation, not an executed tool or approval.
    f.app.get(EventService).restore({
      ...snapshot,
      source: 'synthetic-ipc-fixture',
      turns: [
        {
          ...turn,
          tools: [
            {
              id: 'synthetic-tool',
              name: '合成只读工具',
              status: 'completed',
              summary: '用于展开状态验收，不执行工具',
            },
          ],
        },
      ],
    })
    f.store.saveApproval({
      id: randomUUID(),
      sessionId: a.id,
      epoch: snapshot.epoch,
      turnId: turn.id,
      source: 'synthetic-fixture',
      decision: 'pending',
      parameters: {},
      reason: '合成等待记录，不可执行',
    })
    f.store.saveChangeReference({
      id: randomUUID(),
      sessionId: a.id,
      epoch: snapshot.epoch,
      turnId: turn.id,
      source: 'synthetic-fixture',
      reference: 'synthetic-ledger:A-只读引用',
    })
    await pane.getByRole('button', { name: '返回对话', exact: true }).click()
    await expect(pane.getByText('合成只读工具 · completed · 只读过程')).toBeVisible()
    await pane.getByText('合成只读工具 · completed · 只读过程').click()
    await pane.getByTitle(b.title, { exact: true }).click()
    await pane.getByTitle(c.title, { exact: true }).click()
    await pane.getByTitle(d.title, { exact: true }).click()
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(pane.getByText('用于展开状态验收，不执行工具')).toBeVisible()
    await pane.getByRole('button', { name: '历史记录', exact: true }).click()
    await expect(pane.getByLabel('审批记录')).toContainText('合成等待记录，不可执行')
    await pane.getByRole('button', { name: 'synthetic-ledger:A-只读引用' }).click()
    await pane.getByTitle(b.title, { exact: true }).click()
    await expect(pane.getByTitle(a.title, { exact: true })).toContainText('待审批 1')
    await expect(pane.getByLabel('当前变更引用')).toHaveCount(0)
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(pane.getByLabel('当前变更引用')).toContainText('synthetic-ledger:A-只读引用')
    await pane.getByTitle(b.title, { exact: true }).click()
    await expect(pane.getByLabel('任务内容')).toHaveValue('B 不接收 A 的结果')
    expect(f.store.submissions(a.id)).toHaveLength(1)
  } finally {
    releaseDirectory()
    release()
    await f.close()
  }
})

test('SESSION-02 Electron reads external pi history, handles concurrent append/partial/corrupt records without changing bytes or running kernels', async () => {
  test.setTimeout(90000)
  const f = await fixture(),
    { page } = f.desktop,
    before = readFileSync(f.path),
    count = f.kernels.list().length
  try {
    await page.getByRole('link', { name: '旧 pi 历史 · 只读' }).click()
    await page.getByRole('button', { name: /D:\\旧目录/ }).click()
    await expect(page.getByLabel('旧 pi 历史消息')).toContainText('旧记录 6')
    await page.getByRole('button', { name: '更早的消息', exact: true }).click()
    await expect(page.getByLabel('旧 pi 历史消息')).toContainText('旧记录 0')
    await page.getByRole('button', { name: '刷新最新历史', exact: true }).click()
    appendFileSync(f.path, '{partial')
    await page.getByRole('button', { name: '更早的消息', exact: true }).click()
    await expect(page.getByText(/历史版本已变化/)).toBeVisible()
    await page.getByRole('button', { name: '刷新最新历史', exact: true }).click()
    await expect(page.getByLabel('旧 pi 历史消息')).toContainText('incomplete-tail')
    appendFileSync(f.path, '}\n{broken}\n')
    const after = readFileSync(f.path)
    await page.getByRole('button', { name: '刷新最新历史', exact: true }).click()
    await expect(page.getByLabel('旧 pi 历史消息')).toContainText('invalid-record')
    await expect(page.getByRole('button', { name: '继续旧会话（尚未开放）' })).toBeDisabled()
    expect(readFileSync(f.path)).toEqual(after)
    expect(after.subarray(0, before.length)).toEqual(before)
    expect(f.kernels.list()).toHaveLength(count)
    expect(f.store.managedSessions()).toHaveLength(4)
    await page.screenshot({
      path: `${evidence}/session-legacy-readonly.png`,
      animations: 'disabled',
    })
  } finally {
    await f.close()
  }
})
