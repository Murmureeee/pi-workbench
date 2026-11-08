# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tool-timeline.spec.ts >> OBS-03 actual Electron read-only Trace: nested identity, result-before-start, explicit outcomes/unknown metrics, safe structures and keyboard
- Location: e2e\tool-timeline.spec.ts:36:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: locator('.retained-session:not([hidden])').getByRole('region', { name: '工具调用 read-child', exact: true }).getByRole('button')
Expected: "true"
Error: strict mode violation: locator('.retained-session:not([hidden])').getByRole('region', { name: '工具调用 read-child', exact: true }).getByRole('button') resolved to 2 elements:
    1) <button tabindex="0" type="button" data-panel-open="" aria-expanded="true" aria-controls="base-ui-_r_11_" aria-label="read · 已完成 · read-child" data-slot="trace-collapsible-trigger" class="group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 has-[[data-status=error]]:text-destructive">…</button> aka getByRole('button', { name: 'read · 已完成 · read-child' })
    2) <button tabindex="0" type="button" data-slot="button" class="group/button inline-flex shrink-0 items-center justify-center border bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 …>打开工具关联的当前文件 · 第 2 行</button> aka getByRole('button', { name: '打开工具关联的当前文件 · 第 2 行' })

Call log:
  - Expect "toHaveAttribute" locator('.retained-session:not([hidden])').getByRole('region', { name: '工具调用 read-child', exact: true }).getByRole('button') with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').getByRole('region', { name: '工具调用 read-child', exact: true }).getByRole('button')

```

# Test source

```ts
  1   | import type { RuntimeSnapshot } from '../packages/shared/dist/index.js'
  2   | 
  3   | import { randomUUID } from 'node:crypto'
  4   | import { existsSync, mkdirSync, readFileSync } from 'node:fs'
  5   | import { join } from 'node:path'
  6   | 
  7   | import { expect, test } from '@playwright/test'
  8   | 
  9   | import { renderingDesktop } from './helpers/rendering.js'
  10  | import { toolFixtures, toolSecret } from './helpers/tools.js'
  11  | 
  12  | const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
  13  | 
  14  | async function startTools(f: Awaited<ReturnType<typeof renderingDesktop>>) {
  15  |   const { page } = f.desktop
  16  |   await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 合成工具观察')
  17  |   await page.getByRole('button', { name: '发送任务', exact: true }).click()
  18  |   await expect.poll(() => f.store.managedSessions().length).toBe(1)
  19  |   const session = f.store.managedSessions()[0]
  20  |   if (!session) {
  21  |     throw new Error('Missing tool session')
  22  |   }
  23  |   await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.text).toBe('OFFLINE_')
  24  |   const snapshot = f.events.snapshot(session.id)
  25  |   const turn = snapshot?.turns[0]
  26  |   if (!snapshot || !turn) {
  27  |     throw new Error('Missing active observation')
  28  |   }
  29  |   f.security.redactor.remember(toolSecret)
  30  |   for (const tool of toolFixtures(session.cwd)) {
  31  |     f.events.publish(session.id, snapshot.epoch, turn.id, { type: 'tool.updated', tool })
  32  |   }
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
> 55  |     await expect(child.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
      |                                             ^ Error: expect(locator).toHaveAttribute(expected) failed
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
```