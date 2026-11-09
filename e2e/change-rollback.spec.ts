/* oxlint-disable no-await-in-loop -- Confirmation and narrow theme captures use one actual Electron window. */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { ChangeRollbackService } from '../apps/daemon/dist/modules/changes/change-rollback.service.js'
import { setupChanges } from './helpers/change-fixture.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('CHANGE-05 Electron actual SDK file rollback requires preflight, preserves historical Diff and reconciles after same-profile restart', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const session = await f.send('工具链回滚')
    for (let i = 0; i < 2; i++) {
      await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
      await f.page.getByRole('button', { name: '明确允许本次不可回滚执行', exact: true }).click()
    }
    await f.versions()
    await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存', {
      timeout: 20000,
    })
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    const historical = f.page.getByRole('region', { name: '所选文件历史Diff' })
    await expect(historical).toContainText('second')
    const file = f.page.getByRole('region', { name: '整文件回滚', exact: true })
    await file.getByRole('button', { name: '预检整文件回滚', exact: true }).click()
    const confirm = f.page.getByRole('dialog', { name: '确认本次回滚', exact: true })
    await expect(confirm).toContainText('tracked.txt')
    await confirm.getByRole('button', { name: '取消本次回滚', exact: true }).click()
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('second\n')
    await file.getByRole('button', { name: '预检整文件回滚', exact: true }).click()
    await f.page.getByRole('button', { name: '确认回到本轮基线', exact: true }).click()
    await expect(file).toContainText('回滚成功')
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('baseline\n')
    await expect(historical).toContainText('second')
    const turn = f.changes.history(session.id).rounds[0]
    const historicalRecord = JSON.stringify(turn)
    const operationId = (await file.innerText()).match(/操作 ([a-f0-9-]{36})/)?.[1]
    expect(operationId).toBeDefined()
    await f.restart()
    expect(f.sends()).toBe(0)
    await f.open(session.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    expect(f.app.get(ChangeRollbackService).record(session.id, operationId!).state).toBe(
      'succeeded',
    )
    expect(JSON.stringify(f.changes.history(session.id).rounds[0])).toBe(historicalRecord)
    expect(f.kernels.list()).toHaveLength(0)
    expect(f.sends()).toBe(0)
  } finally {
    await f.close()
  }
})

test('CHANGE-05 Electron unknown-source batch cancels without writes, then separately confirms add/delete/rename restoration in light/dark narrow window', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const session = await f.send('保持批量回滚')
    await f.ready(session.id)
    writeFileSync(join(f.cwd, 'added.txt'), 'new external')
    unlinkSync(join(f.cwd, 'deleted.txt'))
    renameSync(join(f.cwd, 'old-name.txt'), join(f.cwd, 'new-name.txt'))
    writeFileSync(join(f.cwd, 'tracked.txt'), 'mixed current\n')
    await f.stop(session.id)
    await f.versions()
    await f.review()
    await f.page.setViewportSize({ width: 802, height: 761 })
    await expect(f.page.getByRole('dialog', { name: '轮次修改审查', exact: true })).toBeVisible()
    await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
    await expect(
      f.page.getByRole('dialog', { name: '整批预检存在冲突', exact: true }),
    ).toBeVisible()
    await expect(f.page.getByRole('button', { name: '确认回到本轮基线', exact: true })).toHaveCount(
      0,
    )
    await f.page.getByRole('button', { name: '取消本次回滚', exact: true }).click()
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('mixed current\n')
    await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
    await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
    const dialog = f.page.getByRole('dialog', { name: '单独确认覆盖外部内容', exact: true })
    for (const colorScheme of ['light', 'dark'] as const) {
      await f.page.setViewportSize({ width: 802, height: 761 })
      await f.page.emulateMedia({ colorScheme })
      await expect(dialog).toContainText('不能当作 agent 独占修改')
      await expect(
        dialog.getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true }),
      ).toBeVisible()
      await f.page.screenshot({ path: join(evidence, `rollback-${colorScheme}-narrow.png`) })
      expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    await dialog
      .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
      .click()
    await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
      '回滚成功',
    )
    expect(existsSync(join(f.cwd, 'added.txt'))).toBe(false)
    expect(existsSync(join(f.cwd, 'new-name.txt'))).toBe(false)
    expect(readFileSync(join(f.cwd, 'old-name.txt'), 'utf8')).toBe('rename unique\n')
    expect(readFileSync(join(f.cwd, 'deleted.txt'), 'utf8')).toBe('delete me\n')
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('baseline\n')
  } finally {
    await f.close()
  }
})

test('CHANGE-05 Electron stale whole-round preflight writes nothing and injected failure shows conditional compensation; background SDK stays owned', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const a = await f.send('保持目标')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'target after\n')
    writeFileSync(join(f.cwd, 'another.txt'), 'another')
    await f.stop(a.id)
    const b = await f.send('保持独立后台', true)
    await f.ready(b.id)
    const kernel = f.kernels.list().find((k) => k.sessionId === b.id)!
    await f.open(a.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
    await expect(
      f.page.getByRole('dialog', { name: '整批预检存在冲突', exact: true }),
    ).toBeVisible()
    writeFileSync(join(f.cwd, 'tracked.txt'), 'external since preflight')
    await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
    await f.page
      .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
      .click()
    await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
      '预检冲突，未写入',
    )
    expect(readFileSync(join(f.cwd, 'another.txt'), 'utf8')).toBe('another')
    const service = f.app.get(ChangeRollbackService),
      write = service.files.write.bind(service.files)
    let count = 0
    service.files.write = (...args) =>
      ++count === 2 ? Promise.reject(new Error('injected native-adapter failure')) : write(...args)
    await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
    await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
    await f.page
      .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
      .click()
    await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
      '执行失败，已条件补偿',
    )
    expect(readFileSync(join(f.cwd, 'another.txt'), 'utf8')).toBe('another')
    await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    expect(f.kernels.list().find((k) => k.sessionId === b.id)).toMatchObject({
      pid: kernel.pid,
      epoch: kernel.epoch,
      state: 'running',
    })
    await f.stop(b.id)
  } finally {
    await f.close()
  }
})
