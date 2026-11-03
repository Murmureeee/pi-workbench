# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-search.spec.ts >> SESSION-12 Electron searches Chinese title/user/assistant and opens the precise old message without creating a run or losing the draft
- Location: e2e\session-search.spec.ts:42:1

# Error details

```
Error: expect(locator).toBeInViewport() failed

Locator:  locator('[data-search-located="true"]')
Expected: in viewport
Received: viewport ratio 0
Timeout:  5000ms

Call log:
  - Expect "toBeInViewport" locator('[data-search-located="true"]') with timeout 5000ms
  - waiting for locator('[data-search-located="true"]')
    14 × locator resolved to <div data-scroll-anchor="false" data-search-located="true" data-slot="message-scroller-item" data-message-id="73ebdda2-4ecc-4ab8-a016-13730177c267:entry-4" data-reading-id="73ebdda2-4ecc-4ab8-a016-13730177c267:entry-4" class="min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]">…</div>
       - unexpected value "viewport ratio 0"

```

```yaml
- text: 你 · pi 原生历史 芝麻用户定位 中文长历史
```

# Test source

```ts
  1   | import assert from 'node:assert/strict'
  2   | import { randomUUID } from 'node:crypto'
  3   | import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
  4   | import { tmpdir } from 'node:os'
  5   | import { join } from 'node:path'
  6   | import process from 'node:process'
  7   | 
  8   | import { expect, test } from '@playwright/test'
  9   | 
  10  | import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
  11  | import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
  12  | import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
  13  | import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
  14  | import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
  15  | import { ProjectService } from '../apps/daemon/dist/modules/workspaces/project.service.js'
  16  | import { seedSearchSession } from '../apps/daemon/test/helpers/search.js'
  17  | import { launchWorkspaceDesktop } from './helpers/desktop.js'
  18  | 
  19  | const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
  20  | async function fixture(count = 3) {
  21  |   const directory = mkdtempSync(join(tmpdir(), 'piw-search-ui-')), data = join(directory, 'data')
  22  |   mkdirSync(data)
  23  |   const app = await createApp({ dataDir: data, port: 4318, development: true })
  24  |   await app.listen(4318, '127.0.0.1')
  25  |   const projectService = app.get(ProjectService)
  26  |   const a = await projectService.create({ requestId: randomUUID(), name: '同名项目', workspaceId: null }), b = await projectService.create({ requestId: randomUUID(), name: '同名项目', workspaceId: null })
  27  |   const first = await seedSearchSession(app, data, '中文标题甲', Array.from({ length: 132 }, (_, index) => index === 4 ? '芝麻用户定位 中文长历史' : index === 5 ? '芝麻助手定位 答复' : `历史上下文 ${index}`), a.id)
  28  |   const second = await seedSearchSession(app, data, '中文标题乙', ['另一用户输入', '尾部秘密 api_key=redact-me-search 后文助手可见'], b.id)
  29  |   const third = await seedSearchSession(app, data, '无项目备忘', ['无项目用户内容', '独立会话回答'])
  30  |   const store = app.get(SessionStore)
  31  |   store.organize(third.session.id, { action: 'archive', archived: true, expectedRevision: store.organizations().find(row => row.sessionId === third.session.id)!.revision })
  32  |   for (let index = 3; index < count; index++) { await seedSearchSession(app, data, `分页最近 ${index}`) }
  33  |   const desktop = await launchWorkspaceDesktop(directory, app), { page } = desktop
  34  |   await page.setViewportSize({ width: 1920, height: 1080 })
  35  |   const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  36  |   const dialog = page.getByRole('dialog'), input = page.getByRole('textbox', { name: '标题或消息正文', exact: true })
  37  |   const open = async () => { await page.keyboard.press('Control+k'); await expect(dialog).toBeVisible(); await expect(input).toBeFocused() }
  38  |   return { app, directory, first, second, third, a, b, store, desktop, page, errors, dialog, input, open,
  39  |     close: async () => { await desktop.close(); await app.close(); rmSync(directory, { recursive: true, force: true }) } }
  40  | }
  41  | 
  42  | test('SESSION-12 Electron searches Chinese title/user/assistant and opens the precise old message without creating a run or losing the draft', async () => {
  43  |   const f = await fixture()
  44  |   try {
  45  |     const composer = f.page.getByRole('textbox', { name: '任务内容', exact: true })
  46  |     await composer.fill('未发送草稿保留')
  47  |     await f.open()
  48  |     await f.input.fill('芝麻用户定位')
  49  |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
  50  |     await expect(f.dialog.getByRole('button', { name: /用户正文命中/ })).toContainText('芝麻用户定位')
  51  |     await f.input.press('ArrowDown')
  52  |     await expect(f.dialog.getByRole('button', { name: /用户正文命中/ })).toBeFocused()
  53  |     await f.page.keyboard.press('Enter')
  54  |     await expect(f.dialog).toHaveCount(0)
  55  |     const target = f.page.locator('[data-search-located="true"]')
  56  |     await expect(target).toContainText('芝麻用户定位')
> 57  |     await expect(target).toBeInViewport()
      |                          ^ Error: expect(locator).toBeInViewport() failed
  58  |     await expect(f.page.getByLabel('历史载入状态')).toContainText('本页')
  59  |     await f.page.getByRole('button', { name: '新会话', exact: true }).click()
  60  |     await expect(composer).toHaveValue('未发送草稿保留')
  61  |     await f.open(); await f.input.fill('芝麻助手定位')
  62  |     await expect(f.dialog.getByRole('button', { name: /助手正文命中/ })).toBeVisible()
  63  |     await f.input.press('Enter')
  64  |     await expect(f.page.locator('[data-search-located="true"]')).toContainText('芝麻助手定位')
  65  |     await f.open(); await f.input.fill('中文标题乙')
  66  |     await f.dialog.getByRole('button', { name: /标题命中/ }).click()
  67  |     await expect(f.page).toHaveURL(new RegExp(`session=${f.second.session.id}$`))
  68  |     await expect(f.page.getByRole('button', { name: '历史记录', exact: true })).toBeVisible()
  69  |     expect(f.app.get(KernelService).list()).toEqual([])
  70  |     expect(f.store.managedSessions()).toHaveLength(3)
  71  |     expect(f.errors).toEqual([])
  72  |   } finally { await f.close() }
  73  | })
  74  | 
  75  | test('SESSION-12 Electron project/status/time/archive filters, empty clear and redacted snippets work in light/dark narrow layouts', async () => {
  76  |   const f = await fixture()
  77  |   try {
  78  |     await f.open()
  79  |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 2 个会话')
  80  |     const project = f.page.getByLabel('项目范围', { exact: true })
  81  |     await expect(project.locator('option')).toHaveCount(4)
  82  |     await project.selectOption(f.a.id)
  83  |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
  84  |     await expect(f.dialog.getByRole('button', { name: /最近会话/ })).toContainText(f.a.id.slice(0, 8))
  85  |     await project.selectOption('none')
  86  |     await expect(f.page.getByText('没有匹配的会话', { exact: true })).toBeVisible()
  87  |     await f.page.getByLabel('归档范围', { exact: true }).selectOption('all')
  88  |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
  89  |     await expect(f.dialog.getByRole('button', { name: /最近会话/ })).toContainText('已归档')
  90  |     await f.page.getByRole('button', { name: '清除筛选', exact: true }).click()
  91  |     await f.page.getByLabel('会话状态', { exact: true }).selectOption('failed')
  92  |     await expect(f.page.getByText('没有匹配的会话', { exact: true })).toBeVisible()
  93  |     await f.page.getByLabel('会话状态', { exact: true }).selectOption('completed')
  94  |     await f.page.getByLabel('更新时间起始', { exact: true }).fill('2099-01-01')
  95  |     await expect(f.page.getByText('没有匹配的会话', { exact: true })).toBeVisible()
  96  |     await f.page.getByLabel('更新时间截止', { exact: true }).fill('2000-01-01')
  97  |     await expect(f.page.getByLabel('搜索状态')).toContainText('起始日期不能晚于')
  98  |     await f.page.getByRole('button', { name: '清除筛选', exact: true }).click()
  99  |     await f.input.fill('后文助手可见')
  100 |     await expect(f.dialog.getByRole('button', { name: /助手正文命中/ })).toContainText('«redacted»')
  101 |     await expect(f.dialog).not.toContainText('redact-me-search')
  102 |     await f.page.screenshot({ path: `${evidence}/session-12-search-light-1920.png`, animations: 'disabled' })
  103 |     await f.page.emulateMedia({ colorScheme: 'dark' })
  104 |     await f.page.setViewportSize({ width: 800, height: 800 })
  105 |     await expect(f.page.locator('html')).toHaveClass(/dark/)
  106 |     const width = await f.page.evaluate(() => innerWidth)
  107 |     const bounds = await f.dialog.boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
  108 |     await f.page.screenshot({ path: `${evidence}/session-12-search-dark-800.png`, animations: 'disabled' })
  109 |     expect(f.errors).toEqual([])
  110 |   } finally { await f.close() }
  111 | })
  112 | 
  113 | test('SESSION-12 Electron paginates recent results, resets page on filters and refreshes rename/archive/project removal while open', async () => {
  114 |   const f = await fixture(24)
  115 |   try {
  116 |     await f.open()
  117 |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 23 个会话 · 第 1 页')
  118 |     await expect(f.dialog.locator('.session-search-result')).toHaveCount(20)
  119 |     const before = await f.dialog.locator('.session-search-result').allTextContents()
  120 |     await f.page.getByRole('button', { name: '下一页', exact: true }).click()
  121 |     await expect(f.page.getByLabel('搜索状态')).toContainText('第 2 页')
  122 |     await expect(f.dialog.locator('.session-search-result')).toHaveCount(3)
  123 |     const after = await f.dialog.locator('.session-search-result').allTextContents()
  124 |     expect(new Set([...before, ...after]).size).toBe(23)
  125 |     await f.input.fill('中文标题甲')
  126 |     await expect(f.page.getByLabel('搜索状态')).toContainText('第 1 页')
  127 |     f.app.get(SessionService).rename(f.first.session.id, { title: '改名已更新检索', expectedVersion: 1 })
  128 |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 0 个会话')
  129 |     await f.input.fill('改名已更新检索')
  130 |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
  131 |     await f.page.getByLabel('项目范围', { exact: true }).selectOption(f.a.id)
  132 |     f.app.get(SessionService).organizeProject(f.a.id, { action: 'remove', expectedRevision: f.a.revision })
  133 |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 0 个会话')
  134 |     await f.page.getByLabel('项目范围', { exact: true }).selectOption('none')
  135 |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
  136 |     f.store.organize(f.first.session.id, { action: 'archive', archived: true, expectedRevision: f.store.organizations().find(row => row.sessionId === f.first.session.id)!.revision })
  137 |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 0 个会话')
  138 |     await f.page.getByLabel('归档范围', { exact: true }).selectOption('archived')
  139 |     await expect(f.page.getByLabel('搜索状态')).toContainText('共 1 个会话')
  140 |   } finally { await f.close() }
  141 | })
  142 | 
  143 | test('SESSION-12 Electron debounces 200ms, isolates late A/B/A and closed queries, retains filters after failure, protects synthetic IME', async () => {
  144 |   const f = await fixture()
  145 |   try {
  146 |     await f.open(); await expect(f.page.getByLabel('搜索状态')).toContainText('共 2 个会话')
  147 |     const requests: string[] = []
  148 |     let release: (() => void) | undefined, holdQuery = '中文标题甲', fail = false
  149 |     await f.page.route('**/api/chat/search?**', async route => {
  150 |       const url = new URL(route.request().url()), q = url.searchParams.get('q') ?? ''; requests.push(q)
  151 |       if (fail) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '离线查询失败夹具' }) }); return }
  152 |       const response = await route.fetch({ url: `http://127.0.0.1:4318${url.pathname}${url.search}`, headers: { ...route.request().headers(), host: '127.0.0.1:4318', origin: 'http://127.0.0.1:5173' } })
  153 |       if (q === holdQuery) { holdQuery = ''; await new Promise<void>(done => { release = done }) }
  154 |       await route.fulfill({ response })
  155 |     })
  156 |     await f.input.fill('中'); await f.page.waitForTimeout(70); await f.input.fill('中文'); await f.page.waitForTimeout(70); await f.input.fill('中文标题甲')
  157 |     await f.page.waitForTimeout(100)
```