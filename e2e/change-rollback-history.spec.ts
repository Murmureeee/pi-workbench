import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { setupChanges } from './helpers/change-fixture.js'

test('CHANGE-09 Electron durable rollback details survive restart; actual SDK gets facts once and historical messages remain', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const a = await f.send('保持回滚记录目标')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'historical change')
    await f.stop(a.id)
    const native = f.kernels.list().find((k) => k.sessionId === a.id)!.sessionFile!,
      prior = readFileSync(native)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
    await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
    await f.page
      .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
      .click()
    await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
      '回滚成功',
    )
    await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    await f.page.getByRole('button', { name: '查看持久回滚记录', exact: true }).click()
    const history = () => f.page.getByRole('region', { name: '持久回滚记录', exact: true })
    await expect(history()).toContainText('回滚成功')
    await history()
      .getByRole('button', { name: /^回滚详情 / })
      .click()
    const detail = () => f.page.getByRole('region', { name: '持久回滚详情', exact: true })
    await expect(detail()).toContainText('实际操作前')
    await expect(detail()).toContainText('已保存')
    await expect(detail()).toContainText('tracked.txt')
    expect(readFileSync(native)).toEqual(prior)
    await f.restart()
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toHaveLength(0)
    await f.open(a.id)
    await f.versions()
    await f.page.getByRole('button', { name: '查看持久回滚记录', exact: true }).click()
    await expect(history()).toContainText('回滚成功')
    await history()
      .getByRole('button', { name: /^回滚详情 / })
      .click()
    await expect(detail()).toContainText('消息保留')
    expect(readFileSync(native)).toEqual(prior)
    const b = await f.send('环境上下文 核对文件回滚事实')
    await expect(f.page.getByRole('region', { name: '受管会话消息', exact: true })).toContainText(
      '文件回滚未撤销消息历史',
      { timeout: 30000 },
    )
    expect(f.sends()).toBe(1)
    await expect
      .poll(() => f.changes.history(b.id).rounds[0]?.outcome, { timeout: 15000 })
      .toBe('completed')
  } finally {
    await f.close()
  }
})

test('CHANGE-09 Electron failed durable history query exposes retry and never borrows another session record', async () => {
  test.setTimeout(90000)
  const f = await setupChanges()
  try {
    const a = await f.send('记录查询失败')
    await expect.poll(() => f.changes.history(a.id).rounds[0]?.outcome).toBe('completed')
    await f.versions()
    await f.page.route('**/api/changes/rollback/history?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected history failure' }),
      }),
    )
    await f.page.getByRole('button', { name: '查看持久回滚记录', exact: true }).click()
    const history = f.page.getByRole('region', { name: '持久回滚记录', exact: true })
    await expect(history).toContainText('持久回滚记录未同步')
    await f.page.unroute('**/api/changes/rollback/history?*')
    await history.getByRole('button', { name: '刷新回滚记录', exact: true }).click()
    await expect(history).toContainText('尚无回滚记录')
  } finally {
    await f.close()
  }
})
