# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: change-rollback-history.spec.ts >> CHANGE-09 Electron durable rollback details survive restart; actual SDK gets facts once and historical messages remain
- Location: e2e\change-rollback-history.spec.ts:8:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "completed"
Received: "active"
```

# Test source

```ts
  1  | import { readFileSync, writeFileSync } from 'node:fs'
  2  | import { join } from 'node:path'
  3  | 
  4  | import { expect, test } from '@playwright/test'
  5  | 
  6  | import { setupChanges } from './helpers/change-fixture.js'
  7  | 
  8  | test('CHANGE-09 Electron durable rollback details survive restart; actual SDK gets facts once and historical messages remain', async () => {
  9  |   test.setTimeout(120000)
  10 |   const f = await setupChanges()
  11 |   try {
  12 |     const a = await f.send('保持回滚记录目标')
  13 |     await f.ready(a.id)
  14 |     writeFileSync(join(f.cwd, 'tracked.txt'), 'historical change')
  15 |     await f.stop(a.id)
  16 |     const native = f.kernels.list().find((k) => k.sessionId === a.id)!.sessionFile!,
  17 |       prior = readFileSync(native)
  18 |     await f.versions()
  19 |     await f.review()
  20 |     await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
  21 |     await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
  22 |     await f.page
  23 |       .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
  24 |       .click()
  25 |     await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
  26 |       '回滚成功',
  27 |     )
  28 |     await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
  29 |     await f.page.getByRole('button', { name: '查看持久回滚记录', exact: true }).click()
  30 |     const history = () => f.page.getByRole('region', { name: '持久回滚记录', exact: true })
  31 |     await expect(history()).toContainText('回滚成功')
  32 |     await history()
  33 |       .getByRole('button', { name: /^回滚详情 / })
  34 |       .click()
  35 |     const detail = () => f.page.getByRole('region', { name: '持久回滚详情', exact: true })
  36 |     await expect(detail()).toContainText('实际操作前')
  37 |     await expect(detail()).toContainText('已保存')
  38 |     await expect(detail()).toContainText('tracked.txt')
  39 |     expect(readFileSync(native)).toEqual(prior)
  40 |     await f.restart()
  41 |     expect(f.sends()).toBe(0)
  42 |     expect(f.kernels.list()).toHaveLength(0)
  43 |     await f.open(a.id)
  44 |     await f.versions()
  45 |     await f.page.getByRole('button', { name: '查看持久回滚记录', exact: true }).click()
  46 |     await expect(history()).toContainText('回滚成功')
  47 |     await history()
  48 |       .getByRole('button', { name: /^回滚详情 / })
  49 |       .click()
  50 |     await expect(detail()).toContainText('消息保留')
  51 |     expect(readFileSync(native)).toEqual(prior)
  52 |     const b = await f.send('环境上下文 核对文件回滚事实')
  53 |     await expect(f.page.getByRole('region', { name: '受管会话消息', exact: true })).toContainText(
  54 |       '文件回滚未撤销消息历史',
  55 |       { timeout: 30000 },
  56 |     )
  57 |     expect(f.sends()).toBe(1)
> 58 |     expect(f.changes.history(b.id).rounds[0]?.outcome).toBe('completed')
     |                                                        ^ Error: expect(received).toBe(expected) // Object.is equality
  59 |   } finally {
  60 |     await f.close()
  61 |   }
  62 | })
  63 | 
  64 | test('CHANGE-09 Electron failed durable history query exposes retry and never borrows another session record', async () => {
  65 |   test.setTimeout(90000)
  66 |   const f = await setupChanges()
  67 |   try {
  68 |     const a = await f.send('记录查询失败')
  69 |     await expect.poll(() => f.changes.history(a.id).rounds[0]?.outcome).toBe('completed')
  70 |     await f.versions()
  71 |     await f.page.route('**/api/changes/rollback/history?*', (route) =>
  72 |       route.fulfill({
  73 |         status: 503,
  74 |         contentType: 'application/json',
  75 |         body: JSON.stringify({ message: 'injected history failure' }),
  76 |       }),
  77 |     )
  78 |     await f.page.getByRole('button', { name: '查看持久回滚记录', exact: true }).click()
  79 |     const history = f.page.getByRole('region', { name: '持久回滚记录', exact: true })
  80 |     await expect(history).toContainText('持久回滚记录未同步')
  81 |     await f.page.unroute('**/api/changes/rollback/history?*')
  82 |     await history.getByRole('button', { name: '刷新回滚记录', exact: true }).click()
  83 |     await expect(history).toContainText('尚无回滚记录')
  84 |   } finally {
  85 |     await f.close()
  86 |   }
  87 | })
  88 | 
```