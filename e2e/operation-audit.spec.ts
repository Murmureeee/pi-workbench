import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
import { AuditService } from '../apps/daemon/dist/modules/security/audit.service.js'
import { SecurityService } from '../apps/daemon/dist/modules/security/security.service.js'
import { SessionGrantService } from '../apps/daemon/dist/modules/security/session-grant.service.js'
import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
import { auditExportSchema } from '../packages/shared/dist/index.js'
import { launchWorkspaceDesktop } from './helpers/desktop.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
async function setup() {
  mkdirSync(evidence, { recursive: true })
  const directory = mkdtempSync(join(tmpdir(), 'piw-audit-ui-'))
  let app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true }),
    prompts = 0
  const wire = () => {
    const kernels = app.get(KernelService),
      original = kernels.prompt.bind(kernels)
    kernels.prompt = (id, cwd, input, options) => {
      prompts++
      return original(id, cwd, { ...input, fixture: 'approval-write' }, options)
    }
  }
  wire()
  await app.listen(4318, '127.0.0.1')
  let desktop = await launchWorkspaceDesktop(directory, app)
  return {
    get app() {
      return app
    },
    get desktop() {
      return desktop
    },
    prompts: () => prompts,
    restart: async () => {
      await desktop.close()
      await app.close()
      app = await createApp({ dataDir: join(directory, 'data'), port: 4318, development: true })
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

test('SEC-09 actual Electron shows real final approval audit, redacted bounded export and immutable history after restart', async () => {
  test.setTimeout(90000)
  const f = await setup(),
    { page } = f.desktop
  try {
    f.app.get(SecurityService).redactor.remember('AUDIT_PRIVATE_FIXTURE')
    await page.getByRole('textbox', { name: '任务内容' }).fill('审计真实中文文件')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect(page.getByRole('region', { name: '执行前审批' })).toBeVisible()
    await page.getByRole('button', { name: '授权此会话相同参数…' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '明确授予授权并允许本次不可回滚执行' })
      .click()
    const session = f.app.get(SessionStore).managedSessions()[0]
    if (!session) {
      throw new Error('Missing actual created audit session')
    }
    await expect
      .poll(() =>
        existsSync(join(session.cwd, 'APPROVED.txt'))
          ? readFileSync(join(session.cwd, 'APPROVED.txt'), 'utf8')
          : null,
      )
      .toBe('SEC02_APPROVED_ONCE')
    f.app
      .get(SessionGrantService)
      .revoke(session.id, null, '人类撤销 AUDIT_PRIVATE_FIXTURE', 'independent-desktop')
    await page.getByRole('textbox', { name: '任务内容' }).fill('审计返回草稿')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('link', { name: '操作审计' }).click()
    await expect(page.getByRole('heading', { name: '操作审计' })).toBeVisible()
    await page.getByRole('textbox', { name: '会话 ID（可选）' }).fill(session.id)
    await page.getByRole('button', { name: '应用筛选', exact: true }).click()
    await expect(page.locator('[data-audit-id]')).toHaveCount(4)
    await page.getByRole('button', { name: /会话授权 · 撤销/ }).click()
    await expect(page.locator('.audit-record').first()).toContainText('«redacted»')
    await expect(page.locator('.audit-record').first()).toContainText('independent-desktop')
    await expect(page.getByRole('main').last()).not.toContainText('AUDIT_PRIVATE_FIXTURE')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出本页脱敏记录' }).click()
    const file = await download,
      path = await file.path()
    if (!path) {
      throw new Error('Audit export missing downloaded file')
    }
    const value = auditExportSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    expect(value.page.entries).toHaveLength(4)
    expect(JSON.stringify(value)).not.toContain('AUDIT_PRIVATE_FIXTURE')
    expect(value.query.sessionId).toBe(session.id)
    await page.screenshot({ path: join(evidence, 'sec-09-audit-light.png') })
    await page.getByRole('link', { name: '返回工作台' }).click()
    await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('审计返回草稿')
    const before = f.app
        .get(AuditService)
        .page({ sessionId: session.id })
        .entries.map((e) => e.id),
      prompts = f.prompts()
    await f.restart()
    expect(f.prompts()).toBe(prompts)
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(f.app.get(SessionGrantService).list().grants).toEqual([])
    await f.desktop.page.goto('http://127.0.0.1:5173/?audit')
    await f.desktop.page.getByRole('textbox', { name: '会话 ID（可选）' }).fill(session.id)
    await f.desktop.page.getByRole('button', { name: '应用筛选' }).click()
    await expect(f.desktop.page.locator('[data-audit-id]')).toHaveCount(4)
    expect(
      f.app
        .get(AuditService)
        .page({ sessionId: session.id })
        .entries.map((e) => e.id),
    ).toEqual(before)
  } finally {
    await f.close()
  }
})

test('SEC-09 Electron pagination/filter ownership, safe text and dark narrow layout do not execute tools', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    const audit = f.app.get(AuditService)
    for (let i = 0; i < 56; i++) {
      audit.record({
        kind: 'approval',
        objectId: `explicit-synthetic-${i}`,
        sessionId: null,
        source: 'synthetic-fixture',
        actor: null,
        risk: 'unknown',
        decision: 'synthetic-observation',
        scope: '<script>window.AUDIT_UNSAFE=true</script>',
        reason: '仅验证展示，不代表真实执行',
      })
    }
    await page.goto('http://127.0.0.1:5173/?audit')
    await expect(page.locator('[data-audit-id]')).toHaveCount(50)
    const firstIds = await page
      .locator('[data-audit-id]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-audit-id')))
    audit.record({
      kind: 'approval',
      objectId: 'concurrent-synthetic-append',
      sessionId: null,
      source: 'synthetic-fixture',
      actor: null,
      risk: 'unknown',
      decision: 'synthetic-observation',
      scope: '<script>window.AUDIT_UNSAFE=true</script>',
      reason: 'Appended after the first page; pagination must keep its original snapshot.',
    })
    await page.getByRole('button', { name: '更早记录' }).click()
    await expect(page.locator('[data-audit-id]')).toHaveCount(7)
    await page.getByRole('button', { name: '上一页记录' }).click()
    await expect(page.locator('[data-audit-id]')).toHaveCount(50)
    expect(
      await page
        .locator('[data-audit-id]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-audit-id'))),
    ).toEqual(firstIds)
    await page.getByRole('button', { name: '刷新最新记录' }).click()
    await expect(page.locator('[data-audit-id]').first()).not.toHaveAttribute(
      'data-audit-id',
      firstIds[0] ?? '',
    )
    await page.getByRole('button', { name: '审计事件类别' }).click()
    await page.getByRole('menuitemradio', { name: '资源信任' }).click()
    await page.getByRole('button', { name: '应用筛选' }).click()
    await expect(page.getByText('没有匹配的审计记录')).toBeVisible()
    await page.getByRole('button', { name: '清除筛选' }).click()
    await expect(page.locator('[data-audit-id]')).toHaveCount(50)
    await page.locator('[data-audit-id]').first().getByRole('button').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.audit-record pre').first()).toContainText('<script>')
    expect(await page.evaluate(() => Object.hasOwn(window, 'AUDIT_UNSAFE'))).toBe(false)
    await page.getByRole('link', { name: '外观', exact: true }).click()
    await page.getByLabel('外观主题').selectOption('dark')
    await page.setViewportSize({ width: 800, height: 760 })
    await page.getByRole('link', { name: '操作审计' }).click()
    await expect(page.locator('[data-audit-id]')).toHaveCount(50)
    await page.screenshot({ path: join(evidence, 'sec-09-audit-dark-800.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(f.prompts()).toBe(0)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('SEC-09 Electron read/export failures preserve filters; late export after navigation cannot download', async () => {
  const f = await setup(),
    { page } = f.desktop
  try {
    await page.goto('http://127.0.0.1:5173/?audit')
    await expect(page.locator('[data-audit-id]')).toHaveCount(1)
    const exportRoute = '**/api/audit/export?**'
    await page.route(exportRoute, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"明确夹具导出失败"}',
      }),
    )
    await page.getByRole('button', { name: '导出本页脱敏记录' }).click()
    await expect(page.getByRole('alert').last()).toContainText('明确夹具导出失败')
    await expect(page.locator('[data-audit-id]')).toHaveCount(1)
    await page.unroute(exportRoute)
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = false,
      downloads = 0
    page.on('download', () => {
      downloads++
    })
    await page.route(exportRoute, async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace(':5173', ':4318'),
        headers: { ...route.request().headers(), host: '127.0.0.1:4318' },
      })
      requested = true
      await held
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '导出本页脱敏记录' }).click()
    await expect.poll(() => requested).toBe(true)
    await page.getByRole('link', { name: '外观', exact: true }).click()
    release?.()
    await page.getByRole('link', { name: '操作审计' }).click()
    await expect(page.locator('[data-audit-id]')).toHaveCount(1)
    expect(downloads).toBe(0)
    const readRoute = '**/api/audit?**'
    await page.route(readRoute, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"明确夹具读取失败"}',
      }),
    )
    await page.getByRole('button', { name: '刷新最新记录' }).click()
    await expect(page.getByRole('alert').last()).toContainText('明确夹具读取失败')
    await expect(page.locator('[data-audit-id]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '导出本页脱敏记录' })).toBeDisabled()
    await page.unroute(readRoute)
    await page.getByRole('button', { name: '刷新最新记录' }).click()
    await expect(page.getByRole('button', { name: '导出本页脱敏记录' })).toBeEnabled()
    expect(f.prompts()).toBe(0)
  } finally {
    await f.close()
  }
})
