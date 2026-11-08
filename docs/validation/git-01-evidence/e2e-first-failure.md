# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git-status.spec.ts >> GIT-01 Electron light/dark narrow overview and same-data/profile restart observe current files with zero replay
- Location: e2e\git-status.spec.ts:114:1

# Error details

```
Error: expect(received).toMatch(expected)

Matcher error: received value must be a string

Received has value: null

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  28  | 
  29  | test('GIT-01 Electron actual Git overview refreshes staged, unstaged, untracked and broken index without writing metadata', async () => {
  30  |   test.setTimeout(120000)
  31  |   const f = await setupChanges()
  32  |   try {
  33  |     init(f)
  34  |     const s = await f.send('查看真实仓库')
  35  |     await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
  36  |     const index = readFileSync(join(f.cwd, '.git', 'index')),
  37  |       head = git(f.cwd, 'rev-parse', 'HEAD')
  38  |     await show(f)
  39  |     await expect(panel(f)).toContainText('staged 1 · unstaged 1 · untracked 1')
  40  |     await expect(panel(f)).toContainText('中文分支')
  41  |     await expect(panel(f)).toContainText('轮前内容一致')
  42  |     writeFileSync(join(f.cwd, '新增.txt'), 'external')
  43  |     await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
  44  |     await expect(panel(f)).toContainText('untracked 2')
  45  |     writeFileSync(join(f.cwd, '.git', 'index'), 'fault injected')
  46  |     await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
  47  |     await expect(panel(f)).toContainText('仓库状态不可用')
  48  |     await expect(panel(f).getByText('staged 1', { exact: false })).toHaveCount(0)
  49  |     writeFileSync(join(f.cwd, '.git', 'index'), index)
  50  |     await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
  51  |     await expect(panel(f)).toContainText('untracked 2')
  52  |     expect(readFileSync(join(f.cwd, '.git', 'index'))).toEqual(index)
  53  |     expect(git(f.cwd, 'rev-parse', 'HEAD')).toBe(head)
  54  |   } finally {
  55  |     await f.close()
  56  |   }
  57  | })
  58  | 
  59  | test('GIT-01 Electron failed refresh and cancelled late result never replace another target or stop background SDK', async () => {
  60  |   test.setTimeout(120000)
  61  |   const f = await setupChanges()
  62  |   try {
  63  |     init(f)
  64  |     const a = await f.send('保持仓库后台')
  65  |     await f.ready(a.id)
  66  |     await expect
  67  |       .poll(() => f.kernels.list().find((k) => k.sessionId === a.id)?.state)
  68  |       .toBe('running')
  69  |     const background = f.kernels.list().find((k) => k.sessionId === a.id)
  70  |     await show(f)
  71  |     await expect(panel(f)).toContainText('中文分支')
  72  |     await f.page.route('**/api/git/status?*', (route) =>
  73  |       route.fulfill({
  74  |         status: 503,
  75  |         contentType: 'application/json',
  76  |         body: '{"message":"injected Git read failure"}',
  77  |       }),
  78  |     )
  79  |     await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
  80  |     await expect(panel(f)).toContainText('仓库状态未同步')
  81  |     await expect(panel(f)).not.toContainText('中文分支')
  82  |     await f.page.unroute('**/api/git/status?*')
  83  |     let release: () => void = noop,
  84  |       entered = false
  85  |     const gate = new Promise<void>((done) => {
  86  |       release = done
  87  |     })
  88  |     await f.page.route('**/api/git/status?*', async (route) => {
  89  |       entered = true
  90  |       const response = await route.fetch()
  91  |       await gate
  92  |       await route.fulfill({ response })
  93  |     })
  94  |     await panel(f).getByRole('button', { name: '刷新仓库状态', exact: true }).click()
  95  |     await expect.poll(() => entered).toBe(true)
  96  |     const b = await f.send('独立目录只读', true)
  97  |     release()
  98  |     await f.page.unrouteAll({ behavior: 'wait' })
  99  |     await show(f)
  100 |     await expect(panel(f)).toContainText('非 Git 目录')
  101 |     await expect(panel(f)).not.toContainText('中文分支')
  102 |     expect(f.kernels.list().find((k) => k.sessionId === a.id)).toMatchObject({
  103 |       pid: background?.pid,
  104 |       epoch: background?.epoch,
  105 |       state: 'running',
  106 |     })
  107 |     expect(b.cwd).toBe(f.other)
  108 |     await f.stop(a.id)
  109 |   } finally {
  110 |     await f.close()
  111 |   }
  112 | })
  113 | 
  114 | test('GIT-01 Electron light/dark narrow overview and same-data/profile restart observe current files with zero replay', async () => {
  115 |   test.setTimeout(120000)
  116 |   const f = await setupChanges()
  117 |   try {
  118 |     init(f)
  119 |     const s = await f.send('仓库重启验收')
  120 |     await expect.poll(() => f.changes.history(s.id).rounds[0]?.outcome).toBe('completed')
  121 |     await show(f)
  122 |     await expect(panel(f)).toContainText('中文 未跟踪.txt')
  123 |     await f.page.setViewportSize({ width: 802, height: 961 })
  124 |     for (const theme of ['light', 'dark'] as const) {
  125 |       await f.page.emulateMedia({ colorScheme: theme })
  126 |       await expect
  127 |         .poll(() => f.page.locator('html').getAttribute('class'))
> 128 |         .toMatch(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
      |          ^ Error: expect(received).toMatch(expected)
  129 |       await f.page.screenshot({
  130 |         path: join(evidence, `git01-${theme}-narrow.png`),
  131 |         animations: 'disabled',
  132 |       })
  133 |     }
  134 |     await f.restart()
  135 |     expect(f.sends()).toBe(0)
  136 |     expect(f.kernels.list()).toHaveLength(0)
  137 |     await f.open(s.id)
  138 |     await show(f)
  139 |     await expect(panel(f)).toContainText('staged 1 · unstaged 1 · untracked 1')
  140 |     expect(f.sends()).toBe(0)
  141 |     expect(f.kernels.list()).toHaveLength(0)
  142 |   } finally {
  143 |     await f.close()
  144 |   }
  145 | })
  146 | 
```