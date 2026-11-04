/** Fixed local SSE output for content/scroll acceptance. This is never model output or
 * tool execution, and does not accept arbitrary remote destinations or scripts to run. */
export function renderingFixture(long: boolean): string {
  const lines = [
    '# 离线内容验收',
    '',
    '中文 **加粗**、*强调*、`行内代码` 与完整增量🙂。',
    '',
    '- 第一项',
    '- 第二项',
    '',
    '| 项目 | 状态 |',
    '| --- | --- |',
    '| 中文表格 | 离线通过 |',
    '',
    '[安全网站](https://example.com/verification) [脚本链接](javascript:alert%281%29) [本地文件](file:///C:/MUST_NOT_READ) [相对接口](/api/access)',
    '',
    '![追踪图片](https://example.com/MUST_NOT_FETCH.png)',
    '',
    '<script>window.__OBS01_UNSAFE = true</script>',
    '<img src="https://example.com/RAW_MUST_NOT_FETCH" onerror="window.__OBS01_UNSAFE = true">',
    '<svg onload="window.__OBS01_UNSAFE = true"><a href="file:///C:/MUST_NOT_READ">unsafe</a></svg>',
    '',
    '```typescript',
    'const greeting: string = "你好🙂"',
    'console.log(greeting)',
    '```',
    '',
    '```unknown-offline-language',
    '<unsafe>未知语言原文</unsafe>',
    '```',
    '',
    '```mermaid',
    'graph LR; A[保留代码] --> B[图示未启用]',
    '```',
    '',
    ...(long
      ? Array.from(
          { length: 720 },
          (_, index) =>
            `第${String(index + 1).padStart(3, '0')}段：中文历史回看与换行🙂。` +
            '保留原文与上下文。'.repeat(8) +
            '\n',
        )
      : []),
    'OBS01_RENDER_END',
    '',
    '```typescript',
    '未闭合围栏保留原文 const unfinished = "安全文本"',
  ]
  return lines.join('\n')
}
