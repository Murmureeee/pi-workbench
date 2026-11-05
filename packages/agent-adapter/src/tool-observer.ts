import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { RuntimeTool } from '@pi-workbench/shared'

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '未提供数据'
  } catch {
    return '工具数据无法序列化；未影响执行结果，请核对原始记录。'
  }
}

/** Maps installed SDK events without executing tools or guessing outcomes from prose. This
 * observer owns only per-turn parameter snapshots; SDK owns duration/parent identity/results.
 * Unknown/cyclic data degrades to text, and missing start/duration remains explicitly unknown. */
export class ToolObserver {
  private readonly calls = new Map<string, { parameters: string; parentId: string | null }>()
  constructor(private readonly cwd: string) {}

  reset(): void {
    this.calls.clear()
  }

  observe(event: AgentSessionEvent): RuntimeTool | undefined {
    if (
      event.type !== 'tool_execution_start' &&
      event.type !== 'tool_execution_update' &&
      event.type !== 'tool_execution_end'
    ) {
      return undefined
    }
    const prior = this.calls.get(event.toolCallId)
    if (event.type !== 'tool_execution_end' && !prior) {
      this.calls.set(event.toolCallId, {
        parameters: serialize(event.args),
        parentId: event.parentToolCallId ?? null,
      })
    }
    const call = this.calls.get(event.toolCallId)
    const parentId = event.parentToolCallId ?? call?.parentId
    return {
      id: event.toolCallId,
      name: event.toolName,
      origin: 'sdk',
      cwd: this.cwd,
      ...(parentId !== undefined ? { parentId } : {}),
      ...(call ? { parameters: call.parameters } : {}),
      status:
        event.type === 'tool_execution_end' ? (event.isError ? 'error' : 'completed') : 'running',
      summary:
        event.type === 'tool_execution_end'
          ? serialize(event.result)
          : event.type === 'tool_execution_update'
            ? serialize(event.partialResult)
            : '',
      ...(event.type === 'tool_execution_end' &&
      event.durationMs !== undefined &&
      Number.isFinite(event.durationMs) &&
      event.durationMs >= 0
        ? { durationMs: event.durationMs }
        : {}),
    }
  }
}
