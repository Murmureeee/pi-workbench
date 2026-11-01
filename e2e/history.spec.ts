import type { Page } from '@playwright/test'

import { fork } from 'node:child_process'
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
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'

const port = 4318,
  evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
test.use({ acceptDownloads: true })
async function routeHistory(page: Page) {
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

test('CORE-06 real local SDK: restart reads exact native history and expands full Unicode content without writes', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-history-'))
  let app = await createApp({ dataDir: directory, port, development: true })
  try {
    const sessionId = randomUUID(),
      text = '完整原文👩‍💻你e\u0301\n'.repeat(3000)
    await app.get(KernelService).prompt(sessionId, directory, { turnId: randomUUID(), text })
    const nativeFile = app.get(KernelService).list()[0]?.sessionFile
    if (!nativeFile) {
      throw new Error('No native session')
    }
    const before = readFileSync(nativeFile)
    await app.close()
    app = await createApp({ dataDir: directory, port, development: true })
    await app.listen(port, '127.0.0.1')
    await routeHistory(page)
    await page.goto(`/?history=${sessionId}`)
    await expect(page.getByLabel('历史载入状态')).toHaveText('本页 2 条消息')
    await expect(page.getByText('OFFLINE_OK', { exact: true })).toHaveCount(1)
    const expand = page.getByRole('button', { name: '读取完整内容', exact: true })
    await expect(expand).toBeVisible()
    await expand.click()
    await expect(page.locator('[data-slot=bubble-content]').first()).toHaveText(text)
    await page.getByRole('button', { name: '收起完整内容' }).click()
    await expect(page.getByRole('button', { name: '继续任务（尚未开放）' })).toBeDisabled()
    expect(app.get(KernelService).list()).toEqual([])
    expect(readFileSync(nativeFile)).toEqual(before)
    await page.screenshot({ path: `${evidence}/history-native.png`, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${evidence}/history-dark-390.png`, animations: 'disabled' })
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('CORE-06 actual hard crash: partial text stays interrupted, records cannot execute and corrupt native bytes download intact', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-crash-'))
  const child = fork(
    new URL('../apps/daemon/test/fixtures/recovery-host.mjs', import.meta.url),
    [directory],
    { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  )
  const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  let app: Awaited<ReturnType<typeof createApp>> | undefined
  try {
    const ready = await new Promise<{ sessionId: string; sessionFile: string }>(
      (resolve, reject) => {
        child.once('message', (value: unknown) => {
          if (
            typeof value !== 'object' ||
            value === null ||
            !('sessionId' in value) ||
            !('sessionFile' in value) ||
            typeof value.sessionId !== 'string' ||
            typeof value.sessionFile !== 'string'
          ) {
            reject(new Error('Invalid crash fixture'))
            return
          }
          resolve({ sessionId: value.sessionId, sessionFile: value.sessionFile })
        })
        child.once('exit', () => reject(new Error('Crash fixture exited before handshake')))
      },
    )
    child.send('crash')
    await exit
    app = await createApp({ dataDir: directory, port, development: true })
    await app.listen(port, '127.0.0.1')
    await routeHistory(page)
    await page.goto(`/?history=${ready.sessionId}`)
    await expect(page.getByText('已中断的部分回复 · 未自动继续', { exact: false })).toBeVisible()
    await expect(page.getByText('OFFLINE_', { exact: true })).toHaveCount(1)
    await expect(page.getByLabel('队列记录')).toContainText('held')
    await expect(page.getByLabel('审批记录')).toContainText('invalidated')
    await expect(page.getByLabel('变更引用')).toContainText('synthetic-ledger:baseline-1')
    await page.getByRole('button', { name: '刷新最新历史' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('历史载入状态')).toHaveText('本页 2 条消息')
    await page.screenshot({ path: `${evidence}/history-interrupted.png`, animations: 'disabled' })
    const corrupt = Buffer.from('{broken-native-record\n')
    appendFileSync(ready.sessionFile, corrupt)
    await page.getByRole('button', { name: '刷新最新历史' }).click()
    await expect(page.getByText('记录诊断 · invalid-record')).toBeVisible()
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出原始记录' }).click()
    const download = await downloadEvent,
      path = await download.path()
    expect(readFileSync(path)).toEqual(corrupt)
    expect(app.get(KernelService).list()).toEqual([])
    await page.screenshot({ path: `${evidence}/history-diagnostic.png`, animations: 'disabled' })
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await exit
    }
    try {
      if (!page.isClosed()) {
        await page.goto('about:blank')
      }
    } finally {
      await app?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

test('CORE-06 synthetic file fixture: newest 100 messages and earlier page have stable nonduplicated identities', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'piw-browser-history-pages-'))
  const app = await createApp({ dataDir: directory, port, development: true })
  try {
    const sessionId = randomUUID(),
      epoch = randomUUID(),
      path = join(directory, 'kernels', sessionId, epoch, 'sessions', 'synthetic.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    app.get(SessionStore).registerRuntime({
      sessionId,
      epoch,
      cwd: directory,
      nativeSessionId: sessionId,
      sessionFile: path,
      source: 'synthetic-ipc-fixture',
    })
    const records = [
      { type: 'session', version: 3, id: sessionId, cwd: directory },
      ...Array.from({ length: 106 }, (_, i) => ({
        type: 'message',
        id: `m${i}`,
        parentId: i ? `m${i - 1}` : null,
        message: { role: 'user', content: `合成消息 ${i}` },
      })),
    ]
    writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
    await app.listen(port, '127.0.0.1')
    await routeHistory(page)
    await page.goto(`/?history=${sessionId}`)
    await expect(page.getByLabel('历史载入状态')).toHaveText('本页 100 条消息')
    await expect(page.getByText('合成消息 6', { exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: '更早的消息', exact: true }).click()
    await expect(page.getByLabel('历史载入状态')).toHaveText('本页 6 条消息')
    await expect(page.getByText('合成消息 0', { exact: true })).toHaveCount(1)
    await expect(page.getByText('合成消息 6', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '刷新最新历史' }).click()
    await expect(page.getByLabel('历史载入状态')).toHaveText('本页 100 条消息')
  } finally {
    await page.goto('about:blank')
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
