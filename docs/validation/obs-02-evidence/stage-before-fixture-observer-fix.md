# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: run-stages.spec.ts >> OBS-02 actual Electron observes one current stage, synthetic tool/approval/compaction/retry cannot complete or dismiss, late updates preserve focus
- Location: e2e\run-stages.spec.ts:10:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.retained-session:not([hidden])').getByRole('region', { name: '当前运行阶段', exact: true })
Expected substring: "压缩上下文"
Received string:    "运行状态待同步已保存结果保留；断线或队列未同步不代表完成或停止。"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.retained-session:not([hidden])').getByRole('region', { name: '当前运行阶段', exact: true }) with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').getByRole('region', { name: '当前运行阶段', exact: true })
    14 × locator resolved to <section aria-live="polite" aria-label="当前运行阶段" data-stage="syncing" class="current-run-status" data-operation-id="1b845470-a270-42b6-8843-4cc7b5d78ede">…</section>
       - unexpected value "运行状态待同步已保存结果保留；断线或队列未同步不代表完成或停止。"

```

```yaml
- region "当前运行阶段":
  - status "任务状态": 运行状态待同步
  - paragraph: 已保存结果保留；断线或队列未同步不代表完成或停止。
```

# Test source

```ts
  1   | import { mkdirSync } from 'node:fs'
  2   | import { join } from 'node:path'
  3   | 
  4   | import { expect, test } from '@playwright/test'
  5   | 
  6   | import { renderingDesktop } from './helpers/rendering.js'
  7   | 
  8   | const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
  9   | 
  10  | test('OBS-02 actual Electron observes one current stage, synthetic tool/approval/compaction/retry cannot complete or dismiss, late updates preserve focus', async () => {
  11  |   const f = await renderingDesktop(),
  12  |     { page } = f.desktop
  13  |   try {
  14  |     const first = await f.send('阶段基线')
  15  |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  16  |     await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 阶段观察')
  17  |     await page.getByRole('button', { name: '发送任务', exact: true }).click()
  18  |     await expect.poll(() => f.store.managedSessions().length).toBe(2)
  19  |     const session = f.store.managedSessions().find((s) => s.id !== first.id)!
  20  |     await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.stage).toBe('streaming')
  21  |     const snapshot = f.events.snapshot(session.id)!,
  22  |       turn = snapshot.turns[0],
  23  |       pid = f.kernels.list().find((s) => s.sessionId === session.id)?.pid
  24  |     const pane = page.locator('.retained-session:not([hidden])'),
  25  |       stage = pane.getByRole('region', { name: '当前运行阶段', exact: true })
  26  |     await expect(stage).toHaveCount(1)
  27  |     await expect(stage).toContainText('接收模型回复')
  28  |     f.events.attach(session.id, snapshot.epoch, 'synthetic-ipc-fixture')
  29  |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  30  |       type: 'turn.started',
  31  |       messageId: turn.messageId,
  32  |       prompt: turn.prompt,
  33  |     })
  34  |     const publish = (payload: Parameters<typeof f.events.publish>[3]) =>
  35  |       f.events.publish(session.id, snapshot.epoch, turn.id, payload)
  36  |     publish({ type: 'stage.updated', stage: 'compacting' })
> 37  |     await expect(stage).toContainText('压缩上下文')
      |                         ^ Error: expect(locator).toContainText(expected) failed
  38  |     await expect(stage.getByRole('button', { name: '隐藏状态提示' })).toHaveCount(0)
  39  |     publish({ type: 'stage.updated', stage: 'preparing-tools' })
  40  |     await expect(stage).toContainText('准备工具参数')
  41  |     publish({
  42  |       type: 'tool.updated',
  43  |       tool: {
  44  |         id: 'synthetic-tool',
  45  |         name: 'write',
  46  |         status: 'running',
  47  |         summary: '合成观察；没有执行写入',
  48  |       },
  49  |     })
  50  |     publish({ type: 'stage.updated', stage: 'streaming' })
  51  |     await expect(stage).toContainText('执行工具')
  52  |     publish({
  53  |       type: 'approval.requested',
  54  |       approval: { id: 'synthetic-approval', command: '合成观察', cwd: session.cwd },
  55  |     })
  56  |     await expect(stage).toContainText('等待审批')
  57  |     publish({ type: 'approval.resolved', approvalId: 'synthetic-approval' })
  58  |     publish({
  59  |       type: 'tool.updated',
  60  |       tool: {
  61  |         id: 'synthetic-tool',
  62  |         name: 'write',
  63  |         status: 'denied',
  64  |         summary: '合成拒绝；没有执行写入',
  65  |       },
  66  |     })
  67  |     publish({
  68  |       type: 'model.updated',
  69  |       modelRequest: {
  70  |         attempts: 2,
  71  |         retryCount: 1,
  72  |         retryLimit: 2,
  73  |         state: 'waiting',
  74  |         waitUntil: Date.now() - 1,
  75  |         error: '合成错误 api_key=stage-secret',
  76  |       },
  77  |     })
  78  |     await expect(stage).toContainText('等待重试')
  79  |     await expect(stage.getByLabel('模型等待状态')).toContainText('等待服务确认')
  80  |     await expect(pane.getByRole('alert').filter({ hasText: '合成错误' })).toHaveCount(1)
  81  |     await expect(pane).not.toContainText('stage-secret')
  82  |     expect(f.prompts()).toBe(2)
  83  |     await pane.getByTitle(first.title, { exact: true }).click()
  84  |     await page.getByRole('textbox', { name: '任务内容' }).fill('前台草稿阶段隔离')
  85  |     await page.getByRole('textbox', { name: '任务内容' }).focus()
  86  |     publish({ type: 'stage.updated', stage: 'compacting' })
  87  |     await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
  88  |     await expect(pane).not.toContainText('压缩上下文')
  89  |     expect(f.kernels.list().find((s) => s.sessionId === session.id)?.pid).toBe(pid)
  90  |     await pane.getByTitle(session.title, { exact: true }).click()
  91  |     const capture = async (colorScheme: 'light' | 'dark') => {
  92  |       await page.emulateMedia({ colorScheme })
  93  |       await page.setViewportSize({ width: 800, height: 760 })
  94  |       await expect(stage).toBeInViewport()
  95  |       expect(
  96  |         (await pane.getByRole('region', { name: '受管会话消息' }).boundingBox())!.height,
  97  |       ).toBeGreaterThanOrEqual(120)
  98  |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  99  |         true,
  100 |       )
  101 |       mkdirSync(evidence, { recursive: true })
  102 |       await page.screenshot({
  103 |         path: join(evidence, `obs-02-${colorScheme}-800.png`),
  104 |         fullPage: true,
  105 |       })
  106 |     }
  107 |     await capture('light')
  108 |     await capture('dark')
  109 |     await page.getByRole('button', { name: '停止本轮', exact: true }).click()
  110 |     await expect.poll(() => f.store.submissions(session.id)[0]?.status).toBe('aborted')
  111 |     await expect(stage).toContainText('本轮已停止')
  112 |     await expect(stage.getByLabel('模型等待状态')).toHaveCount(0)
  113 |   } finally {
  114 |     await f.close()
  115 |   }
  116 | })
  117 | 
  118 | test('OBS-02 Electron failed stop remains unknown with same SDK PID; confirmation and terminal dismissal never change durable results', async () => {
  119 |   const f = await renderingDesktop(),
  120 |     { page } = f.desktop
  121 |   try {
  122 |     await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 中止确认')
  123 |     await page.getByRole('button', { name: '发送任务', exact: true }).click()
  124 |     await expect.poll(() => f.store.managedSessions().length).toBe(1)
  125 |     const session = f.store.managedSessions()[0]
  126 |     await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.stage).toBe('streaming')
  127 |     const pid = f.kernels.list()[0]?.pid,
  128 |       abort = f.kernels.abort.bind(f.kernels)
  129 |     let release!: () => void
  130 |     const gate = new Promise<void>((resolve) => {
  131 |       release = resolve
  132 |     })
  133 |     f.kernels.abort = async () => {
  134 |       await gate
  135 |       throw new Error('injected failure')
  136 |     }
  137 |     const pane = page.locator('.retained-session:not([hidden])'),
```