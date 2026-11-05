import type { Reasoning } from '@pi-workbench/shared'

import { useEffect, useState } from 'react'

import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@pi-workbench/ui/components/trace'

import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { useWorkbench } from '../../stores/workbench.js'
import { MessageBody } from './message-body.js'
import { useReadingLayout } from './reading-layout.js'

const labels = {
  'not-provided': '上游未提供可展示的思考信息',
  unsupported: '当前模型未声明支持思考信息',
  unavailable: '上游思考信息不可展示 · 已过滤或格式未知',
}

/** Displays public, daemon-redacted output only. Opening/copying/downloading is local and never
 * requests hidden reasoning or changes model execution. Expansion belongs to this session view. */
export function ReasoningCard({
  sessionId,
  messageId,
  reasoning,
}: {
  sessionId: string
  messageId: string
  reasoning: Reasoning | undefined
}) {
  const key = `reasoning:${messageId}`
  const open = useSessionViews((s) => s.views[sessionId]?.expanded.includes(key) ?? false)
  const hidden = useWorkbench((s) => s.hideReasoning)
  const reading = useReadingLayout()
  const [feedback, setFeedback] = useState('')
  const [url, setUrl] = useState('')
  const text = reasoning?.status === 'provided' ? reasoning.text : ''
  const allowed = Boolean(open && !hidden && text)
  useEffect(() => {
    setFeedback('')
    if (!allowed) {
      setUrl('')
      return undefined
    }
    const value = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [allowed, text])
  if (!reasoning || reasoning.status !== 'provided') {
    return (
      <p className="phase-note" aria-label="思考信息状态">
        {labels[reasoning?.status ?? 'not-provided']}
      </p>
    )
  }
  return (
    <section aria-label="上游思考信息" className="min-w-0">
      <Trace>
        <TraceCollapsible
          open={open && !hidden}
          onOpenChange={(value) => {
            reading?.preserve(!value)
            const prior = sessionView(sessionId).expanded.filter((id) => id !== key)
            useSessionViews
              .getState()
              .update(sessionId, { expanded: value ? [...prior, key] : prior })
          }}
        >
          <TraceCollapsibleTrigger disabled={hidden} aria-label="上游提供的思考信息">
            <TraceLine>
              <TraceTitle>
                {hidden ? '思考正文已隐藏（本窗口隐私设置）' : '上游提供的思考信息'}
              </TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            {allowed ? (
              <div className="flex min-w-0 flex-col gap-2">
                <p className="phase-note">仅展示上游允许提供的文本；不代表可获取隐藏的内部推理。</p>
                <MessageBody sessionId={sessionId} messageId={key} text={text} rich={false} />
                {reasoning.truncated ? (
                  <p role="note">内容超过展示上限；复制与下载只包含当前捕获的文本。</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(text).then(
                        () => setFeedback('已复制公开思考文本'),
                        () => setFeedback('复制失败，请重试'),
                      )
                    }}
                  >
                    复制公开思考文本
                  </Button>
                  {url ? (
                    <a
                      href={url}
                      download="piw-public-reasoning.txt"
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      下载公开思考文本
                    </a>
                  ) : null}
                </div>
                {feedback ? <output aria-live="polite">{feedback}</output> : null}
              </div>
            ) : null}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </section>
  )
}
