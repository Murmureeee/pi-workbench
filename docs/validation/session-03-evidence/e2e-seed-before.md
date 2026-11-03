# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-switching.spec.ts >> SESSION-02 Electron isolates evicted draft-directory and A-B-A history responses, restoring synthetic tool/reference context
- Location: e2e\session-switching.spec.ts:311:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "completed"
Received: "failed"

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import type { Route } from '@playwright/test'
  2   | 
  3   | import { randomUUID } from 'node:crypto'
  4   | import {
  5   |   appendFileSync,
  6   |   mkdirSync,
  7   |   mkdtempSync,
  8   |   readFileSync,
  9   |   rmSync,
  10  |   writeFileSync,
  11  | } from 'node:fs'
  12  | import { tmpdir } from 'node:os'
  13  | import { join } from 'node:path'
  14  | 
  15  | import { expect, test } from '@playwright/test'
  16  | 
  17  | import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
  18  | import { EventService } from '../apps/daemon/dist/modules/events/event.service.js'
  19  | import { KernelService } from '../apps/daemon/dist/modules/kernels/kernel.service.js'
  20  | import { SessionService } from '../apps/daemon/dist/modules/sessions/session.service.js'
  21  | import { SessionStore } from '../apps/daemon/dist/modules/sessions/session.store.js'
  22  | import { launchWorkspaceDesktop } from './helpers/desktop.js'
  23  | 
  24  | const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
  25  | async function fixture() {
  26  |   const directory = mkdtempSync(join(tmpdir(), 'piw-switch-ui-')),
  27  |     pi = join(directory, 'pi'),
  28  |     legacy = join(pi, 'sessions', '--old--')
  29  |   mkdirSync(legacy, { recursive: true })
  30  |   const path = join(legacy, 'old.jsonl')
  31  |   writeFileSync(
  32  |     path,
  33  |     [
  34  |       {
  35  |         type: 'session',
  36  |         version: 3,
  37  |         id: 'old-native',
  38  |         cwd: 'D:\\旧目录',
  39  |         timestamp: '2026-10-01T00:00:00Z',
  40  |       },
  41  |       ...Array.from({ length: 106 }, (_, i) => ({
  42  |         type: 'message',
  43  |         id: `old-${i}`,
  44  |         parentId: i ? `old-${i - 1}` : null,
  45  |         message: { role: 'user', content: `旧记录 ${i}` },
  46  |       })),
  47  |     ]
  48  |       .map((item) => JSON.stringify(item))
  49  |       .join('\n') + '\n',
  50  |   )
  51  |   const app = await createApp({
  52  |     dataDir: join(directory, 'data'),
  53  |     port: 4318,
  54  |     development: true,
  55  |     piAgentDir: pi,
  56  |   })
  57  |   await app.listen(4318, '127.0.0.1')
  58  |   const store = app.get(SessionStore),
  59  |     service = app.get(SessionService),
  60  |     kernels = app.get(KernelService)
  61  |   try {
  62  |     const sessions = await Promise.all(
  63  |       ['A', 'B', 'C', 'D'].map(async (letter) => {
  64  |         const receipt = await service.submit({
  65  |           requestId: randomUUID(),
  66  |           sessionId: null,
  67  |           configuration: {
  68  |             projectId: null,
  69  |             workspaceId: null,
  70  |             model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
  71  |             thinking: 'off',
  72  |           },
  73  |           text:
  74  |             `${letter} 会话阅读段落\n` +
  75  |             Array.from({ length: 80 }, (_, i) => `${letter} 第 ${i} 行，保留当前阅读位置。`).join(
  76  |               '\n',
  77  |             ),
  78  |           retryOf: null,
  79  |         })
  80  |         await expect
  81  |           .poll(() => store.receipt(receipt.submission.requestId)?.submission.status, {
  82  |             timeout: 15000,
  83  |           })
> 84  |           .toBe('completed')
      |            ^ Error: expect(received).toBe(expected) // Object.is equality
  85  |         return receipt.session
  86  |       }),
  87  |     )
  88  |     const desktop = await launchWorkspaceDesktop(directory, app)
  89  |     // Native TCP WS to the same isolated daemon as REST; no mocked frames/reducer.
  90  |     await desktop.context.addInitScript(() => {
  91  |       const NativeWebSocket = window.WebSocket
  92  |       window.WebSocket = class extends NativeWebSocket {
  93  |         constructor(url: string | URL, protocols?: string | string[]) {
  94  |           const endpoint = new URL(url)
  95  |           if (endpoint.pathname === '/api/events') {
  96  |             endpoint.port = '4318'
  97  |           }
  98  |           super(endpoint, protocols)
  99  |         }
  100 |       }
  101 |     })
  102 |     await desktop.page.reload()
  103 |     return {
  104 |       directory,
  105 |       path,
  106 |       app,
  107 |       store,
  108 |       service,
  109 |       kernels,
  110 |       sessions,
  111 |       desktop,
  112 |       close: async () => {
  113 |         await desktop.close()
  114 |         await app.close()
  115 |         rmSync(directory, { recursive: true, force: true })
  116 |       },
  117 |     }
  118 |   } catch (error) {
  119 |     await app.close()
  120 |     rmSync(directory, { recursive: true, force: true })
  121 |     throw error
  122 |   }
  123 | }
  124 | async function forward(route: Route) {
  125 |   const url = new URL(route.request().url())
  126 |   return route.fetch({
  127 |     url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
  128 |     headers: {
  129 |       ...route.request().headers(),
  130 |       host: '127.0.0.1:4318',
  131 |       origin: 'http://127.0.0.1:5173',
  132 |     },
  133 |   })
  134 | }
  135 | 
  136 | test('SESSION-02 Electron evicts after three views and restores per-session drafts, anchors and panel after reload', async () => {
  137 |   test.setTimeout(90000)
  138 |   const f = await fixture(),
  139 |     { page } = f.desktop,
  140 |     [a, b, c, d] = f.sessions
  141 |   if (!a || !b || !c || !d) {
  142 |     throw new Error('Missing seeded sessions')
  143 |   }
  144 |   const pane = page.locator('.retained-session:not([hidden])')
  145 |   const open = async (title: string) => {
  146 |     await pane.getByTitle(title, { exact: true }).click()
  147 |     await expect(pane.getByLabel('受管会话消息')).toContainText('OFFLINE_OK')
  148 |   }
  149 |   const errors: string[] = []
  150 |   page.on('pageerror', (error) => errors.push(error.message))
  151 |   try {
  152 |     await open(a.title)
  153 |     await pane.getByLabel('任务内容').fill('A 的未发送草稿')
  154 |     const viewport = pane.getByLabel('受管会话消息')
  155 |     await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(900)
  156 |     await viewport.press('Home')
  157 |     await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
  158 |     await viewport.evaluate((element) => element.scrollTo({ top: 900, behavior: 'instant' }))
  159 |     await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(900)
  160 |     const top = 900
  161 |     const before = await page.evaluate(() => sessionStorage.getItem('piw-session-views-v1'))
  162 |     await open(b.title)
  163 |     await pane.getByLabel('任务内容').fill('B 的草稿')
  164 |     await open(c.title)
  165 |     await open(d.title)
  166 |     await expect(page.locator('[data-session-view]')).toHaveCount(3)
  167 |     await expect(page.locator(`[data-session-view="${a.id}"]`)).toHaveCount(0)
  168 |     await open(a.title)
  169 |     await expect(pane.getByLabel('任务内容')).toHaveValue('A 的未发送草稿')
  170 |     writeFileSync(
  171 |       `${evidence}/session-reading-state.json`,
  172 |       JSON.stringify(
  173 |         {
  174 |           before,
  175 |           after: await page.evaluate(() => sessionStorage.getItem('piw-session-views-v1')),
  176 |           geometry: await viewport.evaluate((element) => ({
  177 |             top: element.scrollTop,
  178 |             height: element.clientHeight,
  179 |             scrollHeight: element.scrollHeight,
  180 |             anchors: [...element.querySelectorAll<HTMLElement>('[data-reading-id]')].map(
  181 |               (item) => ({
  182 |                 id: item.dataset.readingId,
  183 |                 top: item.getBoundingClientRect().top,
  184 |                 height: item.getBoundingClientRect().height,
```