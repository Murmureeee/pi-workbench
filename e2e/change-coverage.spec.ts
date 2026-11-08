/* oxlint-disable no-await-in-loop -- Themes operate sequentially on the same Electron window. */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'

import { ApprovalService } from '../apps/daemon/dist/modules/security/approval.service.js'
import { fileLedgerPolicy } from '../packages/shared/dist/index.js'
import { setupChanges } from './helpers/change-fixture.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
type Fixture = Awaited<ReturnType<typeof setupChanges>>
const repo = (f: Fixture, turnId: string) =>
  join(
    dirname(f.cwd),
    'data',
    'ledger',
    createHash('sha256').update(f.changes.context(turnId).identity.directoryKey).digest('hex'),
    'objects.git',
  )
const git = (f: Fixture, turnId: string, ...args: string[]) =>
  execFileSync('git', ['--git-dir', repo(f, turnId), ...args], {
    windowsHide: true,
    encoding: 'utf8',
  })

/** Actual unreferenced object in isolated ledger; no synthetic capacity observation. */
function fill(f: Fixture, turnId: string, size: number) {
  const oid = execFileSync('git', ['--git-dir', repo(f, turnId), 'hash-object', '-w', '--stdin'], {
    windowsHide: true,
    encoding: 'utf8',
    input: randomBytes(size),
  }).trim()
  return join(repo(f, turnId), 'objects', oid.slice(0, 2), oid.slice(2))
}
const panel = (f: Fixture) =>
  f.page.getByRole('region', { name: '范围、容量与版本保留', exact: true })
const scope = (f: Fixture) => f.page.getByRole('region', { name: '回滚范围说明', exact: true })

test('CHANGE-08 Electron approvals explain full, partial command and unavailable oversized scope before one-shot consent', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    for (const text of ['范围写入', '范围命令', '范围写入 大文件']) {
      if (text.includes('大文件')) {
        writeFileSync(join(f.cwd, 'large.bin'), Buffer.alloc(fileLedgerPolicy.fileBytes + 1, 1))
      }
      const s = await f.send(text)
      await expect(scope(f)).toContainText(
        text.includes('大文件') ? '不可回滚' : text.includes('命令') ? '部分可回滚' : '可回滚',
      )
      await expect(scope(f)).toContainText('512 MiB')
      await expect(scope(f)).toContainText('命令外部副作用不受保护')
      if (text.includes('大文件')) {
        await expect(scope(f)).toContainText('5 MiB')
      }
      if (text.includes('命令')) {
        await expect(scope(f)).toContainText('外部副作用不可回滚')
      }
      expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
      await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
      await expect(f.page.getByRole('alertdialog')).toContainText('不可回滚')
      await f.page
        .getByRole('alertdialog')
        .getByRole('button', { name: '返回核对', exact: true })
        .click()
      await f.page.getByRole('button', { name: '取消本次调用', exact: true }).click()
      await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
      expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    }
  } finally {
    await f.close()
  }
})

test('CHANGE-08 Electron actual ignored/link/binary scope remains explicit in light/dark narrow review and preserves background SDK', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const outside = join(f.root, 'external-target')
    mkdirSync(outside)
    writeFileSync(join(outside, 'external.txt'), 'outside unchanged')
    symlinkSync(outside, join(f.cwd, 'link'), 'junction')
    writeFileSync(join(f.cwd, '.gitignore'), 'ignored.txt\n')
    writeFileSync(join(f.cwd, 'ignored.txt'), 'ignored unchanged')
    const a = await f.send('保持部分范围')
    await f.ready(a.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'external changed')
    writeFileSync(join(f.cwd, 'binary.bin'), Buffer.from([0, 255, 1]))
    await f.stop(a.id)
    const b = await f.send('保持独立后台', true)
    await f.ready(b.id)
    await expect
      .poll(() => f.kernels.list().find((k) => k.sessionId === b.id)?.state)
      .toBe('running')
    const background = f.kernels.list().find((k) => k.sessionId === b.id)
    await f.open(a.id)
    await f.versions()
    await f.page.setViewportSize({ width: 802, height: 961 })
    await f.review()
    await expect(scope(f)).toContainText('部分可回滚')
    await expect(scope(f)).toContainText('含限额内二进制')
    await scope(f).getByText('排除范围：基线 2 条／收尾 2 条', { exact: true }).click()
    await expect(scope(f)).toContainText('ignored.txt：.gitignore')
    await expect(scope(f)).toContainText('link：链接或非普通独占文件')
    await expect(f.page.getByRole('button', { name: '预检整轮回滚', exact: true })).toBeEnabled()
    for (const theme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme: theme })
      if (theme === 'dark') {
        await expect(f.page.locator('html')).toHaveClass(/dark/)
      } else {
        await expect(f.page.locator('html')).not.toHaveClass(/dark/)
      }
      await f.page.screenshot({
        path: join(evidence, `change08-${theme}-narrow.png`),
        animations: 'disabled',
      })
    }
    expect(f.kernels.list().find((k) => k.sessionId === b.id)).toMatchObject({
      pid: background?.pid,
      epoch: background?.epoch,
      state: 'running',
    })
    expect(readFileSync(join(outside, 'external.txt'), 'utf8')).toBe('outside unchanged')
    expect(readFileSync(join(f.cwd, 'ignored.txt'), 'utf8')).toBe('ignored unchanged')
    await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
    await f.stop(b.id)
  } finally {
    await f.close()
  }
})

test('CHANGE-08 Electron measured capacity warning/full disables rollback, failed refresh never uses old permission, refs survive same-profile restart', async () => {
  test.setTimeout(120000)
  const f = await setupChanges(1024 * 1024)
  try {
    const s = await f.send('保持容量')
    await f.ready(s.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'capacity current')
    await f.stop(s.id)
    const t = f.changes.history(s.id).rounds[0]
    if (!t) {
      throw new Error('Capacity round missing')
    }
    const refs = git(f, t.turnId, 'show-ref')
    let filler = fill(f, t.turnId, 850 * 1024)
    await f.versions()
    await f.review()
    await expect(panel(f)).toContainText('账本容量预警')
    unlinkSync(filler)
    filler = fill(f, t.turnId, 1024 * 1024)
    await panel(f).getByRole('button', { name: '重新核对回滚范围', exact: true }).click()
    await expect(panel(f)).toContainText('账本容量已满')
    const prepare = () => f.page.getByRole('button', { name: '预检整轮回滚', exact: true })
    await expect(prepare()).toBeDisabled()
    await f.page.route('**/api/changes/coverage?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"injected coverage read failure"}',
      }),
    )
    await panel(f).getByRole('button', { name: '重新核对回滚范围', exact: true }).click()
    await expect(panel(f)).toContainText('回滚范围未同步，回滚已禁用')
    await expect(prepare()).toBeDisabled()
    await f.page.unroute('**/api/changes/coverage?*')
    await f.restart()
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toHaveLength(0)
    expect(f.app.get(ApprovalService).list()).toHaveLength(0)
    await f.open(s.id)
    await f.versions()
    await f.review()
    await expect(panel(f)).toContainText('账本容量已满')
    await expect(prepare()).toBeDisabled()
    expect(git(f, t.turnId, 'show-ref')).toBe(refs)
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('capacity current')
    unlinkSync(filler)
    await panel(f).getByRole('button', { name: '重新核对回滚范围', exact: true }).click()
    await expect(prepare()).toBeEnabled()
  } finally {
    await f.close()
  }
})

test('CHANGE-08 Electron missing reference explains unavailability and cannot replace history from current files after restart', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const s = await f.send('保持引用失效')
    await f.ready(s.id)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'final bytes')
    await f.stop(s.id)
    const t = f.changes.history(s.id).rounds[0]
    if (!t) {
      throw new Error('Reference round missing')
    }
    await f.versions()
    await f.review()
    await expect(f.page.getByRole('button', { name: '预检整轮回滚', exact: true })).toBeEnabled()
    await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
    await expect(
      f.page.getByRole('dialog', { name: '整批预检存在冲突', exact: true }),
    ).toBeVisible()
    git(f, t.turnId, 'update-ref', '-d', `refs/piw/${t.turnId}/baseline`)
    await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
    await f.page
      .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
      .click()
    await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
      '历史版本失效',
    )
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('final bytes')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'current must not replace history')
    await panel(f).getByRole('button', { name: '重新核对回滚范围', exact: true }).click()
    await expect(panel(f)).toContainText('不可回滚')
    await expect(panel(f)).toContainText('引用')
    await expect(f.page.getByRole('button', { name: '预检整轮回滚', exact: true })).toBeDisabled()
    expect(f.changes.history(s.id).rounds[0]).toEqual(t)
    await f.restart()
    await f.open(s.id)
    await f.versions()
    await f.review()
    await expect(panel(f)).toContainText('当前回滚已禁用')
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toHaveLength(0)
    expect(f.changes.history(s.id).rounds[0]).toEqual(t)
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe(
      'current must not replace history',
    )
  } finally {
    await f.close()
  }
})
