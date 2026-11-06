# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-creation.spec.ts >> SESSION-01 Electron drafts, composition Enter, durable first send and continuing the same session
- Location: e2e\session-creation.spec.ts:84:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByLabel('任务状态')
Expected: "本轮已结束"
Received: "运行状态待同步"
Timeout:  15000ms

Call log:
  - Expect "toHaveText" getByLabel('任务状态') with timeout 15000ms
  - waiting for getByLabel('任务状态')
    34 × locator resolved to <output aria-label="任务状态">运行状态待同步</output>
       - unexpected value "运行状态待同步"

```

```yaml
- status "任务状态": 运行状态待同步
```

# Test source

```ts
  9   | import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
  10  | import { WorkspaceDatabase } from '../apps/daemon/dist/infrastructure/database/database.js'
  11  | import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
  12  | import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
  13  | import { launchWorkspaceDesktop } from './helpers/desktop.js'
  14  | 
  15  | const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
  16  | function firstSessionId(store: SessionStore) {
  17  |   const session = store.managedSessions()[0]
  18  |   if (!session) {
  19  |     throw new Error('Missing first-send session')
  20  |   }
  21  |   return session.id
  22  | }
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
> 109 |     await expect(page.getByLabel('任务状态')).toHaveText('本轮已结束', { timeout: 15000 })
      |                                           ^ Error: expect(locator).toHaveText(expected) failed
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
  123 |     await page
  124 |       .locator('.retained-session:not([hidden])')
  125 |       .getByTitle('首次有效任务', { exact: true })
  126 |       .click()
  127 |     await expect(box).toHaveValue('当前会话草稿')
  128 |     await page.getByRole('link', { name: '设置', exact: true }).click()
  129 |     await page.getByRole('button', { name: '后退', exact: true }).click()
  130 |     await expect(box).toHaveValue('当前会话草稿')
  131 |     await expect(page.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
  132 |     await page.getByRole('link', { name: '设置', exact: true }).click()
  133 |     await page.getByRole('link', { name: '返回工作台', exact: true }).click()
  134 |     await expect(page).toHaveURL(new RegExp(`session=${id}`))
  135 |     await expect(box).toHaveValue('当前会话草稿')
  136 |     await box.press('Enter')
  137 |     await expect(page.getByLabel('任务状态')).toHaveCount(2)
  138 |     await expect(page.getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
  139 |     expect(f.store.managedSessions()).toHaveLength(1)
  140 |     expect(f.store.submissions(id)).toHaveLength(2)
  141 |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  142 |     await expect(box).toHaveValue('新会话独立草稿')
  143 |     await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
  144 |     await page.reload()
  145 |     await expect(box).toHaveValue('新会话独立草稿')
  146 |     await expect(page.getByText(`执行目录：${draftDirectory}`, { exact: true })).toBeVisible()
  147 |     expect(f.store.managedSessions()).toHaveLength(1)
  148 |     expect(errors).toEqual([])
  149 |     await page.setViewportSize({ width: 1920, height: 1080 })
  150 |     await page.screenshot({ path: `${evidence}/session-new-light.png`, animations: 'disabled' })
  151 |   } finally {
  152 |     await f.close()
  153 |   }
  154 | })
  155 | 
  156 | test('SESSION-01 Electron preserves drafts on SQL failure and reconciles a lost accepted response after refresh without a second prompt', async () => {
  157 |   const f = await fixture(),
  158 |     { page } = f.desktop
  159 |   const requestIds: string[] = []
  160 |   page.on('request', (request) => {
  161 |     if (new URL(request.url()).pathname === '/api/chat/submit') {
  162 |       const value: unknown = request.postDataJSON()
  163 |       if (
  164 |         value &&
  165 |         typeof value === 'object' &&
  166 |         'requestId' in value &&
  167 |         typeof value.requestId === 'string'
  168 |       ) {
  169 |         requestIds.push(value.requestId)
  170 |       }
  171 |     }
  172 |   })
  173 |   try {
  174 |     const db = f.app.get(WorkspaceDatabase).sqlite,
  175 |       box = page.getByRole('textbox', { name: '任务内容' })
  176 |     db.exec(
  177 |       "CREATE TRIGGER fail_first_send BEFORE INSERT ON session_submissions BEGIN SELECT RAISE(ABORT, 'injected write failure'); END",
  178 |     )
  179 |     await box.fill('保存失败仍保留的任务')
  180 |     await page.getByRole('button', { name: '发送任务' }).click()
  181 |     await expect(page.getByRole('alert')).toContainText('会话未能保存')
  182 |     await expect(box).toHaveValue('保存失败仍保留的任务')
  183 |     expect(f.store.list()).toEqual([])
  184 |     db.exec('DROP TRIGGER fail_first_send')
  185 |     let blockLookup = true
  186 |     await page.route('**/api/chat/submissions/*', async (route) => {
  187 |       if (blockLookup) {
  188 |         await route.abort()
  189 |       } else {
  190 |         await route.fallback()
  191 |       }
  192 |     })
  193 |     await page.route('**/api/chat/submit', async (route) => {
  194 |       await forward(route)
  195 |       await route.abort()
  196 |     })
  197 |     await page.getByRole('button', { name: '发送任务' }).click()
  198 |     await expect(page.getByRole('button', { name: '核对原提交' })).toBeVisible()
  199 |     // The pending action appears before the protocol check and actual POST complete.
  200 |     await expect.poll(() => requestIds.length).toBe(2)
  201 |     await expect.poll(() => f.store.managedSessions().length).toBe(1)
  202 |     expect(requestIds[0]).toBe(requestIds[1])
  203 |     await expect(box).toHaveAttribute('readonly', '')
  204 |     await page.reload()
  205 |     await expect(box).toHaveValue('保存失败仍保留的任务')
  206 |     await expect(page.getByRole('button', { name: '核对原提交' })).toBeVisible()
  207 |     blockLookup = false
  208 |     await page.getByRole('button', { name: '核对原提交' }).click()
  209 |     await expect(page).toHaveURL(/session=/)
```