/* oxlint-disable no-await-in-loop -- Theme observations share the same real Electron profile and target. */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { fixtureGit as git } from '../apps/daemon/test/helpers/git.js'
import { setupChanges } from './helpers/change-fixture.js'

const noop = () => undefined
type Fixture = Awaited<ReturnType<typeof setupChanges>>
const region = (f: Fixture) => f.page.getByRole('region', { name: '授权文件浏览', exact: true })
const search = (f: Fixture) =>
  f.page.getByRole('textbox', { name: '文件名或相对路径', exact: true })
async function open(f: Fixture) {
  await f.page.getByRole('button', { name: '浏览与查找文件', exact: true }).click()
  await expect(region(f)).toBeVisible()
}
const close = (f: Fixture) =>
  f.page.getByRole('button', { name: '关闭文件浏览', exact: true }).click()
const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'

test('FILE-01 Electron lazy pages, literal Chinese search, ignored markers and real containing directory preserve unsent draft', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    git(f.cwd, 'init')
    writeFileSync(join(f.cwd, '.gitignore'), 'ignored/\n')
    mkdirSync(join(f.cwd, 'ignored'))
    writeFileSync(join(f.cwd, 'ignored', 'hidden.ts'), 'ignored')
    mkdirSync(join(f.cwd, '中文 文件夹'))
    for (let i = 0; i < 130; i++) {
      writeFileSync(join(f.cwd, '中文 文件夹', `目标-${i}.ts`), 'real file')
    }
    const s = await f.send('文件定位验收')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const draft = f.page.getByRole('textbox', { name: '任务内容', exact: true })
    await draft.fill('未发送的中文草稿')
    await open(f)
    await expect(region(f)).toContainText('仓库根（仅信息）')
    await expect(region(f)).toContainText('附加目录：未开放')
    await expect(
      region(f)
        .getByRole('listitem')
        .filter({ has: f.page.getByRole('button', { name: 'ignored', exact: true }) }),
    ).toContainText('Git 忽略')
    await region(f).getByRole('button', { name: '中文 文件夹', exact: true }).click()
    await expect(region(f).getByRole('listitem')).toHaveCount(100)
    await region(f).getByRole('button', { name: '加载下一页文件', exact: true }).click()
    await expect(region(f).getByRole('listitem')).toHaveCount(30)
    await search(f).fill('目标-129.ts')
    await region(f)
      .getByRole('button', { name: /中文 文件夹.*目标-129.ts/ })
      .click()
    await expect(region(f).getByRole('region', { name: '文件位置', exact: true })).toContainText(
      join(f.cwd, '中文 文件夹', '目标-129.ts'),
    )
    await region(f).getByRole('button', { name: '定位所在目录', exact: true }).click()
    await expect(region(f)).toContainText('当前目录：中文 文件夹')
    await close(f)
    await expect(draft).toHaveValue('未发送的中文草稿')
    expect(f.sends()).toBe(1)
  } finally {
    await f.close()
  }
})

test('FILE-01 Electron synthetic IME, cancel, late results and failed read cannot replace another target or stop real SDK background', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  let release: () => void = noop
  try {
    writeFileSync(join(f.cwd, '中文目标.ts'), 'actual')
    const a = await f.send('保持 文件后台')
    await f.ready(a.id)
    await expect
      .poll(() => f.kernels.list().find((k) => k.sessionId === a.id)?.state)
      .toBe('running')
    const before = f.kernels.list().find((k) => k.sessionId === a.id)
    await open(f)
    let searches = 0
    f.page.on('request', (req) => {
      if (req.url().includes('/api/files/search?')) {
        searches++
      }
    })
    await search(f).dispatchEvent('compositionstart')
    await search(f).fill('中文')
    await search(f).press('Enter')
    await expect(region(f)).toContainText('等待文件搜索输入')
    expect(searches).toBe(0)
    await search(f).dispatchEvent('compositionend')
    await expect(region(f)).toContainText('中文目标.ts')
    await region(f).getByRole('button', { name: '取消文件搜索', exact: true }).click()
    await expect(search(f)).toHaveValue('')
    await f.page.route('**/api/files/list?*', (r) =>
      r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"injected file read failure"}',
      }),
    )
    await region(f).getByRole('button', { name: '刷新文件列表', exact: true }).click()
    await expect(region(f)).toContainText('文件列表未同步')
    await expect(region(f).getByRole('listitem')).toHaveCount(0)
    await f.page.unroute('**/api/files/list?*')
    let entered = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.page.route('**/api/files/search?*', async (route) => {
      const response = await route.fetch()
      entered = true
      await gate
      await route.fulfill({ response })
    })
    await search(f).fill('中文')
    await expect.poll(() => entered).toBe(true)
    await close(f)
    const b = await f.send('独立文件目标', true)
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await open(f)
    await expect(region(f)).toContainText(f.other)
    await expect(region(f)).not.toContainText('中文目标.ts')
    expect(f.kernels.list().find((k) => k.sessionId === a.id)).toMatchObject({
      pid: before?.pid,
      epoch: before?.epoch,
      state: 'running',
    })
    expect(b.cwd).toBe(f.other)
    await close(f)
    await f.stop(a.id)
  } finally {
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})

test('FILE-01 Electron directory mutation and stale file handle fail visibly, refresh recovers actual current location', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, 'stale.ts'), 'first')
    await f.send('文件变化诊断')
    await open(f)
    await region(f).getByRole('button', { name: 'stale.ts', exact: true }).waitFor()
    renameSync(join(f.cwd, 'stale.ts'), join(f.cwd, 'moved.ts'))
    writeFileSync(join(f.cwd, 'stale.ts'), 'different identity')
    await region(f).getByRole('button', { name: 'stale.ts', exact: true }).click()
    await expect(region(f).getByRole('region', { name: '文件位置', exact: true })).toContainText(
      '已变化',
    )
    await region(f).getByRole('button', { name: '刷新文件列表', exact: true }).click()
    await region(f).getByRole('button', { name: 'stale.ts', exact: true }).click()
    await expect(region(f).getByRole('region', { name: '文件位置', exact: true })).toContainText(
      '18 字节',
    )
  } finally {
    await f.close()
  }
})

test('FILE-01 Electron light/dark narrow, same-data/profile restart does not replay or retain stale handles', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, '重启前.ts'), 'actual')
    const s = await f.send('文件重启验收')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await open(f)
    await expect(region(f)).toContainText('重启前.ts')
    await f.page.setViewportSize({ width: 802, height: 961 })
    for (const theme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme: theme })
      await expect
        .poll(async () => (await f.page.locator('html').getAttribute('class')) ?? '')
        .toMatch(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
      await f.page.screenshot({
        path: join(evidence, `file01-${theme}-narrow.png`),
        animations: 'disabled',
      })
    }
    await f.restart()
    expect(f.kernels.list()).toEqual([])
    expect(f.sends()).toBe(0)
    renameSync(join(f.cwd, '重启前.ts'), join(f.cwd, '重启后.ts'))
    await f.open(s.id)
    await open(f)
    await expect(region(f)).toContainText('重启后.ts')
    await expect(region(f)).not.toContainText('重启前.ts')
    expect(f.kernels.list()).toEqual([])
    expect(f.sends()).toBe(0)
  } finally {
    await f.close()
  }
})
