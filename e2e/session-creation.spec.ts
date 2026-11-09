import type { Route } from '@playwright/test'

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'
import { openConfiguration } from './helpers/workbench.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function firstSessionId(store: SessionStore) {
  const session = store.managedSessions()[0]
  if (!session) {
    throw new Error('Missing first-send session')
  }
  return session.id
}
function forward(route: Route) {
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
/** Real Electron main/preload/parent identity, actual SQLite and pi SDK subprocess/local HTTP
 * fixture. HTTP loss, SQL trigger and fixture error below are explicit fault injections.
 */
async function fixture(configured = false) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-session-ui-')),
    pi = join(directory, 'pi')
  mkdirSync(pi)
  const modelPath = join(pi, 'models.json')
  writeFileSync(
    modelPath,
    JSON.stringify({
      providers: {
        existing: {
          api: 'openai-completions',
          baseUrl: 'https://fixture.invalid/v1',
          apiKey: 'synthetic-first-send-secret',
          models: [{ id: 'code', name: '已有编码模型' }],
        },
      },
    }),
  )
  const app = await createApp({
    dataDir: join(directory, 'data'),
    port: 4318,
    development: true,
    ...(configured ? { piAgentDir: pi } : {}),
  })
  await app.listen(4318, '127.0.0.1')
  try {
    const desktop = await launchWorkspaceDesktop(directory, app)
    await expect(desktop.page.getByLabel('模型', { exact: true })).toBeEnabled()
    return {
      directory,
      app,
      desktop,
      modelPath,
      store: app.get(SessionStore),
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

test('SESSION-01 Electron drafts, composition Enter, durable first send and continuing the same session', async () => {
  const f = await fixture(),
    { page } = f.desktop,
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const box = page.getByRole('textbox', { name: '任务内容' }),
      send = page.getByRole('button', { name: '发送任务' })
    await box.fill('尚未发送的独立草稿')
    await page.reload()
    await expect(box).toHaveValue('尚未发送的独立草稿')
    await expect(page.getByLabel('项目', { exact: true })).toHaveValue('')
    expect(f.store.list()).toEqual([])
    await box.dispatchEvent('compositionstart')
    await box.press('Enter')
    expect(await box.inputValue()).toContain('尚未发送的独立草稿')
    expect(f.store.list()).toEqual([])
    await box.dispatchEvent('compositionend')
    await box.fill('尚未发送的独立草稿')
    await box.press('Shift+Enter')
    await expect(box).toHaveValue('尚未发送的独立草稿\n')
    await box.fill('首次有效任务')
    await expect(send).toBeEnabled()
    await send.dblclick()
    await expect(page).toHaveURL(/session=/)
    await expect(page.getByLabel('任务状态')).toHaveText('本轮已结束', { timeout: 15000 })
    await expect(page.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
    expect(f.store.managedSessions()).toHaveLength(1)
    const id = firstSessionId(f.store)
    expect(f.store.submissions(id)).toHaveLength(1)
    await box.fill('当前会话草稿')
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await box.fill('新会话独立草稿')
    const draftDirectory = join(f.directory, 'draft-directory')
    mkdirSync(draftDirectory)
    await openConfiguration(page)
    await page.getByText('执行目录：独立目录', { exact: true }).click()
    await f.desktop.setSelection(draftDirectory)
    await page.getByRole('button', { name: '选择文件夹', exact: true }).click()
    await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
    await page
      .locator('.retained-session:not([hidden])')
      .getByTitle('首次有效任务', { exact: true })
      .click()
    await expect(box).toHaveValue('当前会话草稿')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await expect(box).toHaveValue('当前会话草稿')
    await expect(page.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`session=${id}`))
    await expect(box).toHaveValue('当前会话草稿')
    await box.press('Enter')
    await expect(page.getByLabel('任务状态')).toHaveCount(2)
    await expect(page.getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
    expect(f.store.managedSessions()).toHaveLength(1)
    expect(f.store.submissions(id)).toHaveLength(2)
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await expect(box).toHaveValue('新会话独立草稿')
    await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
    await page.reload()
    await expect(box).toHaveValue('新会话独立草稿')
    await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
    expect(f.store.managedSessions()).toHaveLength(1)
    expect(errors).toEqual([])
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.screenshot({ path: `${evidence}/session-new-light.png`, animations: 'disabled' })
  } finally {
    await f.close()
  }
})

test('SESSION-01 Electron preserves drafts on SQL failure and reconciles a lost accepted response after refresh without a second prompt', async () => {
  const f = await fixture(),
    { page } = f.desktop
  const requestIds: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/chat/submit') {
      const value: unknown = request.postDataJSON()
      if (
        value &&
        typeof value === 'object' &&
        'requestId' in value &&
        typeof value.requestId === 'string'
      ) {
        requestIds.push(value.requestId)
      }
    }
  })
  try {
    const db = f.app.get(WorkspaceDatabase).sqlite,
      box = page.getByRole('textbox', { name: '任务内容' })
    db.exec(
      "CREATE TRIGGER fail_first_send BEFORE INSERT ON session_submissions BEGIN SELECT RAISE(ABORT, 'injected write failure'); END",
    )
    await box.fill('保存失败仍保留的任务')
    await page.getByRole('button', { name: '发送任务' }).click()
    await expect(page.getByRole('alert')).toContainText('会话未能保存')
    await expect(box).toHaveValue('保存失败仍保留的任务')
    expect(f.store.list()).toEqual([])
    db.exec('DROP TRIGGER fail_first_send')
    let blockLookup = true
    await page.route('**/api/chat/submissions/*', async (route) => {
      if (blockLookup) {
        await route.abort()
      } else {
        await route.fallback()
      }
    })
    await page.route('**/api/chat/submit', async (route) => {
      await forward(route)
      await route.abort()
    })
    await page.getByRole('button', { name: '发送任务' }).click()
    await expect(page.getByRole('button', { name: '核对原提交' })).toBeVisible()
    // The pending action appears before the protocol check and actual POST complete.
    await expect.poll(() => requestIds.length).toBe(2)
    await expect.poll(() => f.store.managedSessions().length).toBe(1)
    expect(requestIds[0]).toBe(requestIds[1])
    await expect(box).toHaveAttribute('readonly', '')
    await page.reload()
    await expect(box).toHaveValue('保存失败仍保留的任务')
    await expect(page.getByRole('button', { name: '核对原提交' })).toBeVisible()
    blockLookup = false
    await page.getByRole('button', { name: '核对原提交' }).click()
    await expect(page).toHaveURL(/session=/)
    await expect(page.getByLabel('任务状态')).toHaveText('本轮已结束', { timeout: 15000 })
    expect(f.store.managedSessions()).toHaveLength(1)
    expect(f.store.submissions(firstSessionId(f.store))).toHaveLength(1)
    await expect(box).toHaveValue('')
  } finally {
    await f.close()
  }
})

test('SESSION-01 Electron project entry preselects its verified directory, global new resets attribution, themes and narrow layout stay usable', async () => {
  const f = await fixture(),
    { page } = f.desktop,
    directory = join(f.directory, 'project')
  mkdirSync(directory)
  try {
    await openConfiguration(page)
    await page.getByText('执行目录：独立目录', { exact: true }).click()
    await page.getByLabel('目录绝对路径（可选）').fill(directory)
    await page.getByRole('button', { name: '校验此目录' }).click()
    await expect(page.getByText(`执行目录：${directory}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('项目名称', { exact: true }).fill('测试项目')
    await page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(page.getByLabel('项目', { exact: true })).not.toHaveValue('')
    const projectId = await page.getByLabel('项目', { exact: true }).inputValue()
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await expect(page.getByLabel('项目', { exact: true })).toHaveValue('')
    await page.getByRole('button', { name: /^项目新会话：测试项目 ·/ }).click()
    await expect(page.getByLabel('项目', { exact: true })).toHaveValue(projectId)
    expect(f.store.list()).toEqual([])
    await page.getByRole('textbox', { name: '任务内容' }).fill('项目内的首次发送')
    await page.getByRole('button', { name: '发送任务' }).click()
    await expect(page.getByLabel('任务状态')).toHaveText('本轮已结束', { timeout: 15000 })
    expect(f.store.managedSessions()[0]?.cwd).toBe(directory)
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByLabel('外观主题').selectOption('dark')
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.setViewportSize({ width: 800, height: 720 })
    await expect(page.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `${evidence}/session-project-dark-800.png`,
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '展开导航' }).click()
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await expect(page.getByLabel('项目', { exact: true })).toHaveValue('')
    await expect(page.getByRole('textbox', { name: '任务内容' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `${evidence}/session-new-dark-narrow.png`,
      animations: 'disabled',
    })
  } finally {
    await f.close()
  }
})

test('SESSION-01 existing provider selection remains configured/unverified and disabled; no config write or external model request', async () => {
  const f = await fixture(true),
    { page } = f.desktop,
    before = readFileSync(f.modelPath),
    external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1') {
      external.push(request.url())
    }
  })
  try {
    await expect(
      page
        .getByLabel('模型', { exact: true })
        .locator('option')
        .filter({ hasText: '已有编码模型' }),
    ).toHaveCount(1)
    await openConfiguration(page)
    await page
      .getByLabel('模型', { exact: true })
      .selectOption({ label: 'existing / 已有编码模型 · 已配置 · 未联网验证' })
    await page.getByRole('textbox', { name: '任务内容' }).fill('保留真实模型选择')
    await expect(page.getByRole('button', { name: '发送任务' })).toBeDisabled()
    await page.reload()
    await expect(page.getByLabel('模型', { exact: true }).locator('option:checked')).toContainText(
      '已有编码模型',
    )
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('保留真实模型选择')
    expect(f.store.list()).toEqual([])
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(readFileSync(f.modelPath)).toEqual(before)
    expect(external).toEqual([])
    // Explicit synthetic source change: selection survives a vanished catalogue entry.
    writeFileSync(f.modelPath, '{"providers":{}}')
    const changedSource = readFileSync(f.modelPath)
    await page.reload()
    await expect(page.getByLabel('模型', { exact: true }).locator('option:checked')).toContainText(
      '所选模型当前不可用',
    )
    await expect(page.getByRole('button', { name: '发送任务' })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('保留真实模型选择')
    expect(readFileSync(f.modelPath)).toEqual(changedSource)
    expect(f.store.list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('SESSION-01 actual SDK error keeps the session and offers explicit retry; a late successful save does not leave settings', async () => {
  const f = await fixture(),
    { page } = f.desktop,
    kernels = f.app.get(KernelService),
    original = kernels.prompt.bind(kernels)
  let first = true
  kernels.prompt = (id, cwd, prompt, options) => {
    const fail = first
    first = false
    return original(id, cwd, { ...prompt, ...(fail ? { fixture: 'error' } : {}) }, options)
  }
  try {
    await page.getByRole('textbox', { name: '任务内容' }).fill('保留失败会话')
    await page.getByRole('button', { name: '发送任务' }).click()
    await expect(page.getByRole('button', { name: '明确重试此任务' })).toBeVisible({
      timeout: 15000,
    })
    const id = firstSessionId(f.store)
    await page.getByRole('button', { name: '明确重试此任务' }).click()
    await expect(page.getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
    expect(f.store.managedSessions()).toHaveLength(1)
    expect(f.store.submissions(id)).toHaveLength(2)
    let release!: () => void
    const released = new Promise<void>((done) => {
      release = done
    })
    let accepted = false
    await page.route('**/api/chat/submit', async (route) => {
      const response = await forward(route)
      expect(response.status()).toBe(202)
      accepted = true
      await released
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    await page.getByRole('textbox', { name: '任务内容' }).fill('迟到保存不抢焦点')
    await page.getByRole('button', { name: '发送任务' }).click()
    await expect.poll(() => accepted).toBe(true)
    await page.getByRole('link', { name: '设置', exact: true }).click()
    release()
    await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
    await expect.poll(() => f.store.managedSessions().length).toBe(2)
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
  } finally {
    kernels.prompt = original
    await f.close()
  }
})

test('INPUT-01 Electron rejects whitespace and composition Enter, preserves line breaks and submits once', async () => {
  const f = await fixture(),
    { page } = f.desktop,
    pane = page.locator('.retained-session:not([hidden])'),
    box = pane.getByRole('textbox', { name: '任务内容' })
  try {
    const rejectWhitespace = async (text: string) => {
      await box.fill(text)
      await expect(pane.getByRole('button', { name: '发送任务' })).toBeDisabled()
      await box.press('Enter')
      expect(f.store.managedSessions()).toHaveLength(0)
    }
    await rejectWhitespace('')
    await rejectWhitespace(' \t\n　')
    await box.fill('输入法候选尚未确认')
    // These are explicit synthetic Chromium key/composition cases. Real Microsoft Pinyin
    // candidate selection is recorded separately by native Windows acceptance.
    await box.dispatchEvent('compositionstart')
    await box.press('Enter')
    await expect(box).toHaveValue('输入法候选尚未确认\n')
    expect(f.store.managedSessions()).toHaveLength(0)
    await box.dispatchEvent('compositionend')
    await box.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    await box.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 })
    expect(f.store.managedSessions()).toHaveLength(0)
    await box.fill('第一行')
    await box.press('Shift+Enter')
    await expect(box).toHaveValue('第一行\n')
    await page.keyboard.insertText('第二行')
    await expect(box).toHaveValue('第一行\n第二行')
    await box.press('Enter')
    await box.press('Enter')
    await expect(pane.getByLabel('任务状态').last()).toHaveText('本轮已结束', {
      timeout: 15000,
    })
    expect(f.store.managedSessions()).toHaveLength(1)
    const id = firstSessionId(f.store)
    expect(f.store.submissions(id).map((row) => row.text)).toEqual(['第一行\n第二行'])
    await expect(box).toHaveValue('')
    await box.press('Enter')
    expect(f.store.submissions(id)).toHaveLength(1)
  } finally {
    await f.close()
  }
})

test('INPUT-01 Electron restores project/model/new draft through navigation and reload without sending another session draft', async () => {
  test.setTimeout(90000)
  const f = await fixture(true),
    { page } = f.desktop,
    pane = page.locator('.retained-session:not([hidden])'),
    box = pane.getByRole('textbox', { name: '任务内容' }),
    before = readFileSync(f.modelPath)
  try {
    const createSession = async (title: string) => {
      await box.fill(title)
      await box.press('Enter')
      await expect(pane.getByLabel('任务状态').last()).toHaveText('本轮已结束', {
        timeout: 15000,
      })
      await pane.getByRole('button', { name: '新会话', exact: true }).click()
    }
    await createSession('INPUT-01 会话甲')
    await createSession('INPUT-01 会话乙')
    const [a, b] = ['INPUT-01 会话甲', 'INPUT-01 会话乙'].map((title) =>
      f.store.managedSessions().find((session) => session.title === title),
    )
    if (!a || !b) {
      throw new Error('Missing INPUT-01 sessions')
    }
    await pane.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('项目名称', { exact: true }).fill('INPUT-01 草稿项目')
    await page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(pane.getByLabel('项目', { exact: true })).not.toHaveValue('')
    const projectId = await pane.getByLabel('项目', { exact: true }).inputValue()
    await openConfiguration(pane)
    await pane.getByLabel('模型', { exact: true }).selectOption({
      label: 'existing / 已有编码模型 · 已配置 · 未联网验证',
    })
    const model = await pane.getByLabel('模型', { exact: true }).inputValue(),
      newText = '新草稿第一行\n新草稿第二行'
    await box.fill(newText)
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(box).toHaveValue('')
    await box.fill('甲会话独立草稿')
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await expect(box).toHaveValue(newText)
    await expect(pane.getByLabel('项目', { exact: true })).toHaveValue(projectId)
    await expect(pane.getByLabel('模型', { exact: true })).toHaveValue(model)
    await box.press('Enter')
    await expect(pane.getByRole('button', { name: '发送任务' })).toBeDisabled()
    expect(f.store.managedSessions()).toHaveLength(2)
    await page.reload()
    await expect(box).toHaveValue(newText)
    await expect(pane.getByLabel('项目', { exact: true })).toHaveValue(projectId)
    await expect(pane.getByLabel('模型', { exact: true })).toHaveValue(model)
    await pane.getByTitle(a.title, { exact: true }).click()
    await expect(box).toHaveValue('甲会话独立草稿')
    await page.reload()
    await expect(box).toHaveValue('甲会话独立草稿')
    await expect(pane.getByLabel('项目', { exact: true })).toHaveValue('')
    await expect(pane.getByLabel('模型', { exact: true }).locator('option:checked')).toContainText(
      '离线验收模型',
    )
    await pane.getByTitle(b.title, { exact: true }).click()
    await expect(box).toHaveValue('')
    await box.fill('只续发乙会话')
    await expect(pane.getByRole('button', { name: '发送任务' })).toBeEnabled()
    await box.press('Enter')
    // Wait for this continuation, rather than accepting the preceding turn's terminal label.
    await expect(pane.getByLabel('任务状态')).toHaveCount(2)
    await expect(pane.getByLabel('任务状态').last()).toHaveText('本轮已结束', {
      timeout: 15000,
    })
    expect(f.store.submissions(a.id)).toHaveLength(1)
    expect(f.store.submissions(b.id).map((row) => row.text)).toEqual([b.title, '只续发乙会话'])
    await page.getByRole('button', { name: '后退', exact: true }).click()
    await expect(box).toHaveValue('甲会话独立草稿')
    expect(readFileSync(f.modelPath)).toEqual(before)
    await page.screenshot({
      path: `${evidence}/input-drafts-project-model.png`,
      animations: 'disabled',
    })
  } finally {
    await f.close()
  }
})
