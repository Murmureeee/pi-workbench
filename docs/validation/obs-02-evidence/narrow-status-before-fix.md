# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace-recovery.spec.ts >> WS-07 Electron untrusted resource notice, moved-directory recovery, physical-only relocation, draft/history preservation and light/dark narrow layouts
- Location: e2e\workspace-recovery.spec.ts:117:1

# Error details

```
Error: expect(locator).toBeInViewport() failed

Locator:  locator('.retained-session:not([hidden])').getByRole('button', { name: '发送任务' })
Expected: in viewport
Received: viewport ratio 0.4347098171710968
Timeout:  5000ms

Call log:
  - Expect "toBeInViewport" locator('.retained-session:not([hidden])').getByRole('button', { name: '发送任务' }) with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').getByRole('button', { name: '发送任务' })
    14 × locator resolved to <button disabled tabindex="0" type="button" data-disabled="" aria-label="发送任务" data-slot="button" class="group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 ar…>…</button>
       - unexpected value "viewport ratio 0.4347098171710968"

```

```yaml
- button "发送任务" [disabled]
```

# Test source

```ts
  66  |         }
  67  |       }
  68  |     })
  69  |     await desktop.page.reload()
  70  |   }
  71  |   await wire()
  72  |   const errors: string[] = []
  73  |   desktop.page.on('pageerror', (error) => errors.push(error.message))
  74  |   return {
  75  |     cwd,
  76  |     directory,
  77  |     dataDir,
  78  |     project,
  79  |     marker,
  80  |     workspaceId: opened.workspace.id,
  81  |     errors,
  82  |     get app() {
  83  |       return app
  84  |     },
  85  |     get desktop() {
  86  |       return desktop
  87  |     },
  88  |     restart: async () => {
  89  |       await desktop.close()
  90  |       await app.close()
  91  |       app = await createApp({ dataDir, port: 4318, development: true })
  92  |       await app.listen(4318, '127.0.0.1')
  93  |       desktop = await launchWorkspaceDesktop(directory, app)
  94  |       desktop.page.on('pageerror', (error) => errors.push(error.message))
  95  |       await wire()
  96  |     },
  97  |     close: async () => {
  98  |       await desktop.close()
  99  |       await app.close()
  100 |       rmSync(directory, { recursive: true, force: true })
  101 |     },
  102 |   }
  103 | }
  104 | const pane = (f: Awaited<ReturnType<typeof fixture>>) =>
  105 |   f.desktop.page.locator('.retained-session:not([hidden])')
  106 | async function send(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  107 |   await pane(f).getByRole('textbox', { name: '任务内容' }).fill(text)
  108 |   await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeEnabled()
  109 |   await pane(f).getByRole('button', { name: '发送任务' }).click()
  110 |   await expect(pane(f).getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
  111 |   return f.app
  112 |     .get(SessionStore)
  113 |     .managedSessions()
  114 |     .find((row) => row.title === text)!
  115 | }
  116 | 
  117 | test('WS-07 Electron untrusted resource notice, moved-directory recovery, physical-only relocation, draft/history preservation and light/dark narrow layouts', async () => {
  118 |   const f = await fixture()
  119 |   try {
  120 |     const page = f.desktop.page
  121 |     await pane(f).getByLabel('项目', { exact: true }).selectOption(f.project.id)
  122 |     const first = await send(f, '目录恢复与历史')
  123 |     await expect(pane(f).getByRole('region', { name: '工作区信任与恢复' })).toContainText('未确认')
  124 |     expect(f.app.get(TrustService).inspect().records).toEqual([])
  125 |     expect(existsSync(f.marker)).toBe(false)
  126 |     await f.app.get(KernelService).destroy(first.id)
  127 |     const native = f.app.get(SessionStore).resumeRuntime(first.id, f.cwd)!,
  128 |       before = readFileSync(native.sessionFile)
  129 |     const moved = join(f.directory, '移动后中文目录')
  130 |     renameSync(f.cwd, moved)
  131 |     await pane(f).getByRole('textbox', { name: '任务内容' }).fill('失效期间保留的中文草稿')
  132 |     await expect(pane(f).getByText('执行目录不可用，发送已阻止', { exact: true })).toBeVisible()
  133 |     await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeDisabled()
  134 |     await expect(pane(f).getByText('OFFLINE_OK', { exact: true })).toBeVisible()
  135 |     await pane(f).getByRole('button', { name: '重新定位同一目录' }).click()
  136 |     const dialog = page.getByRole('dialog', { name: '重新定位工作区' })
  137 |     await expect(dialog.getByLabel('新的目录位置')).toHaveValue(f.cwd)
  138 |     await dialog.getByLabel('新的目录位置').fill(f.directory)
  139 |     await dialog.getByRole('button', { name: '保存位置', exact: true }).click()
  140 |     await expect(dialog).toContainText('另一个目录')
  141 |     await expect(dialog.getByLabel('新的目录位置')).toHaveValue(f.directory)
  142 |     await f.desktop.setSelection(moved)
  143 |     await dialog.getByRole('button', { name: '选择新的文件夹' }).click()
  144 |     expect(f.app.get(WorkspaceService).lookup(f.workspaceId)?.canonicalPath).toBe(f.cwd)
  145 |     await dialog.getByRole('button', { name: '保存位置', exact: true }).click()
  146 |     await expect(dialog).toHaveCount(0)
  147 |     await expect(pane(f).getByRole('region', { name: '工作区信任与恢复' })).toContainText(
  148 |       '工作区已重新定位',
  149 |     )
  150 |     await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue(
  151 |       '失效期间保留的中文草稿',
  152 |     )
  153 |     expect(f.app.get(SessionStore).managedSessions()[0]?.cwd).toBe(f.cwd)
  154 |     expect(readFileSync(native.sessionFile)).toEqual(before)
  155 |     expect(f.app.get(KernelService).list()).toEqual([])
  156 |     await page.emulateMedia({ colorScheme: 'light' })
  157 |     await page.setViewportSize({ width: 1920, height: 1080 })
  158 |     await page.screenshot({
  159 |       path: `${evidence}/workspace-recovery-light.png`,
  160 |       animations: 'disabled',
  161 |     })
  162 |     await page.emulateMedia({ colorScheme: 'dark' })
  163 |     await page.setViewportSize({ width: 800, height: 760 })
  164 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  165 |     await expect(pane(f).getByRole('button', { name: '重新校验执行目录' })).toBeInViewport()
> 166 |     await expect(pane(f).getByRole('button', { name: '发送任务' })).toBeInViewport({ ratio: 1 })
      |                                                                 ^ Error: expect(locator).toBeInViewport() failed
  167 |     const viewport = await pane(f)
  168 |       .getByLabel('受管会话消息')
  169 |       .evaluate((element) => ({
  170 |         height: element.clientHeight,
  171 |         top: element.scrollTop,
  172 |         total: element.scrollHeight,
  173 |       }))
  174 |     expect(viewport.height).toBeGreaterThanOrEqual(120)
  175 |     // Resizing retains the reading anchor. Explicitly scroll to inspect the older reply.
  176 |     await pane(f).getByText('OFFLINE_OK', { exact: true }).scrollIntoViewIfNeeded()
  177 |     await expect(pane(f).getByText('OFFLINE_OK', { exact: true })).toBeInViewport({ ratio: 1 })
  178 |     await page.screenshot({
  179 |       path: `${evidence}/workspace-recovery-dark-800.png`,
  180 |       animations: 'disabled',
  181 |     })
  182 |     renameSync(moved, f.cwd)
  183 |     await pane(f).getByRole('button', { name: '重新定位同一目录' }).click()
  184 |     await page.getByLabel('新的目录位置').fill(f.cwd)
  185 |     await page.getByRole('button', { name: '保存位置', exact: true }).click()
  186 |     await expect(dialog).toHaveCount(0)
  187 |     const check = pane(f).getByRole('button', { name: '重新校验执行目录' })
  188 |     await check.focus()
  189 |     await check.press('Enter')
  190 |     await expect(pane(f).getByRole('status').filter({ hasText: '目录检查通过' })).toBeVisible()
  191 |     expect(f.app.get(SessionStore).submissions(first.id)).toHaveLength(1)
  192 |     expect(f.app.get(KernelService).list()).toEqual([])
  193 |     await pane(f).getByRole('button', { name: '发送任务' }).click()
  194 |     await expect(pane(f).getByLabel('任务状态')).toHaveCount(2)
  195 |     await expect(pane(f).getByLabel('任务状态').last()).toHaveText('本轮已结束', { timeout: 15000 })
  196 |     expect(f.app.get(SessionStore).submissions(first.id)).toHaveLength(2)
  197 |     expect(f.errors).toEqual([])
  198 |   } finally {
  199 |     await f.close()
  200 |   }
  201 | })
  202 | 
  203 | test('WS-07 actual Electron background task stops on real OS directory access loss; recovery and full restart never replay', async () => {
  204 |   const f = await fixture()
  205 |   let restore = nothingToRestore
  206 |   try {
  207 |     const kernels = f.app.get(KernelService),
  208 |       original = kernels.prompt.bind(kernels)
  209 |     kernels.prompt = (id, cwd, input, options) =>
  210 |       original(id, cwd, { ...input, fixture: 'hold' }, options)
  211 |     await pane(f).getByLabel('项目', { exact: true }).selectOption(f.project.id)
  212 |     await pane(f).getByRole('textbox', { name: '任务内容' }).fill('后台目录失效任务')
  213 |     await pane(f).getByRole('button', { name: '发送任务' }).click()
  214 |     await expect.poll(() => f.app.get(SessionStore).managedSessions().length).toBe(1)
  215 |     const session = f.app.get(SessionStore).managedSessions()[0]
  216 |     assert(session)
  217 |     await expect
  218 |       .poll(() => f.app.get(EventService).snapshot(session.id)?.turns.at(-1)?.text, {
  219 |         timeout: 15000,
  220 |       })
  221 |       .toContain('OFFLINE_')
  222 |     await pane(f).getByRole('button', { name: '新会话', exact: true }).click()
  223 |     await pane(f).getByRole('textbox', { name: '任务内容' }).fill('另一会话草稿不受影响')
  224 |     if (process.platform === 'win32') {
  225 |       const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
  226 |         encoding: 'utf8',
  227 |         windowsHide: true,
  228 |       }).match(/S-1-[\d-]+/)?.[0]
  229 |       assert(sid)
  230 |       restore = () => {
  231 |         execFileSync('icacls', [f.cwd, '/remove:d', `*${sid}`], {
  232 |           windowsHide: true,
  233 |           stdio: 'pipe',
  234 |         })
  235 |       }
  236 |       execFileSync('icacls', [f.cwd, '/deny', `*${sid}:(RD)`], { windowsHide: true, stdio: 'pipe' })
  237 |     } else {
  238 |       const moved = join(f.directory, 'unmounted')
  239 |       renameSync(f.cwd, moved)
  240 |       restore = () => renameSync(moved, f.cwd)
  241 |     }
  242 |     await expect
  243 |       .poll(() => f.app.get(SessionStore).submissions(session.id)[0]?.status, { timeout: 15000 })
  244 |       .toBe('interrupted')
  245 |     expect(kernels.list()).toEqual([])
  246 |     await expect(pane(f).getByRole('textbox', { name: '任务内容' })).toHaveValue(
  247 |       '另一会话草稿不受影响',
  248 |     )
  249 |     await pane(f).getByTitle(session.title, { exact: true }).click()
  250 |     await expect(pane(f).getByLabel('任务状态').last()).toHaveText('已中断 · 未自动重发')
  251 |     await expect(pane(f).getByText(/本轮已中断，请核对历史/)).toBeVisible()
  252 |     restore()
  253 |     restore = nothingToRestore
  254 |     await pane(f).getByRole('button', { name: '重新校验执行目录' }).click()
  255 |     await expect(pane(f).getByRole('status').filter({ hasText: '目录检查通过' })).toBeVisible()
  256 |     const history = f.app.get(SessionStore).resumeRuntime(session.id, f.cwd)!,
  257 |       before = readFileSync(history.sessionFile)
  258 |     expect(f.app.get(SessionStore).submissions(session.id)).toHaveLength(1)
  259 |     expect(kernels.list()).toEqual([])
  260 |     await f.restart()
  261 |     expect(f.app.get(KernelService).list()).toEqual([])
  262 |     await pane(f).getByTitle(session.title, { exact: true }).click()
  263 |     await expect(pane(f).getByLabel('任务状态').last()).toHaveText('已中断 · 未自动重发')
  264 |     expect(readFileSync(history.sessionFile)).toEqual(before)
  265 |     expect(f.app.get(SessionStore).submissions(session.id)).toHaveLength(1)
  266 |     expect(f.errors).toEqual([])
```