# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reasoning.spec.ts >> OBS-06 actual Electron states, late/cross-session isolation, background focus and light/dark narrow windows
- Location: e2e\reasoning.spec.ts:60:1

# Error details

```
Error: expect(locator).toBeInViewport() failed

Locator:  locator('.retained-session:not([hidden])').getByRole('button', { name: '上游提供的思考信息', exact: true })
Expected: in viewport
Received: viewport ratio 0
Timeout:  5000ms

Call log:
  - Expect "toBeInViewport" locator('.retained-session:not([hidden])').getByRole('button', { name: '上游提供的思考信息', exact: true }) with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').getByRole('button', { name: '上游提供的思考信息', exact: true })
    14 × locator resolved to <button tabindex="0" type="button" data-panel-open="" aria-expanded="true" aria-label="上游提供的思考信息" aria-controls="base-ui-_r_2p_" data-slot="trace-collapsible-trigger" class="group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 has-[[data-status=error]]:text-destructive">…</button>
       - unexpected value "viewport ratio 0"

```

```yaml
- button "上游提供的思考信息" [expanded]
```

# Test source

```ts
  16  |       .locator('.retained-session:not([hidden])')
  17  |       .getByRole('region', { name: '上游思考信息' })
  18  |     const trigger = card.getByRole('button', { name: '上游提供的思考信息', exact: true })
  19  |     await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  20  |     await expect(card).not.toContainText('先核对输入')
  21  |     await trigger.focus()
  22  |     await page.keyboard.press('Enter')
  23  |     await expect(card).toContainText('先核对输入')
  24  |     await expect(card).toContainText('«redacted»')
  25  |     await expect(card).not.toContainText('fixture-only-secret')
  26  |     await card.getByRole('button', { name: '复制公开思考文本', exact: true }).click()
  27  |     await expect(card.getByRole('status').or(card.locator('output'))).toHaveText(
  28  |       '已复制公开思考文本',
  29  |     )
  30  |     expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('先核对输入')
  31  |     expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(
  32  |       'fixture-only-secret',
  33  |     )
  34  |     const downloaded = page.waitForEvent('download')
  35  |     await card.getByRole('link', { name: '下载公开思考文本', exact: true }).click()
  36  |     const path = await (await downloaded).path()
  37  |     expect(path && readFileSync(path, 'utf8')).toContain('先核对输入')
  38  |     expect(path && readFileSync(path, 'utf8')).not.toContain('fixture-only-secret')
  39  |     await trigger.focus()
  40  |     await page.keyboard.press('Space')
  41  |     await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  42  |     await page.goto('http://127.0.0.1:5173/?credentials')
  43  |     await page.getByRole('button', { name: '隐藏公开思考正文', exact: true }).click()
  44  |     await page.reload()
  45  |     await expect(
  46  |       page.getByRole('button', { name: '允许显示公开思考正文', exact: true }),
  47  |     ).toHaveAttribute('aria-pressed', 'true')
  48  |     await page.goto(`http://127.0.0.1:5173/?session=${session.id}`)
  49  |     await expect(
  50  |       page.getByRole('button', { name: '上游提供的思考信息', exact: true }),
  51  |     ).toBeDisabled()
  52  |     await expect(page.locator('main')).not.toContainText('先核对输入')
  53  |     await expect(page.getByRole('button', { name: '复制公开思考文本', exact: true })).toHaveCount(0)
  54  |     expect(f.prompts()).toBe(1)
  55  |   } finally {
  56  |     await f.close()
  57  |   }
  58  | })
  59  | 
  60  | test('OBS-06 actual Electron states, late/cross-session isolation, background focus and light/dark narrow windows', async () => {
  61  |   const f = await renderingDesktop(),
  62  |     { page } = f.desktop
  63  |   const errors: string[] = []
  64  |   page.on('pageerror', (error) => errors.push(error.message))
  65  |   try {
  66  |     const first = await f.send('没有思考的普通回复')
  67  |     await expect(page.getByLabel('思考信息状态')).toContainText('未声明支持')
  68  |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  69  |     await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 等待响应')
  70  |     await page.getByRole('button', { name: '发送任务', exact: true }).click()
  71  |     await expect.poll(() => f.store.managedSessions().length).toBe(2)
  72  |     const second = f.store.managedSessions().find((s) => s.id !== first.id)!
  73  |     await expect.poll(() => f.events.snapshot(second.id)?.turns[0]?.text).toBe('OFFLINE_')
  74  |     const snapshot = f.events.snapshot(second.id)!,
  75  |       turn = snapshot.turns[0]
  76  |     if (!turn) {
  77  |       throw new Error('Missing active turn')
  78  |     }
  79  |     const pane = page.locator('.retained-session:not([hidden])')
  80  |     f.events.publish(second.id, snapshot.epoch, turn.id, {
  81  |       type: 'reasoning.updated',
  82  |       reasoning: { status: 'not-provided' },
  83  |     })
  84  |     await expect(pane.getByLabel('思考信息状态')).toContainText('未提供')
  85  |     f.events.publish(second.id, snapshot.epoch, turn.id, {
  86  |       type: 'reasoning.updated',
  87  |       reasoning: { status: 'unavailable' },
  88  |     })
  89  |     await expect(pane.getByLabel('思考信息状态')).toContainText('不可展示')
  90  |     await expect(pane.getByRole('button', { name: '上游提供的思考信息', exact: true })).toHaveCount(
  91  |       0,
  92  |     )
  93  |     // The result may still be unread when leaving immediately after completion.
  94  |     // Its native title identifies the same row regardless of the unread badge.
  95  |     await pane.getByTitle(first.title, { exact: true }).click()
  96  |     await page.getByRole('textbox', { name: '任务内容' }).fill('草稿焦点保持')
  97  |     await page.getByRole('textbox', { name: '任务内容' }).focus()
  98  |     f.events.publish(second.id, snapshot.epoch, turn.id, {
  99  |       type: 'reasoning.updated',
  100 |       reasoning: { status: 'provided', text: '后台公开观察，合成夹具', truncated: false },
  101 |     })
  102 |     await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
  103 |     await expect(pane).not.toContainText('后台公开观察')
  104 |     expect(f.kernels.list().find((k) => k.sessionId === second.id)?.state).toBe('running')
  105 |     await page.getByRole('button', { name: `${second.title} 运行中`, exact: true }).click()
  106 |     const trigger = pane.getByRole('button', { name: '上游提供的思考信息', exact: true })
  107 |     await trigger.click()
  108 |     await expect(pane).toContainText('后台公开观察')
  109 |     mkdirSync(evidence, { recursive: true })
  110 |     const capture = async (colorScheme: 'light' | 'dark') => {
  111 |       await page.emulateMedia({ colorScheme })
  112 |       await page.setViewportSize({ width: 800, height: 760 })
  113 |       await trigger.scrollIntoViewIfNeeded()
  114 |       await trigger.focus()
  115 |       await expect(trigger).toBeVisible()
> 116 |       await expect(trigger).toBeInViewport()
      |                             ^ Error: expect(locator).toBeInViewport() failed
  117 |       expect(
  118 |         await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  119 |       ).toBe(true)
  120 |       await page.screenshot({
  121 |         path: join(evidence, `obs-06-${colorScheme}-narrow.png`),
  122 |         fullPage: true,
  123 |       })
  124 |     }
  125 |     await capture('light')
  126 |     await capture('dark')
  127 |     await f.kernels.abort(second.id, turn.id)
  128 |     expect(errors).toEqual([])
  129 |   } finally {
  130 |     await f.close()
  131 |   }
  132 | })
  133 | 
```