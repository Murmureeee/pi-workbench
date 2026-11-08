/* oxlint-disable no-await-in-loop -- Theme screenshots operate sequentially on the same Electron window. */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { ChangeService } from '../apps/daemon/dist/modules/changes/change.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../apps/daemon/dist/modules/security/approval.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Snapshot Electron fixture object missing')
  }
  return value
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'piw-change-ui-')),
    cwd = join(root, '中文快照目录'),
    dataDir = join(root, 'data')
  mkdirSync(cwd)
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(cwd, 'original.txt'), 'BEFORE_REAL_SDK')
  let app = await createApp({
      dataDir,
      port: 4318,
      development: true,
      resourceLimits: { kernels: 4, modelTasks: 3 },
    }),
    sends = 0
  const opened = await app.get(WorkspaceService).open(cwd)
  if (!opened.ok) {
    throw new Error('Snapshot workspace fixture rejected')
  }
  const project = await app
    .get(ProjectService)
    .create({ requestId: randomUUID(), name: '文件版本项目', workspaceId: opened.workspace.id })
  const wire = () => {
    const kernels = app.get(KernelService),
      prompt = kernels.prompt.bind(kernels)
    kernels.prompt = (id, path, input, options) => {
      sends++
      return prompt(
        id,
        path,
        {
          ...input,
          fixture: input.text.includes('写入')
            ? 'approval-write'
            : input.text.includes('保持')
              ? 'hold'
              : input.text.includes('失败')
                ? 'error'
                : 'reply',
        },
        options,
      )
    }
  }
  wire()
  await app.listen(4318, '127.0.0.1')
  let desktop = await launchWorkspaceDesktop(root, app)
  return {
    root,
    cwd,
    get page() {
      return desktop.page
    },
    get app() {
      return app
    },
    get changes() {
      return app.get(ChangeService)
    },
    get kernels() {
      return app.get(KernelService)
    },
    sends: () => sends,
    send: async (text: string) => {
      const before = new Set(
        app
          .get(SessionStore)
          .managedSessions()
          .map((row) => row.id),
      )
      const button = desktop.page.getByRole('button', { name: '新会话', exact: true }).first()
      if (!(await button.isVisible())) {
        await desktop.page.getByRole('button', { name: '展开导航', exact: true }).click()
      }
      await button.click()
      await desktop.page.getByLabel('项目', { exact: true }).selectOption(project.id)
      await desktop.page.getByRole('textbox', { name: '任务内容' }).fill(text)
      await expect(
        desktop.page.getByRole('button', { name: '发送任务', exact: true }),
      ).toBeEnabled()
      await desktop.page.getByRole('button', { name: '发送任务', exact: true }).click()
      await expect.poll(() => app.get(SessionStore).managedSessions().length).toBe(before.size + 1)
      return required(
        app
          .get(SessionStore)
          .managedSessions()
          .find((row) => !before.has(row.id)),
      )
    },
    open: async (id: string) => {
      await desktop.page.goto(`http://127.0.0.1:5173/?session=${id}`)
    },
    restart: async () => {
      await desktop.close()
      await app.close()
      app = await createApp({ dataDir, port: 4318, development: true })
      sends = 0
      wire()
      await app.listen(4318, '127.0.0.1')
      desktop = await launchWorkspaceDesktop(root, app)
    },
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

test('CHANGE-01 Electron shows actual baseline and final references without mutating files, retains versions after same-profile restart', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    const session = await f.send('保存文件版本')
    const region = f.page.getByRole('region', { name: '轮次文件版本', exact: true })
    await expect(region).toContainText('基线已保存')
    await expect(region).toContainText('收尾已保存')
    await region.getByRole('button', { name: '查看轮次文件版本', exact: true }).click()
    const record = required(f.changes.history(session.id).rounds[0])
    await expect(region).toContainText(required(record.baseline.reference ?? undefined))
    await expect(region).toContainText('来源不确定')
    await expect(region).toContainText('来源不确定时须单独确认覆盖，禁止自动回滚')
    await expect(
      region.getByRole('button', { name: '查看持久回滚记录', exact: true }),
    ).toBeVisible()
    expect(readFileSync(join(f.cwd, 'original.txt'), 'utf8')).toBe('BEFORE_REAL_SDK')
    expect(
      (await f.changes.readVersion(record.turnId, 'baseline', 'original.txt'))?.toString(),
    ).toBe('BEFORE_REAL_SDK')
    await f.restart()
    await f.open(session.id)
    await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存')
    expect(f.changes.history(session.id).rounds[0]?.baseline.reference).toBe(
      record.baseline.reference,
    )
    expect(f.kernels.list()).toEqual([])
    expect(f.sends()).toBe(0)
    expect(f.app.get(ApprovalService).list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('CHANGE-01 Electron baseline failure is visible before explicit one-shot irreversible approval; cancel leaves actual files unchanged', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'large.bin'), Buffer.alloc(5 * 1024 * 1024 + 1))
    const first = await f.send('写入失败基线')
    const region = f.page.getByRole('region', { name: '轮次文件版本' })
    await expect(region).toContainText('基线保存失败')
    await region.getByRole('button', { name: '查看轮次文件版本' }).click()
    await expect(region).toContainText('写入暂停')
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    await f.page.getByRole('button', { name: '取消本次调用', exact: true }).click()
    await expect.poll(() => f.changes.history(first.id).rounds[0]?.outcome).toBe('completed')
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    await f.send('写入单次明确确认')
    await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
    await expect(f.page.getByRole('alertdialog')).toContainText('本次调用及外部副作用不保证可回滚')
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    await f.page.getByRole('button', { name: '明确允许本次不可回滚执行', exact: true }).click()
    await expect.poll(() => existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(true)
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
  } finally {
    await f.close()
  }
})

test('CHANGE-01 Electron queued cancellation creates no version, background round retains PID and captures external mixed files on stop', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    const first = await f.send('保持后台文件版本')
    await expect
      .poll(() => f.kernels.list().find((k) => k.sessionId === first.id)?.state)
      .toBe('running')
    const kernel = required(f.kernels.list().find((k) => k.sessionId === first.id))
    const second = await f.send('排队文件版本')
    const region = f.page.getByRole('region', { name: '轮次文件版本' })
    await expect(region).toContainText('尚无轮次文件版本')
    expect(f.changes.history(second.id).rounds).toEqual([])
    await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
    expect(f.kernels.list().find((k) => k.sessionId === first.id)?.pid).toBe(kernel.pid)
    writeFileSync(join(f.cwd, 'original.txt'), 'EXTERNAL_MIXED_WHILE_BACKGROUND')
    await f.open(first.id)
    await expect(region).toContainText('基线已保存')
    await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect(region).toContainText('本轮已中止')
    await expect(region).toContainText('收尾已保存')
    await region.getByRole('button', { name: '查看轮次文件版本' }).click()
    await expect(region).toContainText('来源不确定')
    const record = required(f.changes.history(first.id).rounds[0])
    expect((await f.changes.readVersion(record.turnId, 'final', 'original.txt'))?.toString()).toBe(
      'EXTERNAL_MIXED_WHILE_BACKGROUND',
    )
    expect(f.changes.history(second.id).rounds).toEqual([])
  } finally {
    await f.close()
  }
})

test('CHANGE-01 Electron read failure recovers and saved outcome is legible in light/dark narrow windows', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    await f.send('失败轮次文件版本')
    const region = f.page.getByRole('region', { name: '轮次文件版本' })
    await expect(region).toContainText('本轮失败')
    let fail = true
    await f.page.route('**/api/changes/rounds?**', async (route) => {
      if (fail) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '明确合成 HTTP 读取失败夹具' }),
        })
      } else {
        await route.fallback()
      }
    })
    await expect(region).toContainText('文件版本待同步')
    await region.getByRole('button', { name: '查看轮次文件版本' }).click()
    await expect(region).toContainText('现场与任务保留')
    fail = false
    await region.getByRole('button', { name: '刷新文件版本' }).click()
    await expect(region).toContainText('收尾已保存')
    await f.page.setViewportSize({ width: 802, height: 761 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme })
      await expect(region).toContainText('写入前基线：已保存')
      await region.scrollIntoViewIfNeeded()
      await f.page.screenshot({ path: join(evidence, `change01-${colorScheme}-narrow.png`) })
      expect(
        await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    }
  } finally {
    await f.close()
  }
})
