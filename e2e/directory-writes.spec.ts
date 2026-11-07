import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../apps/daemon/dist/modules/security/approval.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { DirectoryWriteService } from '../apps/daemon/dist/modules/workspaces/directory-write.service.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Live directory fixture value missing')
  }
  return value
}
async function setup() {
  mkdirSync(evidence, { recursive: true })
  const directory = mkdtempSync(join(tmpdir(), 'piw-directory-ui-')),
    a = join(directory, '共享中文目录'),
    b = join(directory, '独立中文目录')
  mkdirSync(a)
  mkdirSync(b)
  writeFileSync(join(a, 'external.txt'), 'before')
  let app = await createApp({
      dataDir: join(directory, 'data'),
      port: 4318,
      development: true,
      resourceLimits: { kernels: 4, modelTasks: 3 },
    }),
    requests = 0
  const projects = await Promise.all(
    (
      [
        [a, '共享目录项目'],
        [b, '独立目录项目'],
      ] as const
    ).map(async ([path, name]) => {
      const workspace = await app.get(WorkspaceService).open(path)
      if (!workspace.ok) {
        throw new Error('Directory fixture registration failed')
      }
      return app
        .get(ProjectService)
        .create({ requestId: randomUUID(), name, workspaceId: workspace.workspace.id })
    }),
  )
  const wire = () => {
    const kernels = app.get(KernelService),
      prompt = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, input, options) => {
      requests++
      return prompt(
        id,
        cwd,
        { ...input, fixture: input.text.includes('写入') ? 'approval-write' : 'hold' },
        options,
      )
    }
  }
  wire()
  await app.listen(4318, '127.0.0.1')
  let desktop = await launchWorkspaceDesktop(directory, app)
  return {
    directory,
    a,
    b,
    projects,
    get app() {
      return app
    },
    get page() {
      return desktop.page
    },
    get kernels() {
      return app.get(KernelService)
    },
    get store() {
      return app.get(SessionStore)
    },
    get writes() {
      return app.get(DirectoryWriteService)
    },
    requests: () => requests,
    send: async (text: string, project = required(projects[0]).id) => {
      const page = desktop.page,
        prior = app.get(SessionStore).managedSessions().length
      if (!(await page.getByRole('button', { name: '新会话', exact: true }).first().isVisible())) {
        await page.getByRole('button', { name: '展开导航', exact: true }).click()
      }
      await page.getByRole('button', { name: '新会话', exact: true }).first().click()
      await page.getByLabel('项目', { exact: true }).selectOption(project)
      await page.getByRole('textbox', { name: '任务内容' }).fill(text)
      await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: '发送任务', exact: true }).click()
      await expect
        .poll(() => app.get(SessionStore).managedSessions().length, { timeout: 20000 })
        .toBe(prior + 1)
      return required(
        app
          .get(SessionStore)
          .managedSessions()
          .find((s) => s.title === text),
      )
    },
    restart: async () => {
      await desktop.close()
      await app.close()
      app = await createApp({
        dataDir: join(directory, 'data'),
        port: 4318,
        development: true,
        resourceLimits: { kernels: 4, modelTasks: 3 },
      })
      requests = 0
      wire()
      await app.listen(4318, '127.0.0.1')
      desktop = await launchWorkspaceDesktop(directory, app)
    },
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

test('WS-04 Electron shows actual competing owner and queue, cancels without dispatch and keeps independent directories running', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    const first = await f.send('持续运行共享甲')
    await expect
      .poll(() => f.kernels.list().find((k) => k.sessionId === first.id)?.state)
      .toBe('running')
    const kernel = required(f.kernels.list().find((k) => k.sessionId === first.id))
    const second = await f.send('共享乙等待目录'),
      region = f.page.getByRole('region', { name: '目录写入与来源', exact: true })
    await expect(region).toContainText('等待目录 · 第 1 位')
    await region.getByRole('button', { name: '查看目录占用与来源' }).click()
    await expect(region).toContainText(first.id)
    await expect(region).toContainText(required(f.store.submissions(first.id)[0]).turnId)
    await expect(region).toContainText('尚未发送本轮')
    expect(f.kernels.list().some((k) => k.sessionId === second.id)).toBe(false)
    await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(second.id)[0]?.status).toBe('aborted')
    const independent = await f.send('独立目录持续丙', required(f.projects[1]).id)
    await expect.poll(() => f.kernels.resources().modelTasks).toBe(2)
    expect(f.kernels.list().find((k) => k.sessionId === first.id)).toMatchObject({
      pid: kernel.pid,
      epoch: kernel.epoch,
      cwd: kernel.cwd,
      state: 'running',
    })
    await f.page.getByRole('textbox', { name: '任务内容' }).fill('当前独立草稿保持')
    await f.page.getByRole('link', { name: '设置', exact: true }).click()
    expect(f.kernels.resources().modelTasks).toBe(2)
    await f.page.getByRole('link', { name: '返回工作台', exact: true }).click()
    await expect(f.page.getByRole('textbox', { name: '任务内容' })).toHaveValue('当前独立草稿保持')
    await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(independent.id)[0]?.status).toBe('aborted')
    await f.page.goto(`http://127.0.0.1:5173/?session=${first.id}`)
    await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(first.id)[0]?.status).toBe('aborted')
  } finally {
    await f.close()
  }
})

test('WS-04 Electron pending approval keeps occupancy; real approved write hands off only after settled and records uncertain provenance', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    const first = await f.send('共享甲明确写入')
    await expect.poll(() => f.app.get(ApprovalService).list().length).toBe(1)
    const next = await f.send('共享乙等甲收尾'),
      region = f.page.getByRole('region', { name: '目录写入与来源', exact: true })
    await expect(region).toContainText('等待目录 · 第 1 位')
    await f.page.goto(`http://127.0.0.1:5173/?session=${first.id}`)
    await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
    await f.page
      .getByRole('alertdialog', { name: '允许本次不可回滚调用？' })
      .getByRole('button', { name: '明确允许本次不可回滚执行' })
      .click()
    await expect.poll(() => f.store.submissions(first.id)[0]?.status).toBe('completed')
    expect(readFileSync(join(f.a, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
    await expect
      .poll(() => f.kernels.list().find((k) => k.sessionId === next.id)?.state)
      .toBe('running')
    await expect(f.page.getByRole('region', { name: '目录写入与来源', exact: true })).toContainText(
      '发现文件变化 · 来源不确定',
    )
    expect(f.writes.latest(first.id)).toMatchObject({
      automaticRollback: false,
      changedPaths: ['APPROVED.txt'],
    })
  } finally {
    await f.close()
  }
})

test('WS-04 Electron external file edit, stale read failure, target isolation and 800px light/dark retain stop and composer', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    const first = await f.send('外部修改观察甲')
    await expect.poll(() => f.kernels.list()[0]?.state).toBe('running')
    writeFileSync(join(f.a, 'external.txt'), 'actual external fixture edit')
    const region = f.page.getByRole('region', { name: '目录写入与来源', exact: true })
    await expect(region).toContainText('发现文件变化 · 来源不确定', { timeout: 10000 })
    await expect(region).toContainText('external.txt')
    await region.getByRole('button', { name: '查看目录占用与来源' }).click()
    await expect(region).toContainText('不能自动回滚')
    const path = '**/api/workspaces/write-status?**'
    await f.page.route(path, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"explicit status failure fixture"}',
      }),
    )
    await expect(region).toContainText('目录占用待同步')
    await expect(region).not.toContainText('目录当前空闲')
    await f.page.unroute(path)
    await region.getByRole('button', { name: '重新核对目录占用' }).click()
    await expect(region).toContainText('发现文件变化 · 来源不确定')
    const checkTheme = async (colorScheme: 'light' | 'dark') => {
      await f.page.emulateMedia({ colorScheme })
      await f.page.setViewportSize({ width: 800, height: 760 })
      await region.scrollIntoViewIfNeeded()
      await expect(f.page.getByRole('button', { name: '停止本轮', exact: true })).toBeInViewport({
        ratio: 1,
      })
      await expect(f.page.getByRole('textbox', { name: '任务内容' })).toBeInViewport({ ratio: 1 })
      expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await f.page.screenshot({ path: `${evidence}/ws04-${colorScheme}-800.png` })
    }
    await checkTheme('light')
    await checkTheme('dark')
    const other = await f.send('独立来源乙', required(f.projects[1]).id)
    await expect(region).not.toContainText('external.txt')
    await expect.poll(() => f.kernels.resources().modelTasks).toBe(2)
    expect(f.store.submissions(first.id)[0]?.status).toBe('executing')
    expect(other.cwd).toBe(f.b)
  } finally {
    await f.close()
  }
})

test('WS-04 full Electron restart preserves original provenance and SDK history with zero sends, kernels or authority', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    const first = await f.send('重启保留来源记录')
    await expect.poll(() => f.kernels.list()[0]?.state).toBe('running')
    writeFileSync(join(f.a, 'external.txt'), 'external edit retained after restart')
    await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.store.submissions(first.id)[0]?.status).toBe('aborted')
    await expect.poll(() => f.writes.latest(first.id)?.changedPaths).toContain('external.txt')
    const file = required(f.kernels.list()[0]?.sessionFile),
      bytes = readFileSync(file)
    await f.restart()
    await f.page.goto(`http://127.0.0.1:5173/?session=${first.id}`)
    const region = f.page.getByRole('region', { name: '目录写入与来源', exact: true })
    await expect(region).toContainText('目录当前空闲')
    await expect(region).toContainText('来源不确定')
    expect(f.requests()).toBe(0)
    expect(f.kernels.list()).toEqual([])
    expect(f.kernels.resources().queue).toEqual([])
    expect(f.app.get(ApprovalService).list()).toEqual([])
    expect(readFileSync(file)).toEqual(bytes)
  } finally {
    await f.close()
  }
})
