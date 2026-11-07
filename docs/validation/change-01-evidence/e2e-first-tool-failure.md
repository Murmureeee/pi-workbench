# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tool-timeline.spec.ts >> OBS-03 actual Electron long redacted output expands without changing source, Diff remains observation, light/dark narrow layouts stay bounded
- Location: e2e\tool-timeline.spec.ts:94:1

# Error details

```
Error: expect(locator).toBeInViewport() failed

Locator:  locator('.retained-session:not([hidden])').locator('[data-tool-id="edit"]').getByLabel('工具 Diff')
Expected: in viewport
Received: viewport ratio 0.5052001476287842
Timeout:  5000ms

Call log:
  - Expect "toBeInViewport" locator('.retained-session:not([hidden])').locator('[data-tool-id="edit"]').getByLabel('工具 Diff') with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').locator('[data-tool-id="edit"]').getByLabel('工具 Diff')
    14 × locator resolved to <section aria-label="工具 Diff">…</section>
       - unexpected value "viewport ratio 0.5052001476287842"

```

```yaml
- region "工具 Diff":
  - heading "工具返回的 Diff · 仅观察" [level=4]
  - paragraph: 尚未关联可回滚账本；不能据此执行回滚。
  - text: "--- a/not-created.txt +++ b/not-created.txt @@ -1 +1 @@ -旧行 +新行"
```

# Test source

```ts
  33  |   return { session, snapshot, turn }
  34  | }
  35  | 
  36  | test('OBS-03 actual Electron read-only Trace: nested identity, result-before-start, explicit outcomes/unknown metrics, safe structures and keyboard', async () => {
  37  |   const f = await renderingDesktop(),
  38  |     { page } = f.desktop
  39  |   const errors: string[] = [],
  40  |     remote: string[] = []
  41  |   page.on('pageerror', (error) => errors.push(error.message))
  42  |   page.on('request', (request) => {
  43  |     if (request.url().startsWith('https://invalid.example')) {
  44  |       remote.push(request.url())
  45  |     }
  46  |   })
  47  |   try {
  48  |     const { session } = await startTools(f)
  49  |     const pane = page.locator('.retained-session:not([hidden])')
  50  |     await expect(pane.locator('[data-tool-id]')).toHaveCount(12)
  51  |     const child = pane.getByRole('region', { name: '工具调用 read-child', exact: true })
  52  |     await expect(child).toHaveAttribute('data-tool-depth', '1')
  53  |     await child.getByRole('button').focus()
  54  |     await page.keyboard.press('Enter')
  55  |     await expect(child.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  56  |     await expect(child).toContainText('只读样本🙂')
  57  |     await expect(child).toContainText('src/中文.ts · 请求从第 2 行开始 · 请求最多 4 行')
  58  |     await expect(child).not.toContainText('sample-key-hidden')
  59  |     await child.getByRole('button').focus()
  60  |     await page.keyboard.press('Space')
  61  |     await expect(child.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  62  |     const command = pane.locator('[data-tool-id="command"]')
  63  |     await command.getByRole('button').click()
  64  |     await expect(command.locator('dd').last()).toHaveText('未知')
  65  |     await expect(command.locator('dd').nth(4)).toHaveText('未知')
  66  |     const failure = pane.locator('[data-tool-id="failure"]')
  67  |     await failure.getByRole('button').click()
  68  |     await expect(failure).toContainText('12.5 ms')
  69  |     await expect(failure.locator('dd').last()).toHaveText('7')
  70  |     await expect(
  71  |       pane.getByRole('button', { name: 'write · 已拒绝 · denied', exact: true }),
  72  |     ).toBeVisible()
  73  |     await expect(
  74  |       pane.getByRole('button', { name: 'custom-cancelled · 已取消 · cancelled', exact: true }),
  75  |     ).toBeVisible()
  76  |     const unknown = pane.locator('[data-tool-id="unknown"]')
  77  |     await unknown.getByRole('button').click()
  78  |     await expect(unknown).toContainText('未知结构')
  79  |     await expect(unknown).toContainText('父调用尚不可用')
  80  |     await expect(unknown.getByLabel('工具结果')).toContainText('<script>')
  81  |     await expect(unknown.locator('img,script')).toHaveCount(0)
  82  |     const cycle = pane.locator('[data-tool-id="cycle-a"]')
  83  |     await cycle.getByRole('button').click()
  84  |     await expect(cycle).toContainText('循环')
  85  |     expect(remote).toEqual([])
  86  |     expect(errors).toEqual([])
  87  |     expect(existsSync(join(session.cwd, 'not-created.txt'))).toBe(false)
  88  |     expect(f.prompts()).toBe(1)
  89  |   } finally {
  90  |     await f.close()
  91  |   }
  92  | })
  93  | 
  94  | test('OBS-03 actual Electron long redacted output expands without changing source, Diff remains observation, light/dark narrow layouts stay bounded', async () => {
  95  |   const f = await renderingDesktop(),
  96  |     { page } = f.desktop
  97  |   try {
  98  |     await page.emulateMedia({ colorScheme: 'light' })
  99  |     await page.setViewportSize({ width: 1920, height: 1080 })
  100 |     const runtimeErrors = await page.evaluateHandle(() => {
  101 |       const errors: string[] = []
  102 |       window.addEventListener('error', (event) => errors.push(event.message))
  103 |       return errors
  104 |     })
  105 |     const { session, snapshot, turn } = await startTools(f)
  106 |     const pane = page.locator('.retained-session:not([hidden])'),
  107 |       mcp = pane.locator('[data-tool-id="mcp"]')
  108 |     const before = f.events.snapshot(session.id)
  109 |     await mcp.getByRole('button').click()
  110 |     await expect(mcp).toContainText('本机合成服务 / lookup')
  111 |     await expect(mcp).not.toContainText('OBS03_TOOL_OUTPUT_END')
  112 |     await mcp.getByRole('button', { name: '展开完整消息', exact: true }).click()
  113 |     await expect(mcp).toContainText('OBS03_TOOL_OUTPUT_END')
  114 |     await expect(mcp).not.toContainText(toolSecret)
  115 |     await mcp.getByRole('button', { name: '收起长消息', exact: true }).click()
  116 |     await expect(mcp.getByRole('button', { name: '展开完整消息', exact: true })).toBeInViewport()
  117 |     await mcp.getByRole('button', { name: 'custom-lookup · 已完成 · mcp', exact: true }).click()
  118 |     const edit = pane.locator('[data-tool-id="edit"]')
  119 |     await edit.getByRole('button').click()
  120 |     await expect(edit.getByLabel('工具 Diff')).toContainText('-旧行\n+新行')
  121 |     await expect(edit.getByLabel('工具 Diff')).toContainText('尚未关联可回滚账本')
  122 |     await expect(edit.getByRole('button', { name: /回滚/ })).toHaveCount(0)
  123 |     const truncated = pane.locator('[data-tool-id="truncated"]')
  124 |     await truncated.getByRole('button').click()
  125 |     await expect(truncated).toContainText('工具已截断输出')
  126 |     const file = f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.sessionFile
  127 |     if (!file) {
  128 |       throw new Error('Missing native history')
  129 |     }
  130 |     const bytes = readFileSync(file)
  131 |     mkdirSync(evidence, { recursive: true })
  132 |     await edit.getByLabel('工具 Diff').scrollIntoViewIfNeeded()
> 133 |     await expect(edit.getByLabel('工具 Diff')).toBeInViewport({ ratio: 0.7 })
      |                                              ^ Error: expect(locator).toBeInViewport() failed
  134 |     await page.screenshot({
  135 |       path: join(evidence, 'tool-timeline-light.png'),
  136 |       animations: 'disabled',
  137 |     })
  138 |     await page.emulateMedia({ colorScheme: 'dark' })
  139 |     await page.setViewportSize({ width: 800, height: 760 })
  140 |     await edit.getByLabel('工具 Diff').scrollIntoViewIfNeeded()
  141 |     await expect(edit.getByLabel('工具 Diff')).toBeInViewport({ ratio: 0.7 })
  142 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  143 |     await page.screenshot({
  144 |       path: join(evidence, 'tool-timeline-dark-800.png'),
  145 |       animations: 'disabled',
  146 |     })
  147 |     expect(f.events.snapshot(session.id)).toEqual(before)
  148 |     expect(readFileSync(file)).toEqual(bytes)
  149 |     expect(snapshot.epoch).toBe(f.events.snapshot(session.id)?.epoch)
  150 |     expect(await runtimeErrors.jsonValue()).toEqual([])
  151 |     await runtimeErrors.dispose()
  152 |     await f.kernels.abort(session.id, turn.id)
  153 |   } finally {
  154 |     await f.close()
  155 |   }
  156 | })
  157 | 
  158 | test('OBS-03 actual Electron expansion survives 3-view eviction/reload; background observations and reused call IDs cannot change current focus or another turn', async () => {
  159 |   const f = await renderingDesktop(2),
  160 |     { page } = f.desktop
  161 |   try {
  162 |     const { session, snapshot, turn } = await startTools(f)
  163 |     const pane = page.locator('.retained-session:not([hidden])')
  164 |     await pane.locator('[data-tool-id="read-child"]').getByRole('button').click()
  165 |     const pid = f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.pid
  166 |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  167 |     const second = await f.send('第二会话工具隔离')
  168 |     const state = f.events.snapshot(second.id),
  169 |       active = state?.turns[0]
  170 |     if (!state || !active) {
  171 |       throw new Error('Missing second turn')
  172 |     }
  173 |     // Restored synthetic snapshot is observation-only; no new prompt or tool invocation.
  174 |     const other: RuntimeSnapshot = {
  175 |       ...state,
  176 |       epoch: randomUUID(),
  177 |       source: 'synthetic-ipc-fixture',
  178 |       turns: [
  179 |         {
  180 |           ...active,
  181 |           tools: [
  182 |             {
  183 |               id: 'read-child',
  184 |               name: 'read',
  185 |               status: 'completed',
  186 |               parameters: '{"path":"other.txt"}',
  187 |               summary: '另一个轮次的相同ID',
  188 |               origin: 'synthetic-fixture',
  189 |             },
  190 |           ],
  191 |         },
  192 |       ],
  193 |     }
  194 |     f.events.restore(other)
  195 |     await expect(pane.locator('[data-tool-id="read-child"]').getByRole('button')).toHaveAttribute(
  196 |       'aria-expanded',
  197 |       'false',
  198 |     )
  199 |     const input = pane.getByRole('textbox', { name: '任务内容' })
  200 |     await input.fill('当前会话独立草稿')
  201 |     await input.focus()
  202 |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  203 |       type: 'tool.updated',
  204 |       tool: {
  205 |         id: 'background',
  206 |         name: 'background',
  207 |         status: 'completed',
  208 |         summary: '后台新工具观察',
  209 |         origin: 'synthetic-fixture',
  210 |       },
  211 |     })
  212 |     await expect(input).toBeFocused()
  213 |     await expect(pane).toHaveAttribute('data-session-view', second.id)
  214 |     await expect(input).toHaveValue('当前会话独立草稿')
  215 |     const sendNext = async (name: string) => {
  216 |       await page.getByRole('button', { name: '新会话', exact: true }).click()
  217 |       await f.send(name)
  218 |     }
  219 |     await sendNext('第三会话工具淘汰')
  220 |     await sendNext('第四会话工具淘汰')
  221 |     await expect(page.locator(`[data-session-view="${session.id}"]`)).toHaveCount(0)
  222 |     await pane.getByTitle(session.title, { exact: true }).click()
  223 |     await expect(pane.locator('[data-tool-id="read-child"]').getByRole('button')).toHaveAttribute(
  224 |       'aria-expanded',
  225 |       'true',
  226 |     )
  227 |     expect(f.kernels.list().find((kernel) => kernel.sessionId === session.id)?.pid).toBe(pid)
  228 |     await page.reload()
  229 |     await expect(pane.locator('[data-tool-id="read-child"]').getByRole('button')).toHaveAttribute(
  230 |       'aria-expanded',
  231 |       'true',
  232 |     )
  233 |     expect(f.prompts()).toBe(4)
```