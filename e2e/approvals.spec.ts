import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../apps/daemon/dist/modules/security/approval.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

/** Only the model response is a local HTTP fixture. Pending state, final invocation,
 * execution, file effects and history all pass through the installed SDK and daemon. */
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-approval-ui-'))
  const app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
  await app.listen(4318, '127.0.0.1')
  const kernels = app.get(KernelService),
    original = kernels.prompt.bind(kernels),
    store = app.get(SessionStore),
    approvals = app.get(ApprovalService),
    events = app.get(EventService)
  let prompts = 0
  kernels.prompt = (id, cwd, input, options) => {
    prompts++
    return original(
      id,
      cwd,
      { ...input, fixture: input.text.includes('命令') ? 'approval-command' : 'approval-write' },
      options,
    )
  }
  const desktop = await launchWorkspaceDesktop(directory, app),
    { page } = desktop
  const send = async (text: string) => {
    await page.getByRole('textbox', { name: '任务内容' }).fill(text)
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => approvals.list().length, { timeout: 20000 }).toBe(1)
    const pending = approvals.list()[0],
      session = store.managedSessions().find((s) => s.id === pending?.sessionId)
    if (!pending || !session) {
      throw new Error('Missing actual pending invocation')
    }
    await expect(page.getByRole('region', { name: '执行前审批' })).toBeVisible()
    return { pending, session }
  }
  return {
    desktop,
    app,
    kernels,
    store,
    events,
    approvals,
    send,
    prompts: () => prompts,
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

test('SEC-02 actual Electron preserves an unexecuted pending call across settings, reload and connection loss; explicit irreversible confirmation executes once', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    const { session, pending } = await f.send('等待中文文件审批'),
      target = join(session.cwd, 'APPROVED.txt'),
      region = page.getByRole('region', { name: '执行前审批' })
    expect(existsSync(target)).toBe(false)
    const pid = f.kernels.list()[0]?.pid
    await expect(
      page
        .getByRole('region', { name: '最近无项目会话', exact: true })
        .locator(`[data-library-session="${session.id}"]`),
    ).toContainText('待审批')
    expect(f.kernels.resources().kernels[0]?.waitingApproval).toBe(true)
    await page.getByRole('link', { name: '设置', exact: true }).click()
    expect(existsSync(target)).toBe(false)
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    await expect(region).toContainText('无倒计时')
    await page.reload()
    await expect(region).toContainText(pending.tool)
    const path = '**/api/chat/approvals'
    await page.route(path, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"离线夹具断线"}',
      }),
    )
    await expect(region).toContainText('审批状态待同步')
    await expect(region.getByRole('button', { name: '允许本次…', exact: true })).toBeDisabled()
    expect(existsSync(target)).toBe(false)
    await page.unroute(path)
    await region.getByRole('button', { name: '刷新审批状态' }).click()
    await expect(region.getByRole('button', { name: '允许本次…', exact: true })).toBeEnabled()
    expect(f.kernels.list()[0]?.pid).toBe(pid)
    await region.getByRole('button', { name: '查看最终参数与调用身份' }).click()
    await expect(region).toContainText(pending.risk.digest)
    await region.getByRole('button', { name: '允许本次…', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: '允许本次不可回滚调用？' })
    await expect(dialog.getByRole('button', { name: '返回核对' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    expect(existsSync(target)).toBe(false)
    await region.getByRole('button', { name: '允许本次…', exact: true }).click()
    await dialog.getByRole('button', { name: '明确允许本次不可回滚执行' }).click()
    await expect
      .poll(() => f.store.submissions(session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    expect(readFileSync(target, 'utf8')).toBe('SEC02_APPROVED_ONCE')
    await expect(region).not.toBeVisible()
    const file = f.kernels.list()[0]?.sessionFile
    if (!file) {
      throw new Error('Missing SDK history')
    }
    const before = readFileSync(file)
    await page.reload()
    await expect(page.locator('.retained-session:not([hidden])')).toContainText(
      'GUARD_FIXTURE_DONE',
    )
    expect(f.prompts()).toBe(1)
    expect(readFileSync(file)).toEqual(before)
  } finally {
    await f.close()
  }
})

test('SEC-02 actual Electron preserves a failed decision reason; background refusal does not steal draft focus or run an alternate tool', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    const { session, pending } = await f.send('拒绝中文写入'),
      region = page.getByRole('region', { name: '执行前审批' }),
      input = region.getByRole('textbox', { name: '决定说明（可选）' }),
      url = '**/api/chat/approvals/*/decision'
    await input.fill('保留说明：请先核对目录')
    await page.route(url, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"夹具保存失败"}',
      }),
    )
    await region.getByRole('button', { name: '拒绝本次调用', exact: true }).click()
    await expect(region).toContainText('未自动重新提交决定')
    await expect(input).toHaveValue('保留说明：请先核对目录')
    expect(f.approvals.list()).toHaveLength(1)
    expect(existsSync(join(session.cwd, 'APPROVED.txt'))).toBe(false)
    await page.unroute(url)
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    const draft = page.getByRole('textbox', { name: '任务内容' })
    await draft.fill('后台审批不打断这份草稿')
    await draft.focus()
    // Explicit second host decision, separately from the paired multi-client API race test.
    f.approvals.decide(
      pending.id,
      {
        sessionId: pending.sessionId,
        epoch: pending.epoch,
        turnId: pending.turnId,
        digest: pending.risk.digest,
        policyVersion: pending.risk.policyVersion,
        action: 'deny',
        acceptIrreversible: false,
        reason: '后台人工拒绝',
      },
      'second-host-fixture',
    )
    await expect
      .poll(() => f.store.submissions(session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    await expect(draft).toBeFocused()
    await expect(draft).toHaveValue('后台审批不打断这份草稿')
    await page
      .getByRole('region', { name: '最近无项目会话', exact: true })
      .locator(`[data-library-session="${session.id}"] .session-library-select`)
      .click()
    await expect(region).not.toBeVisible()
    const card = page.locator('.retained-session:not([hidden]) [data-tool-id="guard-0"]')
    await card.getByRole('button').click()
    await expect(card).toContainText('后台人工拒绝')
    expect(existsSync(join(session.cwd, 'APPROVED.txt'))).toBe(false)
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})

test('SEC-02 actual Electron cancellation and stopped approvals never run; a new explicit command decision works with light/dark narrow keyboard controls', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    const cancelled = await f.send('取消文件调用'),
      region = page.getByRole('region', { name: '执行前审批' })
    await region.getByRole('button', { name: '取消本次调用', exact: true }).click()
    await expect
      .poll(() => f.store.submissions(cancelled.session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    expect(existsSync(join(cancelled.session.cwd, 'APPROVED.txt'))).toBe(false)
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    const stopped = await f.send('停止文件调用')
    await page.getByRole('button', { name: '停止本轮', exact: true }).click()
    await expect.poll(() => f.approvals.list().length).toBe(0)
    await expect
      .poll(() => f.store.submissions(stopped.session.id)[0]?.status, { timeout: 20000 })
      .not.toBe('executing')
    expect(existsSync(join(stopped.session.cwd, 'APPROVED.txt'))).toBe(false)
    await page.getByRole('button', { name: '新会话', exact: true }).click()
    const command = await f.send('本地命令单次审批')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(region).toContainText('powershell')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 760 })
    const allow = region.getByRole('button', { name: '允许本次…', exact: true })
    await allow.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: '允许本次不可回滚调用？' })
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'sec02-command-confirm-dark-800.png') })
    await dialog.getByRole('button', { name: '明确允许本次不可回滚执行' }).click()
    await expect
      .poll(() => f.store.submissions(command.session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    expect(readFileSync(join(command.session.cwd, 'APPROVAL-COMMAND.txt'), 'utf8')).toContain(
      'SEC02_COMMAND_ONCE',
    )
    expect(f.prompts()).toBe(3)
  } finally {
    await f.close()
  }
})
