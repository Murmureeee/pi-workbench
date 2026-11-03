# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-switching.spec.ts >> SESSION-02 Electron reads external pi history, handles concurrent append/partial/corrupt records without changing bytes or running kernels
- Location: e2e\session-switching.spec.ts:461:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByLabel('旧 pi 历史消息')
Expected substring: "旧记录 0"
Received string:    "你 · 外部只读记录旧记录 你 · 外部只读记录旧记录 1你 · 外部只读记录旧记录 2你 · 外部只读记录旧记录 3你 · 外部只读记录旧记录 4你 · 外部只读记录旧记录 5"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByLabel('旧 pi 历史消息') with timeout 5000ms
  - waiting for getByLabel('旧 pi 历史消息')
    - locator resolved to <div tabindex="0" role="region" data-scrollable="end" aria-label="旧 pi 历史消息" data-slot="message-scroller-viewport" class="scroll-fade-b size-full min-h-0 min-w-0 scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent data-pending-scroll:invisible">…</div>
    13 × unexpected value "你 · 外部只读记录旧记录 你 · 外部只读记录旧记录 1你 · 外部只读记录旧记录 2你 · 外部只读记录旧记录 3你 · 外部只读记录旧记录 4你 · 外部只读记录旧记录 5"
       - locator resolved to <div tabindex="0" role="region" aria-label="旧 pi 历史消息" data-slot="message-scroller-viewport" class="scroll-fade-b size-full min-h-0 min-w-0 scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent data-pending-scroll:invisible">…</div>
    - unexpected value "你 · 外部只读记录旧记录 你 · 外部只读记录旧记录 1你 · 外部只读记录旧记录 2你 · 外部只读记录旧记录 3你 · 外部只读记录旧记录 4你 · 外部只读记录旧记录 5"

```

```yaml
- region "旧 pi 历史消息":
  - log:
    - paragraph: 你 · 外部只读记录
    - paragraph: 旧记录
    - paragraph: 你 · 外部只读记录
    - paragraph: 旧记录 1
    - paragraph: 你 · 外部只读记录
    - paragraph: 旧记录 2
    - paragraph: 你 · 外部只读记录
    - paragraph: 旧记录 3
    - paragraph: 你 · 外部只读记录
    - paragraph: 旧记录 4
    - paragraph: 你 · 外部只读记录
    - paragraph: 旧记录 5
```

# Test source

```ts
  372 |     await pane.getByText('执行目录：独立目录', { exact: true }).click()
  373 |     await pane.getByLabel('目录绝对路径（可选）').fill(newDirectory)
  374 |     await pane.getByRole('button', { name: '校验此目录', exact: true }).click()
  375 |     await expect(pane.getByText(`执行目录：${newDirectory}`, { exact: true })).toBeVisible()
  376 |     releaseDirectory()
  377 |     await directoryDelivered
  378 |     // Let the delivered body and React's resulting layout settle before checking ownership.
  379 |     await page.evaluate(
  380 |       () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  381 |     )
  382 |     await expect(pane.getByText(`执行目录：${newDirectory}`, { exact: true })).toBeVisible()
  383 |     await pane.getByTitle(a.title, { exact: true }).click()
  384 |     await pane.getByRole('button', { name: '历史记录', exact: true }).click()
  385 |     await expect.poll(() => waiting).toBe(true)
  386 |     await pane.getByTitle(b.title, { exact: true }).click()
  387 |     await pane.getByLabel('任务内容').fill('B 不接收 A 的结果')
  388 |     await pane.getByTitle(c.title, { exact: true }).click()
  389 |     await pane.getByTitle(d.title, { exact: true }).click()
  390 |     await pane.getByTitle(a.title, { exact: true }).click()
  391 |     await expect(pane.getByLabel('持久化历史')).toContainText('A 第 0 行')
  392 |     release()
  393 |     await expect(pane.getByLabel('持久化历史')).not.toContainText('B 第 0 行')
  394 |     const snapshot = f.app.get(EventService).snapshot(a.id)
  395 |     const turn = snapshot?.turns[0]
  396 |     if (!snapshot || !turn) {
  397 |       throw new Error('Missing real runtime snapshot')
  398 |     }
  399 |     // Synthetic completed observation, not an executed tool or approval.
  400 |     f.app.get(EventService).restore({
  401 |       ...snapshot,
  402 |       source: 'synthetic-ipc-fixture',
  403 |       turns: [
  404 |         {
  405 |           ...turn,
  406 |           tools: [
  407 |             {
  408 |               id: 'synthetic-tool',
  409 |               name: '合成只读工具',
  410 |               status: 'completed',
  411 |               summary: '用于展开状态验收，不执行工具',
  412 |             },
  413 |           ],
  414 |         },
  415 |       ],
  416 |     })
  417 |     f.store.saveApproval({
  418 |       id: randomUUID(),
  419 |       sessionId: a.id,
  420 |       epoch: snapshot.epoch,
  421 |       turnId: turn.id,
  422 |       source: 'synthetic-fixture',
  423 |       decision: 'pending',
  424 |       parameters: {},
  425 |       reason: '合成等待记录，不可执行',
  426 |     })
  427 |     f.store.saveChangeReference({
  428 |       id: randomUUID(),
  429 |       sessionId: a.id,
  430 |       epoch: snapshot.epoch,
  431 |       turnId: turn.id,
  432 |       source: 'synthetic-fixture',
  433 |       reference: 'synthetic-ledger:A-只读引用',
  434 |     })
  435 |     await pane.getByRole('button', { name: '返回对话', exact: true }).click()
  436 |     await expect(pane.getByText('合成只读工具 · completed · 只读过程')).toBeVisible()
  437 |     await pane.getByText('合成只读工具 · completed · 只读过程').click()
  438 |     await pane.getByTitle(b.title, { exact: true }).click()
  439 |     await pane.getByTitle(c.title, { exact: true }).click()
  440 |     await pane.getByTitle(d.title, { exact: true }).click()
  441 |     await pane.getByTitle(a.title, { exact: true }).click()
  442 |     await expect(pane.getByText('用于展开状态验收，不执行工具')).toBeVisible()
  443 |     await pane.getByRole('button', { name: '历史记录', exact: true }).click()
  444 |     await expect(pane.getByLabel('审批记录')).toContainText('合成等待记录，不可执行')
  445 |     await pane.getByRole('button', { name: 'synthetic-ledger:A-只读引用' }).click()
  446 |     await pane.getByTitle(b.title, { exact: true }).click()
  447 |     await expect(pane.getByTitle(a.title, { exact: true })).toContainText('待审批 1')
  448 |     await expect(pane.getByLabel('当前变更引用')).toHaveCount(0)
  449 |     await pane.getByTitle(a.title, { exact: true }).click()
  450 |     await expect(pane.getByLabel('当前变更引用')).toContainText('synthetic-ledger:A-只读引用')
  451 |     await pane.getByTitle(b.title, { exact: true }).click()
  452 |     await expect(pane.getByLabel('任务内容')).toHaveValue('B 不接收 A 的结果')
  453 |     expect(f.store.submissions(a.id)).toHaveLength(1)
  454 |   } finally {
  455 |     releaseDirectory()
  456 |     release()
  457 |     await f.close()
  458 |   }
  459 | })
  460 | 
  461 | test('SESSION-02 Electron reads external pi history, handles concurrent append/partial/corrupt records without changing bytes or running kernels', async () => {
  462 |   test.setTimeout(90000)
  463 |   const f = await fixture(),
  464 |     { page } = f.desktop,
  465 |     before = readFileSync(f.path),
  466 |     count = f.kernels.list().length
  467 |   try {
  468 |     await page.getByRole('link', { name: '旧 pi 历史 · 只读' }).click()
  469 |     await page.getByRole('button', { name: /D:\\旧目录/ }).click()
  470 |     await expect(page.getByLabel('旧 pi 历史消息')).toContainText('旧记录 6')
  471 |     await page.getByRole('button', { name: '更早的消息', exact: true }).click()
> 472 |     await expect(page.getByLabel('旧 pi 历史消息')).toContainText('旧记录 0')
      |                                                ^ Error: expect(locator).toContainText(expected) failed
  473 |     await page.getByRole('button', { name: '刷新最新历史', exact: true }).click()
  474 |     appendFileSync(f.path, '{partial')
  475 |     await page.getByRole('button', { name: '更早的消息', exact: true }).click()
  476 |     await expect(page.getByText(/历史版本已变化/)).toBeVisible()
  477 |     await page.getByRole('button', { name: '刷新最新历史', exact: true }).click()
  478 |     await expect(page.getByLabel('旧 pi 历史消息')).toContainText('incomplete-tail')
  479 |     appendFileSync(f.path, '}\n{broken}\n')
  480 |     const after = readFileSync(f.path)
  481 |     await page.getByRole('button', { name: '刷新最新历史', exact: true }).click()
  482 |     await expect(page.getByLabel('旧 pi 历史消息')).toContainText('invalid-record')
  483 |     await expect(page.getByRole('button', { name: '继续旧会话（尚未开放）' })).toBeDisabled()
  484 |     expect(readFileSync(f.path)).toEqual(after)
  485 |     expect(after.subarray(0, before.length)).toEqual(before)
  486 |     expect(f.kernels.list()).toHaveLength(count)
  487 |     expect(f.store.managedSessions()).toHaveLength(4)
  488 |     await page.screenshot({
  489 |       path: `${evidence}/session-legacy-readonly.png`,
  490 |       animations: 'disabled',
  491 |     })
  492 |   } finally {
  493 |     await f.close()
  494 |   }
  495 | })
  496 | 
```