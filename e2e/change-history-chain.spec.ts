/* oxlint-disable no-await-in-loop -- Theme evidence uses one actual Electron window. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { setupChanges } from './helpers/change-fixture.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
test('CHANGE-07 Electron preserves earlier block history, exposes later dependency and recomputes after newest rollback and restart', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const path = join(f.cwd, 'tracked.txt')
    writeFileSync(path, 'first=0\n\nsecond=0\n')
    const a = await f.send('保持第一轮版本')
    await f.ready(a.id)
    writeFileSync(path, 'first=1\n\nsecond=0\n')
    await f.stop(a.id)
    const b = await f.send('保持后续不同代码块')
    await f.ready(b.id)
    writeFileSync(path, 'first=1\n\nsecond=1\n')
    await f.stop(b.id)
    const background = await f.send('保持独立后台', true)
    await f.ready(background.id)
    const kernel = f.kernels.list().find((k) => k.sessionId === background.id)!
    await f.open(a.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    const diff = f.page.getByRole('region', { name: '所选文件历史Diff' })
    await expect(diff).toContainText('first=1')
    await expect(diff).toContainText('second=0')
    await f.page.getByRole('button', { name: '核对当前回滚条件', exact: true }).click()
    const conditions = f.page.getByRole('region', { name: '当前回滚条件与后续版本' })
    await expect(conditions).toContainText('当前含后续或外部修改')
    await conditions.getByText('依赖版本与后续轮次（1）', { exact: true }).click()
    await expect(conditions).toContainText(b.id)
    await expect(conditions).toContainText('未判断旧代码块消失')
    for (const colorScheme of ['light', 'dark'] as const) {
      await f.page.setViewportSize({ width: 802, height: 761 })
      await f.page.emulateMedia({ colorScheme })
      // A layout transition remounts the read-only pane. Requery explicitly.
      await f.page.getByRole('button', { name: '核对当前回滚条件', exact: true }).click()
      await expect(conditions).toContainText('当前含后续或外部修改')
      await f.page.screenshot({ path: join(evidence, `change-chain-${colorScheme}.png`) })
    }
    await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    await f.open(b.id)
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
    expect(readFileSync(path, 'utf8')).toBe('first=1\n\nsecond=0\n')
    await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    await f.open(a.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '核对当前回滚条件', exact: true }).click()
    await expect(conditions).toContainText('当前匹配该轮收尾')
    expect(f.kernels.list().find((k) => k.sessionId === background.id)).toMatchObject({
      pid: kernel.pid,
      epoch: kernel.epoch,
      state: 'running',
    })
    await f.stop(background.id)
    await f.restart()
    await f.open(a.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '核对当前回滚条件', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '当前回滚条件与后续版本' })).toContainText(
      '当前匹配该轮收尾',
    )
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toHaveLength(0)
  } finally {
    await f.close()
  }
})

test('CHANGE-07 Electron failed current observation keeps immutable Diff and permits explicit refresh', async () => {
  test.setTimeout(90000)
  const f = await setupChanges()
  try {
    const a = await f.send('保持条件故障')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'historical')
    await f.stop(a.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await f.page.route('**/api/changes/availability?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected observation failure' }),
      }),
    )
    await f.page.getByRole('button', { name: '核对当前回滚条件', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '当前回滚条件与后续版本' })).toContainText(
      '当前回滚条件未同步',
    )
    await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText(
      'historical',
    )
    await f.page.unroute('**/api/changes/availability?*')
    await f.page.getByRole('button', { name: '核对当前回滚条件', exact: true }).click()
    await expect(f.page.getByRole('region', { name: '当前回滚条件与后续版本' })).toContainText(
      '当前匹配该轮收尾',
    )
  } finally {
    await f.close()
  }
})
