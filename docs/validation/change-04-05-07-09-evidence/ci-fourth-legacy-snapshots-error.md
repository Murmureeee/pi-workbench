# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: change-snapshots.spec.ts >> CHANGE-01 Electron shows actual baseline and final references without exposing rollback, retains versions after same-profile restart
- Location: e2e\change-snapshots.spec.ts:133:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: '轮次文件版本', exact: true })
Expected substring: "接受和回滚入口尚未交付"
Received string:    "基线已保存本轮成功 · 收尾已保存查看轮次文件版本文件版本保存不等于可整轮回滚。可审查历史差异与来源，并经预检和明确确认回滚文件；来源不确定时须单独确认覆盖，禁止自动回滚。本轮成功 · 轮次 554d20d6-b9cc-431d-ad38-3227461293a3 · 2026/11/8 19:11:18执行目录：C:\\Users\\Murmure\\AppData\\Local\\Temp\\piw-change-ui-KnxOwS\\中文快照目录写入前基线：已保存 · 1 个文件 · 15 字节 · 0 项排除版本引用：f1c9ba7af14948dd87d68529b03d908f260663f8收尾版本：已保存 · 1 个文件 · 15 字节 · 0 项排除版本引用：d9517f365b9cf388c3db399e20c52010b621c481来源不确定：文件工具、命令与外部编辑可能混合；文件字节不覆盖 ACL、空目录、排除项或外部副作用。审查本轮文件差异核对修改来源查看持久回滚记录"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('region', { name: '轮次文件版本', exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: '轮次文件版本', exact: true })
    14 × locator resolved to <section aria-label="轮次文件版本" class="flex min-w-0 flex-col gap-2 border-b bg-background px-5 py-2 text-xs">…</section>
       - unexpected value "基线已保存本轮成功 · 收尾已保存查看轮次文件版本文件版本保存不等于可整轮回滚。可审查历史差异与来源，并经预检和明确确认回滚文件；来源不确定时须单独确认覆盖，禁止自动回滚。本轮成功 · 轮次 554d20d6-b9cc-431d-ad38-3227461293a3 · 2026/11/8 19:11:18执行目录：C:\Users\Murmure\AppData\Local\Temp\piw-change-ui-KnxOwS\中文快照目录写入前基线：已保存 · 1 个文件 · 15 字节 · 0 项排除版本引用：f1c9ba7af14948dd87d68529b03d908f260663f8收尾版本：已保存 · 1 个文件 · 15 字节 · 0 项排除版本引用：d9517f365b9cf388c3db399e20c52010b621c481来源不确定：文件工具、命令与外部编辑可能混合；文件字节不覆盖 ACL、空目录、排除项或外部副作用。审查本轮文件差异核对修改来源查看持久回滚记录"

```

```yaml
- region "轮次文件版本":
  - text: 基线已保存 本轮成功 · 收尾已保存
  - button "查看轮次文件版本" [expanded]
  - paragraph: 文件版本保存不等于可整轮回滚。可审查历史差异与来源，并经预检和明确确认回滚文件；来源不确定时须单独确认覆盖，禁止自动回滚。
  - article "文件版本轮次 554d20d6-b9cc-431d-ad38-3227461293a3":
    - paragraph: 本轮成功 · 轮次 554d20d6-b9cc-431d-ad38-3227461293a3 · 2026/11/8 19:11:18 执行目录：C:\Users\Murmure\AppData\Local\Temp\piw-change-ui-KnxOwS\中文快照目录
    - paragraph: 写入前基线：已保存 · 1 个文件 · 15 字节 · 0 项排除
    - paragraph: 版本引用：f1c9ba7af14948dd87d68529b03d908f260663f8
    - paragraph: 收尾版本：已保存 · 1 个文件 · 15 字节 · 0 项排除
    - paragraph: 版本引用：d9517f365b9cf388c3db399e20c52010b621c481
    - paragraph: 来源不确定：文件工具、命令与外部编辑可能混合；文件字节不覆盖 ACL、空目录、排除项或外部副作用。
    - button "审查本轮文件差异"
    - button "核对修改来源"
  - region "持久回滚记录":
    - button "查看持久回滚记录"
```

# Test source

```ts
  45  |     .create({ requestId: randomUUID(), name: '文件版本项目', workspaceId: opened.workspace.id })
  46  |   const wire = () => {
  47  |     const kernels = app.get(KernelService),
  48  |       prompt = kernels.prompt.bind(kernels)
  49  |     kernels.prompt = (id, path, input, options) => {
  50  |       sends++
  51  |       return prompt(
  52  |         id,
  53  |         path,
  54  |         {
  55  |           ...input,
  56  |           fixture: input.text.includes('写入')
  57  |             ? 'approval-write'
  58  |             : input.text.includes('保持')
  59  |               ? 'hold'
  60  |               : input.text.includes('失败')
  61  |                 ? 'error'
  62  |                 : 'reply',
  63  |         },
  64  |         options,
  65  |       )
  66  |     }
  67  |   }
  68  |   wire()
  69  |   await app.listen(4318, '127.0.0.1')
  70  |   let desktop = await launchWorkspaceDesktop(root, app)
  71  |   return {
  72  |     root,
  73  |     cwd,
  74  |     get page() {
  75  |       return desktop.page
  76  |     },
  77  |     get app() {
  78  |       return app
  79  |     },
  80  |     get changes() {
  81  |       return app.get(ChangeService)
  82  |     },
  83  |     get kernels() {
  84  |       return app.get(KernelService)
  85  |     },
  86  |     sends: () => sends,
  87  |     send: async (text: string) => {
  88  |       const before = new Set(
  89  |         app
  90  |           .get(SessionStore)
  91  |           .managedSessions()
  92  |           .map((row) => row.id),
  93  |       )
  94  |       const button = desktop.page.getByRole('button', { name: '新会话', exact: true }).first()
  95  |       if (!(await button.isVisible())) {
  96  |         await desktop.page.getByRole('button', { name: '展开导航', exact: true }).click()
  97  |       }
  98  |       await button.click()
  99  |       await desktop.page.getByLabel('项目', { exact: true }).selectOption(project.id)
  100 |       await desktop.page.getByRole('textbox', { name: '任务内容' }).fill(text)
  101 |       await expect(
  102 |         desktop.page.getByRole('button', { name: '发送任务', exact: true }),
  103 |       ).toBeEnabled()
  104 |       await desktop.page.getByRole('button', { name: '发送任务', exact: true }).click()
  105 |       await expect.poll(() => app.get(SessionStore).managedSessions().length).toBe(before.size + 1)
  106 |       return required(
  107 |         app
  108 |           .get(SessionStore)
  109 |           .managedSessions()
  110 |           .find((row) => !before.has(row.id)),
  111 |       )
  112 |     },
  113 |     open: async (id: string) => {
  114 |       await desktop.page.goto(`http://127.0.0.1:5173/?session=${id}`)
  115 |     },
  116 |     restart: async () => {
  117 |       await desktop.close()
  118 |       await app.close()
  119 |       app = await createApp({ dataDir, port: 4318, development: true })
  120 |       sends = 0
  121 |       wire()
  122 |       await app.listen(4318, '127.0.0.1')
  123 |       desktop = await launchWorkspaceDesktop(root, app)
  124 |     },
  125 |     close: async () => {
  126 |       await desktop.close()
  127 |       await app.close()
  128 |       rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  129 |     },
  130 |   }
  131 | }
  132 | 
  133 | test('CHANGE-01 Electron shows actual baseline and final references without exposing rollback, retains versions after same-profile restart', async () => {
  134 |   test.setTimeout(90000)
  135 |   const f = await setup()
  136 |   try {
  137 |     const session = await f.send('保存文件版本')
  138 |     const region = f.page.getByRole('region', { name: '轮次文件版本', exact: true })
  139 |     await expect(region).toContainText('基线已保存')
  140 |     await expect(region).toContainText('收尾已保存')
  141 |     await region.getByRole('button', { name: '查看轮次文件版本', exact: true }).click()
  142 |     const record = required(f.changes.history(session.id).rounds[0])
  143 |     await expect(region).toContainText(required(record.baseline.reference ?? undefined))
  144 |     await expect(region).toContainText('来源不确定')
> 145 |     await expect(region).toContainText('接受和回滚入口尚未交付')
      |                          ^ Error: expect(locator).toContainText(expected) failed
  146 |     expect(await region.getByRole('button', { name: /回滚|恢复文件/ }).count()).toBe(0)
  147 |     expect(
  148 |       (await f.changes.readVersion(record.turnId, 'baseline', 'original.txt'))?.toString(),
  149 |     ).toBe('BEFORE_REAL_SDK')
  150 |     await f.restart()
  151 |     await f.open(session.id)
  152 |     await expect(f.page.getByRole('region', { name: '轮次文件版本' })).toContainText('收尾已保存')
  153 |     expect(f.changes.history(session.id).rounds[0]?.baseline.reference).toBe(
  154 |       record.baseline.reference,
  155 |     )
  156 |     expect(f.kernels.list()).toEqual([])
  157 |     expect(f.sends()).toBe(0)
  158 |     expect(f.app.get(ApprovalService).list()).toEqual([])
  159 |   } finally {
  160 |     await f.close()
  161 |   }
  162 | })
  163 | 
  164 | test('CHANGE-01 Electron baseline failure is visible before explicit one-shot irreversible approval; cancel leaves actual files unchanged', async () => {
  165 |   test.setTimeout(90000)
  166 |   const f = await setup()
  167 |   try {
  168 |     writeFileSync(join(f.cwd, 'large.bin'), Buffer.alloc(5 * 1024 * 1024 + 1))
  169 |     const first = await f.send('写入失败基线')
  170 |     const region = f.page.getByRole('region', { name: '轮次文件版本' })
  171 |     await expect(region).toContainText('基线保存失败')
  172 |     await region.getByRole('button', { name: '查看轮次文件版本' }).click()
  173 |     await expect(region).toContainText('写入暂停')
  174 |     expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
  175 |     await f.page.getByRole('button', { name: '取消本次调用', exact: true }).click()
  176 |     await expect.poll(() => f.changes.history(first.id).rounds[0]?.outcome).toBe('completed')
  177 |     expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
  178 |     await f.send('写入单次明确确认')
  179 |     await f.page.getByRole('button', { name: '允许本次…', exact: true }).click()
  180 |     await expect(f.page.getByRole('alertdialog')).toContainText('当前尚无整轮回滚入口')
  181 |     expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
  182 |     await f.page.getByRole('button', { name: '明确允许本次不可回滚执行', exact: true }).click()
  183 |     await expect.poll(() => existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(true)
  184 |     expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
  185 |   } finally {
  186 |     await f.close()
  187 |   }
  188 | })
  189 | 
  190 | test('CHANGE-01 Electron queued cancellation creates no version, background round retains PID and captures external mixed files on stop', async () => {
  191 |   test.setTimeout(90000)
  192 |   const f = await setup()
  193 |   try {
  194 |     const first = await f.send('保持后台文件版本')
  195 |     await expect
  196 |       .poll(() => f.kernels.list().find((k) => k.sessionId === first.id)?.state)
  197 |       .toBe('running')
  198 |     const kernel = required(f.kernels.list().find((k) => k.sessionId === first.id))
  199 |     const second = await f.send('排队文件版本')
  200 |     const region = f.page.getByRole('region', { name: '轮次文件版本' })
  201 |     await expect(region).toContainText('尚无轮次文件版本')
  202 |     expect(f.changes.history(second.id).rounds).toEqual([])
  203 |     await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
  204 |     expect(f.kernels.list().find((k) => k.sessionId === first.id)?.pid).toBe(kernel.pid)
  205 |     writeFileSync(join(f.cwd, 'original.txt'), 'EXTERNAL_MIXED_WHILE_BACKGROUND')
  206 |     await f.open(first.id)
  207 |     await expect(region).toContainText('基线已保存')
  208 |     await f.page.getByRole('button', { name: '停止本轮', exact: true }).click()
  209 |     await expect(region).toContainText('本轮已中止')
  210 |     await expect(region).toContainText('收尾已保存')
  211 |     await region.getByRole('button', { name: '查看轮次文件版本' }).click()
  212 |     await expect(region).toContainText('来源不确定')
  213 |     const record = required(f.changes.history(first.id).rounds[0])
  214 |     expect((await f.changes.readVersion(record.turnId, 'final', 'original.txt'))?.toString()).toBe(
  215 |       'EXTERNAL_MIXED_WHILE_BACKGROUND',
  216 |     )
  217 |     expect(f.changes.history(second.id).rounds).toEqual([])
  218 |   } finally {
  219 |     await f.close()
  220 |   }
  221 | })
  222 | 
  223 | test('CHANGE-01 Electron read failure recovers and saved outcome is legible in light/dark narrow windows', async () => {
  224 |   test.setTimeout(90000)
  225 |   const f = await setup()
  226 |   try {
  227 |     await f.send('失败轮次文件版本')
  228 |     const region = f.page.getByRole('region', { name: '轮次文件版本' })
  229 |     await expect(region).toContainText('本轮失败')
  230 |     let fail = true
  231 |     await f.page.route('**/api/changes/rounds?**', async (route) => {
  232 |       if (fail) {
  233 |         await route.fulfill({
  234 |           status: 503,
  235 |           contentType: 'application/json',
  236 |           body: JSON.stringify({ message: '明确合成 HTTP 读取失败夹具' }),
  237 |         })
  238 |       } else {
  239 |         await route.fallback()
  240 |       }
  241 |     })
  242 |     await expect(region).toContainText('文件版本待同步')
  243 |     await region.getByRole('button', { name: '查看轮次文件版本' }).click()
  244 |     await expect(region).toContainText('现场与任务保留')
  245 |     fail = false
```