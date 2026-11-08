# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: change-review.spec.ts >> CHANGE-02/03 Electron links actual SDK write/edit source to historical Diff and preserves the selected turn after read-only restart
- Location: e2e\change-review.spec.ts:176:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 6
```

# Test source

```ts
  105 |       const previous = new Set(
  106 |           app
  107 |             .get(SessionStore)
  108 |             .managedSessions()
  109 |             .map((row) => row.id),
  110 |         ),
  111 |         button = desktop.page.getByRole('button', { name: '新会话', exact: true }).first()
  112 |       if (!(await button.isVisible())) {
  113 |         await desktop.page.getByRole('button', { name: '展开导航', exact: true }).click()
  114 |       }
  115 |       await button.click()
  116 |       await desktop.page
  117 |         .getByLabel('项目', { exact: true })
  118 |         .selectOption(useIndependent ? second.id : project.id)
  119 |       await desktop.page.getByRole('textbox', { name: '任务内容' }).fill(text)
  120 |       await expect(
  121 |         desktop.page.getByRole('button', { name: '发送任务', exact: true }),
  122 |       ).toBeEnabled()
  123 |       await desktop.page.getByRole('button', { name: '发送任务', exact: true }).click()
  124 |       await expect
  125 |         .poll(() => app.get(SessionStore).managedSessions().length)
  126 |         .toBe(previous.size + 1)
  127 |       return required(
  128 |         app
  129 |           .get(SessionStore)
  130 |           .managedSessions()
  131 |           .find((row) => !previous.has(row.id)),
  132 |       )
  133 |     },
  134 |     ready: async (id: string) =>
  135 |       expect
  136 |         .poll(() => app.get(ChangeService).history(id).rounds[0]?.baseline.status, {
  137 |           timeout: 20000,
  138 |         })
  139 |         .toBe('ready'),
  140 |     open: async (id: string) => desktop.page.goto(`http://127.0.0.1:5173/?session=${id}`),
  141 |     versions: async () => {
  142 |       const region = desktop.page.getByRole('region', { name: '轮次文件版本', exact: true })
  143 |       await region.getByRole('button', { name: '查看轮次文件版本', exact: true }).click()
  144 |       return region
  145 |     },
  146 |     review: async () => {
  147 |       const region = desktop.page.getByRole('region', { name: '轮次文件版本', exact: true })
  148 |       const trigger = region.getByRole('button', { name: '审查本轮文件差异', exact: true }).first()
  149 |       await trigger.click()
  150 |       return trigger
  151 |     },
  152 |     stop: async (id: string) => {
  153 |       const round = required(app.get(ChangeService).history(id).rounds[0])
  154 |       await app.get(KernelService).abort(id, round.turnId)
  155 |       await expect
  156 |         .poll(() => app.get(ChangeService).history(id).rounds[0]?.outcome, { timeout: 20000 })
  157 |         .not.toBe('active')
  158 |     },
  159 |     restart: async () => {
  160 |       await desktop.close()
  161 |       await app.close()
  162 |       app = await createApp({ dataDir, port: 4318, development: true })
  163 |       sends = 0
  164 |       wire()
  165 |       await app.listen(4318, '127.0.0.1')
  166 |       desktop = await launchWorkspaceDesktop(root, app)
  167 |     },
  168 |     close: async () => {
  169 |       await desktop.close()
  170 |       await app.close()
  171 |       rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  172 |     },
  173 |   }
  174 | }
  175 | 
  176 | test('CHANGE-02/03 Electron links actual SDK write/edit source to historical Diff and preserves the selected turn after read-only restart', async () => {
  177 |   test.setTimeout(120000)
  178 |   const f = await setup()
  179 |   try {
  180 |     const session = await f.send('工具链来源审查')
  181 |     for (let i = 0; i < 2; i++) {
  182 |       await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
  183 |       await f.page.getByRole('button', { name: '明确允许本次不可回滚执行', exact: true }).click()
  184 |     }
  185 |     const region = f.page.getByRole('region', { name: '轮次文件版本', exact: true })
  186 |     await expect(region).toContainText('收尾已保存', { timeout: 20000 })
  187 |     await f.versions()
  188 |     await region.getByRole('button', { name: '核对修改来源', exact: true }).click()
  189 |     const source = region.getByRole('article', { name: '文件来源 tracked.txt', exact: true })
  190 |     await expect(source).toContainText('工具观察一致')
  191 |     await expect(source).toContainText('change-1')
  192 |     await expect(source).toContainText('change-2')
  193 |     const trigger = await f.review()
  194 |     await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
  195 |     const diff = f.page.getByRole('region', { name: '所选文件历史Diff', exact: true })
  196 |     await expect(diff).toContainText('+1 −1')
  197 |     await expect(diff).toContainText('second')
  198 |     writeFileSync(join(f.cwd, 'tracked.txt'), 'CURRENT_MUST_NOT_REPLACE_HISTORY\n')
  199 |     await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
  200 |     await expect(trigger).toBeFocused()
  201 |     await trigger.click()
  202 |     await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
  203 |     await expect(diff).toContainText('second')
  204 |     await expect(diff).not.toContainText('CURRENT_MUST_NOT_REPLACE_HISTORY')
> 205 |     expect(await f.page.getByRole('button', { name: /回滚|接受本轮|恢复文件/ }).count()).toBe(0)
      |                                                                                ^ Error: expect(received).toBe(expected) // Object.is equality
  206 |     const record = required(f.changes.history(session.id).rounds[0]),
  207 |       observations = f.app.get(ChangeProvenanceService).observations(record.turnId)
  208 |     expect(observations).toHaveLength(2)
  209 |     await f.restart()
  210 |     await f.open(session.id)
  211 |     await f.versions()
  212 |     await f.review()
  213 |     await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
  214 |     await expect(
  215 |       f.page.getByRole('region', { name: '所选文件历史Diff', exact: true }),
  216 |     ).toContainText('second')
  217 |     expect(f.sends()).toBe(0)
  218 |     expect(f.kernels.list()).toEqual([])
  219 |     expect(f.app.get(ChangeProvenanceService).observations(record.turnId)).toEqual(observations)
  220 |   } finally {
  221 |     await f.close()
  222 |   }
  223 | })
  224 | 
  225 | test('CHANGE-03 Electron shows actual non-Git external file types, redaction and accessible light/dark narrow drawers with focus return', async () => {
  226 |   test.setTimeout(120000)
  227 |   const f = await setup()
  228 |   try {
  229 |     const session = await f.send('保持外部审查')
  230 |     await f.ready(session.id)
  231 |     writeFileSync(
  232 |       join(f.cwd, 'tracked.txt'),
  233 |       'external new\napi_key=fixture-diff-secret\n<img src=x onerror=alert(1)>\n',
  234 |     )
  235 |     unlinkSync(join(f.cwd, 'deleted.txt'))
  236 |     renameSync(join(f.cwd, 'old-name.txt'), join(f.cwd, '新名称.txt'))
  237 |     writeFileSync(join(f.cwd, 'binary.bin'), Buffer.from([0, 255]))
  238 |     writeFileSync(join(f.cwd, 'added.txt'), 'new\n')
  239 |     await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
  240 |     await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存', {
  241 |       timeout: 20000,
  242 |     })
  243 |     await f.versions()
  244 |     const trigger = await f.review()
  245 |     await expect(f.page.getByRole('list', { name: '轮次文件列表' })).toContainText('tracked.txt')
  246 |     await f.page.getByRole('button', { name: '审查文件 新名称.txt', exact: true }).click()
  247 |     await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText(
  248 |       '字节完全相同',
  249 |     )
  250 |     await f.page.getByRole('button', { name: '审查文件 binary.bin', exact: true }).click()
  251 |     await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText('行数未知')
  252 |     await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
  253 |     const diff = f.page.getByRole('region', { name: '所选文件历史Diff' })
  254 |     await expect(diff).toContainText('«redacted»')
  255 |     await expect(diff).not.toContainText('fixture-diff-secret')
  256 |     expect(await diff.locator('img,script,a').count()).toBe(0)
  257 |     for (const colorScheme of ['light', 'dark'] as const) {
  258 |       await f.page.setViewportSize({ width: 802, height: 761 })
  259 |       await f.page.emulateMedia({ colorScheme })
  260 |       await expect(f.page.getByRole('dialog', { name: '轮次修改审查' })).toBeVisible()
  261 |       await expect(diff).toContainText('external new')
  262 |       await f.page.screenshot({ path: join(evidence, `change-review-${colorScheme}-narrow.png`) })
  263 |       expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  264 |         true,
  265 |       )
  266 |     }
  267 |     await f.page.keyboard.press('Escape')
  268 |     await expect(f.page.getByRole('dialog', { name: '轮次修改审查' })).toHaveCount(0)
  269 |     await expect(trigger).toBeFocused()
  270 |     expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toContain('fixture-diff-secret')
  271 |   } finally {
  272 |     await f.close()
  273 |   }
  274 | })
  275 | 
  276 | test('CHANGE-02/03 Electron late file response and closed or hidden review cannot replace another session or stop an independent background SDK', async () => {
  277 |   test.setTimeout(120000)
  278 |   const f = await setup()
  279 |   let release!: () => void
  280 |   const gate = new Promise<void>((resolve) => {
  281 |     release = resolve
  282 |   })
  283 |   try {
  284 |     const a = await f.send('保持第一轮')
  285 |     await f.ready(a.id)
  286 |     writeFileSync(join(f.cwd, 'tracked.txt'), 'FIRST_TURN_ONLY\n')
  287 |     await f.stop(a.id)
  288 |     await f.versions()
  289 |     await f.review()
  290 |     let entered = false
  291 |     await f.page.route('**/api/changes/diff?**', async (route) => {
  292 |       const url = new URL(route.request().url())
  293 |       const response = await route.fetch({
  294 |         url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
  295 |         headers: {
  296 |           ...route.request().headers(),
  297 |           host: '127.0.0.1:4318',
  298 |           origin: 'http://127.0.0.1:5173',
  299 |         },
  300 |       })
  301 |       expect(response.status()).toBe(200)
  302 |       entered = true
  303 |       await gate
  304 |       await route.fulfill({ response })
  305 |     })
```