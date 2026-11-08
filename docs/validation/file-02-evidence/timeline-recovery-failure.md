# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tool-timeline.spec.ts >> OBS-03 actual Electron expansion survives 3-view eviction/reload; background observations and reused call IDs cannot change current focus or another turn
- Location: e2e\tool-timeline.spec.ts:166:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: locator('.retained-session:not([hidden])').locator('[data-tool-id="read-child"]').getByRole('button')
Expected: "true"
Error: strict mode violation: locator('.retained-session:not([hidden])').locator('[data-tool-id="read-child"]').getByRole('button') resolved to 2 elements:
    1) <button tabindex="0" type="button" data-panel-open="" aria-expanded="true" aria-controls="base-ui-_r_6r_" aria-label="read · 已完成 · read-child" data-slot="trace-collapsible-trigger" class="group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 has-[[data-status=error]]:text-destructive">…</button> aka getByRole('button', { name: 'read · 已完成 · read-child' })
    2) <button tabindex="0" type="button" data-slot="button" class="group/button inline-flex shrink-0 items-center justify-center border bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 …>打开工具关联的当前文件 · 第 2 行</button> aka getByRole('button', { name: '打开工具关联的当前文件 · 第 2 行' })

Call log:
  - Expect "toHaveAttribute" locator('.retained-session:not([hidden])').locator('[data-tool-id="read-child"]').getByRole('button') with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').locator('[data-tool-id="read-child"]').getByRole('button')

```

# Test source

```ts
  131 |     mkdirSync(evidence, { recursive: true })
  132 |     const diff = edit.getByLabel('工具 Diff'),
  133 |       diffText = diff.locator('pre')
  134 |     await pane.getByLabel('受管会话消息').press('Home')
  135 |     await diff.getByRole('heading').scrollIntoViewIfNeeded()
  136 |     await expect(diff.getByRole('heading')).toBeInViewport()
  137 |     await diffText.scrollIntoViewIfNeeded()
  138 |     await expect(diffText).toBeInViewport({ ratio: 0.7 })
  139 |     await page.screenshot({
  140 |       path: join(evidence, 'tool-timeline-light.png'),
  141 |       animations: 'disabled',
  142 |     })
  143 |     await page.emulateMedia({ colorScheme: 'dark' })
  144 |     await page.setViewportSize({ width: 800, height: 760 })
  145 |     await pane.getByLabel('受管会话消息').press('Home')
  146 |     await diff.getByRole('heading').scrollIntoViewIfNeeded()
  147 |     await expect(diff.getByRole('heading')).toBeInViewport()
  148 |     await diffText.scrollIntoViewIfNeeded()
  149 |     await expect(diffText).toBeInViewport({ ratio: 0.7 })
  150 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  151 |     await page.screenshot({
  152 |       path: join(evidence, 'tool-timeline-dark-800.png'),
  153 |       animations: 'disabled',
  154 |     })
  155 |     expect(f.events.snapshot(session.id)).toEqual(before)
  156 |     expect(readFileSync(file)).toEqual(bytes)
  157 |     expect(snapshot.epoch).toBe(f.events.snapshot(session.id)?.epoch)
  158 |     expect(await runtimeErrors.jsonValue()).toEqual([])
  159 |     await runtimeErrors.dispose()
  160 |     await f.kernels.abort(session.id, turn.id)
  161 |   } finally {
  162 |     await f.close()
  163 |   }
  164 | })
  165 | 
  166 | test('OBS-03 actual Electron expansion survives 3-view eviction/reload; background observations and reused call IDs cannot change current focus or another turn', async () => {
  167 |   const f = await renderingDesktop(2),
  168 |     { page } = f.desktop
  169 |   try {
  170 |     const { session, snapshot, turn } = await startTools(f)
  171 |     const pane = page.locator('.retained-session:not([hidden])')
  172 |     await pane.locator('[data-tool-id="read-child"]').getByRole('button').click()
  173 |     const pid = f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.pid
  174 |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  175 |     const second = await f.send('第二会话工具隔离')
  176 |     const state = f.events.snapshot(second.id),
  177 |       active = state?.turns[0]
  178 |     if (!state || !active) {
  179 |       throw new Error('Missing second turn')
  180 |     }
  181 |     // Restored synthetic snapshot is observation-only; no new prompt or tool invocation.
  182 |     const other: RuntimeSnapshot = {
  183 |       ...state,
  184 |       epoch: randomUUID(),
  185 |       source: 'synthetic-ipc-fixture',
  186 |       turns: [
  187 |         {
  188 |           ...active,
  189 |           tools: [
  190 |             {
  191 |               id: 'read-child',
  192 |               name: 'read',
  193 |               status: 'completed',
  194 |               parameters: '{"path":"other.txt"}',
  195 |               summary: '另一个轮次的相同ID',
  196 |               origin: 'synthetic-fixture',
  197 |             },
  198 |           ],
  199 |         },
  200 |       ],
  201 |     }
  202 |     f.events.restore(other)
  203 |     await expect(pane.locator('[data-tool-id="read-child"]').getByRole('button')).toHaveAttribute(
  204 |       'aria-expanded',
  205 |       'false',
  206 |     )
  207 |     const input = pane.getByRole('textbox', { name: '任务内容' })
  208 |     await input.fill('当前会话独立草稿')
  209 |     await input.focus()
  210 |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  211 |       type: 'tool.updated',
  212 |       tool: {
  213 |         id: 'background',
  214 |         name: 'background',
  215 |         status: 'completed',
  216 |         summary: '后台新工具观察',
  217 |         origin: 'synthetic-fixture',
  218 |       },
  219 |     })
  220 |     await expect(input).toBeFocused()
  221 |     await expect(pane).toHaveAttribute('data-session-view', second.id)
  222 |     await expect(input).toHaveValue('当前会话独立草稿')
  223 |     const sendNext = async (name: string) => {
  224 |       await page.getByRole('button', { name: '新会话', exact: true }).click()
  225 |       await f.send(name)
  226 |     }
  227 |     await sendNext('第三会话工具淘汰')
  228 |     await sendNext('第四会话工具淘汰')
  229 |     await expect(page.locator(`[data-session-view="${session.id}"]`)).toHaveCount(0)
  230 |     await pane.getByTitle(session.title, { exact: true }).click()
> 231 |     await expect(pane.locator('[data-tool-id="read-child"]').getByRole('button')).toHaveAttribute(
      |                                                                                   ^ Error: expect(locator).toHaveAttribute(expected) failed
  232 |       'aria-expanded',
  233 |       'true',
  234 |     )
  235 |     expect(f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.pid).toBe(pid)
  236 |     await page.reload()
  237 |     await expect(pane.locator('[data-tool-id="read-child"]').getByRole('button')).toHaveAttribute(
  238 |       'aria-expanded',
  239 |       'true',
  240 |     )
  241 |     expect(f.prompts()).toBe(4)
  242 |     await f.kernels.abort(session.id, turn.id)
  243 |     await pane.getByRole('button', { name: '历史记录', exact: true }).click()
  244 |     await expect(
  245 |       pane.getByLabel('持久化历史').locator('[data-tool-id="read-child"]'),
  246 |     ).toContainText('只读样本🙂')
  247 |     expect(f.prompts()).toBe(4)
  248 |     await pane.getByRole('button', { name: '返回对话', exact: true }).click()
  249 |     await pane
  250 |       .getByRole('textbox', { name: '任务内容' })
  251 |       .fill('保持运行 · 同会话新轮次的相同调用ID')
  252 |     await pane.getByRole('button', { name: '发送任务', exact: true }).click()
  253 |     await expect.poll(() => f.events.snapshot(session.id)?.turns.length).toBe(2)
  254 |     await expect.poll(() => f.events.snapshot(session.id)?.turns.at(-1)?.text).toBe('OFFLINE_')
  255 |     const next = f.events.snapshot(session.id)?.turns.at(-1)
  256 |     if (!next) {
  257 |       throw new Error('Missing next turn')
  258 |     }
  259 |     f.events.publish(session.id, snapshot.epoch, next.id, {
  260 |       type: 'tool.updated',
  261 |       tool: {
  262 |         id: 'read-child',
  263 |         name: 'read',
  264 |         status: 'completed',
  265 |         parameters: '{"path":"next.txt"}',
  266 |         summary: '新轮次结果',
  267 |         origin: 'synthetic-fixture',
  268 |       },
  269 |     })
  270 |     const sameId = pane.locator('[data-tool-id="read-child"]')
  271 |     await expect(sameId).toHaveCount(2)
  272 |     await expect(sameId.first().getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  273 |     await expect(sameId.last().getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  274 |     expect(f.prompts()).toBe(5)
  275 |     await f.kernels.abort(session.id, next.id)
  276 |   } finally {
  277 |     await f.close()
  278 |   }
  279 | })
  280 | 
```