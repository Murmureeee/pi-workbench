import type { RuntimeTool } from '@pi-workbench/shared'

import { CheckIcon, CircleDashedIcon, TerminalIcon, XIcon } from 'lucide-react'
import { memo, useMemo } from 'react'

import { toolPresentation, toolRows, toolStatusNames } from '@pi-workbench/shared'
import { Badge } from '@pi-workbench/ui/components/badge'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@pi-workbench/ui/components/trace'

import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { MessageBody } from './message-body.js'
import { useReadingLayout } from './reading-layout.js'

/** A read-only, per-call Trace. Expansion belongs to the window view, keyed by turn+call;
 * background events never open a card, steal focus, approve or retry an execution. */
const ToolRow = memo(function ToolRow({
  sessionId,
  turnId,
  tool,
  depth,
  diagnostic,
}: {
  sessionId: string
  turnId: string
  tool: RuntimeTool
  depth: number
  diagnostic: string
}) {
  const key = `tool:${JSON.stringify([turnId, tool.id])}`
  const open = useSessionViews(
    (state) => state.views[sessionId]?.expanded.some((id) => id === key || id === tool.id) ?? false,
  )
  const reading = useReadingLayout()
  const presentation = useMemo(() => toolPresentation(tool), [tool])
  const failed = ['error', 'denied', 'cancelled', 'interrupted'].includes(tool.status)
  const Icon =
    tool.status === 'completed'
      ? CheckIcon
      : failed
        ? XIcon
        : tool.status === 'pending'
          ? CircleDashedIcon
          : TerminalIcon
  return (
    <section
      aria-label={`工具调用 ${tool.id}`}
      data-tool-id={tool.id}
      data-tool-depth={depth}
      className="min-w-0"
      style={{ marginInlineStart: `${Math.min(depth, 4) * 12}px` }}
    >
      <TraceCollapsible
        open={open}
        onOpenChange={(value) => {
          reading?.preserve(!value)
          const prior = sessionView(sessionId).expanded
          const retained = prior.filter((id) => id !== key && id !== tool.id)
          useSessionViews
            .getState()
            .update(sessionId, { expanded: value ? [...retained, key] : retained })
        }}
      >
        <TraceCollapsibleTrigger
          aria-label={`${tool.name || '未知工具'} · ${toolStatusNames[tool.status]} · ${tool.id}`}
        >
          <TraceLine
            status={
              tool.status === 'running'
                ? 'running'
                : failed
                  ? 'error'
                  : tool.status === 'pending'
                    ? 'pending'
                    : undefined
            }
          >
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>{tool.name || '未知工具'}</TraceTitle>
            <TraceDescription>{toolStatusNames[tool.status]}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{presentation.kind}</Badge>
              {tool.risk ? (
                <Badge variant="outline">
                  {tool.risk.level} · {tool.risk.automatic ? '受限读取自动' : '须明确审批'}
                </Badge>
              ) : null}
              {tool.origin === 'synthetic-fixture' ? (
                <Badge variant="secondary">合成观察 · 未执行</Badge>
              ) : null}
            </div>
            <p className="wrap-anywhere whitespace-pre-wrap">{presentation.text}</p>
            {tool.risk ? (
              <section aria-label="宿主风险裁决">
                <p>{tool.risk.reasons.join(' ')}</p>
                <p className="text-xs wrap-anywhere text-muted-foreground">
                  最终参数指纹 {tool.risk.digest} · 策略版本 {tool.risk.policyVersion}
                </p>
              </section>
            ) : null}
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt>调用 ID</dt>
              <dd className="wrap-anywhere">{tool.id}</dd>
              <dt>父调用</dt>
              <dd className="wrap-anywhere">
                {tool.parentId ?? (tool.parentId === null ? '无' : '未知')}
              </dd>
              <dt>嵌套层级</dt>
              <dd>{depth}</dd>
              <dt>执行目录</dt>
              <dd className="wrap-anywhere">{tool.cwd || '未知'}</dd>
              <dt>耗时</dt>
              <dd>{tool.durationMs === undefined ? '未知' : `${tool.durationMs} ms`}</dd>
              <dt>退出码</dt>
              <dd>
                {tool.exitCode === undefined || tool.exitCode === null ? '未知' : tool.exitCode}
              </dd>
            </dl>
            {tool.diagnostic || diagnostic ? (
              <p role="note">{tool.diagnostic || diagnostic}</p>
            ) : null}
            {presentation.truncated ? (
              <p role="note">工具已截断输出；此处只能展开已捕获内容，未自动读取外部输出文件。</p>
            ) : null}
            <section aria-label="工具参数">
              <h4>最终参数快照</h4>
              <MessageBody
                sessionId={sessionId}
                messageId={`${key}:parameters`}
                text={tool.parameters ?? '未提供参数快照，不能推断最终参数。'}
                rich={false}
              />
            </section>
            <section aria-label="工具结果">
              <h4>工具结果</h4>
              <MessageBody
                sessionId={sessionId}
                messageId={`${key}:result`}
                text={
                  tool.summary ||
                  (tool.status === 'running' || tool.status === 'pending'
                    ? '等待工具结果。'
                    : '未提供结果正文。')
                }
                rich={false}
              />
            </section>
            {presentation.diff ? (
              <section aria-label="工具 Diff">
                <h4>工具返回的 Diff · 仅观察</h4>
                <p>尚未关联可回滚账本；不能据此执行回滚。</p>
                <MessageBody
                  sessionId={sessionId}
                  messageId={`${key}:diff`}
                  text={presentation.diff}
                  rich={false}
                />
              </section>
            ) : null}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </section>
  )
})

export function ToolTimeline({
  sessionId,
  turnId,
  tools,
}: {
  sessionId: string
  turnId: string
  tools: readonly RuntimeTool[]
}) {
  const rows = useMemo(() => toolRows(tools), [tools])
  if (!rows.length) {
    return null
  }
  return (
    <section aria-label="工具时间线" className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">工具过程 · {rows.length} 次调用 · 只读</p>
      <Trace>
        {rows.map((row) => (
          <ToolRow key={row.tool.id} sessionId={sessionId} turnId={turnId} {...row} />
        ))}
      </Trace>
    </section>
  )
}
