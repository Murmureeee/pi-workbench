import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../apps/daemon/dist/modules/security/approval.service.js'
import { SessionGrantService } from '../apps/daemon/dist/modules/security/session-grant.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Required live Electron fixture object missing')
  }
  return value
}
async function setup() {
  mkdirSync(evidence, { recursive: true })
  const directory = mkdtempSync(join(tmpdir(), 'piw-grant-ui-'))
  let app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true }),
    prompts = 0
  const wire = () => {
    const kernels = app.get(KernelService),
      original = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, input, options) => {
      prompts++
      return original(
        id,
        cwd,
        {
          ...input,
          fixture: input.text.includes('边界')
            ? 'approval-boundary'
            : input.text.includes('高危')
              ? 'guard-denied'
              : input.text.includes('命令')
                ? 'approval-running'
                : 'approval-write',
        },
        options,
      )
    }
  }
  await app.listen(4318, '127.0.0.1')
  wire()
  let desktop = await launchWorkspaceDesktop(directory, app)
  const f = {
    get app() {
      return app
    },
    get desktop() {
      return desktop
    },
    get grants() {
      return app.get(SessionGrantService)
    },
    get approvals() {
      return app.get(ApprovalService)
    },
    get kernels() {
      return app.get(KernelService)
    },
    get store() {
      return app.get(SessionStore)
    },
    prompts: () => prompts,
    send: async (text: string) => {
      const page = desktop.page
      await page.getByRole('textbox', { name: '任务内容' }).fill(text)
      await page.getByRole('button', { name: '发送任务', exact: true }).click()
      await expect.poll(() => f.approvals.list().length, { timeout: 20000 }).toBeGreaterThan(0)
      const p = required(f.approvals.list()[0]),
        session = required(f.store.managedSessions().find((s) => s.id === p.sessionId))
      await expect(page.locator(`[data-approval-id="${p.id}"]`)).toBeVisible()
      return { p, session }
    },
    grant: async () => {
      const page = desktop.page
      await page.getByRole('button', { name: '授权此会话相同参数…', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: '授予此会话相同参数的授权？' })
      await expect(dialog.getByRole('button', { name: '返回核对' })).toBeFocused()
      await dialog.getByRole('button', { name: '明确授予授权并允许本次不可回滚执行' }).click()
      await expect(page.getByRole('region', { name: '执行前审批' })).not.toBeVisible()
      await expect(page.getByRole('button', { name: /^会话授权 · [1-9]/ })).toBeVisible()
    },
    restart: async () => {
      await desktop.close()
      await app.close()
      app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
      await app.listen(4318, '127.0.0.1')
      prompts = 0
      wire()
      desktop = await launchWorkspaceDesktop(directory, app)
    },
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
  return f
}

test('SEC-10 actual Electron uncertain redirection is one-shot only, discloses real cwd/network limits and preserves pending work across settings', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    const { p, session } = await f.send('命令边界：只核对，不执行'),
      region = page.getByRole('region', { name: '执行前审批' })
    expect(p.risk.level).toBe('L3')
    expect(p.sessionPermission.eligible).toBe(false)
    await expect(region).toContainText(session.cwd)
    await expect(region).toContainText('网络目标未验证')
    await expect(region).toContainText('没有 OS 网络沙箱')
    await expect(region).toContainText('附加根目录授权未开放')
    await expect(region.getByRole('button', { name: '授权此会话相同参数…' })).toHaveCount(0)
    expect(() =>
      f.approvals.decide(
        p.id,
        {
          sessionId: p.sessionId,
          epoch: p.epoch,
          turnId: p.turnId,
          digest: p.risk.digest,
          policyVersion: p.risk.policyVersion,
          action: 'allow-session',
          reason: 'forged reusable command request',
          acceptIrreversible: true,
        },
        'desktop-fixture',
      ),
    ).toThrow('单次')
    await page.getByRole('textbox', { name: '任务内容' }).fill('返回后保留的中文草稿')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    expect(f.approvals.list()).toHaveLength(1)
    const pid = f.kernels.list()[0]?.pid
    await page.getByRole('link', { name: '返回工作台', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue(
      '返回后保留的中文草稿',
    )
    expect(f.kernels.list()[0]?.pid).toBe(pid)
    await region.getByRole('button', { name: '允许本次…', exact: true }).click()
    const confirm = page.getByRole('alertdialog', { name: '允许本次不可回滚调用？' })
    await expect(confirm).toContainText('Write-Output SEC10_CONTROL > MUST-NOT-EXIST')
    await expect(confirm.getByRole('button', { name: '返回核对' })).toBeFocused()
    await page.keyboard.press('Escape')
    expect(f.approvals.list()).toHaveLength(1)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 800, height: 760 })
    await region.getByRole('button', { name: '取消本次调用', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${evidence}/sec-10-command-dark-narrow.png` })
    await page.emulateMedia({ colorScheme: 'light' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await region.getByRole('button', { name: '取消本次调用', exact: true }).click()
    await expect(region).not.toBeVisible()
    await expect
      .poll(() => f.store.submissions(session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    expect(f.grants.list().grants).toHaveLength(0)
    expect(existsSync(join(session.cwd, 'MUST-NOT-EXIST'))).toBe(false)
    expect(f.prompts()).toBe(1)
  } finally {
    await f.close()
  }
})
test('SEC-03 actual Electron explicit grant scope, failed save/escape, exact reuse consent and individual/all revoke', async () => {
  test.setTimeout(90000)
  const f = await setup(),
    { page } = f.desktop
  try {
    const { session } = await f.send('授权中文文件'),
      target = join(session.cwd, 'APPROVED.txt')
    await page.getByRole('button', { name: '授权此会话相同参数…' }).click()
    const confirm = page.getByRole('alertdialog', { name: '授予此会话相同参数的授权？' })
    await expect(confirm).toContainText('完整最终参数')
    await page.keyboard.press('Escape')
    expect(f.grants.list().grants).toHaveLength(0)
    expect(existsSync(target)).toBe(false)
    await page.getByRole('button', { name: '授权此会话相同参数…' }).click()
    const path = '**/api/chat/approvals/*/decision'
    await page.route(path, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"message":"夹具授权保存失败"}',
      }),
    )
    await confirm.getByRole('button', { name: '明确授予授权并允许本次不可回滚执行' }).click()
    await expect(confirm).toContainText('夹具授权保存失败')
    expect(f.grants.list().grants).toHaveLength(0)
    expect(existsSync(target)).toBe(false)
    await page.unroute(path)
    await confirm.getByRole('button', { name: '明确授予授权并允许本次不可回滚执行' }).click()
    await expect(page.getByRole('region', { name: '执行前审批' })).not.toBeVisible()
    await expect
      .poll(() => (existsSync(target) ? readFileSync(target, 'utf8') : null))
      .toBe('SEC02_APPROVED_ONCE')
    const grant = required(f.grants.list().grants[0])
    writeFileSync(target, 'sentinel before repeated irreversible consent')
    await f.send('相同文件参数续发')
    await page.getByRole('button', { name: '使用会话授权…' }).click()
    const reuse = page.getByRole('alertdialog', { name: '使用已有会话授权并确认本次执行？' })
    await expect(reuse).toContainText(grant.parameterDigest)
    expect(readFileSync(target, 'utf8')).toContain('sentinel')
    await page.keyboard.press('Escape')
    expect(readFileSync(target, 'utf8')).toContain('sentinel')
    await page.getByRole('button', { name: '使用会话授权…' }).click()
    await reuse.getByRole('button', { name: '确认本次不可回滚执行并使用授权' }).click()
    await expect(page.getByRole('region', { name: '执行前审批' })).not.toBeVisible()
    await expect.poll(() => readFileSync(target, 'utf8')).toBe('SEC02_APPROVED_ONCE')
    await page.getByRole('button', { name: '会话授权 · 1', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '会话授权', exact: true })
    await dialog.getByRole('button', { name: '查看授权范围与来源' }).click()
    await expect(dialog).toContainText(grant.physicalIdentity)
    await expect(dialog).toContainText('正在执行的动作需返回工作台单独停止')
    await page.route('**/api/chat/grants/revoke', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"夹具撤销失败"}',
      }),
    )
    await dialog.getByRole('button', { name: '撤销这条授权' }).click()
    await expect(dialog).toContainText('夹具撤销失败')
    expect(f.grants.list().grants).toHaveLength(1)
    await page.unroute('**/api/chat/grants/revoke')
    await dialog.getByRole('button', { name: '撤销这条授权' }).click()
    await expect(dialog).toContainText('尚无有效会话授权')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '会话授权 · 0', exact: true })).toBeFocused()
    await f.send('重新授予文件')
    await f.grant()
    await f.send('固定命令授权')
    await f.grant()
    expect(f.grants.list(session.id).grants).toHaveLength(2)
    await page.getByRole('button', { name: '会话授权 · 2', exact: true }).click()
    await dialog.getByRole('button', { name: '撤销本会话全部授权' }).click()
    await expect(dialog).toContainText('尚无有效会话授权')
    expect(f.grants.list().grants).toHaveLength(0)
  } finally {
    await f.close()
  }
})
test('SEC-03 actual Electron offline/reload preserve live scope, background focus is isolated and L3 has no session action', async () => {
  test.setTimeout(60000)
  const f = await setup(),
    { page } = f.desktop
  try {
    await f.send('授权文件视图')
    await f.grant()
    await page.reload()
    await page.getByRole('button', { name: '会话授权 · 1', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '会话授权', exact: true })
    await page.route('**/api/chat/grants?**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"夹具断线"}',
      }),
    )
    await expect(dialog).toContainText('授权状态待同步')
    await expect(dialog.getByRole('button', { name: '撤销这条授权' })).toBeDisabled()
    await page.unroute('**/api/chat/grants?**')
    await dialog.getByRole('button', { name: '刷新会话授权' }).click()
    await expect(dialog.getByRole('button', { name: '撤销这条授权' })).toBeEnabled()
    await page.keyboard.press('Escape')
    const { session } = await f.send('同会话等待文件'),
      pid = f.kernels.list()[0]?.pid
    await page.getByRole('button', { name: '新会话', exact: true }).first().click()
    const draft = page.getByRole('textbox', { name: '任务内容' })
    await draft.fill('前台草稿不被后台授权抢焦点')
    await draft.focus()
    f.grants.revoke(session.id, null, 'independent desktop client revoke', 'desktop-b')
    await expect(draft).toBeFocused()
    await expect(draft).toHaveValue('前台草稿不被后台授权抢焦点')
    expect(f.kernels.list()[0]?.pid).toBe(pid)
    const pending = required(f.approvals.list()[0])
    f.approvals.decide(
      pending.id,
      {
        sessionId: pending.sessionId,
        epoch: pending.epoch,
        turnId: pending.turnId,
        digest: pending.risk.digest,
        policyVersion: pending.risk.policyVersion,
        action: 'cancel',
        reason: 'explicit test cleanup',
        acceptIrreversible: false,
      },
      'desktop-b',
    )
    await expect.poll(() => f.approvals.list().length).toBe(0)
    await f.send('高危命令核对')
    await expect.poll(() => f.approvals.list().some((p) => p.risk.level === 'L3')).toBe(true)
    const high = required(f.approvals.list().find((p) => p.risk.level === 'L3'))
    await expect(
      page
        .locator(`[data-approval-id="${high.id}"]`)
        .getByRole('button', { name: '授权此会话相同参数…' }),
    ).toHaveCount(0)
    await expect(page.locator(`[data-approval-id="${high.id}"]`)).toContainText('不能生成会话授权')
  } finally {
    await f.close()
  }
})
test('SEC-03 actual Electron pending approval actions remain reachable beside composer in a short narrow window', async () => {
  test.setTimeout(60000)
  const f = await setup(),
    { page } = f.desktop
  try {
    await page.setViewportSize({ width: 800, height: 760 })
    await f.send('窄窗核对审批按钮')
    const approval = page.getByRole('region', { name: '执行前审批' })
    await approval.getByRole('button', { name: '查看最终参数与调用身份' }).click()
    await approval.getByRole('button', { name: '授权此会话相同参数…' }).click()
    const confirmation = page.getByRole('alertdialog', { name: '授予此会话相同参数的授权？' })
    await expect(confirmation).toBeInViewport({ ratio: 1 })
    await confirmation
      .getByRole('button', { name: '明确授予授权并允许本次不可回滚执行' })
      .scrollIntoViewIfNeeded()
    await expect(
      confirmation.getByRole('button', { name: '明确授予授权并允许本次不可回滚执行' }),
    ).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible()
    await approval.getByRole('button', { name: '取消本次调用', exact: true }).click()
    await expect(approval).not.toBeVisible()
    expect(f.grants.list().grants).toHaveLength(0)
    expect(f.approvals.list()).toHaveLength(0)
  } finally {
    await f.close()
  }
})

test('SEC-03 actual Electron grant viewer fits light/dark 800px; full restart keeps audit/history and restores no authority or execution', async () => {
  test.setTimeout(60000)
  const f = await setup()
  try {
    let { page } = f.desktop
    const { session } = await f.send('重启授权记录')
    await f.grant()
    const file = required(f.kernels.list()[0]?.sessionFile),
      bytes = readFileSync(file)
    await page.setViewportSize({ width: 800, height: 850 })
    await page.getByRole('button', { name: '会话授权 · 1', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '会话授权', exact: true })
    await dialog.getByRole('button', { name: '查看授权范围与来源' }).click()
    await expect(dialog.getByRole('button', { name: '撤销这条授权' })).toBeVisible()
    await page.screenshot({
      path: `${evidence}/sec03-grants-light-800.png`,
      animations: 'disabled',
    })
    await page.keyboard.press('Escape')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('button', { name: '会话授权 · 1', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '会话授权', exact: true })
    await expect(dialog.getByRole('button', { name: '撤销本会话全部授权' })).toBeVisible()
    await page.screenshot({ path: `${evidence}/sec03-grants-dark-800.png`, animations: 'disabled' })
    await f.restart()
    page = f.desktop.page
    expect(f.kernels.list()).toEqual([])
    expect(f.prompts()).toBe(0)
    expect(f.grants.list().grants).toEqual([])
    await page
      .getByRole('region', { name: '最近无项目会话', exact: true })
      .locator(`[data-library-session="${session.id}"]`)
      .getByRole('button')
      .first()
      .click()
    await page.getByRole('button', { name: '会话授权 · 0', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '会话授权', exact: true })).toContainText(
      '尚无有效会话授权',
    )
    expect(readFileSync(file)).toEqual(bytes)
    expect(
      f.store
        .history(session.id)
        ?.approvals.some(
          (a) =>
            a.parameters.kind === 'session-grant' &&
            a.parameters.event === 'revoked' &&
            !a.executable,
        ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})
