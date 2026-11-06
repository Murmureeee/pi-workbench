import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { TrustService } from '../apps/daemon/dist/modules/security/trust.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function nothingToRestore() {}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-recovery-ui-')),
    cwd = join(directory, '中文项目'),
    dataDir = join(directory, 'data')
  mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true })
  const marker = join(directory, 'MUST_NOT_EXECUTE')
  writeFileSync(join(cwd, 'AGENTS.md'), 'Untrusted text; no automatic loading.')
  writeFileSync(
    join(cwd, '.pi', 'extensions', 'unsafe.mjs'),
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe'); export default () => {}`,
  )
  writeFileSync(
    join(cwd, '.pi', 'settings.json'),
    JSON.stringify({
      packages: ['npm:must-not-install'],
      extensions: ['./.pi/extensions/unsafe.mjs'],
    }),
  )
  let app = await createApp({ dataDir, port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const opened = await app.get(WorkspaceService).open(cwd)
  assert(opened.ok)
  const project = await app
    .get(ProjectService)
    .create({ requestId: randomUUID(), name: '恢复验收项目', workspaceId: opened.workspace.id })
  let desktop = await launchWorkspaceDesktop(directory, app)
  const wire = async () => {
    await desktop.context.addInitScript(() => {
      const Native = window.WebSocket
      window.WebSocket = class extends Native {
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
  }
  await wire()
  const errors: string[] = []
  desktop.page.on('pageerror', (error) => errors.push(error.message))
  return {
    cwd,
    directory,
    dataDir,
    project,
    marker,
    workspaceId: opened.workspace.id,
    errors,
    get app() {
      return app
    },
    get desktop() {
      return desktop
    },
    restart: async () => {
      await desktop.close()
      await app.close()
      app = await createApp({ dataDir, port: 4318, development: true })
      await app.listen(4318, '127.0.0.1')
      desktop = await launchWorkspaceDesktop(directory, app)
      desktop.page.on('pageerror', (error) => errors.push(error.message))
      await wire()
    },
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
const pane = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.desktop.page.locator('.retained-session:not([hidden])')
async function send(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  await pane(f).getByRole('textbox', { name: '任务内容' }).fill(text)
  await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeEnabled()
  await pane(f).getByRole('button', { name: '发送任务' }).click()
  await expect(pane(f).getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
  return f.app
    .get(SessionStore)
    .managedSessions()
    .find((row) => row.title === text)!
}

test('WS-07 Electron untrusted resource notice, moved-directory recovery, physical-only relocation, draft/history preservation and light/dark narrow layouts', async () => {
  const f = await fixture()
  try {
    const page = f.desktop.page
    await pane(f).getByLabel('项目', { exact: true }).selectOption(f.project.id)
    const first = await send(f, '目录恢复与历史')
    await expect(pane(f).getByRole('region', { name: '工作区信任与恢复' })).toContainText('未确认')
    expect(f.app.get(TrustService).inspect().records).toEqual([])
    expect(existsSync(f.marker)).toBe(false)
    await f.app.get(KernelService).destroy(first.id)
    const native = f.app.get(SessionStore).resumeRuntime(first.id, f.cwd)!,
      before = readFileSync(native.sessionFile)
    const moved = join(f.directory, '移动后中文目录')
    renameSync(f.cwd, moved)
    await pane(f).getByRole('textbox', { name: '任务内容' }).fill('失效期间保留的中文草稿')
    await expect(pane(f).getByText('执行目录不可用，发送已阻止', { exact: true })).toBeVisible()
    await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeDisabled()
    await expect(pane(f).getByText('OFFLINE_OK', { exact: true })).toBeVisible()
    await pane(f).getByRole('button', { name: '重新定位同一目录' }).click()
    const dialog = page.getByRole('dialog', { name: '重新定位工作区' })
    await expect(dialog.getByLabel('新的目录位置')).toHaveValue(f.cwd)
    await dialog.getByLabel('新的目录位置').fill(f.directory)
    await dialog.getByRole('button', { name: '保存位置', exact: true }).click()
    await expect(dialog).toContainText('另一个目录')
    await expect(dialog.getByLabel('新的目录位置')).toHaveValue(f.directory)
    await f.desktop.setSelection(moved)
    await dialog.getByRole('button', { name: '选择新的文件夹' }).click()
    expect(f.app.get(WorkspaceService).lookup(f.workspaceId)?.canonicalPath).toBe(f.cwd)
    await dialog.getByRole('button', { name: '保存位置', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(pane(f).getByRole('region', { name: '工作区信任与恢复' })).toContainText(
      '工作区已重新定位',
    )
    await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue(
      '失效期间保留的中文草稿',
    )
    expect(f.app.get(SessionStore).managedSessions()[0]?.cwd).toBe(f.cwd)
    expect(readFileSync(native.sessionFile)).toEqual(before)
    expect(f.app.get(KernelService).list()).toEqual([])
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.screenshot({
      path: `${evidence}/workspace-recovery-light.png`,
      animations: 'disabled',
    })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 760 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `${evidence}/obs-02-directory-recovery-dark-800.png`,
      animations: 'disabled',
    })
    await expect(pane(f).getByRole('button', { name: '重新校验执行目录' })).toBeInViewport()
    await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeInViewport({ ratio: 1 })
    await expect(pane(f).getByRole('region', { name: '当前运行阶段', exact: true })).toBeInViewport(
      {
        ratio: 1,
      },
    )
    const viewport = await pane(f)
      .getByLabel('受管会话消息')
      .evaluate((element) => ({
        height: element.clientHeight,
        top: element.scrollTop,
        total: element.scrollHeight,
      }))
    expect(viewport.height).toBeGreaterThanOrEqual(120)
    // Resizing retains the reading anchor. Explicitly scroll to inspect the older reply.
    await pane(f).getByText('OFFLINE_OK', { exact: true }).scrollIntoViewIfNeeded()
    await expect(pane(f).getByText('OFFLINE_OK', { exact: true })).toBeInViewport({ ratio: 1 })
    await page.screenshot({
      path: `${evidence}/workspace-recovery-dark-800.png`,
      animations: 'disabled',
    })
    renameSync(moved, f.cwd)
    await pane(f).getByRole('button', { name: '重新定位同一目录' }).click()
    await page.getByLabel('新的目录位置').fill(f.cwd)
    await page.getByRole('button', { name: '保存位置', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const check = pane(f).getByRole('button', { name: '重新校验执行目录' })
    await check.focus()
    await check.press('Enter')
    await expect(pane(f).getByRole('status').filter({ hasText: '目录检查通过' })).toBeVisible()
    expect(f.app.get(SessionStore).submissions(first.id)).toHaveLength(1)
    expect(f.app.get(KernelService).list()).toEqual([])
    await pane(f).getByRole('button', { name: '发送任务' }).click()
    await expect(pane(f).getByLabel('任务状态')).toHaveCount(2)
    await expect(pane(f).getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
    expect(f.app.get(SessionStore).submissions(first.id)).toHaveLength(2)
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-07 actual Electron background task stops on real OS directory access loss; recovery and full restart never replay', async () => {
  const f = await fixture()
  let restore = nothingToRestore
  try {
    const kernels = f.app.get(KernelService),
      original = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, input, options) =>
      original(id, cwd, { ...input, fixture: 'hold' }, options)
    await pane(f).getByLabel('项目', { exact: true }).selectOption(f.project.id)
    await pane(f).getByRole('textbox', { name: '任务内容' }).fill('后台目录失效任务')
    await pane(f).getByRole('button', { name: '发送任务' }).click()
    await expect.poll(() => f.app.get(SessionStore).managedSessions().length).toBe(1)
    const session = f.app.get(SessionStore).managedSessions()[0]
    assert(session)
    await expect
      .poll(() => f.app.get(EventService).snapshot(session.id)?.turns.at(-1)?.text, {
        timeout: 15000,
      })
      .toContain('OFFLINE_')
    await pane(f).getByRole('button', { name: '新会话', exact: true }).click()
    await pane(f).getByRole('textbox', { name: '任务内容' }).fill('另一会话草稿不受影响')
    if (process.platform === 'win32') {
      const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
        encoding: 'utf8',
        windowsHide: true,
      }).match(/S-1-[\d-]+/)?.[0]
      assert(sid)
      restore = () => {
        execFileSync('icacls', [f.cwd, '/remove:d', `*${sid}`], {
          windowsHide: true,
          stdio: 'pipe',
        })
      }
      execFileSync('icacls', [f.cwd, '/deny', `*${sid}:(RD)`], { windowsHide: true, stdio: 'pipe' })
    } else {
      const moved = join(f.directory, 'unmounted')
      renameSync(f.cwd, moved)
      restore = () => renameSync(moved, f.cwd)
    }
    await expect
      .poll(() => f.app.get(SessionStore).submissions(session.id)[0]?.status, { timeout: 15000 })
      .toBe('interrupted')
    expect(kernels.list()).toEqual([])
    await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue(
      '另一会话草稿不受影响',
    )
    await pane(f).getByTitle(session.title, { exact: true }).click()
    await expect(pane(f).getByLabel('任务状态').last()).toHaveText('已中断 · 未自动重发')
    await expect(pane(f).getByText(/本轮已中断，请核对历史/)).toBeVisible()
    restore()
    restore = nothingToRestore
    await pane(f).getByRole('button', { name: '重新校验执行目录' }).click()
    await expect(pane(f).getByRole('status').filter({ hasText: '目录检查通过' })).toBeVisible()
    const history = f.app.get(SessionStore).resumeRuntime(session.id, f.cwd)!,
      before = readFileSync(history.sessionFile)
    expect(f.app.get(SessionStore).submissions(session.id)).toHaveLength(1)
    expect(kernels.list()).toEqual([])
    await f.restart()
    expect(f.app.get(KernelService).list()).toEqual([])
    await pane(f).getByTitle(session.title, { exact: true }).click()
    await expect(pane(f).getByLabel('任务状态').last()).toHaveText('已中断 · 未自动重发')
    expect(readFileSync(history.sessionFile)).toEqual(before)
    expect(f.app.get(SessionStore).submissions(session.id)).toHaveLength(1)
    expect(f.errors).toEqual([])
  } finally {
    restore()
    await f.close()
  }
})

test('WS-07 Electron failed and late recovery checks keep drafts, isolate targets and allow explicit retry', async () => {
  const f = await fixture()
  let release!: () => void
  try {
    await pane(f).getByLabel('项目', { exact: true }).selectOption(f.project.id)
    const session = await send(f, '恢复失败隔离')
    await pane(f).getByRole('textbox', { name: '任务内容' }).fill('原会话草稿')
    await f.desktop.context.route(
      '**/api/workspaces/recover',
      (route) => route.fulfill({ status: 503, json: { message: '明确故障夹具：校验暂不可用' } }),
      { times: 1 },
    )
    await pane(f).getByRole('button', { name: '重新校验执行目录' }).click()
    await expect(pane(f).getByRole('status').filter({ hasText: '明确故障夹具' })).toBeVisible()
    await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue('原会话草稿')
    await pane(f).getByRole('button', { name: '重新校验执行目录' }).click()
    await expect(pane(f).getByRole('status').filter({ hasText: '目录检查通过' })).toBeVisible()
    let intercepted = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.desktop.context.route(
      '**/api/workspaces/recover',
      async (route) => {
        intercepted = true
        await gate
        await route.fulfill({ status: 503, json: { message: '迟到旧目标故障' } })
      },
      { times: 1 },
    )
    await pane(f).getByRole('button', { name: '重新校验执行目录' }).click()
    await expect.poll(() => intercepted).toBe(true)
    await pane(f).getByRole('button', { name: '新会话', exact: true }).click()
    await pane(f).getByRole('textbox', { name: '任务内容' }).fill('新目标草稿')
    release()
    await expect(pane(f).getByText('迟到旧目标故障', { exact: true })).toHaveCount(0)
    await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue('新目标草稿')
    await pane(f).getByTitle(session.title, { exact: true }).click()
    await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue('原会话草稿')
    expect(f.app.get(SessionStore).submissions(session.id)).toHaveLength(1)
    expect(f.errors).toEqual([])
  } finally {
    release?.()
    await f.close()
  }
})

test('WS-07 Electron unavailable new-draft directory blocks sending but permits explicit replacement and project changes without creating a session', async () => {
  const f = await fixture()
  try {
    await pane(f).getByText('执行目录：独立目录', { exact: true }).click()
    await pane(f).getByLabel('目录绝对路径（可选）').fill(f.cwd)
    await pane(f).getByRole('button', { name: '校验此目录' }).click()
    await expect(pane(f).getByText(`执行目录：${f.cwd}`, { exact: true })).toBeVisible()
    await pane(f).getByRole('textbox', { name: '任务内容' }).fill('失效目录草稿仍可明确改选')
    renameSync(f.cwd, join(f.directory, 'draft-moved'))
    await expect(pane(f).getByText('执行目录不可用，发送已阻止', { exact: true })).toBeVisible()
    await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeDisabled()
    await pane(f).getByRole('button', { name: '使用独立目录', exact: true }).click()
    await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeEnabled()
    await pane(f).getByLabel('项目', { exact: true }).selectOption(f.project.id)
    await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeDisabled()
    await pane(f).getByLabel('项目', { exact: true }).selectOption('')
    await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeEnabled()
    await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue(
      '失效目录草稿仍可明确改选',
    )
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(f.app.get(WorkspaceService).lookup(f.workspaceId)?.canonicalPath).toBe(f.cwd)
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})
