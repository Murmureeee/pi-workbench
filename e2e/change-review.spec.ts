/* oxlint-disable no-await-in-loop -- Approvals, theme captures and file selections share one actual Electron window. */
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { ChangeProvenanceService } from '../apps/daemon/dist/modules/changes/change-provenance.service.js'
import { ChangeService } from '../apps/daemon/dist/modules/changes/change.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function required<T>(v: T | undefined): T {
  if (v === undefined) {
    throw new Error('Historical review fixture value missing')
  }
  return v
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'piw-review-ui-')),
    cwd = join(root, '中文工作目录'),
    other = join(root, '独立目录'),
    dataDir = join(root, 'data')
  mkdirSync(cwd)
  mkdirSync(other)
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(cwd, 'tracked.txt'), 'baseline\n')
  writeFileSync(join(cwd, 'deleted.txt'), 'delete me\n')
  writeFileSync(join(cwd, 'old-name.txt'), 'rename unique\n')
  let app = await createApp({
      dataDir,
      port: 4318,
      development: true,
      resourceLimits: { kernels: 4, modelTasks: 3 },
    }),
    sends = 0
  const opened = await app.get(WorkspaceService).open(cwd),
    independent = await app.get(WorkspaceService).open(other)
  if (!opened.ok || !independent.ok) {
    throw new Error('Review workspace rejected')
  }
  const project = await app
      .get(ProjectService)
      .create({ requestId: randomUUID(), name: '修改审查项目', workspaceId: opened.workspace.id }),
    second = await app.get(ProjectService).create({
      requestId: randomUUID(),
      name: '独立后台项目',
      workspaceId: independent.workspace.id,
    })
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
          fixture: input.text.includes('工具链')
            ? 'change-chain'
            : input.text.includes('保持')
              ? 'hold'
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
    other,
    get app() {
      return app
    },
    get page() {
      return desktop.page
    },
    get kernels() {
      return app.get(KernelService)
    },
    get changes() {
      return app.get(ChangeService)
    },
    sends: () => sends,
    send: async (text: string, useIndependent = false) => {
      const previous = new Set(
          app
            .get(SessionStore)
            .managedSessions()
            .map((row) => row.id),
        ),
        button = desktop.page.getByRole('button', { name: '新会话', exact: true }).first()
      if (!(await button.isVisible())) {
        await desktop.page.getByRole('button', { name: '展开导航', exact: true }).click()
      }
      await button.click()
      await desktop.page
        .getByLabel('项目', { exact: true })
        .selectOption(useIndependent ? second.id : project.id)
      await desktop.page.getByRole('textbox', { name: '任务内容' }).fill(text)
      await expect(
        desktop.page.getByRole('button', { name: '发送任务', exact: true }),
      ).toBeEnabled()
      await desktop.page.getByRole('button', { name: '发送任务', exact: true }).click()
      await expect
        .poll(() => app.get(SessionStore).managedSessions().length)
        .toBe(previous.size + 1)
      return required(
        app
          .get(SessionStore)
          .managedSessions()
          .find((row) => !previous.has(row.id)),
      )
    },
    ready: async (id: string) =>
      expect
        .poll(() => app.get(ChangeService).history(id).rounds[0]?.baseline.status, {
          timeout: 20000,
        })
        .toBe('ready'),
    open: async (id: string) => desktop.page.goto(`http://127.0.0.1:5173/?session=${id}`),
    versions: async () => {
      const region = desktop.page.getByRole('region', { name: '轮次文件版本', exact: true })
      await region.getByRole('button', { name: '查看轮次文件版本', exact: true }).click()
      return region
    },
    review: async () => {
      const region = desktop.page.getByRole('region', { name: '轮次文件版本', exact: true })
      const trigger = region.getByRole('button', { name: '审查本轮文件差异', exact: true }).first()
      await trigger.click()
      return trigger
    },
    stop: async (id: string) => {
      const round = required(app.get(ChangeService).history(id).rounds[0])
      await app.get(KernelService).abort(id, round.turnId)
      await expect
        .poll(() => app.get(ChangeService).history(id).rounds[0]?.outcome, { timeout: 20000 })
        .not.toBe('active')
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

test('CHANGE-02/03 Electron links actual SDK write/edit source to historical Diff and preserves the selected turn after read-only restart', async () => {
  test.setTimeout(120000)
  const f = await setup()
  try {
    const session = await f.send('工具链来源审查')
    for (let i = 0; i < 2; i++) {
      await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
      await f.page.getByRole('button', { name: '明确允许本次不可回滚执行', exact: true }).click()
    }
    const region = f.page.getByRole('region', { name: '轮次文件版本', exact: true })
    await expect(region).toContainText('收尾已保存', { timeout: 20000 })
    await f.versions()
    await region.getByRole('button', { name: '核对修改来源', exact: true }).click()
    const source = region.getByRole('article', { name: '文件来源 tracked.txt', exact: true })
    await expect(source).toContainText('工具观察一致')
    await expect(source).toContainText('change-1')
    await expect(source).toContainText('change-2')
    const trigger = await f.review()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    const diff = f.page.getByRole('region', { name: '所选文件历史Diff', exact: true })
    await expect(diff).toContainText('+1 −1')
    await expect(diff).toContainText('second')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'CURRENT_MUST_NOT_REPLACE_HISTORY\n')
    await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await expect(diff).toContainText('second')
    await expect(diff).not.toContainText('CURRENT_MUST_NOT_REPLACE_HISTORY')
    await expect(f.page.getByRole('button', { name: '预检整文件回滚', exact: true })).toBeVisible()
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe(
      'CURRENT_MUST_NOT_REPLACE_HISTORY\n',
    )
    const record = required(f.changes.history(session.id).rounds[0]),
      observations = f.app.get(ChangeProvenanceService).observations(record.turnId)
    expect(observations).toHaveLength(2)
    await f.restart()
    await f.open(session.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await expect(
      f.page.getByRole('region', { name: '所选文件历史Diff', exact: true }),
    ).toContainText('second')
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toEqual([])
    expect(f.app.get(ChangeProvenanceService).observations(record.turnId)).toEqual(observations)
  } finally {
    await f.close()
  }
})

test('CHANGE-03 Electron shows actual non-Git external file types, redaction and accessible light/dark narrow drawers with focus return', async () => {
  test.setTimeout(120000)
  const f = await setup()
  try {
    const session = await f.send('保持外部审查')
    await f.ready(session.id)
    writeFileSync(
      join(f.cwd, 'tracked.txt'),
      'external new\napi_key=fixture-diff-secret\n<img src=x onerror=alert(1)>\n',
    )
    unlinkSync(join(f.cwd, 'deleted.txt'))
    renameSync(join(f.cwd, 'old-name.txt'), join(f.cwd, '新名称.txt'))
    writeFileSync(join(f.cwd, 'binary.bin'), Buffer.from([0, 255]))
    writeFileSync(join(f.cwd, 'added.txt'), 'new\n')
    await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存', {
      timeout: 20000,
    })
    await f.versions()
    const trigger = await f.review()
    await expect(f.page.getByRole('list', { name: '轮次文件列表' })).toContainText('tracked.txt')
    await f.page.getByRole('button', { name: '审查文件 新名称.txt', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText(
      '字节完全相同',
    )
    await f.page.getByRole('button', { name: '审查文件 binary.bin', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText('行数未知')
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    const diff = f.page.getByRole('region', { name: '所选文件历史Diff' })
    await expect(diff).toContainText('«redacted»')
    await expect(diff).not.toContainText('fixture-diff-secret')
    expect(await diff.locator('img,script,a').count()).toBe(0)
    for (const colorScheme of ['light', 'dark'] as const) {
      await f.page.setViewportSize({ width: 802, height: 761 })
      await f.page.emulateMedia({ colorScheme })
      await expect(f.page.getByRole('dialog', { name: '轮次修改审查' })).toBeVisible()
      await expect(diff).toContainText('external new')
      await f.page.screenshot({ path: join(evidence, `change-review-${colorScheme}-narrow.png`) })
      expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    await f.page.keyboard.press('Escape')
    await expect(f.page.getByRole('dialog', { name: '轮次修改审查' })).toHaveCount(0)
    await expect(trigger).toBeFocused()
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toContain('fixture-diff-secret')
  } finally {
    await f.close()
  }
})

test('CHANGE-02/03 Electron late file response and closed or hidden review cannot replace another session or stop an independent background SDK', async () => {
  test.setTimeout(120000)
  const f = await setup()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const a = await f.send('保持第一轮')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'FIRST_TURN_ONLY\n')
    await f.stop(a.id)
    await f.versions()
    await f.review()
    let entered = false
    await f.page.route('**/api/changes/diff?**', async (route) => {
      const url = new URL(route.request().url())
      const response = await route.fetch({
        url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      expect(response.status()).toBe(200)
      entered = true
      await gate
      await route.fulfill({ response })
    })
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await expect.poll(() => entered).toBe(true)
    await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    const b = await f.send('保持独立后台', true)
    await f.ready(b.id)
    const kernel = required(f.kernels.list().find((k) => k.sessionId === b.id))
    const c = await f.send('空轮次')
    await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存', {
      timeout: 20000,
    })
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.versions()
    await f.review()
    await expect(f.page.getByText('本轮无文件变更', { exact: true })).toBeVisible()
    await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toHaveCount(0)
    expect(f.kernels.list().find((k) => k.sessionId === b.id)).toMatchObject({
      pid: kernel.pid,
      epoch: kernel.epoch,
      state: 'running',
    })
    expect(f.changes.history(c.id).rounds[0]?.turnId).not.toBe(
      f.changes.history(a.id).rounds[0]?.turnId,
    )
    await f.stop(b.id)
  } finally {
    release()
    await f.close()
  }
})

test('CHANGE-03 Electron list and Diff read failures preserve target and recover explicitly without replay', async () => {
  test.setTimeout(90000)
  const f = await setup()
  try {
    const a = await f.send('保持失败恢复')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'RECOVERED_DIFF\n')
    await f.stop(a.id)
    let failList = true,
      failDiff = true
    await f.page.route('**/api/changes/review?**', async (route) => {
      if (failList) {
        await route.fulfill({ status: 503, json: { message: '合成列表故障' } })
      } else {
        await route.fallback()
      }
    })
    await f.page.route('**/api/changes/diff?**', async (route) => {
      if (failDiff) {
        await route.fulfill({ status: 503, json: { message: '合成Diff故障' } })
      } else {
        await route.fallback()
      }
    })
    await f.versions()
    await f.review()
    await expect(f.page.getByText('历史文件列表未同步', { exact: true })).toBeVisible()
    failList = false
    await f.page.getByRole('button', { name: '重试历史文件列表', exact: true }).click()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await expect(f.page.getByText('历史Diff未同步', { exact: true })).toBeVisible()
    failDiff = false
    await f.page.getByRole('button', { name: '重试历史Diff', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText(
      'RECOVERED_DIFF',
    )
    expect(f.sends()).toBe(1)
    expect(f.changes.history(a.id).rounds).toHaveLength(1)
  } finally {
    await f.close()
  }
})
