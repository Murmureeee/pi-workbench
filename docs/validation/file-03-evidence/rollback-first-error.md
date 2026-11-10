# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: change-rollback.spec.ts >> CHANGE-05 Electron stale whole-round preflight writes nothing and injected failure shows conditional compensation; background SDK stays owned
- Location: e2e\change-rollback.spec.ts:117:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: '整轮回滚', exact: true })
Expected substring: "执行失败，已条件补偿"
Received string:    "预检整轮回滚核对回滚结果回滚失败 · 操作 193456d7-71db-4a9d-858a-bca5658a376eEPERM: operation not permitted, rename 'C:\\Users\\Murmure\\AppData\\Local\\Temp\\piw-review-ui-VOnPrB\\中文工作目录\\.pi-workbench-rollback-b1e935a6-4be8-4010-84bd-1363fb70f1df' -> 'C:\\Users\\Murmure\\AppData\\Local\\Temp\\piw-review-ui-VOnPrB\\中文工作目录\\tracked.txt'"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('region', { name: '整轮回滚', exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: '整轮回滚', exact: true })
    7 × locator resolved to <section aria-label="整轮回滚" class="rollback-actions">…</section>
      - unexpected value "预检整轮回滚核对回滚结果回滚失败 · 操作 193456d7-71db-4a9d-858a-bca5658a376eEPERM: operation not permitted, rename 'C:\Users\Murmure\AppData\Local\Temp\piw-review-ui-VOnPrB\中文工作目录\.pi-workbench-rollback-b1e935a6-4be8-4010-84bd-1363fb70f1df' -> 'C:\Users\Murmure\AppData\Local\Temp\piw-review-ui-VOnPrB\中文工作目录\tracked.txt'"

```

```yaml
- region "整轮回滚":
  - button "预检整轮回滚"
  - button "核对回滚结果"
  - status: 回滚失败 · 操作 193456d7-71db-4a9d-858a-bca5658a376e
  - paragraph: "EPERM: operation not permitted, rename 'C:\\Users\\Murmure\\AppData\\Local\\Temp\\piw-review-ui-VOnPrB\\中文工作目录\\.pi-workbench-rollback-b1e935a6-4be8-4010-84bd-1363fb70f1df' -> 'C:\\Users\\Murmure\\AppData\\Local\\Temp\\piw-review-ui-VOnPrB\\中文工作目录\\tracked.txt'"
```

# Test source

```ts
  55  |     expect(f.kernels.list()).toHaveLength(0)
  56  |     expect(f.sends()).toBe(0)
  57  |   } finally {
  58  |     await f.close()
  59  |   }
  60  | })
  61  | 
  62  | test('CHANGE-05 Electron unknown-source batch cancels without writes, then separately confirms add/delete/rename restoration in light/dark narrow window', async () => {
  63  |   test.setTimeout(120000)
  64  |   const f = await setupChanges()
  65  |   try {
  66  |     const session = await f.send('保持批量回滚')
  67  |     await f.ready(session.id)
  68  |     writeFileSync(join(f.cwd, 'added.txt'), 'new external')
  69  |     unlinkSync(join(f.cwd, 'deleted.txt'))
  70  |     renameSync(join(f.cwd, 'old-name.txt'), join(f.cwd, 'new-name.txt'))
  71  |     writeFileSync(join(f.cwd, 'tracked.txt'), 'mixed current\n')
  72  |     await f.stop(session.id)
  73  |     await f.versions()
  74  |     await f.review()
  75  |     await f.page.setViewportSize({ width: 802, height: 761 })
  76  |     await expect(f.page.getByRole('dialog', { name: '轮次修改审查', exact: true })).toBeVisible()
  77  |     await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
  78  |     await expect(
  79  |       f.page.getByRole('dialog', { name: '整批预检存在冲突', exact: true }),
  80  |     ).toBeVisible()
  81  |     await expect(f.page.getByRole('button', { name: '确认回到本轮基线', exact: true })).toHaveCount(
  82  |       0,
  83  |     )
  84  |     await f.page.getByRole('button', { name: '取消本次回滚', exact: true }).click()
  85  |     expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('mixed current\n')
  86  |     await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
  87  |     await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
  88  |     const dialog = f.page.getByRole('dialog', { name: '单独确认覆盖外部内容', exact: true })
  89  |     for (const colorScheme of ['light', 'dark'] as const) {
  90  |       await f.page.setViewportSize({ width: 802, height: 761 })
  91  |       await f.page.emulateMedia({ colorScheme })
  92  |       await expect(dialog).toContainText('不能当作 agent 独占修改')
  93  |       await expect(
  94  |         dialog.getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true }),
  95  |       ).toBeVisible()
  96  |       await f.page.screenshot({ path: join(evidence, `rollback-${colorScheme}-narrow.png`) })
  97  |       expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  98  |         true,
  99  |       )
  100 |     }
  101 |     await dialog
  102 |       .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
  103 |       .click()
  104 |     await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
  105 |       '回滚成功',
  106 |     )
  107 |     expect(existsSync(join(f.cwd, 'added.txt'))).toBe(false)
  108 |     expect(existsSync(join(f.cwd, 'new-name.txt'))).toBe(false)
  109 |     expect(readFileSync(join(f.cwd, 'old-name.txt'), 'utf8')).toBe('rename unique\n')
  110 |     expect(readFileSync(join(f.cwd, 'deleted.txt'), 'utf8')).toBe('delete me\n')
  111 |     expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('baseline\n')
  112 |   } finally {
  113 |     await f.close()
  114 |   }
  115 | })
  116 | 
  117 | test('CHANGE-05 Electron stale whole-round preflight writes nothing and injected failure shows conditional compensation; background SDK stays owned', async () => {
  118 |   test.setTimeout(120000)
  119 |   const f = await setupChanges()
  120 |   try {
  121 |     const a = await f.send('保持目标')
  122 |     await f.ready(a.id)
  123 |     writeFileSync(join(f.cwd, 'tracked.txt'), 'target after\n')
  124 |     writeFileSync(join(f.cwd, 'another.txt'), 'another')
  125 |     await f.stop(a.id)
  126 |     const b = await f.send('保持独立后台', true)
  127 |     await f.ready(b.id)
  128 |     const kernel = f.kernels.list().find((k) => k.sessionId === b.id)!
  129 |     await f.open(a.id)
  130 |     await f.versions()
  131 |     await f.review()
  132 |     await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
  133 |     await expect(
  134 |       f.page.getByRole('dialog', { name: '整批预检存在冲突', exact: true }),
  135 |     ).toBeVisible()
  136 |     writeFileSync(join(f.cwd, 'tracked.txt'), 'external since preflight')
  137 |     await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
  138 |     await f.page
  139 |       .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
  140 |       .click()
  141 |     await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
  142 |       '预检冲突，未写入',
  143 |     )
  144 |     expect(readFileSync(join(f.cwd, 'another.txt'), 'utf8')).toBe('another')
  145 |     const service = f.app.get(ChangeRollbackService),
  146 |       write = service.files.write.bind(service.files)
  147 |     let count = 0
  148 |     service.files.write = (...args) =>
  149 |       ++count === 2 ? Promise.reject(new Error('injected native-adapter failure')) : write(...args)
  150 |     await f.page.getByRole('button', { name: '预检整轮回滚', exact: true }).click()
  151 |     await f.page.getByRole('button', { name: '单独确认覆盖…', exact: true }).click()
  152 |     await f.page
  153 |       .getByRole('button', { name: '明确覆盖以上外部或未知内容并回滚', exact: true })
  154 |       .click()
> 155 |     await expect(f.page.getByRole('region', { name: '整轮回滚', exact: true })).toContainText(
      |                                                                             ^ Error: expect(locator).toContainText(expected) failed
  156 |       '执行失败，已条件补偿',
  157 |     )
  158 |     expect(readFileSync(join(f.cwd, 'another.txt'), 'utf8')).toBe('another')
  159 |     await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
  160 |     expect(f.kernels.list().find((k) => k.sessionId === b.id)).toMatchObject({
  161 |       pid: kernel.pid,
  162 |       epoch: kernel.epoch,
  163 |       state: 'running',
  164 |     })
  165 |     await f.stop(b.id)
  166 |   } finally {
  167 |     await f.close()
  168 |   }
  169 | })
  170 | 
```