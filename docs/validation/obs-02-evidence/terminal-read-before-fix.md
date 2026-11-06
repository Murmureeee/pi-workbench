# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: run-stages.spec.ts >> OBS-02 actual Electron observes one current stage, synthetic tool/approval/compaction/retry cannot complete or dismiss, late updates preserve focus
- Location: e2e\run-stages.spec.ts:12:1

# Error details

```
Error: expect(locator).not.toContainText(expected) failed

Locator: locator('.retained-session:not([hidden])').getByRole('region', { name: '当前运行阶段', exact: true })
Expected substring: not "本轮已结束"
Received string: "本轮已结束 · 压缩上下文"
Timeout: 5000ms

Call log:
  - Expect "not toContainText" locator('.retained-session:not([hidden])').getByRole('region', { name: '当前运行阶段', exact: true }) with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').getByRole('region', { name: '当前运行阶段', exact: true })
    14 × locator resolved to <section aria-live="polite" aria-label="当前运行阶段" data-stage="compacting" class="current-run-status" data-operation-id="84bb76db-1c50-41f4-877f-36940d558805">…</section>
       - unexpected value "本轮已结束 · 压缩上下文"

```

```yaml
- region "当前运行阶段":
  - status "任务状态": 本轮已结束
  - text: · 压缩上下文
```

# Test source

```ts
  1   | import { mkdirSync } from 'node:fs'
  2   | import { join } from 'node:path'
  3   | 
  4   | import { expect, test } from '@playwright/test'
  5   | 
  6   | import { submissionListSchema } from '../packages/shared/dist/index.js'
  7   | 
  8   | import { renderingDesktop } from './helpers/rendering.js'
  9   | 
  10  | const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
  11  | 
  12  | test('OBS-02 actual Electron observes one current stage, synthetic tool/approval/compaction/retry cannot complete or dismiss, late updates preserve focus', async () => {
  13  |   const f = await renderingDesktop(),
  14  |     { page } = f.desktop
  15  |   try {
  16  |     const first = await f.send('阶段基线')
  17  |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  18  |     await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 阶段观察')
  19  |     await page.getByRole('button', { name: '发送任务', exact: true }).click()
  20  |     await expect.poll(() => f.store.managedSessions().length).toBe(2)
  21  |     const session = f.store.managedSessions().find((s) => s.id !== first.id)!
  22  |     await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.stage).toBe('streaming')
  23  |     const snapshot = f.events.snapshot(session.id)!,
  24  |       turn = snapshot.turns[0],
  25  |       pid = f.kernels.list().find((s) => s.sessionId === session.id)?.pid
  26  |     if (!turn) {
  27  |       throw new Error('Missing active SDK fixture turn')
  28  |     }
  29  |     const pane = page.locator('.retained-session:not([hidden])'),
  30  |       stage = pane.getByRole('region', { name: '当前运行阶段', exact: true })
  31  |     await expect(stage).toHaveCount(1)
  32  |     await expect(stage).toContainText('接收模型回复')
  33  |     f.events.attach(session.id, snapshot.epoch, 'synthetic-ipc-fixture')
  34  |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  35  |       type: 'turn.started',
  36  |       messageId: turn.messageId,
  37  |       prompt: turn.prompt,
  38  |     })
  39  |     // A synthetic journal replacement restarts its cursor. A fresh observer avoids asking
  40  |     // production code to accept a regressed cursor within the real SDK generation.
  41  |     await page.reload()
  42  |     await expect(pane.getByLabel('会话同步状态')).toHaveText('已同步')
  43  |     const publish = (payload: Parameters<typeof f.events.publish>[3]) =>
  44  |       f.events.publish(session.id, snapshot.epoch, turn.id, payload)
  45  |     const submissionRoute = `**/api/chat/sessions/${session.id}/submissions`
  46  |     let terminalReads = 0
  47  |     await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible()
  48  |     // Explicit transport-order fixture: a newer terminal HTTP read arrives while the
  49  |     // delayed observation still has active compaction. The real SDK task stays running.
  50  |     await page.route(submissionRoute, async (route) => {
  51  |       const response = await route.fetch({
  52  |         url: `http://127.0.0.1:4318/api/chat/sessions/${session.id}/submissions`,
  53  |         headers: { ...route.request().headers(), host: '127.0.0.1:4318' },
  54  |       })
  55  |       const result = submissionListSchema.parse(await response.json())
  56  |       await route.fulfill({
  57  |         response,
  58  |         json: {
  59  |           submissions: result.submissions.map((item) =>
  60  |             item.turnId === turn.id ? { ...item, status: 'completed' } : item,
  61  |           ),
  62  |         },
  63  |       })
  64  |       terminalReads++
  65  |     })
  66  |     publish({ type: 'stage.updated', stage: 'compacting' })
  67  |     await expect(stage).toContainText('压缩上下文')
  68  |     await expect.poll(() => terminalReads).toBeGreaterThan(0)
  69  |     await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toHaveCount(0)
> 70  |     await expect(stage).not.toContainText('本轮已结束')
      |                             ^ Error: expect(locator).not.toContainText(expected) failed
  71  |     await expect(stage.getByRole('button', { name: '隐藏状态提示' })).toHaveCount(0)
  72  |     await page.unroute(submissionRoute)
  73  |     await expect(page.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible()
  74  |     publish({ type: 'stage.updated', stage: 'preparing-tools' })
  75  |     await expect(stage).toContainText('准备工具参数')
  76  |     publish({
  77  |       type: 'tool.updated',
  78  |       tool: {
  79  |         id: 'synthetic-tool',
  80  |         name: 'write',
  81  |         status: 'running',
  82  |         summary: '合成观察；没有执行写入',
  83  |       },
  84  |     })
  85  |     publish({ type: 'stage.updated', stage: 'streaming' })
  86  |     await expect(stage).toContainText('执行工具')
  87  |     publish({
  88  |       type: 'approval.requested',
  89  |       approval: { id: 'synthetic-approval', command: '合成观察', cwd: session.cwd },
  90  |     })
  91  |     await expect(stage).toContainText('等待审批')
  92  |     publish({ type: 'approval.resolved', approvalId: 'synthetic-approval' })
  93  |     publish({
  94  |       type: 'tool.updated',
  95  |       tool: {
  96  |         id: 'synthetic-tool',
  97  |         name: 'write',
  98  |         status: 'denied',
  99  |         summary: '合成拒绝；没有执行写入',
  100 |       },
  101 |     })
  102 |     publish({
  103 |       type: 'model.updated',
  104 |       modelRequest: {
  105 |         attempts: 2,
  106 |         retryCount: 1,
  107 |         retryLimit: 2,
  108 |         state: 'waiting',
  109 |         waitUntil: Date.now() - 1,
  110 |         error: '合成错误 api_key=stage-secret',
  111 |       },
  112 |     })
  113 |     await expect(stage).toContainText('等待重试')
  114 |     await expect(stage.getByLabel('模型等待状态')).toContainText('等待服务确认')
  115 |     await expect(pane.getByRole('alert').filter({ hasText: '合成错误' })).toHaveCount(1)
  116 |     await expect(pane).not.toContainText('stage-secret')
  117 |     expect(f.prompts()).toBe(2)
  118 |     await pane.getByTitle(first.title, { exact: true }).click()
  119 |     await page.getByRole('textbox', { name: '任务内容' }).fill('前台草稿阶段隔离')
  120 |     await page.getByRole('textbox', { name: '任务内容' }).focus()
  121 |     publish({ type: 'stage.updated', stage: 'compacting' })
  122 |     await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
  123 |     await expect(pane).not.toContainText('压缩上下文')
  124 |     expect(f.kernels.list().find((s) => s.sessionId === session.id)?.pid).toBe(pid)
  125 |     await pane.getByTitle(session.title, { exact: true }).click()
  126 |     const capture = async (colorScheme: 'light' | 'dark') => {
  127 |       await page.emulateMedia({ colorScheme })
  128 |       await page.setViewportSize({ width: 800, height: 760 })
  129 |       await expect(stage).toBeInViewport()
  130 |       expect(
  131 |         (await pane.getByRole('region', { name: '受管会话消息' }).boundingBox())!.height,
  132 |       ).toBeGreaterThanOrEqual(120)
  133 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  134 |         true,
  135 |       )
  136 |       mkdirSync(evidence, { recursive: true })
  137 |       await page.screenshot({
  138 |         path: join(evidence, `obs-02-${colorScheme}-800.png`),
  139 |         fullPage: true,
  140 |       })
  141 |     }
  142 |     await capture('light')
  143 |     await capture('dark')
  144 |     await page.getByRole('button', { name: '停止本轮', exact: true }).click()
  145 |     await expect.poll(() => f.store.submissions(session.id)[0]?.status).toBe('aborted')
  146 |     await expect(stage).toContainText('本轮已停止')
  147 |     await expect(stage.getByLabel('模型等待状态')).toHaveCount(0)
  148 |   } finally {
  149 |     await f.close()
  150 |   }
  151 | })
  152 | 
  153 | test('OBS-02 Electron failed stop remains unknown with same SDK PID; confirmation and terminal dismissal never change durable results', async () => {
  154 |   const f = await renderingDesktop(),
  155 |     { page } = f.desktop
  156 |   try {
  157 |     await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 中止确认')
  158 |     await page.getByRole('button', { name: '发送任务', exact: true }).click()
  159 |     await expect.poll(() => f.store.managedSessions().length).toBe(1)
  160 |     const session = f.store.managedSessions()[0]
  161 |     if (!session) {
  162 |       throw new Error('Missing stop fixture session')
  163 |     }
  164 |     await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.stage).toBe('streaming')
  165 |     const pid = f.kernels.list()[0]?.pid,
  166 |       abort = f.kernels.abort.bind(f.kernels)
  167 |     let release!: () => void
  168 |     const gate = new Promise<void>((resolve) => {
  169 |       release = resolve
  170 |     })
```