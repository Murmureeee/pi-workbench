# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-creation.spec.ts >> SESSION-01 Electron drafts, composition Enter, durable first send and continuing the same session
- Location: e2e\session-creation.spec.ts:84:1

# Error details

```
Error: locator.click: Error: strict mode violation: getByTitle('首次有效任务', { exact: true }) resolved to 2 elements:
    1) <button tabindex="0" type="button" title="首次有效任务" data-slot="button" class="group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-de…>…</button> aka getByRole('button', { name: '首次有效任务 未读' })
    2) <button tabindex="0" type="button" title="首次有效任务" data-slot="button" aria-current="page" class="group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 …>…</button> aka getByText('首次有效任务未读').nth(1)

Call log:
  - waiting for getByTitle('首次有效任务', { exact: true })

```

# Test source

```ts
  23  | function forward(route: Route) {
  24  |   const url = new URL(route.request().url())
  25  |   return route.fetch({
  26  |     url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
  27  |     headers: {
  28  |       ...route.request().headers(),
  29  |       host: '127.0.0.1:4318',
  30  |       origin: 'http://127.0.0.1:5173',
  31  |     },
  32  |   })
  33  | }
  34  | /** Real Electron main/preload/parent identity, actual SQLite and pi SDK subprocess/local HTTP
  35  |  * fixture. HTTP loss, SQL trigger and fixture error below are explicit fault injections.
  36  |  */
  37  | async function fixture(configured = false) {
  38  |   const directory = mkdtempSync(join(tmpdir(), 'piw-session-ui-')),
  39  |     pi = join(directory, 'pi')
  40  |   mkdirSync(pi)
  41  |   const modelPath = join(pi, 'models.json')
  42  |   writeFileSync(
  43  |     modelPath,
  44  |     JSON.stringify({
  45  |       providers: {
  46  |         existing: {
  47  |           api: 'openai-completions',
  48  |           baseUrl: 'https://fixture.invalid/v1',
  49  |           apiKey: 'synthetic-first-send-secret',
  50  |           models: [{ id: 'code', name: '已有编码模型' }],
  51  |         },
  52  |       },
  53  |     }),
  54  |   )
  55  |   const app = await createApp({
  56  |     dataDir: join(directory, 'data'),
  57  |     port: 4318,
  58  |     development: true,
  59  |     ...(configured ? { piAgentDir: pi } : {}),
  60  |   })
  61  |   await app.listen(4318, '127.0.0.1')
  62  |   try {
  63  |     const desktop = await launchWorkspaceDesktop(directory, app)
  64  |     await expect(desktop.page.getByLabel('模型', { exact: true })).toBeEnabled()
  65  |     return {
  66  |       directory,
  67  |       app,
  68  |       desktop,
  69  |       modelPath,
  70  |       store: app.get(SessionStore),
  71  |       close: async () => {
  72  |         await desktop.close()
  73  |         await app.close()
  74  |         rmSync(directory, { recursive: true, force: true })
  75  |       },
  76  |     }
  77  |   } catch (error) {
  78  |     await app.close()
  79  |     rmSync(directory, { recursive: true, force: true })
  80  |     throw error
  81  |   }
  82  | }
  83  | 
  84  | test('SESSION-01 Electron drafts, composition Enter, durable first send and continuing the same session', async () => {
  85  |   const f = await fixture(),
  86  |     { page } = f.desktop,
  87  |     errors: string[] = []
  88  |   page.on('pageerror', (error) => errors.push(error.message))
  89  |   try {
  90  |     const box = page.getByRole('textbox', { name: '任务内容' }),
  91  |       send = page.getByRole('button', { name: '发送任务' })
  92  |     await box.fill('尚未发送的独立草稿')
  93  |     await page.reload()
  94  |     await expect(box).toHaveValue('尚未发送的独立草稿')
  95  |     await expect(page.getByLabel('项目', { exact: true })).toHaveValue('')
  96  |     expect(f.store.list()).toEqual([])
  97  |     await box.dispatchEvent('compositionstart')
  98  |     await box.press('Enter')
  99  |     expect(await box.inputValue()).toContain('尚未发送的独立草稿')
  100 |     expect(f.store.list()).toEqual([])
  101 |     await box.dispatchEvent('compositionend')
  102 |     await box.fill('尚未发送的独立草稿')
  103 |     await box.press('Shift+Enter')
  104 |     await expect(box).toHaveValue('尚未发送的独立草稿\n')
  105 |     await box.fill('首次有效任务')
  106 |     await expect(send).toBeEnabled()
  107 |     await send.dblclick()
  108 |     await expect(page).toHaveURL(/session=/)
  109 |     await expect(page.getByLabel('任务状态')).toHaveText('本轮已结束', { timeout: 15000 })
  110 |     await expect(page.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
  111 |     expect(f.store.managedSessions()).toHaveLength(1)
  112 |     const id = firstSessionId(f.store)
  113 |     expect(f.store.submissions(id)).toHaveLength(1)
  114 |     await box.fill('当前会话草稿')
  115 |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  116 |     await box.fill('新会话独立草稿')
  117 |     const draftDirectory = join(f.directory, 'draft-directory')
  118 |     mkdirSync(draftDirectory)
  119 |     await page.getByText('执行目录：独立目录', { exact: true }).click()
  120 |     await f.desktop.setSelection(draftDirectory)
  121 |     await page.getByRole('button', { name: '选择文件夹', exact: true }).click()
  122 |     await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
> 123 |     await page.getByTitle('首次有效任务', { exact: true }).click()
      |                                                      ^ Error: locator.click: Error: strict mode violation: getByTitle('首次有效任务', { exact: true }) resolved to 2 elements:
  124 |     await expect(box).toHaveValue('当前会话草稿')
  125 |     await page.getByRole('link', { name: '设置', exact: true }).click()
  126 |     await page.getByRole('button', { name: '后退', exact: true }).click()
  127 |     await expect(box).toHaveValue('当前会话草稿')
  128 |     await expect(page.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
  129 |     await page.getByRole('link', { name: '设置', exact: true }).click()
  130 |     await page.getByRole('link', { name: '返回工作台', exact: true }).click()
  131 |     await expect(page).toHaveURL(new RegExp(`session=${id}`))
  132 |     await expect(box).toHaveValue('当前会话草稿')
  133 |     await box.press('Enter')
  134 |     await expect(page.getByLabel('任务状态')).toHaveCount(2)
  135 |     await expect(page.getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
  136 |     expect(f.store.managedSessions()).toHaveLength(1)
  137 |     expect(f.store.submissions(id)).toHaveLength(2)
  138 |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  139 |     await expect(box).toHaveValue('新会话独立草稿')
  140 |     await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
  141 |     await page.reload()
  142 |     await expect(box).toHaveValue('新会话独立草稿')
  143 |     await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
  144 |     expect(f.store.managedSessions()).toHaveLength(1)
  145 |     expect(errors).toEqual([])
  146 |     await page.setViewportSize({ width: 1920, height: 1080 })
  147 |     await page.screenshot({ path: `${evidence}/session-new-light.png`, animations: 'disabled' })
  148 |   } finally {
  149 |     await f.close()
  150 |   }
  151 | })
  152 | 
  153 | test('SESSION-01 Electron preserves drafts on SQL failure and reconciles a lost accepted response after refresh without a second prompt', async () => {
  154 |   const f = await fixture(),
  155 |     { page } = f.desktop
  156 |   const requestIds: string[] = []
  157 |   page.on('request', (request) => {
  158 |     if (new URL(request.url()).pathname === '/api/chat/submit') {
  159 |       const value: unknown = request.postDataJSON()
  160 |       if (
  161 |         value &&
  162 |         typeof value === 'object' &&
  163 |         'requestId' in value &&
  164 |         typeof value.requestId === 'string'
  165 |       ) {
  166 |         requestIds.push(value.requestId)
  167 |       }
  168 |     }
  169 |   })
  170 |   try {
  171 |     const db = f.app.get(WorkspaceDatabase).sqlite,
  172 |       box = page.getByRole('textbox', { name: '任务内容' })
  173 |     db.exec(
  174 |       "CREATE TRIGGER fail_first_send BEFORE INSERT ON session_submissions BEGIN SELECT RAISE(ABORT, 'injected write failure'); END",
  175 |     )
  176 |     await box.fill('保存失败仍保留的任务')
  177 |     await page.getByRole('button', { name: '发送任务' }).click()
  178 |     await expect(page.getByRole('alert')).toContainText('会话未能保存')
  179 |     await expect(box).toHaveValue('保存失败仍保留的任务')
  180 |     expect(f.store.list()).toEqual([])
  181 |     db.exec('DROP TRIGGER fail_first_send')
  182 |     let blockLookup = true
  183 |     await page.route('**/api/chat/submissions/*', async (route) => {
  184 |       if (blockLookup) {
  185 |         await route.abort()
  186 |       } else {
  187 |         await route.fallback()
  188 |       }
  189 |     })
  190 |     await page.route('**/api/chat/submit', async (route) => {
  191 |       await forward(route)
  192 |       await route.abort()
  193 |     })
  194 |     await page.getByRole('button', { name: '发送任务' }).click()
  195 |     await expect(page.getByRole('button', { name: '核对原提交' })).toBeVisible()
  196 |     expect(requestIds).toHaveLength(2)
  197 |     expect(requestIds[0]).toBe(requestIds[1])
  198 |     await expect(box).toHaveAttribute('readonly', '')
  199 |     await page.reload()
  200 |     await expect(box).toHaveValue('保存失败仍保留的任务')
  201 |     await expect(page.getByRole('button', { name: '核对原提交' })).toBeVisible()
  202 |     blockLookup = false
  203 |     await page.getByRole('button', { name: '核对原提交' }).click()
  204 |     await expect(page).toHaveURL(/session=/)
  205 |     await expect(page.getByLabel('任务状态')).toHaveText('本轮已结束', { timeout: 15000 })
  206 |     expect(f.store.managedSessions()).toHaveLength(1)
  207 |     expect(f.store.submissions(firstSessionId(f.store))).toHaveLength(1)
  208 |     await expect(box).toHaveValue('')
  209 |   } finally {
  210 |     await f.close()
  211 |   }
  212 | })
  213 | 
  214 | test('SESSION-01 Electron project entry preselects its verified directory, global new resets attribution, themes and narrow layout stay usable', async () => {
  215 |   const f = await fixture(),
  216 |     { page } = f.desktop,
  217 |     directory = join(f.directory, 'project')
  218 |   mkdirSync(directory)
  219 |   try {
  220 |     await page.getByText('执行目录：独立目录', { exact: true }).click()
  221 |     await page.getByLabel('目录绝对路径（可选）').fill(directory)
  222 |     await page.getByRole('button', { name: '校验此目录' }).click()
  223 |     await expect(page.getByText(`执行目录：${directory}`, { exact: true })).toBeVisible()
```