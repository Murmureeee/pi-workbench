import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { setupChanges } from './helpers/change-fixture.js'

test('CHANGE-04 late acceptance cannot replace another review or stop an independent background SDK', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const a = await f.send('保持迟到审查')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'a changed')
    await f.stop(a.id)
    const b = await f.send('保持独立审查后台', true)
    await f.ready(b.id)
    const background = f.kernels.list().find((k) => k.sessionId === b.id)
    if (!background?.pid) {
      throw new Error('Background SDK missing')
    }
    await f.open(a.id)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    let entered = false
    await f.page.route('**/api/changes/decisions/accept', async (route) => {
      const response = await route.fetch({
        url: 'http://127.0.0.1:4318/api/changes/decisions/accept',
        headers: {
          ...route.request().headers(),
          host: '127.0.0.1:4318',
          origin: 'http://127.0.0.1:5173',
        },
      })
      entered = true
      await gate
      await route.fulfill({ response })
    })
    await f.page.getByRole('button', { name: '接受并保留所选文件', exact: true }).click()
    await expect.poll(() => entered).toBe(true)
    const c = await f.send('另一空轮次')
    await expect.poll(() => f.changes.history(c.id).rounds[0]?.outcome).toBe('completed')
    release?.()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.versions()
    await f.review()
    const progress = f.page.getByRole('region', { name: '逐文件审查进度', exact: true })
    await expect(progress).toContainText('已处理 0/0')
    await expect(progress).not.toContainText('已接受保留')
    expect(f.kernels.list().find((k) => k.sessionId === b.id)).toMatchObject({
      pid: background.pid,
      epoch: background.epoch,
      state: 'running',
    })
    await f.stop(b.id)
  } finally {
    release?.()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('CHANGE-04 Electron accepts one file and rolls back another: durable 2/2 survives current edits and restart', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const a = await f.send('保持混合审查终态')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'keep this changed content')
    writeFileSync(join(f.cwd, 'deleted.txt'), 'restore this file')
    await f.stop(a.id)
    await f.versions()
    await f.review()
    const progress = () => f.page.getByRole('region', { name: '逐文件审查进度', exact: true })
    await expect(progress()).toContainText('已处理 0/2')
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await progress().getByRole('button', { name: '接受并保留所选文件', exact: true }).click()
    await expect(progress()).toContainText('已接受保留')
    await expect(progress()).toContainText('已处理 1/2')
    await expect(
      progress().getByRole('button', { name: '接受并保留所选文件', exact: true }),
    ).toBeDisabled()
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('keep this changed content')
    await f.page.getByRole('button', { name: '审查文件 deleted.txt', exact: true }).click()
    await f.page.getByRole('button', { name: '预检整文件回滚', exact: true }).click()
    await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
    await f.page
      .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
      .click()
    await expect(progress()).toContainText('已处理 2/2')
    await expect(progress()).toContainText('曾成功回滚')
    expect(readFileSync(join(f.cwd, 'deleted.txt'), 'utf8')).toBe('delete me\n')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'later external content')
    await f.restart()
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toHaveLength(0)
    await f.open(a.id)
    await f.versions()
    await f.review()
    await expect(progress()).toContainText('已处理 2/2')
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await expect(progress()).toContainText('已接受保留')
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('later external content')
  } finally {
    await f.close()
  }
})

test('CHANGE-04 Electron failed accept and failed status preserve progress; explicit retry saves once', async () => {
  test.setTimeout(90000)
  const f = await setupChanges()
  try {
    const a = await f.send('保持失败审查')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'changed')
    await f.stop(a.id)
    await f.versions()
    await f.review()
    const progress = f.page.getByRole('region', { name: '逐文件审查进度', exact: true })
    await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
    await f.page.route('**/api/changes/decisions/accept', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected accept storage failure' }),
      }),
    )
    await progress.getByRole('button', { name: '接受并保留所选文件', exact: true }).click()
    await expect(progress).toContainText('接受未确认保存')
    await expect(progress).toContainText('已处理 0/1')
    await f.page.unroute('**/api/changes/decisions/accept')
    await progress.getByRole('button', { name: '刷新审查决定', exact: true }).click()
    await progress.getByRole('button', { name: '接受并保留所选文件', exact: true }).click()
    await expect(progress).toContainText('已处理 1/1')
    await f.page.route('**/api/changes/decisions?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"injected read failure"}',
      }),
    )
    await progress.getByRole('button', { name: '刷新审查决定', exact: true }).click()
    await expect(progress).toContainText('审查进度未同步')
    await expect(
      progress.getByRole('button', { name: '接受并保留所选文件', exact: true }),
    ).toBeDisabled()
    await f.page.unroute('**/api/changes/decisions?*')
    await progress.getByRole('button', { name: '刷新审查决定', exact: true }).click()
    await expect(progress).toContainText('已处理 1/1')
  } finally {
    await f.close()
  }
})
