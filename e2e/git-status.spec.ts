/* oxlint-disable no-await-in-loop -- Themes and failure/recovery steps share one actual Electron window. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { fixtureGit as git } from '../apps/daemon/test/helpers/git.js'
import { setupChanges } from './helpers/change-fixture.js'

const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
const noop = () => undefined
type Fixture = Awaited<ReturnType<typeof setupChanges>>
const panel = (f: Fixture) =>
  f.page.getByRole('region', { name: '仓库状态与本地改动', exact: true })
async function show(f: Fixture) {
  await f.page.getByRole('button', { name: '查看仓库状态', exact: true }).click()
  return panel(f)
}
function init(f: Fixture) {
  git(f.cwd, 'init', '--initial-branch=中文分支')
  git(f.cwd, 'add', '.')
  git(f.cwd, 'commit', '-m', 'baseline')
  writeFileSync(join(f.cwd, 'tracked.txt'), 'staged')
  git(f.cwd, 'add', 'tracked.txt')
  writeFileSync(join(f.cwd, 'tracked.txt'), 'unstaged')
  writeFileSync(join(f.cwd, '中文 未跟踪.txt'), 'actual untracked')
}

test('GIT-01 Electron actual Git overview refreshes staged, unstaged, untracked and broken index without writing metadata', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    init(f)
    const s = await f.send('查看真实仓库')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const index = readFileSync(join(f.cwd, '.git', 'index')),
      head = git(f.cwd, 'rev-parse', 'HEAD')
    await show(f)
    await expect(panel(f)).toContainText('staged 1 · unstaged 1 · untracked 1')
    await expect(panel(f)).toContainText('中文分支')
    await expect(panel(f)).toContainText('轮前内容一致')
    writeFileSync(join(f.cwd, '新增.txt'), 'external')
    await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
    await expect(panel(f)).toContainText('untracked 2')
    writeFileSync(join(f.cwd, '.git', 'index'), 'fault injected')
    await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
    await expect(panel(f)).toContainText('仓库状态不可用')
    await expect(panel(f).getByText('staged 1', { exact: false })).toHaveCount(0)
    writeFileSync(join(f.cwd, '.git', 'index'), index)
    await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
    await expect(panel(f)).toContainText('untracked 2')
    expect(readFileSync(join(f.cwd, '.git', 'index'))).toEqual(index)
    expect(git(f.cwd, 'rev-parse', 'HEAD')).toBe(head)
  } finally {
    await f.close()
  }
})

test('GIT-01 Electron failed refresh and cancelled late result never replace another target or stop background SDK', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    init(f)
    const a = await f.send('保持仓库后台')
    await f.ready(a.id)
    await expect
      .poll(() => f.kernels.list().find((k) => k.sessionId === a.id)?.state)
      .toBe('running')
    const background = f.kernels.list().find((k) => k.sessionId === a.id)
    await show(f)
    await expect(panel(f)).toContainText('中文分支')
    await f.page.route('**/api/git/status?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"injected Git read failure"}',
      }),
    )
    await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
    await expect(panel(f)).toContainText('仓库状态未同步')
    await expect(panel(f)).not.toContainText('中文分支')
    await f.page.unroute('**/api/git/status?*')
    let release: () => void = noop,
      entered = false
    const gate = new Promise<void>((done) => {
      release = done
    })
    await f.page.route('**/api/git/status?*', async (route) => {
      entered = true
      const response = await route.fetch()
      await gate
      await route.fulfill({ response })
    })
    await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
    await expect.poll(() => entered).toBe(true)
    const b = await f.send('独立目录只读', true)
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await show(f)
    await expect(panel(f)).toContainText('非 Git 目录')
    await expect(panel(f)).not.toContainText('中文分支')
    expect(f.kernels.list().find((k) => k.sessionId === a.id)).toMatchObject({
      pid: background?.pid,
      epoch: background?.epoch,
      state: 'running',
    })
    expect(b.cwd).toBe(f.other)
    await f.stop(a.id)
  } finally {
    await f.close()
  }
})

test('GIT-01 Electron light/dark narrow overview and same-data/profile restart observe current files with zero replay', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    init(f)
    const s = await f.send('仓库重启验收')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await show(f)
    await expect(panel(f)).toContainText('中文 未跟踪.txt')
    await f.page.setViewportSize({ width: 802, height: 961 })
    for (const theme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme: theme })
      await expect
        .poll(async () => (await f.page.locator('html').getAttribute('class')) ?? '')
        .toMatch(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
      await f.page.screenshot({
        path: join(evidence, `git01-${theme}-narrow.png`),
        animations: 'disabled',
      })
    }
    await f.restart()
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toHaveLength(0)
    await f.open(s.id)
    await show(f)
    await expect(panel(f)).toContainText('staged 1 · unstaged 1 · untracked 1')
    expect(f.sends()).toBe(0)
    expect(f.kernels.list()).toHaveLength(0)
  } finally {
    await f.close()
  }
})
