/* oxlint-disable no-await-in-loop -- Sequential actions share one actual Electron/SDK fixture. */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
import { setupChanges } from './helpers/change-fixture.js'

type Fixture = Awaited<ReturnType<typeof setupChanges>>
const noop = () => undefined
const reader = (f: Fixture) => f.page.getByRole('region', { name: '只读代码阅读', exact: true })
const code = (f: Fixture) => reader(f).getByRole('region', { name: '代码行', exact: true })
const draft = (f: Fixture) => f.page.getByRole('textbox', { name: '任务内容', exact: true })
async function browse(f: Fixture, name: string) {
  await f.page.getByRole('button', { name: '浏览与查找文件', exact: true }).click()
  await f.page.getByRole('textbox', { name: '文件名或相对路径', exact: true }).fill(name)
  const region = f.page.getByRole('region', { name: '授权文件浏览', exact: true })
  await region.getByRole('button', { name, exact: true }).click()
  await region.getByRole('button', { name: '只读查看代码', exact: true }).click()
  await expect(reader(f)).toBeVisible()
}
async function close(f: Fixture) {
  await f.page.getByRole('button', { name: '关闭代码阅读', exact: true }).click()
  const browser = f.page.getByRole('button', { name: '关闭文件浏览', exact: true })
  if (await browser.isVisible()) {
    await browser.click()
  }
}

test('FILE-02 Electron actual Chinese code lines append only selected rechecked bytes to owned unsent draft; current changes hide old content', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    writeFileSync(
      join(f.cwd, '中文代码.ts'),
      'export const 中文 = 1\r\nconst selected = 2\r\nconst last = 3\r\n',
    )
    const s = await f.send('代码选区验收')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    await draft(f).fill('原有中文草稿')
    await browse(f, '中文代码.ts')
    await expect(code(f)).toContainText('const selected = 2')
    await reader(f).getByRole('button', { name: '选择第 2 行', exact: true }).click()
    await reader(f).getByRole('button', { name: '选区加入输入', exact: true }).click()
    await expect(reader(f)).toContainText('尚未发送')
    await close(f)
    await expect(draft(f)).toHaveValue('原有中文草稿')
    await expect(f.page.getByRole('region', { name: '输入引用', exact: true })).toContainText(
      '中文代码.ts:2-2',
    )
    await f.page.getByRole('button', { name: '预览引用', exact: true }).click()
    await expect(f.page.getByRole('dialog', { name: '引用预览', exact: true })).toContainText(
      'const selected = 2',
    )
    await f.page.getByRole('button', { name: '关闭引用', exact: true }).click()
    expect(await draft(f).inputValue()).not.toContain('const last = 3')
    expect(f.sends()).toBe(1)
    await browse(f, '中文代码.ts')
    writeFileSync(join(f.cwd, '中文代码.ts'), 'external new code\n')
    await expect(reader(f)).toContainText('旧正文已隐藏', { timeout: 10000 })
    await expect(code(f)).toHaveCount(0)
    await reader(f).getByRole('button', { name: '刷新读取当前版本', exact: true }).click()
    await expect(code(f)).toContainText('external new code')
    unlinkSync(join(f.cwd, '中文代码.ts'))
    await expect(reader(f)).toContainText('旧正文已隐藏', { timeout: 10000 })
    await expect(code(f)).toHaveCount(0)
  } finally {
    await f.close()
  }
})
test('FILE-02 Electron binary/encoding/line overflow downgrade, light/dark narrow and same-profile restart read new disk bytes without kernels', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, 'binary.dat'), Buffer.from([0, 1]))
    writeFileSync(join(f.cwd, 'invalid.txt'), Buffer.from([0xff, 0xfe, 0xa1]))
    writeFileSync(
      join(f.cwd, '分页代码.ts'),
      Array.from({ length: 420 }, (_, i) => `const line${i + 1} = ${i + 1}`).join('\n'),
    )
    const s = await f.send('代码降级与重启')
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    for (const [name, diagnostic] of [
      ['binary.dat', '二进制'],
      ['invalid.txt', '不是有效 UTF-8'],
    ] as const) {
      await browse(f, name)
      await expect(reader(f)).toContainText(diagnostic)
      await expect(code(f)).toHaveCount(0)
      await close(f)
    }
    await browse(f, '分页代码.ts')
    await expect(code(f).getByRole('row')).toHaveCount(200)
    await reader(f).getByRole('button', { name: '下一页代码', exact: true }).click()
    await expect(code(f)).toContainText('const line201 = 201')
    await reader(f).getByRole('spinbutton', { name: '选区起始行', exact: true }).fill('900')
    await reader(f).getByRole('spinbutton', { name: '选区结束行', exact: true }).fill('900')
    await expect(
      reader(f).getByRole('button', { name: '选区加入输入', exact: true }),
    ).toBeDisabled()
    await f.page.setViewportSize({ width: 802, height: 961 })
    for (const theme of ['light', 'dark'] as const) {
      await f.page.emulateMedia({ colorScheme: theme })
      await f.page.screenshot({
        path: join(
          process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest',
          `file02-${theme}-narrow.png`,
        ),
        animations: 'disabled',
      })
    }
    await f.restart()
    writeFileSync(join(f.cwd, '分页代码.ts'), 'restart current code\n')
    await f.open(s.id)
    await browse(f, '分页代码.ts')
    await expect(code(f)).toContainText('restart current code')
    expect(f.kernels.list()).toEqual([])
    expect(f.sends()).toBe(0)
  } finally {
    await f.close()
  }
})
test('FILE-02 Electron actual SDK tool final path and immutable historical Diff line open independently verified current file', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    const s = await f.send('范围写入 代码关联验收')
    await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
    await f.page.getByRole('button', { name: '明确允许本次不可回滚执行', exact: true }).click()
    await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
    const expected = readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')
    await f.page.getByRole('button', { name: /^write · 已完成/ }).click()
    await f.page
      .getByRole('button', { name: '打开工具关联的当前文件 · 第 1 行', exact: true })
      .click()
    await expect(code(f)).toContainText(expected)
    await close(f)
    await f.versions()
    await f.review()
    await f.page.getByRole('button', { name: '审查文件 APPROVED.txt', exact: true }).click()
    const diff = f.page.getByRole('region', { name: '历史Diff正文', exact: true })
    await expect(diff).toContainText(expected)
    writeFileSync(join(f.cwd, 'APPROVED.txt'), 'later external content\n')
    await diff.getByRole('button', { name: '当前文件第 1 行', exact: true }).click()
    await expect(code(f)).toContainText('later external content')
    await expect(code(f)).not.toContainText(expected)
    await close(f)
    await expect(diff).toContainText(expected)
    await expect(diff).not.toContainText('later external content')
    expect(f.sends()).toBe(1)
  } finally {
    await f.close()
  }
})
test('FILE-02 Electron synthetic assistant path/line observation stays within physical cwd and never opens system protocols', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  try {
    writeFileSync(join(f.cwd, '中文 code.ts'), 'first\nreal target line\nthird')
    const session = await f.send('保持 合成消息路径观察')
    const events = f.app.get(EventService)
    await expect.poll(() => events.snapshot(session.id)?.turns[0]?.text).toBe('OFFLINE_')
    const snapshot = events.snapshot(session.id),
      turn = snapshot?.turns[0]
    if (!snapshot || !turn?.messageId) {
      throw Error('Active synthetic message observation missing')
    }
    // Explicit synthetic observation on a real SDK hold. This validates Markdown
    // navigation only; the SDK history is neither changed nor claimed as output.
    events.publish(session.id, snapshot.epoch, turn.id, {
      type: 'message.replaced',
      messageId: turn.messageId,
      text: '[定位代码](中文%20code.ts#L2) [越界](../outside.ts#L1) [危险](javascript:alert(1))',
    })
    await f.page.getByRole('button', { name: '定位代码', exact: true }).click()
    await expect(code(f)).toContainText('real target line')
    await expect(
      reader(f).getByRole('spinbutton', { name: '选区起始行', exact: true }),
    ).toHaveValue('2')
    await expect(reader(f)).toContainText(join(f.cwd, '中文 code.ts'))
    await close(f)
    await f.page.getByRole('button', { name: '越界', exact: true }).click()
    await expect(reader(f)).toContainText('旧正文已隐藏')
    await expect(code(f)).toHaveCount(0)
    await close(f)
    await expect(f.page.getByRole('link', { name: '危险', exact: true })).toHaveCount(0)
    expect(f.sends()).toBe(1)
    await f.stop(session.id)
  } finally {
    await f.close()
  }
})
test('FILE-02 Electron delayed reference check cannot mutate a changed draft or another target, observation failure preserves actual SDK background', async () => {
  test.setTimeout(120000)
  const f = await setupChanges()
  let release: () => void = noop
  try {
    writeFileSync(join(f.cwd, 'read.ts'), 'checked reference')
    const a = await f.send('保持 代码后台')
    await f.ready(a.id)
    const before = f.kernels.list().find((k) => k.sessionId === a.id)
    await draft(f).fill('owned prior')
    await browse(f, 'read.ts')
    await expect(code(f)).toContainText('checked reference')
    let entered = false
    const gate = new Promise<void>((r) => {
      release = r
    })
    await f.page.route('**/api/files/read?*', async (route) => {
      const response = await route.fetch()
      entered = true
      await gate
      await route.fulfill({ response })
    })
    await reader(f).getByRole('button', { name: '选区加入输入', exact: true }).click()
    await expect.poll(() => entered).toBe(true)
    await close(f)
    await draft(f).fill('newer owned draft')
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await expect(draft(f)).toHaveValue('newer owned draft')
    writeFileSync(join(f.other, 'read.ts'), 'independent current bytes')
    await f.send('独立代码目标', true)
    await browse(f, 'read.ts')
    await expect(code(f)).toContainText('independent current bytes')
    await expect(reader(f)).toContainText(f.other)
    expect(f.kernels.list().find((k) => k.sessionId === a.id)).toMatchObject({
      pid: before?.pid,
      epoch: before?.epoch,
      state: 'running',
    })
    await f.page.route('**/api/files/read?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected reading failure' }),
      }),
    )
    await expect(reader(f)).toContainText('旧正文已隐藏', { timeout: 10000 })
    await expect(code(f)).toHaveCount(0)
    await f.page.unrouteAll({ behavior: 'wait' })
    await close(f)
    await f.stop(a.id)
  } finally {
    release()
    await f.page.unrouteAll({ behavior: 'wait' })
    await f.close()
  }
})
