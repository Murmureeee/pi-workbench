import type { ModelRequest } from '@pi-workbench/shared'

import { useEffect, useState } from 'react'

import { modelWaitLabel } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@pi-workbench/ui/components/trace'

/** A local display clock has no retry effect. The owner keeps the stop action enabled until
 * a real terminal; state, errors and metrics belong to the same immutable turn identity. */
export function ModelRequestStatus({
  request,
  error,
  feedback = true,
  metrics = true,
}: {
  request: ModelRequest | undefined
  error: string | null
  feedback?: boolean
  metrics?: boolean
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!feedback || request?.state !== 'waiting' || request.waitUntil === null) {
      return undefined
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [feedback, request?.state, request?.waitUntil])
  const message = error ?? (request?.state === 'waiting' ? request.error : null)
  return (
    <section aria-label="模型请求状态" className="flex min-w-0 flex-col gap-2">
      {metrics ? (
        <output aria-label="模型重试策略" className="phase-note">
          模型请求 {request?.attempts ?? '未知'} 次 · 自动重试 {request?.retryCount ?? '未知'} 次 ·
          重试上限 {request?.retryLimit ?? '未知'}
        </output>
      ) : null}
      {feedback && request?.state === 'waiting' ? (
        <output aria-label="模型等待状态">{modelWaitLabel(request, now)} · 可停止本轮</output>
      ) : null}
      {feedback && request?.state === 'interrupted' ? (
        <p className="phase-note">请求结果待核对 · 未自动重试</p>
      ) : null}
      {feedback && message ? (
        <Alert variant="destructive">
          <AlertTitle>
            {request?.state === 'waiting' ? '模型请求暂未完成' : '任务未完成'}
          </AlertTitle>
          <AlertDescription>
            <Trace>
              <TraceCollapsible defaultOpen>
                <TraceCollapsibleTrigger>
                  <TraceLine status="error">
                    <TraceTitle>错误详情</TraceTitle>
                  </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent>
                  <p className="break-words whitespace-pre-wrap">{message}</p>
                </TraceCollapsibleContent>
              </TraceCollapsible>
            </Trace>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
