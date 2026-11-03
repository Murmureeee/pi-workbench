import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function fixture(directory = mkdtempSync(join(tmpdir(), 'piw-project-ui-')), seed = true) {
  const first = join(directory, '中文 Alpha'),
    second = join(directory, 'Beta')
  if (seed) {
    mkdirSync(first)
    mkdirSync(second)
    writeFileSync(join(first, '保留.txt'), '项目整理不移动或删除此文件')
  }
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const projects = app.get(ProjectService),
    workspaces = app.get(WorkspaceService)
  if (seed) {
    const wa = await workspaces.open(first)
    assert(wa.ok)
    await projects.create({
      requestId: randomUUID(),
      name: '同名项目',
      workspaceId: wa.workspace.id,
    })
    await projects.create({ requestId: randomUUID(), name: '同名项目', workspaceId: null })
  }
  const desktop = await launchWorkspaceDesktop(directory, app),
    { page } = desktop
  await page.setViewportSize({ width: 1920, height: 1080 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const view = () => page.locator('[data-session-view]:visible')
  const row = (id: string) => view().locator(`[data-project-id="${id}"]`)
  const menu = async (id: string, name: string) => {
    await row(id)
      .getByRole('button', { name: /^项目菜单：/ })
      .click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeEnabled()
  return {
    app,
    projects,
    workspaces,
    desktop,
    page,
    view,
    row,
    menu,
    directory,
    first,
    second,
    errors,
    close: async (remove = true) => {
      await desktop.close()
      await app.close()
      if (remove) {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
}

test('WS-06 Electron disambiguates same-name projects, searches name/path/ID, expands groups and keeps global/project attribution explicit', async () => {
  const f = await fixture()
  try {
    const [a, b] = f.projects.list()
    assert(a && b)
    await expect(f.row(a.id)).toContainText(f.first)
    await expect(f.row(b.id)).toContainText('独立目录')
    await expect(f.row(a.id)).toContainText(a.id.slice(0, 8))
    const search = f.page.getByLabel('检索项目名称或路径', { exact: true })
    await search.fill('ALPHA')
    await expect(f.view().locator('[data-project-id]')).toHaveCount(1)
    await search.fill(b.id.slice(0, 8))
    await expect(f.row(b.id)).toBeVisible()
    await search.fill('没有结果')
    await expect(f.page.getByText('没有匹配的项目。')).toBeVisible()
    await f.page.getByRole('button', { name: '清除检索' }).click()
    await f
      .row(a.id)
      .getByRole('button', { name: /^项目新会话：/ })
      .click()
    await expect(f.page.getByLabel('项目', { exact: true })).toHaveValue(a.id)
    await f.page
      .getByRole('textbox', { name: '任务内容', exact: true })
      .fill('分组中的真实本地会话')
    await f.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect(f.page.getByLabel('发送反馈')).toContainText('任务已保存')
    const session = f.app.get(SessionStore).managedSessions()[0]
    assert(session)
    await expect(f.row(a.id).locator(`[data-library-session="${session.id}"]`)).toBeVisible()
    await f.row(a.id).getByRole('button', { name: a.name, exact: true }).click()
    await expect(f.row(a.id).locator(`[data-library-session="${session.id}"]`)).toBeHidden()
    await f.row(a.id).getByRole('button', { name: a.name, exact: true }).press('Enter')
    await expect(f.row(a.id).locator(`[data-library-session="${session.id}"]`)).toBeVisible()
    await f.page.getByRole('button', { name: '新会话', exact: true }).click()
    await expect(f.page.getByLabel('项目', { exact: true })).toHaveValue('')
    expect(f.app.get(SessionStore).managedSessions()).toHaveLength(1)
    expect(f.errors).toEqual([])
    await f.page.screenshot({ path: `${evidence}/ws-06-project-groups-light-1920.png` })
  } finally {
    await f.close()
  }
})

test('WS-06 Electron editor prefill/cancel, Unicode/IME, storage failure recovery, concurrent revisions and invalid default retain input', async () => {
  const f = await fixture()
  try {
    const recentBefore = f.workspaces.recent()
    const a = f.projects.list()[0]
    assert(a)
    const name = f.page.getByLabel('项目名称', { exact: true }),
      path = f.page.getByLabel('默认目录（可选）', { exact: true })
    await f.menu(a.id, '编辑项目')
    await expect(name).toHaveValue(a.name)
    await expect(name).toBeFocused()
    await name.fill('取消的编辑')
    await name.press('Escape')
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    expect(f.projects.list()[0]?.name).toBe(a.name)
    await f.menu(a.id, '编辑项目')
    await name.fill('🧪'.repeat(81))
    await expect(f.page.getByRole('button', { name: '保存项目', exact: true })).toBeDisabled()
    await name.fill('🧪'.repeat(80))
    await expect(f.page.getByRole('button', { name: '保存项目', exact: true })).toBeEnabled()
    await name.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
    )
    await name.press('Enter')
    await name.press('Escape')
    await expect(f.page.getByRole('dialog')).toBeVisible()
    expect(f.projects.list()[0]?.name).toBe(a.name)
    await name.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
    )
    await path.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
    )
    await path.press('Escape')
    await path.press('Enter')
    await expect(f.page.getByRole('dialog')).toBeVisible()
    expect(f.projects.list()[0]?.name).toBe(a.name)
    await path.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
    )
    await name.fill('保存失败后保留')
    const db = f.app.get(WorkspaceDatabase).sqlite
    db.exec(
      "CREATE TRIGGER deny_project_ui BEFORE UPDATE OF name ON projects BEGIN SELECT RAISE(ABORT,'UI fixture failure'); END",
    )
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByText('保存结果待核对', { exact: true })).toBeVisible()
    await expect(name).toHaveValue('保存失败后保留')
    db.exec('DROP TRIGGER deny_project_ui')
    await name.press('Enter')
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    expect(f.workspaces.recent()).toEqual(recentBefore)
    await f.menu(a.id, '编辑项目')
    await name.fill('我的冲突编辑')
    const current = f.projects.list().find((item) => item.id === a.id)
    assert(current)
    await f.projects.edit(a.id, {
      action: 'edit',
      name: '另一个客户端',
      workspaceId: current.workspaceId,
      expectedRevision: current.revision,
    })
    await expect(f.page.getByText('项目已更新', { exact: true })).toBeVisible()
    await expect(name).toHaveValue('我的冲突编辑')
    await f.page.getByRole('button', { name: '使用最新版本继续编辑' }).click()
    await path.fill(join(f.directory, 'missing'))
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByText('项目未保存', { exact: true })).toBeVisible()
    await expect(name).toHaveValue('我的冲突编辑')
    await path.fill(f.first)
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    await expect(f.row(a.id)).toContainText('我的冲突编辑')
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-06 Electron creates optional validated default and reconciles uncertain create identity without duplicates', async () => {
  const f = await fixture()
  try {
    await f.page.getByRole('button', { name: '新建项目', exact: true }).click()
    await f.page.getByLabel('项目名称', { exact: true }).fill('新目录项目')
    await f.desktop.setSelection(f.second)
    await f.page.getByRole('button', { name: '选择默认文件夹' }).click()
    await expect(f.page.getByLabel('默认目录（可选）', { exact: true })).toHaveValue(f.second)
    expect(f.projects.list()).toHaveLength(2)
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    const project = f.projects.list().find((item) => item.name === '新目录项目')
    assert(project)
    await expect(f.page.getByLabel('项目', { exact: true })).toHaveValue(project.id)
    expect(project.directory).toBe(f.second)
    await f.page.getByRole('button', { name: '新会话', exact: true }).click()
    await f.page.getByRole('button', { name: '新建项目', exact: true }).click()
    await f.page.getByLabel('项目名称', { exact: true }).fill('原请求只创建一次')
    await f.desktop.context.route(
      '**/api/chat/projects',
      async (route) => {
        await route.fetch({
          url: 'http://127.0.0.1:4318/api/chat/projects',
          headers: {
            ...route.request().headers(),
            host: '127.0.0.1:4318',
            origin: 'http://127.0.0.1:5173',
          },
        })
        await route.abort('connectionfailed')
      },
      { times: 1 },
    )
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByRole('button', { name: '核对原创建' })).toBeVisible()
    await expect(f.page.getByLabel('项目名称', { exact: true })).toHaveValue('原请求只创建一次')
    await expect(f.page.getByRole('button', { name: '保存项目', exact: true })).toBeDisabled()
    await f.page.getByRole('button', { name: '核对原创建' }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    expect(f.projects.list().filter((item) => item.name === '原请求只创建一次')).toHaveLength(1)
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(f.app.get(SessionStore).list()).toEqual([])
    expect(f.errors).toEqual([])
    expect(readFileSync(join(f.first, '保留.txt'), 'utf8')).toContain('不移动或删除')
  } finally {
    await f.close()
  }
})

test('WS-06 Electron persists create/rename/pin/manual order across a complete restart and supports dark/narrow layouts', async () => {
  const f = await fixture()
  let restarted: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    const [a, b] = f.projects.list()
    assert(a && b)
    await f.menu(b.id, '编辑项目')
    await f.page.getByLabel('项目名称', { exact: true }).fill('重新命名项目')
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    await expect(f.row(b.id)).toContainText('重新命名项目')
    await f.menu(b.id, '上移项目')
    await expect
      .poll(() =>
        f
          .view()
          .locator('[data-project-id]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-project-id')),
          ),
      )
      .toEqual([b.id, a.id])
    await f.menu(a.id, '置顶项目')
    await expect
      .poll(() =>
        f
          .view()
          .locator('[data-project-id]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-project-id')),
          ),
      )
      .toEqual([a.id, b.id])
    await f.page.getByRole('button', { name: '新建项目', exact: true }).click()
    await f.page.getByLabel('项目名称', { exact: true }).fill('末尾新增项目')
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    await expect(f.view().locator('[data-project-id]')).toHaveCount(3)
    const before = f.projects.list(),
      c = before[2]
    assert(c)
    await f.menu(c.id, '上移项目')
    await expect
      .poll(() =>
        f
          .view()
          .locator('[data-project-id]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-project-id')),
          ),
      )
      .toEqual([a.id, c.id, b.id])
    const saved = f.projects.list()
    await f.desktop.page.emulateMedia({ colorScheme: 'dark' })
    await f.page.screenshot({ path: `${evidence}/ws-06-project-groups-dark-1920.png` })
    await f.page.setViewportSize({ width: 800, height: 800 })
    await f.page.getByRole('button', { name: '展开导航', exact: true }).click()
    await expect(f.row(a.id)).toBeVisible()
    await f.page.screenshot({ path: `${evidence}/ws-06-project-groups-dark-800.png` })
    await f.close(false)
    restarted = await fixture(f.directory, false)
    expect(restarted.projects.list()).toEqual(saved)
    await expect(restarted.row(b.id)).toContainText('重新命名项目')
    await expect
      .poll(() =>
        restarted!
          .view()
          .locator('[data-project-id]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-project-id')),
          ),
      )
      .toEqual([a.id, c.id, b.id])
    expect(restarted.app.get(KernelService).list()).toEqual([])
    expect(restarted.errors).toEqual([])
  } finally {
    if (restarted) {
      await restarted.close()
    } else {
      await f.close()
    }
  }
})

test('WS-06 Electron default edits and confirmed removal preserve the running SDK PID/cwd, files and session, including continuation after detach', async () => {
  const f = await fixture()
  try {
    const a = f.projects.list()[0]
    assert(a)
    const kernels = f.app.get(KernelService),
      store = f.app.get(SessionStore)
    const original = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, prompt, options) =>
      original(
        id,
        cwd,
        { ...prompt, ...(prompt.text === '保留后台进程' ? { fixture: 'hold' as const } : {}) },
        options,
      )
    await f
      .row(a.id)
      .getByRole('button', { name: /^项目新会话：/ })
      .click()
    await f.page.getByRole('textbox', { name: '任务内容', exact: true }).fill('保留后台进程')
    await f.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => kernels.list()[0]?.state).toBe('running')
    const kernel = kernels.list()[0],
      session = store.managedSessions()[0]
    assert(kernel?.pid && session)
    await f.page.getByRole('button', { name: '新会话', exact: true }).click()
    await f.menu(a.id, '编辑项目')
    await f.page.getByLabel('默认目录（可选）', { exact: true }).fill(f.second)
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect(f.page.getByRole('dialog')).toHaveCount(0)
    expect(kernels.list()[0]?.pid).toBe(kernel.pid)
    expect(store.managedSessions()[0]?.cwd).toBe(f.first)
    await f
      .row(a.id)
      .getByRole('button', { name: /^项目新会话：/ })
      .click()
    await expect(f.page.getByLabel('项目', { exact: true })).toHaveValue(a.id)
    await expect(f.view().locator('.thread-identity')).toContainText(f.second)
    await f.menu(a.id, '移除项目分组')
    await expect(f.page.getByRole('alertdialog')).toContainText('后台任务继续运行')
    await f.page.getByRole('button', { name: '取消', exact: true }).click()
    expect(kernels.list()[0]?.pid).toBe(kernel.pid)
    expect(f.projects.list()).toHaveLength(2)
    await f.menu(a.id, '移除项目分组')
    await f.page.getByRole('button', { name: '确认移除分组' }).click()
    await expect(f.page.getByRole('alertdialog')).toHaveCount(0)
    await expect(f.row(a.id)).toHaveCount(0)
    await expect(f.view().locator(`[data-library-session="${session.id}"]`)).toContainText('运行中')
    expect(kernels.list()[0]?.pid).toBe(kernel.pid)
    expect(kernels.list()[0]?.state).toBe('running')
    expect(store.managedSessions()[0]?.configuration).toEqual({
      ...session.configuration,
      projectId: null,
    })
    await f
      .view()
      .locator(`[data-library-session="${session.id}"]`)
      .getByRole('button', { name: /^保留后台进程/ })
      .click()
    await expect(f.page.getByLabel('项目', { exact: true })).toHaveValue('')
    await expect(f.view().locator('.thread-identity')).toContainText(f.first)
    const task = store.submissions(session.id)[0]
    assert(task)
    await kernels.abort(session.id, task.turnId)
    await expect.poll(() => store.submissions(session.id)[0]?.status).toBe('aborted')
    await f.page.getByRole('textbox', { name: '任务内容', exact: true }).fill('移除项目后的续发')
    await f.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => store.submissions(session.id).at(-1)?.status).toBe('completed')
    expect(store.managedSessions()).toHaveLength(1)
    expect(store.managedSessions()[0]?.cwd).toBe(f.first)
    expect(readFileSync(join(f.first, '保留.txt'), 'utf8')).toContain('不移动或删除')
    expect(f.errors).toEqual([])
  } finally {
    await f.close()
  }
})

test('WS-06 Electron late project creation after unmount refreshes metadata without selecting a newer draft', async () => {
  const f = await fixture()
  let release: (() => void) | undefined
  try {
    const released = new Promise<void>((done) => {
      release = done
    })
    let accepted = false
    await f.desktop.context.route(
      '**/api/chat/projects',
      async (route) => {
        const response = await route.fetch({
          url: 'http://127.0.0.1:4318/api/chat/projects',
          headers: {
            ...route.request().headers(),
            host: '127.0.0.1:4318',
            origin: 'http://127.0.0.1:5173',
          },
        })
        accepted = response.ok()
        await released
        await route.fulfill({ response }).catch(() => undefined)
      },
      { times: 1 },
    )
    await f.page.getByRole('textbox', { name: '任务内容', exact: true }).fill('保留当前草稿')
    await f.page.getByRole('button', { name: '新建项目', exact: true }).click()
    await f.page.getByLabel('项目名称', { exact: true }).fill('迟到的新项目')
    await f.page.getByRole('button', { name: '保存项目', exact: true }).click()
    await expect.poll(() => accepted).toBe(true)
    await f.page.goto('http://127.0.0.1:5173/?settings=appearance')
    release?.()
    await expect(f.page.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
    await f.page.goto('http://127.0.0.1:5173/')
    await expect(f.page.getByLabel('项目', { exact: true })).toHaveValue('')
    await expect(f.page.getByRole('textbox', { name: '任务内容', exact: true })).toHaveValue(
      '保留当前草稿',
    )
    expect(f.projects.list().filter((row) => row.name === '迟到的新项目')).toHaveLength(1)
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    expect(f.errors).toEqual([])
  } finally {
    release?.()
    await f.close()
  }
})
