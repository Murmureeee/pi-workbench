import type { ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Component, lazy, memo, Suspense, useLayoutEffect, useState } from 'react'

import { Button } from '@pi-workbench/ui/components/button'

import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { markdownLimit, messagePrefix, messagePreview } from './content-policy.js'
import { useReadingLayout } from './reading-layout.js'
import './message-body.css'

const MarkdownBody = lazy(() => import('./markdown-body.js'))

/** A failed optional renderer leaves escaped source readable; a new source can retry.
 * The boundary owns no execution, persisted history or model context. */
class RenderBoundary extends Component<{ children: ReactNode; text: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <>
        <p className="phase-note">格式显示失败，已保留纯文本。</p>
        <pre className="message-plain">{this.props.text}</pre>
      </>
    ) : (
      this.props.children
    )
  }
}

/** Bounded visual previews never modify SDK content. Full-history fetching is explicit,
 * paired/daemon-redacted, query-identity-bound and aborted when this message unmounts. */
export const MessageBody = memo(function MessageBody({
  sessionId,
  messageId,
  text,
  rich = true,
  streaming = false,
  fullMessageId,
  preview = true,
}: {
  sessionId: string
  messageId: string
  text: string
  rich?: boolean
  streaming?: boolean
  fullMessageId?: string
  preview?: boolean
}) {
  const key = `body:${messageId}`
  const expanded = useSessionViews((s) => s.views[sessionId]?.expanded.includes(key) ?? false)
  const full = useQuery({
    queryKey: ['message-body-full', sessionId, fullMessageId],
    enabled: expanded && Boolean(fullMessageId),
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(fullMessageId ?? '')}/content`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error('完整内容暂不可用，请重试。')
      }
      return response.text()
    },
  })
  const source = expanded && full.data !== undefined ? full.data : text
  const truncated =
    preview && !expanded && (source.length > messagePreview || Boolean(fullMessageId))
  const visible = truncated ? messagePrefix(source) : source
  const [plain, setPlain] = useState(false)
  const reading = useReadingLayout()
  useLayoutEffect(() => {
    reading?.restore()
  }, [reading, visible, plain, expanded])
  const fallback = <pre className="message-plain">{visible}</pre>
  return (
    <div className="message-body" data-message-body={messageId}>
      {rich && !plain && visible.length <= markdownLimit ? (
        <RenderBoundary key={visible} text={visible}>
          <Suspense fallback={fallback}>
            <MarkdownBody text={visible} streaming={streaming || truncated} />
          </Suspense>
        </RenderBoundary>
      ) : (
        fallback
      )}
      {source.length > markdownLimit ? (
        <p className="phase-note">完整内容较长，展开后以纯文本显示。</p>
      ) : null}
      {rich ? (
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={plain}
          onClick={() => {
            reading?.preserve(true)
            setPlain((v) => !v)
          }}
        >
          {plain ? '格式化显示' : '纯文本显示'}
        </Button>
      ) : null}
      {preview && (source.length > messagePreview || fullMessageId) ? (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => {
            reading?.preserve(expanded)
            const prior = sessionView(sessionId).expanded
            useSessionViews.getState().update(sessionId, {
              expanded: expanded ? prior.filter((id) => id !== key) : [...prior, key],
            })
          }}
        >
          {expanded ? '收起长消息' : '展开完整消息'}
        </Button>
      ) : null}
      {truncated ? (
        <p className="phase-note">当前显示前 {messagePreview} 个字符；展开不改变历史或上下文。</p>
      ) : null}
      {full.isFetching ? <output>正在读取完整内容…</output> : null}
      {full.isError ? (
        <p role="alert">
          {full.error.message}
          <Button
            variant="outline"
            onClick={() => {
              void full.refetch()
            }}
          >
            重试读取
          </Button>
        </p>
      ) : null}
    </div>
  )
})
