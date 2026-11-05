import type { RuntimeTool } from './tool-observation.js'

import { z } from 'zod'

import { toolOutputTruncated } from './tool-observation.js'

export const toolStatusNames = {
  pending: '等待执行',
  running: '运行中',
  completed: '已完成',
  error: '失败',
  denied: '已拒绝',
  cancelled: '已取消',
  interrupted: '结果未知 · 已中断',
}
const fileInput = z.object({ path: z.string().min(1) })
const readInput = fileInput.extend({
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
})
const writeInput = fileInput.extend({ content: z.string() })
const editInput = fileInput.extend({
  edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).min(1),
})
const commandInput = z.object({ command: z.string().min(1) })
const editResult = z.object({
  details: z.object({ patch: z.string().optional(), diff: z.string().optional() }),
})

/** Only recognized tool names AND validated structures get a specialized summary. Request
 * ranges are labeled requests, never claimed as actual reads. Unknown/oversized/malformed
 * values remain plain text; no links, tool calls, filesystem reads or Diff authority are made. */
export function toolPresentation(tool: RuntimeTool) {
  let parameters: unknown, result: unknown
  try {
    parameters =
      tool.parameters && tool.parameters.length <= 65536 ? JSON.parse(tool.parameters) : undefined
  } catch {
    /* Plain text remains visible below. */
  }
  try {
    result = tool.summary.length <= 262144 ? JSON.parse(tool.summary) : undefined
  } catch {
    /* Unknown output is not a render failure. */
  }
  const truncated = toolOutputTruncated(result)
  if (tool.mcp) {
    return { kind: 'MCP', text: `${tool.mcp.server} / ${tool.mcp.tool}`, truncated }
  }
  if (tool.name === 'read') {
    const input = readInput.safeParse(parameters)
    if (input.success) {
      return {
        kind: '文件读取',
        text: `${input.data.path}${input.data.offset !== undefined ? ` · 请求从第 ${input.data.offset} 行开始` : ''}${input.data.limit !== undefined ? ` · 请求最多 ${input.data.limit} 行` : ''}`,
        truncated,
      }
    }
  }
  if (tool.name === 'write') {
    const input = writeInput.safeParse(parameters)
    if (input.success) {
      return { kind: '文件写入', text: `${input.data.path} · 写入请求`, truncated }
    }
  }
  if (tool.name === 'edit') {
    const input = editInput.safeParse(parameters)
    if (input.success) {
      const output = editResult.safeParse(result)
      return {
        kind: '文件变更',
        text: `${input.data.path} · ${input.data.edits.length} 处替换请求`,
        truncated,
        diff: output.success ? (output.data.details.patch ?? output.data.details.diff) : undefined,
      }
    }
  }
  if (tool.name === 'bash' || tool.name === 'powershell') {
    const input = commandInput.safeParse(parameters)
    if (input.success) {
      return { kind: '命令', text: input.data.command, truncated }
    }
  }
  if (tool.name === 'grep' || tool.name === 'find' || tool.name === 'ls') {
    const input = z
      .object({ path: z.string().optional(), pattern: z.string().optional() })
      .safeParse(parameters)
    if (input.success && (input.data.path || input.data.pattern)) {
      return {
        kind: '文件检索',
        text: [input.data.path, input.data.pattern].filter(Boolean).join(' · '),
        truncated,
      }
    }
  }
  return { kind: '未知结构', text: '保留脱敏参数与结果，按安全文本显示。', truncated }
}

/** Stable first-observed sibling order, independent of completion order. Missing parents,
 * self/cyclic references remain visible as diagnostics; every call appears exactly once.
 * Iterative traversal avoids recursion limits for untrusted deeply nested observations. */
export function toolRows(tools: readonly RuntimeTool[]) {
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  const children = new Map<string, RuntimeTool[]>()
  for (const tool of tools) {
    if (tool.parentId && byId.has(tool.parentId)) {
      const siblings = children.get(tool.parentId)
      if (siblings) {
        siblings.push(tool)
      } else {
        children.set(tool.parentId, [tool])
      }
    }
  }
  const seen = new Set<string>()
  const rows: { tool: RuntimeTool; depth: number; diagnostic: string }[] = []
  const visit = (root: RuntimeTool, diagnostic = '') => {
    const stack = [{ tool: root, depth: 0, diagnostic }]
    while (stack.length) {
      const row = stack.pop()
      if (!row || seen.has(row.tool.id)) {
        continue
      }
      seen.add(row.tool.id)
      rows.push(row)
      for (const child of (children.get(row.tool.id) ?? []).toReversed()) {
        stack.push({ tool: child, depth: row.depth + 1, diagnostic: '' })
      }
    }
  }
  for (const tool of tools) {
    if (!tool.parentId || !byId.has(tool.parentId)) {
      visit(tool, tool.parentId ? '父调用尚不可用；保留原关联。' : '')
    }
  }
  for (const tool of tools) {
    if (!seen.has(tool.id)) {
      visit(tool, '嵌套关联存在循环；平铺保留原调用。')
    }
  }
  return rows
}
