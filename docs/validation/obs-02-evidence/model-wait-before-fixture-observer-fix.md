# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-requests.spec.ts >> MODEL-07 synthetic wait deadlines never retry, preserve completed/denied tools, isolate focus and remain stoppable in actual Electron
- Location: e2e\model-requests.spec.ts:57:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.retained-session:not([hidden])').getByLabel('模型等待状态')
Expected substring: "距宿主等待期限"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('.retained-session:not([hidden])').getByLabel('模型等待状态') with timeout 5000ms
  - waiting for locator('.retained-session:not([hidden])').getByLabel('模型等待状态')

```

```yaml
- banner "桌面控制栏":
  - button "后退"
  - button "前进" [disabled]
  - navigation "应用菜单":
    - button "文件"
    - button "编辑"
    - button "视图"
    - button "帮助"
  - text: Pi Workbench
- navigation "工作台导航":
  - link "打开工作台":
    - /url: /?session=30746051-ee66-4983-a52f-81eb4cf20b28
  - link "打开设置":
    - /url: /?settings=appearance
- complementary "项目与会话":
  - text: π
  - strong: Pi Workbench
  - button "收起导航"
  - navigation:
    - button "新会话"
    - button "搜索会话 Ctrl+K"
    - link "打开工作区":
      - /url: /?workspaces
  - text: 会话
  - button "已归档"
  - region "项目分组":
    - text: 项目
    - button "新建项目"
    - text: 检索项目名称或路径
    - textbox "检索项目名称或路径":
      - /placeholder: 搜索项目名称或路径
    - paragraph: 置顶优先 · 组内手动排序
    - paragraph: 项目用于整理会话，也可以不绑定目录。
  - region "最近无项目会话":
    - paragraph: 最近 · 无项目
    - button "保持运行 · 等待策略样本 运行中"
    - button "会话菜单：保持运行 · 等待策略样本"
    - button "正常基线 · 后台焦点 未读"
    - button "会话菜单：正常基线 · 后台焦点"
  - link "旧 pi 历史 · 只读":
    - /url: /?legacy
  - link "模型与提供商":
    - /url: /?models
  - link "设置":
    - /url: /?settings=appearance
  - link "离线状态样本":
    - /url: /?samples
- main:
  - button "标题菜单：保持运行 · 等待策略样本":
    - strong: 保持运行 · 等待策略样本
  - text: 无项目 · 独立目录 · C:\Users\Murmure\AppData\Local\Temp\piw-render-ui-f5pnac\data\standalone\30746051-ee66-4983-a52f-81eb4cf20b28
  - button "历史记录"
  - region "工作区环境与恢复":
    - region "工作区与 Git 环境":
      - text: 实际 cwd C:\Users\Murmure\AppData\Local\Temp\piw-render-ui-f5pnac\data\standalone\30746051-ee66-4983-a52f-81eb4cf20b28 非 Git 目录 本地只读 · 自动更新
      - button "刷新环境标识": 刷新
    - region "工作区信任与恢复":
      - text: 项目资源受限 已确认文本 0 项 · 未确认 0 项 · 无法检查 0 项。仅已确认文本可在下轮加载。扩展、脚本与安装动作保持禁用。
      - link "检查资源信任":
        - /url: /?trust&project=C%3A%5CUsers%5CMurmure%5CAppData%5CLocal%5CTemp%5Cpiw-render-ui-f5pnac%5Cdata%5Cstandalone%5C30746051-ee66-4983-a52f-81eb4cf20b28
      - button "重新校验执行目录"
  - region "受管会话消息":
    - log:
      - paragraph:
        - text: 真实 pi SDK + 本地 HTTP 夹具；回复为验收样本，不调用真实提供商，工具与扩展关闭。
        - status "会话同步状态": 等待重新连接 · 后台任务继续
      - alert: 观察暂未同步 已保存内容保留；请恢复连接，后台任务不会因离开页面而停止。
      - text: 你 保持运行 · 等待策略样本 Pi · 本地夹具
      - paragraph: OFFLINE_
      - button "纯文本显示"
      - paragraph: 上游未提供可展示的思考信息
      - region "模型请求状态":
        - status "模型重试策略": 模型请求 1 次 · 自动重试 0 次 · 重试上限 0
  - button "返回最新消息": 返回最新
  - region "当前运行阶段":
    - status "任务状态": 运行状态待同步
    - paragraph: 已保存结果保留；断线或队列未同步不代表完成或停止。
    - region "模型请求状态"
  - text: 项目
  - combobox "项目 项目 项目" [disabled]:
    - option "无项目" [selected]
  - text: 模型
  - combobox "模型 模型 模型" [disabled]:
    - option "离线验收模型 · pi SDK 本地夹具" [selected]
  - paragraph: 离线验收：固定样本回复，思考关闭，不执行工具或扩展。
  - group:
    - textbox "任务内容":
      - /placeholder: 继续当前会话…
    - group:
      - text: 当前会话
      - button "停止本轮"
      - button "发送任务" [disabled]
  - text: Enter 发送 · Shift+Enter 换行 费用未知 · 未调用真实提供商 桌面已授权 真实传输关闭
```

# Test source

```ts
  1   | import { mkdirSync } from 'node:fs'
  2   | import { join } from 'node:path'
  3   | 
  4   | import { expect, test } from '@playwright/test'
  5   | 
  6   | import { renderingDesktop } from './helpers/rendering.js'
  7   | const evidence = process.env.PIW_EVIDENCE_DIR || '.workbench/evidence/latest'
  8   | 
  9   | test('MODEL-07 actual Electron merges a lost request and pushed model error, exposes zero retry policy and reconciles without resending', async () => {
  10  |   const f = await renderingDesktop(),
  11  |     { page } = f.desktop
  12  |   try {
  13  |     const session = await f.send('模型策略正常基线')
  14  |     await page.route('**/api/chat/submissions/*', (route) => route.abort('failed'))
  15  |     await page.route('**/api/chat/submit', async (route) => {
  16  |       await route.fetch({
  17  |         url: 'http://127.0.0.1:4318/api/chat/submit',
  18  |         headers: {
  19  |           ...route.request().headers(),
  20  |           host: '127.0.0.1:4318',
  21  |           origin: 'http://127.0.0.1:5173',
  22  |         },
  23  |       })
  24  |       await route.abort('failed')
  25  |     })
  26  |     await page.getByRole('textbox', { name: '任务内容' }).fill('模型错误 · 丢失回执验收')
  27  |     await page.getByRole('button', { name: '发送任务', exact: true }).click()
  28  |     await expect
  29  |       .poll(() => f.store.submissions(session.id).at(-1)?.status, { timeout: 20000 })
  30  |       .toBe('failed')
  31  |     const pane = page.locator('.retained-session:not([hidden])')
  32  |     await expect(pane.getByRole('alert').filter({ hasText: 'Offline fixture error' })).toHaveCount(
  33  |       1,
  34  |     )
  35  |     await expect(pane.getByRole('alert')).toHaveCount(1)
  36  |     await expect(pane).not.toContainText('fixture-model-error-secret')
  37  |     await expect(pane.getByLabel('模型重试策略').last()).toContainText(
  38  |       '模型请求 1 次 · 自动重试 0 次 · 重试上限 0',
  39  |     )
  40  |     await expect(pane.getByLabel('发送反馈')).toHaveCount(0)
  41  |     await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue(
  42  |       '模型错误 · 丢失回执验收',
  43  |     )
  44  |     await page.unroute('**/api/chat/submissions/*')
  45  |     await page.unroute('**/api/chat/submit')
  46  |     await pane.getByRole('button', { name: '核对原提交', exact: true }).click()
  47  |     await expect(page.getByRole('textbox', { name: '任务内容' })).toHaveValue('')
  48  |     expect(f.prompts()).toBe(2)
  49  |     await page.reload()
  50  |     await expect(page.getByLabel('模型重试策略').last()).toContainText('重试上限 0')
  51  |     expect(f.prompts()).toBe(2)
  52  |   } finally {
  53  |     await f.close()
  54  |   }
  55  | })
  56  | 
  57  | test('MODEL-07 synthetic wait deadlines never retry, preserve completed/denied tools, isolate focus and remain stoppable in actual Electron', async () => {
  58  |   const f = await renderingDesktop(),
  59  |     { page } = f.desktop
  60  |   try {
  61  |     const first = await f.send('正常基线 · 后台焦点')
  62  |     await page.getByRole('button', { name: '新会话', exact: true }).click()
  63  |     await page.getByRole('textbox', { name: '任务内容' }).fill('保持运行 · 等待策略样本')
  64  |     await page.getByRole('button', { name: '发送任务', exact: true }).click()
  65  |     await expect.poll(() => f.store.managedSessions().length).toBe(2)
  66  |     const session = f.store.managedSessions().find((row) => row.id !== first.id)!
  67  |     await expect.poll(() => f.events.snapshot(session.id)?.turns[0]?.text).toBe('OFFLINE_')
  68  |     const snapshot = f.events.snapshot(session.id)!,
  69  |       turn = snapshot.turns[0]
  70  |     if (!turn) {
  71  |       throw new Error('Missing active fixture turn')
  72  |     }
  73  |     const pid = f.kernels.list().find((row) => row.sessionId === session.id)?.pid
  74  |     f.events.attach(session.id, snapshot.epoch, 'synthetic-ipc-fixture')
  75  |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  76  |       type: 'turn.started',
  77  |       messageId: turn.messageId,
  78  |       prompt: turn.prompt,
  79  |     })
  80  |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  81  |       type: 'tool.updated',
  82  |       tool: { id: 'done', name: 'write', status: 'completed', summary: '合成观察：已完成一次' },
  83  |     })
  84  |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  85  |       type: 'tool.updated',
  86  |       tool: { id: 'denied', name: 'bash', status: 'denied', summary: '合成观察：拒绝保持有效' },
  87  |     })
  88  |     const request = {
  89  |       attempts: 2,
  90  |       retryCount: 1,
  91  |       retryLimit: 2,
  92  |       state: 'waiting' as const,
  93  |       waitUntil: Date.now() + 3000,
  94  |       error: 'synthetic rate limit api_key=sample-secret',
  95  |     }
  96  |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  97  |       type: 'model.updated',
  98  |       modelRequest: request,
  99  |     })
  100 |     const pane = page.locator('.retained-session:not([hidden])')
> 101 |     await expect(pane.getByLabel('模型等待状态')).toContainText('距宿主等待期限')
      |                                             ^ Error: expect(locator).toContainText(expected) failed
  102 |     await expect(pane.getByLabel('模型等待状态')).toContainText('等待服务确认', { timeout: 7000 })
  103 |     expect(f.prompts()).toBe(2)
  104 |     expect(f.kernels.list().find((row) => row.sessionId === session.id)?.pid).toBe(pid)
  105 |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  106 |       type: 'model.updated',
  107 |       modelRequest: { ...request, waitUntil: null },
  108 |     })
  109 |     await expect(pane.getByLabel('模型等待状态')).toContainText('等待期限未知')
  110 |     await expect(pane).not.toContainText('sample-secret')
  111 |     expect(f.events.snapshot(session.id)?.turns[0]?.tools.map((tool) => tool.status)).toEqual([
  112 |       'completed',
  113 |       'denied',
  114 |     ])
  115 |     await pane.getByTitle(first.title, { exact: true }).click()
  116 |     await page.getByRole('textbox', { name: '任务内容' }).fill('前台草稿不受迟到等待影响')
  117 |     await page.getByRole('textbox', { name: '任务内容' }).focus()
  118 |     f.events.publish(session.id, snapshot.epoch, turn.id, {
  119 |       type: 'model.updated',
  120 |       modelRequest: { ...request, waitUntil: Date.now() - 1000 },
  121 |     })
  122 |     await expect(page.getByRole('textbox', { name: '任务内容' })).toBeFocused()
  123 |     await expect(pane.getByLabel('模型等待状态')).toHaveCount(0)
  124 |     await page.getByRole('button', { name: `${session.title} 运行中`, exact: true }).click()
  125 |     await expect(pane.getByLabel('模型等待状态')).toContainText('等待服务确认')
  126 |     mkdirSync(evidence, { recursive: true })
  127 |     const capture = async (colorScheme: 'light' | 'dark') => {
  128 |       await page.emulateMedia({ colorScheme })
  129 |       await page.setViewportSize({ width: 800, height: 760 })
  130 |       await pane.getByLabel('模型等待状态').scrollIntoViewIfNeeded()
  131 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  132 |         true,
  133 |       )
  134 |       await page.screenshot({
  135 |         path: join(evidence, `model-07-${colorScheme}-800.png`),
  136 |         fullPage: true,
  137 |       })
  138 |     }
  139 |     await capture('light')
  140 |     await capture('dark')
  141 |     await page.getByRole('button', { name: '停止本轮', exact: true }).click()
  142 |     await expect.poll(() => f.store.submissions(session.id)[0]?.status).toBe('aborted')
  143 |     await expect(pane.getByLabel('任务状态')).toContainText('已停止')
  144 |     await expect(pane.getByLabel('模型等待状态')).toHaveCount(0)
  145 |     expect(f.prompts()).toBe(2)
  146 |   } finally {
  147 |     await f.close()
  148 |   }
  149 | })
  150 | 
```