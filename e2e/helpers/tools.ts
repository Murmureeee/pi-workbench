import type { RuntimeTool } from '../../packages/shared/dist/index.js'

/** Explicit observation fixtures, never executable tools or production approvals. */
export const toolSecret = 'obs03-private-fixture-value'
export const toolLongOutput =
  '中文工具输出🙂\n'.repeat(8000) + toolSecret + '\nOBS03_TOOL_OUTPUT_END'
export function toolFixtures(cwd: string): RuntimeTool[] {
  const base = { origin: 'synthetic-fixture' as const, cwd }
  return [
    {
      ...base,
      id: 'read-child',
      name: 'read',
      parentId: 'script-parent',
      status: 'completed',
      summary: '{"content":[{"type":"text","text":"只读样本🙂"}]}',
    },
    {
      ...base,
      id: 'read-child',
      name: 'read',
      parentId: 'script-parent',
      status: 'running',
      parameters: '{"path":"src/中文.ts","offset":2,"limit":4,"apiKey":"sample-key-hidden"}',
      summary: '',
    },
    {
      ...base,
      id: 'script-parent',
      name: 'codemode',
      parentId: null,
      status: 'running',
      parameters: '{"code":"不执行的嵌套调用观察"}',
      summary: '',
    },
    {
      ...base,
      id: 'command',
      name: 'powershell',
      parentId: 'script-parent',
      status: 'completed',
      parameters: '{"command":"Write-Output 离线样本"}',
      summary: '输出包含 exit 0 字样，但不能据此猜退出码。',
    },
    {
      ...base,
      id: 'failure',
      name: 'bash',
      parentId: null,
      status: 'error',
      parameters: '{"command":"不执行的失败命令"}',
      summary: '合成失败结果',
      exitCode: 7,
      durationMs: 12.5,
    },
    {
      ...base,
      id: 'edit',
      name: 'edit',
      parentId: null,
      status: 'completed',
      parameters: '{"path":"not-created.txt","edits":[{"oldText":"旧行","newText":"新行"}]}',
      summary:
        '{"details":{"patch":"--- a/not-created.txt\\n+++ b/not-created.txt\\n@@ -1 +1 @@\\n-旧行\\n+新行"}}',
    },
    {
      ...base,
      id: 'mcp',
      name: 'custom-lookup',
      parentId: null,
      status: 'completed',
      mcp: { server: '本机合成服务', tool: 'lookup' },
      parameters: '{"query":"中文查询"}',
      summary: toolLongOutput,
    },
    {
      ...base,
      id: 'denied',
      name: 'write',
      parentId: null,
      status: 'denied',
      parameters: '{"path":"not-created.txt","content":"未执行"}',
      summary: '明确拒绝的合成观察',
    },
    {
      ...base,
      id: 'cancelled',
      name: 'custom-cancelled',
      parentId: null,
      status: 'cancelled',
      parameters: '{}',
      summary: '明确取消的合成观察',
    },
    {
      ...base,
      id: 'unknown',
      name: 'custom-unknown',
      parentId: 'missing-parent',
      status: 'completed',
      parameters: '{invalid JSON',
      summary:
        '<script>window.obs03Unsafe=true</script><img src="https://invalid.example/obs03-image">\n未知结构保留原文。',
    },
    {
      ...base,
      id: 'truncated',
      name: 'read',
      parentId: null,
      status: 'completed',
      parameters: '{"path":"large.txt"}',
      summary:
        '{"details":{"truncation":{"truncated":true}},"content":[{"type":"text","text":"仅捕获的输出"}]}',
    },
    {
      ...base,
      id: 'cycle-a',
      name: 'cycle-a',
      parentId: 'cycle-b',
      status: 'completed',
      summary: 'cycle sample',
    },
    {
      ...base,
      id: 'cycle-b',
      name: 'cycle-b',
      parentId: 'cycle-a',
      status: 'completed',
      summary: 'cycle sample',
    },
    {
      ...base,
      id: 'script-parent',
      name: 'codemode',
      parentId: null,
      status: 'completed',
      summary: '嵌套合成观察已结束',
      durationMs: 25,
    },
  ]
}
