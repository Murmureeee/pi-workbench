# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: change-review.spec.ts >> CHANGE-02/03 Electron links actual SDK write/edit source to historical Diff and preserves the selected turn after read-only restart
- Location: e2e\change-review.spec.ts:176:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: '所选文件历史Diff', exact: true })
Expected substring: "second"
Received string:    ""

```

# Test source

```ts
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
  205 |     expect(await f.page.getByRole('button', { name: /回滚|接受本轮|恢复文件/ }).count()).toBe(0)
  206 |     const record = required(f.changes.history(session.id).rounds[0]),
  207 |       observations = f.app.get(ChangeProvenanceService).observations(record.turnId)
  208 |     expect(observations).toHaveLength(2)
  209 |     await f.restart()
  210 |     await f.open(session.id)
  211 |     await f.versions()
  212 |     await f.review()
  213 |     await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
> 214 |     await expect(diff).toContainText('second')
      |                        ^ Error: expect(locator).toContainText(expected) failed
  215 |     expect(f.sends()).toBe(0)
  216 |     expect(f.kernels.list()).toEqual([])
  217 |     expect(f.app.get(ChangeProvenanceService).observations(record.turnId)).toEqual(observations)
  218 |   } finally {
  219 |     await f.close()
  220 |   }
  221 | })
  222 | 
  223 | test('CHANGE-03 Electron shows actual non-Git external file types, redaction and accessible light/dark narrow drawers with focus return', async () => {
  224 |   test.setTimeout(120000)
  225 |   const f = await setup()
  226 |   try {
  227 |     const session = await f.send('保持外部审查')
  228 |     await f.ready(session.id)
  229 |     writeFileSync(
  230 |       join(f.cwd, 'tracked.txt'),
  231 |       'external new\napi_key=fixture-diff-secret\n<img src=x onerror=alert(1)>\n',
  232 |     )
  233 |     unlinkSync(join(f.cwd, 'deleted.txt'))
  234 |     renameSync(join(f.cwd, 'old-name.txt'), join(f.cwd, '新名称.txt'))
  235 |     writeFileSync(join(f.cwd, 'binary.bin'), Buffer.from([0, 255]))
  236 |     writeFileSync(join(f.cwd, 'added.txt'), 'new\n')
  237 |     await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
  238 |     await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存', {
  239 |       timeout: 20000,
  240 |     })
  241 |     await f.versions()
  242 |     const trigger = await f.review()
  243 |     await expect(f.page.getByRole('list', { name: '轮次文件列表' })).toContainText('tracked.txt')
  244 |     await f.page.getByRole('button', { name: '审查文件 新名称.txt', exact: true }).click()
  245 |     await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText(
  246 |       '字节完全相同',
  247 |     )
  248 |     await f.page.getByRole('button', { name: '审查文件 binary.bin', exact: true }).click()
  249 |     await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toContainText('行数未知')
  250 |     await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
  251 |     const diff = f.page.getByRole('region', { name: '所选文件历史Diff' })
  252 |     await expect(diff).toContainText('«redacted»')
  253 |     await expect(diff).not.toContainText('fixture-diff-secret')
  254 |     expect(await diff.locator('img,script,a').count()).toBe(0)
  255 |     for (const colorScheme of ['light', 'dark'] as const) {
  256 |       await f.page.setViewportSize({ width: 802, height: 761 })
  257 |       await f.page.emulateMedia({ colorScheme })
  258 |       await expect(f.page.getByRole('dialog', { name: '轮次修改审查' })).toBeVisible()
  259 |       await expect(diff).toContainText('external new')
  260 |       await f.page.screenshot({ path: join(evidence, `change-review-${colorScheme}-narrow.png`) })
  261 |       expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  262 |         true,
  263 |       )
  264 |     }
  265 |     await f.page.keyboard.press('Escape')
  266 |     await expect(f.page.getByRole('dialog', { name: '轮次修改审查' })).toHaveCount(0)
  267 |     await expect(trigger).toBeFocused()
  268 |     expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toContain('fixture-diff-secret')
  269 |   } finally {
  270 |     await f.close()
  271 |   }
  272 | })
  273 | 
  274 | test('CHANGE-02/03 Electron late file response and closed or hidden review cannot replace another session or stop an independent background SDK', async () => {
  275 |   test.setTimeout(120000)
  276 |   const f = await setup()
  277 |   let release!: () => void
  278 |   const gate = new Promise<void>((resolve) => {
  279 |     release = resolve
  280 |   })
  281 |   try {
  282 |     const a = await f.send('保持第一轮')
  283 |     await f.ready(a.id)
  284 |     writeFileSync(join(f.cwd, 'tracked.txt'), 'FIRST_TURN_ONLY\n')
  285 |     await f.stop(a.id)
  286 |     await f.versions()
  287 |     await f.review()
  288 |     let entered = false
  289 |     await f.page.route('**/api/changes/diff?**', async (route) => {
  290 |       const response = await route.fetch()
  291 |       entered = true
  292 |       await gate
  293 |       await route.fulfill({ response })
  294 |     })
  295 |     await f.page.getByRole('button', { name: '审查文件 tracked.txt', exact: true }).click()
  296 |     await expect.poll(() => entered).toBe(true)
  297 |     await f.page.getByRole('button', { name: '关闭修改审查', exact: true }).click()
  298 |     const b = await f.send('保持独立后台', true)
  299 |     await f.ready(b.id)
  300 |     const kernel = required(f.kernels.list().find((k) => k.sessionId === b.id))
  301 |     const c = await f.send('空轮次')
  302 |     await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存', {
  303 |       timeout: 20000,
  304 |     })
  305 |     release()
  306 |     await f.page.unrouteAll({ behavior: 'wait' })
  307 |     await f.versions()
  308 |     await f.review()
  309 |     await expect(f.page.getByText('本轮无文件变更', { exact: true })).toBeVisible()
  310 |     await expect(f.page.getByRole('region', { name: '所选文件历史Diff' })).toHaveCount(0)
  311 |     expect(f.kernels.list().find((k) => k.sessionId === b.id)).toMatchObject({
  312 |       pid: kernel.pid,
  313 |       epoch: kernel.epoch,
  314 |       state: 'running',
```