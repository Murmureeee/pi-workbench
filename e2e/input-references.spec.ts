import type { Route } from '@playwright/test'

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { setupChanges } from './helpers/change-fixture.js'
import { openConfiguration } from './helpers/workbench.js'

type Fixture = Awaited<ReturnType<typeof setupChanges>>
const noop = () => undefined
// A page delay overrides the context forwarding route; target this fixture explicitly.
const referenceResponse = (route: Route) =>
  route.fetch({
    url: 'http://127.0.0.1:4318/api/chat/input-references',
    headers: {
      ...route.request().headers(),
      host: '127.0.0.1:4318',
      origin: 'http://127.0.0.1:5173',
    },
  })
const input = (f: Fixture) => f.page.getByRole('textbox', { name: '任务内容', exact: true })
const refs = (f: Fixture) => f.page.getByRole('region', { name: '输入引用', exact: true })
async function prepare(f: Fixture) {
  await openConfiguration(f.page)
  const project = f.app
    .get(ProjectService)
    .list()
    .find((p) => p.directory === f.cwd)!
  await f.page.getByLabel('项目', { exact: true }).selectOption(project.id)
  await f.page.getByRole('button', { name: '会话配置', exact: true }).click()
}
async function add(f: Fixture, path: string) {
  await f.page.getByRole('button', { name: '@ 添加引用', exact: true }).click()
  await f.page.getByRole('textbox', { name: '引用路径', exact: true }).fill(path)
  await f.page.getByRole('button', { name: '保存引用', exact: true }).click()
  await expect(f.page.getByRole('dialog', { name: '引用预览', exact: true })).toBeVisible()
  await f.page.getByRole('button', { name: '关闭引用', exact: true }).click()
}

test('INPUT-03 Electron unsent draft file preview/edit/remove/undo, changed-version refusal and atomic first binding', async () => {
  const f = await setupChanges()
  try {
    await prepare(f)
    writeFileSync(join(f.cwd, '引用.ts'), 'const 原文 = 1\r\n')
    await add(f, '引用.ts')
    expect(f.app.get(SessionStore).managedSessions()).toHaveLength(0)
    expect(f.sends()).toBe(0)
    await refs(f).getByRole('button', { name: '移除引用', exact: true }).click()
    await expect(refs(f)).not.toContainText('引用.ts')
    await refs(f).getByRole('button', { name: '撤销引用操作', exact: true }).click()
    await expect(refs(f)).toContainText('引用.ts')
    writeFileSync(join(f.cwd, '引用.ts'), 'const 外部 = 2\r\n')
    await f.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect(f.page.getByRole('alert')).toContainText('变化')
    expect(f.app.get(SessionStore).managedSessions()).toHaveLength(0)
    await refs(f).getByRole('button', { name: '修改引用', exact: true }).click()
    await f.page.getByRole('button', { name: '保存引用', exact: true }).click()
    await expect(f.page.getByRole('dialog', { name: '引用预览', exact: true })).toContainText(
      'const 外部 = 2',
    )
    await f.page.getByRole('button', { name: '关闭引用', exact: true }).click()
    await f.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.app.get(SessionStore).managedSessions().length).toBe(1)
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(0)
    await f.restart()
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toEqual([])
    const rows = f.app
      .get(WorkspaceDatabase)
      .sqlite.prepare('select session_id from input_references where session_id is not null')
      .all()
    expect(rows).toHaveLength(1)
  } finally {
    await f.close()
  }
})

test('INPUT-03 Electron synthetic long paste preserves received UTF8 bytes, redacted preview, known submit failure and retry retain draft', async () => {
  const f = await setupChanges()
  try {
    const raw =
      '\ufeff  中文\r\napi_key = "isolated-ui-paste-secret"\r\n' + 'x'.repeat(5000) + '\r\n  '
    await input(f).evaluate((element, text) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    }, raw)
    await expect(f.page.getByRole('textbox', { name: '原始粘贴内容', exact: true })).toBeVisible()
    await f.page.getByRole('button', { name: '保存引用', exact: true }).click()
    const preview = f.page.getByRole('dialog', { name: '引用预览', exact: true })
    await expect(preview).toContainText('«redacted»')
    await expect(preview).not.toContainText('isolated-ui-paste-secret')
    expect(
      f.app.get(WorkspaceDatabase).sqlite.prepare('select content from input_references').all(),
    ).toEqual([{ content: Buffer.from(raw) }])
    await f.page.getByRole('button', { name: '关闭引用', exact: true }).click()
    await f.page.route('**/api/chat/submit', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected before-save refusal' }),
      }),
    )
    await f.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect(f.page.getByRole('alert')).toContainText('injected before-save refusal')
    await expect(refs(f)).toContainText('长粘贴')
    expect(f.sends()).toBe(0)
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => f.sends()).toBe(1)
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(0)
  } finally {
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('INPUT-03 Electron late attachment cannot overwrite a newer owned draft; separate background SDK keeps identity', async () => {
  const f = await setupChanges()
  let release: () => void = noop
  try {
    const a = await f.send('保持 引用后台')
    await f.ready(a.id)
    const before = f.kernels.list().find((k) => k.sessionId === a.id)
    writeFileSync(join(f.other, 'read.ts'), 'independent')
    await f.send('独立引用目标', true)
    await expect
      .poll(
        () =>
          f.changes.history(
            f.app
              .get(SessionStore)
              .managedSessions()
              .find((s) => s.id !== a.id)!.id,
          ).rounds[0]?.outcome,
      )
      .toBe('completed')
    let entered = false
    const gate = new Promise<void>((done) => {
      release = done
    })
    await f.page.route('**/api/chat/input-references', async (route) => {
      const response = await referenceResponse(route)
      entered = true
      await gate
      await route.fulfill({ response })
    })
    await f.page.getByRole('button', { name: '@ 添加引用', exact: true }).click()
    await f.page.getByRole('textbox', { name: '引用路径', exact: true }).fill('read.ts')
    await f.page.getByRole('button', { name: '保存引用', exact: true }).click()
    await expect.poll(() => entered).toBe(true)
    await f.page.getByRole('button', { name: '关闭引用', exact: true }).click()
    await input(f).fill('newer owned draft')
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await expect(input(f)).toHaveValue('newer owned draft')
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(0)
    expect(f.kernels.list().find((k) => k.sessionId === a.id)).toMatchObject({
      pid: before?.pid,
      epoch: before?.epoch,
      state: 'running',
    })
    await f.stop(a.id)
  } finally {
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('INPUT-03 Electron eight references remain reachable in narrow view and replacement works at the item limit', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    await prepare(f)
    // Eight explicit UI additions, not synthetic reference-store population.
    for (let i = 0; i < 8; i++) {
      // oxlint-disable-next-line no-await-in-loop -- each UI operation must settle before the next immutable version is added.
      await add(f, 'tracked.txt')
    }
    await f.page.setViewportSize({ width: 800, height: 760 })
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(8)
    await expect(f.page.getByRole('button', { name: '发送任务', exact: true })).toBeInViewport()
    // An explicitly expanded configuration uses the existing scrollable composer.
    await f.page.getByRole('button', { name: '会话配置', exact: true }).click()
    await f.page.getByRole('button', { name: '发送任务', exact: true }).scrollIntoViewIfNeeded()
    await expect(f.page.getByRole('button', { name: '发送任务', exact: true })).toBeInViewport()
    await f.page.getByRole('button', { name: '会话配置', exact: true }).click()
    await refs(f).getByRole('button', { name: '修改引用', exact: true }).first().click()
    await f.page.getByRole('button', { name: '保存引用', exact: true }).click()
    await expect(f.page.getByRole('dialog', { name: '引用预览', exact: true })).toBeVisible()
    await f.page.getByRole('button', { name: '关闭引用', exact: true }).click()
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(8)
    await f.page.getByRole('button', { name: '@ 添加引用', exact: true }).click()
    await f.page.getByRole('textbox', { name: '引用路径', exact: true }).fill('tracked.txt')
    await f.page.getByRole('button', { name: '保存引用', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toContainText('8 项')
    expect(f.sends()).toBe(0)
  } finally {
    await f.close()
  }
})

test('INPUT-03 Electron closing a pending reference cancels its late draft attachment without sending', async () => {
  const f = await setupChanges()
  let release: () => void = noop
  let delivered: () => void = noop
  try {
    await prepare(f)
    let entered = false
    const gate = new Promise<void>((done) => {
      release = done
    })
    const delivery = new Promise<void>((done) => {
      delivered = done
    })
    await f.page.route('**/api/chat/input-references', async (route) => {
      const response = await referenceResponse(route)
      entered = true
      await gate
      try {
        await route.fulfill({ response })
      } catch (error) {
        if (!route.request().failure()?.errorText.includes('ERR_ABORTED')) {
          throw error
        }
      } finally {
        delivered()
      }
    })
    await f.page.getByRole('button', { name: '@ 添加引用', exact: true }).click()
    await f.page.getByRole('textbox', { name: '引用路径', exact: true }).fill('tracked.txt')
    await f.page.getByRole('button', { name: '保存引用', exact: true }).click()
    await expect.poll(() => entered).toBe(true)
    await f.page.getByRole('button', { name: '关闭引用', exact: true }).click()
    release()
    await delivery
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    )
    await expect(f.page.getByRole('alert')).toHaveCount(0)
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(0)
    expect(f.sends()).toBe(0)
    expect(f.app.get(SessionStore).managedSessions()).toHaveLength(0)
    await add(f, 'tracked.txt')
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(1)
  } finally {
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('INPUT-03 Electron closing code selection during reference capture leaves its unsent draft untouched', async () => {
  const f = await setupChanges()
  let release: () => void = noop
  let delivered: () => void = noop
  try {
    await prepare(f)
    await f.page.getByRole('button', { name: '浏览与查找文件', exact: true }).click()
    await f.page.getByRole('textbox', { name: '文件名或相对路径', exact: true }).fill('tracked.txt')
    const browser = f.page.getByRole('region', { name: '授权文件浏览', exact: true })
    await browser.getByRole('button', { name: 'tracked.txt', exact: true }).click()
    await browser.getByRole('button', { name: '只读查看代码', exact: true }).click()
    let entered = false
    const gate = new Promise<void>((done) => {
      release = done
    })
    const delivery = new Promise<void>((done) => {
      delivered = done
    })
    await f.page.route('**/api/chat/input-references', async (route) => {
      const response = await referenceResponse(route)
      expect(response.status()).toBe(200)
      entered = true
      await gate
      try {
        await route.fulfill({ response })
      } catch (error) {
        if (!route.request().failure()?.errorText.includes('ERR_ABORTED')) {
          throw error
        }
      } finally {
        delivered()
      }
    })
    await f.page.getByRole('button', { name: '选区加入输入', exact: true }).click()
    await expect.poll(() => entered).toBe(true)
    await f.page.getByRole('button', { name: '关闭代码阅读', exact: true }).click()
    release()
    await delivery
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    )
    await f.page.getByRole('button', { name: '关闭文件浏览', exact: true }).click()
    await expect(refs(f).locator('[data-reference-id]')).toHaveCount(0)
    await expect(f.page.getByRole('alert')).toHaveCount(0)
    expect(f.sends()).toBe(0)
    expect(f.app.get(SessionStore).managedSessions()).toHaveLength(0)
    expect(
      f.app.get(WorkspaceDatabase).sqlite.prepare('select session_id from input_references').all(),
    ).toEqual([{ session_id: null }])
  } finally {
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})
