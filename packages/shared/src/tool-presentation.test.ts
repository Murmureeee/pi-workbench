import type { RuntimeTool } from './tool-observation.js'

import { expect, test } from 'vitest'

import { toolPresentation, toolRows } from './tool-presentation.js'

const tool: RuntimeTool = {
  id: 'a',
  name: 'read',
  status: 'completed',
  summary: '',
  parameters: '{"path":"src/中文.ts","offset":5,"limit":3}',
}

test('file/command/change/MCP summaries require verified structures and never infer actual lines or exit codes from prose', () => {
  expect(toolPresentation(tool)).toMatchObject({
    kind: '文件读取',
    text: 'src/中文.ts · 请求从第 5 行开始 · 请求最多 3 行',
  })
  expect(
    toolPresentation({
      ...tool,
      name: 'bash',
      parameters: '{"command":"echo fixture"}',
      summary: 'Process exited with code 0',
    }),
  ).toMatchObject({ kind: '命令', text: 'echo fixture' })
  expect(
    toolPresentation({
      ...tool,
      name: 'edit',
      parameters: '{"path":"a.ts","edits":[{"oldText":"a","newText":"b"}]}',
      summary: '{"details":{"patch":"-a\\n+b"}}',
    }),
  ).toMatchObject({ kind: '文件变更', diff: '-a\n+b' })
  expect(
    toolPresentation({ ...tool, name: 'custom', mcp: { server: 'local', tool: 'lookup' } }),
  ).toMatchObject({ kind: 'MCP', text: 'local / lookup' })
})

test('malformed/unknown/oversized tool structures degrade to safe text and explicit upstream truncation stays visible', () => {
  for (const parameters of ['{bad', '{"path":23}', 'x'.repeat(65537)]) {
    expect(toolPresentation({ ...tool, parameters }).kind).toBe('未知结构')
  }
  expect(toolPresentation({ ...tool, name: 'mcp_guessed_server' }).kind).toBe('未知结构')
  expect(
    toolPresentation({ ...tool, summary: '{"details":{"truncation":{"truncated":true}}}' })
      .truncated,
  ).toBe(true)
})

test('child-before-parent, missing and cyclic parents preserve each identity once and sibling order independent of return order', () => {
  const tools = [
    { ...tool, id: 'child', parentId: 'parent' },
    { ...tool, id: 'sibling', parentId: 'parent' },
    { ...tool, id: 'parent' },
    { ...tool, id: 'orphan', parentId: 'missing' },
    { ...tool, id: 'cycle1', parentId: 'cycle2' },
    { ...tool, id: 'cycle2', parentId: 'cycle1' },
  ]
  const rows = toolRows(tools)
  expect(rows.map((row) => row.tool.id)).toEqual([
    'parent',
    'child',
    'sibling',
    'orphan',
    'cycle1',
    'cycle2',
  ])
  expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 0, 0, 1])
  expect(rows.find((row) => row.tool.id === 'orphan')?.diagnostic).toContain('尚不可用')
  expect(rows.find((row) => row.tool.id === 'cycle1')?.diagnostic).toContain('循环')
  expect(
    toolRows(
      Array.from({ length: 3000 }, (_, index) => ({
        ...tool,
        id: String(index),
        parentId: index ? String(index - 1) : null,
      })),
    ),
  ).toHaveLength(3000)
})
