import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect } from '@playwright/test'

import { createApp } from '../../apps/daemon/dist/bootstrap/app.js'
import { ChangeService } from '../../apps/daemon/dist/modules/changes/change.service.js'
import { KernelService } from '../../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../../apps/daemon/dist/modules/sessions/session.store.js'
import { ProjectService } from '../../apps/daemon/dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../../apps/daemon/dist/modules/workspaces/workspace.service.js'
import { launchWorkspaceDesktop } from './desktop.js'
import { openConfiguration, openVersions } from './workbench.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function required<T>(v: T | undefined): T {
  if (v === undefined) {
    throw new Error('Historical review fixture value missing')
  }
  return v
}
export async function setupChanges(
  ledgerCapacityBytes?: number,
  externalShell = false,
  unloadFixture = false,
) {
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
      ledgerCapacityBytes,
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
          fixture: input.text.includes('范围写入')
            ? 'approval-write'
            : input.text.includes('范围命令')
              ? 'approval-command'
              : input.text.includes('环境上下文')
                ? 'trust-context'
                : input.text.includes('工具链')
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
  let desktop = await launchWorkspaceDesktop(root, app, externalShell, unloadFixture)
  return {
    root,
    cwd,
    other,
    get app(): Awaited<ReturnType<typeof createApp>> {
      return app
    },
    get page() {
      return desktop.page
    },
    get desktop() {
      return desktop
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
      await openConfiguration(desktop.page)
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
      await openVersions(region)
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
      app = await createApp({ dataDir, port: 4318, development: true, ledgerCapacityBytes })
      sends = 0
      wire()
      await app.listen(4318, '127.0.0.1')
      desktop = await launchWorkspaceDesktop(root, app, externalShell, unloadFixture)
    },
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
