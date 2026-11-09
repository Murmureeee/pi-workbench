import type { Route } from '@playwright/test'

import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { seedSearchSession } from '../apps/daemon/test/helpers/search.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const code = 'const 中文 = 1\n\nconsole.log(中文)\n'
const noop = () => undefined
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-link-ui-')),
    data = join(directory, 'data')
  mkdirSync(data)
  writeFileSync(join(data, '中文.ts'), 'export const current = 1\n')
  let app = await createApp({ dataDir: data, port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const a = await seedSearchSession(
    app,
    data,
    '链接甲',
    Array.from({ length: 132 }, (_, i) =>
      i === 4
        ? '检索命中 用户旧消息'
        : i === 5
          ? `检索命中 助手代码\n\n\`\`\`typescript\n${code}\`\`\`\n[读取当前文件](./中文.ts#L1)`
          : `历史条目 ${i}`,
    ),
  )
  const b = await seedSearchSession(app, data, '链接乙', ['其他用户输入', '检索命中 其他会话'])
  const c = await seedSearchSession(app, data, '链接丙'),
    d = await seedSearchSession(app, data, '链接丁')
  const events = app.get(EventService)
  events.attach(a.session.id, a.epoch, 'synthetic-ipc-fixture')
  events.publish(a.session.id, a.epoch, a.submission.turnId, {
    type: 'turn.started',
    messageId: `${a.submission.turnId}:assistant`,
    prompt: '合成观察，未执行',
  })
  events.publish(a.session.id, a.epoch, a.submission.turnId, {
    type: 'tool.updated',
    tool: {
      id: 'read-link',
      name: 'read',
      status: 'completed',
      summary: '合成读取结果',
      parameters: JSON.stringify({ path: '中文.ts', offset: 1 }),
      origin: 'synthetic-fixture',
    },
  })
  events.publish(a.session.id, a.epoch, a.submission.turnId, {
    type: 'turn.finished',
    outcome: 'completed',
  })
  let desktop = await launchWorkspaceDesktop(directory, app)
  const errors: string[] = []
  desktop.page.on('pageerror', (error) => errors.push(error.message))
  const go = async (url: string) => {
    await desktop.page.evaluate((path) => {
      history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, url)
  }
  return {
    a,
    b,
    c,
    d,
    directory,
    data,
    errors,
    go,
    get app() {
      return app
    },
    get desktop() {
      return desktop
    },
    get page() {
      return desktop.page
    },
    restart: async () => {
      await desktop.close()
      await app.close()
      app = await createApp({ dataDir: data, port: 4318, development: true })
      await app.listen(4318, '127.0.0.1')
      desktop = await launchWorkspaceDesktop(directory, app)
    },
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('OBS-05 Electron message search scopes every hit, references only the owned draft, and exact code copy excludes UI decoration', async () => {
  const f = await fixture()
  try {
    await f.go(`/?session=${f.a.session.id}`)
    const composer = f.page.getByRole('textbox', { name: '任务内容', exact: true })
    await composer.fill('原输入保留')
    await f.page.getByRole('button', { name: '查找本会话', exact: true }).click()
    const dialog = f.page.getByRole('dialog')
    await f.page.getByRole('textbox', { name: '标题或消息正文', exact: true }).fill('检索命中')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 2 条消息')
    await f.page.getByLabel('会话范围', { exact: true }).selectOption('all')
    await expect(f.page.getByLabel('搜索状态')).toContainText('共 3 条消息')
    await dialog.getByRole('button', { name: /链接甲.*助手正文命中/ }).click()
    const located = f.page.locator('[data-search-located="true"]')
    await expect(located).toContainText('检索命中 助手代码')
    await expect(located).toBeInViewport()
    await located.getByRole('button', { name: '复制代码', exact: true }).click()
    // Windows clipboard text normalizes line endings; code source has no UI decoration.
    expect(
      (await f.page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'),
    ).toBe(code)
    await located.getByRole('button', { name: '引用到输入', exact: true }).click()
    await expect(composer).toHaveValue(/原输入保留[\s\S]*引用历史消息[\s\S]*检索命中 助手代码/)
    await expect(located.getByText('已加入本会话输入，尚未发送；这是历史文本引用。')).toBeVisible()
    expect(f.app.get(SessionStore).managedSessions()).toHaveLength(4)
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('OBS-05 Electron copied message links survive pagination, view eviction, profile restart and unavailable-source recovery', async () => {
  const f = await fixture()
  try {
    // Native IDs include the runtime epoch; ask history around the first native entry.
    const entry = f.app
      .get(SessionStore)
      .searchSource(f.a.session.id)
      .messages.find((row) => row.text.includes('助手代码'))!
    const url = `/?session=${f.a.session.id}&message=${encodeURIComponent(entry.id)}`
    await f.go(url)
    await f.page
      .locator('[data-search-located="true"]')
      .getByRole('button', { name: '复制消息链接', exact: true })
      .click()
    const link = await f.page.evaluate(() => navigator.clipboard.readText())
    expect(new URL(link, 'http://127.0.0.1:5173').searchParams.get('message')).toBe(entry.id)
    await f.page.getByRole('button', { name: '刷新最新历史', exact: true }).click()
    await expect(f.page.getByLabel('历史载入状态')).toContainText('本页 100 条消息')
    await f.page.getByRole('button', { name: '更早的消息', exact: true }).click()
    await expect(f.page.getByLabel('历史载入状态')).toContainText('本页 32 条消息')
    await f.go(`/?session=${f.b.session.id}`)
    await f.go(`/?session=${f.c.session.id}`)
    await f.go(`/?session=${f.d.session.id}`)
    await expect(f.page.locator(`[data-session-view="${f.a.session.id}"]`)).toHaveCount(0)
    await f.go(link)
    await expect(f.page.locator('[data-search-located="true"]')).toContainText('助手代码')
    const native = readFileSync(f.a.sessionFile)
    await f.restart()
    await f.go(link)
    await expect(f.page.locator('[data-search-located="true"]')).toContainText('助手代码')
    expect(f.app.get(KernelService).list()).toEqual([])
    unlinkSync(f.a.sessionFile)
    await f.go(`/?session=${f.b.session.id}`)
    await f.go(link)
    await expect(f.page.getByText('链接目标不可用', { exact: true })).toBeVisible()
    await expect(f.page.locator('[data-search-located="true"]')).toHaveCount(0)
    writeFileSync(f.a.sessionFile, native)
    await f.page.getByRole('button', { name: '重新核对目标', exact: true }).click()
    await expect(f.page.locator('[data-search-located="true"]')).toContainText('助手代码')
  } finally {
    await f.close()
  }
})

test('OBS-05 Electron tool links expand the exact archived call; changed current files leave historical messages intact in light/dark narrow views', async () => {
  const f = await fixture()
  try {
    await f.go(`/?session=${f.a.session.id}`)
    await f.page.getByRole('button', { name: /read · 已完成 · read-link/ }).click()
    await f.page.getByRole('button', { name: '复制工具链接', exact: true }).click()
    const link = await f.page.evaluate(() => navigator.clipboard.readText())
    expect(new URL(link, 'http://127.0.0.1:5173').searchParams.get('tool')).toBe('read-link')
    const store = f.app.get(SessionStore),
      org = store.organizations().find((row) => row.sessionId === f.a.session.id)!
    store.organize(f.a.session.id, {
      action: 'archive',
      archived: true,
      expectedRevision: org.revision,
    })
    await f.go(`/?session=${f.b.session.id}`)
    await f.go(link)
    const tool = f.page.locator('[data-tool-located="true"]')
    await expect(tool).toContainText('read-link')
    await expect(tool).toBeInViewport()
    await expect(f.page.getByText('来源会话已归档 · 仅阅读，不恢复运行')).toBeVisible()
    /* oxlint-disable no-await-in-loop -- Both theme checks operate on the same window. */
    for (const theme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme: theme })
      await f.page.setViewportSize({ width: 802, height: 961 })
      await expect(tool.getByRole('button', { name: /打开工具关联的当前文件/ })).toBeVisible()
    }
    /* oxlint-enable no-await-in-loop */
    await tool.getByRole('button', { name: /打开工具关联的当前文件/ }).click()
    await expect(f.page.getByRole('dialog')).toContainText('export const current = 1')
    writeFileSync(join(f.data, '中文.ts'), 'export const external = 2\n')
    await expect(f.page.getByRole('dialog')).toContainText('外部变化', { timeout: 7000 })
    await expect(f.page.getByRole('dialog')).not.toContainText('export const current = 1')
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('OBS-05 Electron late reference resolution cannot overwrite edits or another view; failures preserve draft and allow retry', async () => {
  const f = await fixture()
  let release: () => void = noop
  try {
    const entry = f.app
      .get(SessionStore)
      .searchSource(f.a.session.id)
      .messages.find((row) => row.text.includes('助手代码'))!
    await f.go(`/?session=${f.a.session.id}&message=${encodeURIComponent(entry.id)}`)
    const located = f.page.locator('[data-search-located="true"]')
    await expect(located).toContainText('助手代码')
    const composer = f.page.getByRole('textbox', { name: '任务内容', exact: true })
    await composer.fill('核对前草稿')
    let reached = false
    const held = new Promise<void>((done) => {
      release = done
    })
    const handler = async (route: Route) => {
      reached = true
      await held
      const url = new URL(route.request().url())
      const response = await route.fetch({
        url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      await route.fulfill({ response })
    }
    await f.page.route('**/locate?**', handler)
    await located.getByRole('button', { name: '引用到输入', exact: true }).click()
    await expect.poll(() => reached).toBe(true)
    await composer.fill('核对期间新的草稿')
    release()
    await expect(located).toContainText('草稿或视图已变化，未加入引用')
    await expect(composer).toHaveValue('核对期间新的草稿')
    await f.page.unroute('**/locate?**', handler)
    await located.getByRole('button', { name: '引用到输入', exact: true }).click()
    await expect(composer).toHaveValue(/核对期间新的草稿[\s\S]*引用历史消息/)
    const quoted = await composer.inputValue()
    reached = false
    const navigating = new Promise<void>((done) => {
      release = done
    })
    let resolved = false
    const afterNavigation = async (route: Route) => {
      reached = true
      await navigating
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            f.app
              .get(SessionStore)
              .locate(f.a.session.id, { kind: 'message', messageId: entry.id }),
          ),
        })
      } catch (error) {
        // A replaced target can cancel; a retained pane can receive a late response.
        // Only proven cancellation is an expected transport error in this fixture.
        if (
          !(
            error instanceof Error &&
            error.message.includes('Route is already handled') &&
            route.request().failure()?.errorText.includes('ERR_ABORTED')
          )
        ) {
          throw error
        }
        await route.fallback()
      } finally {
        resolved = true
      }
    }
    await f.page.route('**/locate?**', afterNavigation)
    await located.getByRole('button', { name: '引用到输入', exact: true }).click()
    await expect.poll(() => reached).toBe(true)
    await f.go(`/?session=${f.b.session.id}`)
    await composer.fill('乙会话独立草稿')
    release()
    await expect.poll(() => resolved).toBe(true)
    await f.page.unroute('**/locate?**', afterNavigation)
    await expect(composer).toHaveValue('乙会话独立草稿')
    await f.go(`/?session=${f.a.session.id}&message=${encodeURIComponent(entry.id)}`)
    await expect(located).toContainText('助手代码')
    await expect(composer).toHaveValue(quoted)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    release()
    await f.close()
  }
})

test('OBS-05 Electron rechecks a new tool target before reusing a cached history page, and hides stale location success on failure', async () => {
  const f = await fixture()
  try {
    const entry = f.app
      .get(SessionStore)
      .searchSource(f.a.session.id)
      .messages.find((row) => row.text.includes('助手代码'))!
    const link = `/?session=${f.a.session.id}&message=${encodeURIComponent(entry.id)}`
    await f.go(link)
    await expect(
      f.page.getByText('已定位搜索命中消息 · 可阅读前后文或刷新最新历史', { exact: true }),
    ).toBeVisible()
    await f.go(`${link}&turn=${f.a.submission.turnId}&tool=missing-call`)
    await expect(f.page.getByText('链接目标不可用', { exact: true })).toBeVisible()
    await expect(f.page.locator('[data-search-located="true"]')).toHaveCount(0)
    await expect(
      f.page.getByText('已定位搜索命中消息 · 可阅读前后文或刷新最新历史', { exact: true }),
    ).toHaveCount(0)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})
