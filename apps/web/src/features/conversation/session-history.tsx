import type { HistoryMessage } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { historyPageSchema, sessionTitleListSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Bubble, BubbleContent } from '@pi-workbench/ui/components/bubble'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import { Message, MessageContent, MessageHeader } from '@pi-workbench/ui/components/message'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
} from '@pi-workbench/ui/components/message-scroller'

import { sessionJson } from '../../services/session-client.js'
import { mergeTitles } from '../../services/session-title-cache.js'
import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { LatestMessagesButton } from './latest-messages-button.js'
import { MessageBody } from './message-body.js'
import { useReadingLayout } from './reading-layout.js'
import { ReasoningCard } from './reasoning-card.js'
import { RememberedViewport } from './remembered-viewport.js'
import { ToolTimeline } from './tool-timeline.js'

function HistoryEntry({
  sessionId,
  message,
  located = false,
}: {
  sessionId: string
  message: HistoryMessage
  located?: boolean
}) {
  const reading = useReadingLayout()
  const expanded = useSessionViews(
    (state) => state.views[sessionId]?.expanded.includes(message.id) ?? false,
  )
  const setExpanded = () => {
    reading?.preserve(expanded)
    const prior = sessionView(sessionId).expanded
    useSessionViews.getState().update(sessionId, {
      expanded: expanded ? prior.filter((id) => id !== message.id) : [...prior, message.id],
    })
  }
  const full = useQuery({
    queryKey: ['native-message', sessionId, message.id],
    enabled: expanded || (located && message.truncated),
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(message.id)}/content`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error('完整内容读取失败，请刷新历史后重试。')
      }
      return response.text()
    },
  })
  return (
    <Message align={message.role === 'user' ? 'end' : 'start'}>
      <MessageContent>
        <MessageHeader>
          {message.role === 'user' ? '你' : message.role === 'assistant' ? 'Pi' : '工具结果'} ·{' '}
          {message.origin === 'interrupted-checkpoint'
            ? message.role === 'user'
              ? '未确认送达的输入 · 未自动重发'
              : '已中断的部分回复 · 未自动继续'
            : 'pi 原生历史'}
        </MessageHeader>
        <Bubble variant={message.role === 'user' ? 'muted' : 'ghost'}>
          <BubbleContent className="whitespace-pre-wrap">
            <MessageBody
              sessionId={sessionId}
              messageId={message.id}
              text={(expanded || located) && full.data !== undefined ? full.data : message.text}
              rich={message.role === 'assistant'}
              preview={!message.truncated && !located}
            />
          </BubbleContent>
        </Bubble>
        {message.role === 'assistant' ? (
          <ReasoningCard
            sessionId={sessionId}
            messageId={message.id}
            reasoning={message.reasoning}
          />
        ) : null}
        {message.error ? (
          <Alert variant="destructive">
            <AlertTitle>本轮未完成</AlertTitle>
            <AlertDescription>{message.error}</AlertDescription>
          </Alert>
        ) : null}
        {message.truncated ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">预览 64 KiB / 原文 {message.bytes} 字节</Badge>
            <Button variant="outline" disabled={full.isFetching} onClick={setExpanded}>
              {expanded ? '收起完整内容' : '读取完整内容'}
            </Button>
          </div>
        ) : null}
        {full.isError ? (
          <Alert variant="destructive">
            <AlertTitle>读取失败</AlertTitle>
            <AlertDescription>{full.error.message}</AlertDescription>
          </Alert>
        ) : null}
      </MessageContent>
    </Message>
  )
}

/** Fetches the server-scanned copy before download so HTTP failures remain visible. Leaving the
 * session aborts stale exports and revokes the component-owned blob URL.
 */
function DiagnosticExport({
  sessionId,
  diagnosticId,
}: {
  sessionId: string
  diagnosticId: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const download = useRef<string | null>(null)
  useEffect(
    () => () => {
      request.current?.abort()
      if (download.current) {
        URL.revokeObjectURL(download.current)
      }
    },
    [],
  )
  const exportRecord = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError('')
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/diagnostics/${encodeURIComponent(diagnosticId)}/raw`,
        { signal: controller.signal, cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error(
          response.status === 422
            ? '该记录无法安全解析，原件保留，请在本机检查。'
            : '记录导出失败，请刷新后重试。',
        )
      }
      const blob = await response.blob()
      if (controller.signal.aborted) {
        return
      }
      if (download.current) {
        URL.revokeObjectURL(download.current)
      }
      const url = URL.createObjectURL(blob)
      download.current = url
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download =
        response.headers.get('x-piw-redacted') === 'true'
          ? 'piw-redacted-record.txt'
          : 'piw-original-record.bin'
      anchor.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
        if (download.current === url) {
          download.current = null
        }
      }, 1000)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : '原始记录导出失败。')
      }
    } finally {
      if (!controller.signal.aborted) {
        setPending(false)
      }
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          void exportRecord()
        }}
      >
        导出记录（先脱敏）
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}

/** CORE-06 read-only recovery reader; query identity and AbortSignal isolate late responses.
 * Pagination/expansion never writes displayed previews back to pi history or model context.
 */
export function SessionHistory({
  sessionId,
  embedded = false,
  active = true,
  targetMessage = null,
}: {
  sessionId: string
  embedded?: boolean
  active?: boolean
  targetMessage?: string | null
}) {
  const view = useSessionViews((state) => state.views[sessionId])
  const titles = useQuery({
    queryKey: ['session-titles'],
    structuralSharing: mergeTitles,
    queryFn: async ({ signal }) =>
      sessionTitleListSchema.parse(await sessionJson('/api/session-titles', signal)),
  })
  const cursor = view?.cursor ?? null
  const [locationDismissed, setLocationDismissed] = useState<string | null>(null)
  const around = cursor || locationDismissed === targetMessage ? null : targetMessage
  const setCursor = (value: string | null, trail: (string | null)[] = []) =>
    useSessionViews.getState().update(sessionId, { cursor: value, historyTrail: trail })
  const history = useQuery({
    queryKey: ['session-history', sessionId, cursor, around],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        limit: '100',
        ...(cursor ? { cursor } : {}),
        ...(around ? { around } : {}),
      })
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/history?${params}`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error(
          around
            ? '目标消息暂不可用，请刷新搜索或历史；未定位到其他消息。'
            : '历史暂不可用，请确认会话或刷新后重试。',
        )
      }
      return historyPageSchema.parse(await response.json())
    },
    gcTime: 0,
  })
  const page = history.data
  return (
    <section
      aria-label="会话历史与恢复"
      className={`mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3 p-4 ${embedded ? 'embedded-history' : 'h-full sm:p-6'}`}
    >
      <h1>会话历史与恢复 · 只读</h1>
      {titles.data?.titles.find((row) => row.sessionId === sessionId) ? (
        <p aria-label="会话标题">
          {titles.data.titles.find((row) => row.sessionId === sessionId)?.title}
        </p>
      ) : null}
      <p>
        {page
          ? page.source === 'synthetic-ipc-fixture'
            ? '合成测试记录。'
            : '真实 SDK + 本地模型夹具。'
          : '正在读取记录来源。'}{' '}
        重启仅恢复记录；排队任务需重新确认，旧授权不恢复。
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          className={buttonVariants({ variant: 'outline' })}
          href={`/?observe=${encodeURIComponent(sessionId)}`}
        >
          实时观察
        </a>
        <Button
          variant="outline"
          disabled={history.isFetching}
          onClick={() => {
            setLocationDismissed(targetMessage)
            if (cursor) {
              setCursor(null)
            } else {
              void history.refetch()
            }
          }}
        >
          刷新最新历史
        </Button>
        <Button
          variant="outline"
          disabled={!page?.nextCursor || history.isFetching}
          onClick={() =>
            setCursor(
              page?.nextCursor ?? null,
              [...(cursor ? (view?.historyTrail ?? []) : []), cursor].slice(-100),
            )
          }
        >
          更早的消息
        </Button>
        <Button
          variant="outline"
          disabled={!cursor || !view?.historyTrail.length || history.isFetching}
          onClick={() => {
            const trail = sessionView(sessionId).historyTrail
            setCursor(trail.at(-1) ?? null, trail.slice(0, -1))
          }}
        >
          返回较新一页
        </Button>
        <Button disabled>继续任务（尚未开放）</Button>
      </div>
      <output aria-label="历史载入状态">
        {history.isFetching
          ? '正在读取历史'
          : history.isError
            ? '历史读取失败'
            : `本页 ${page?.messages.length ?? 0} 条消息`}
      </output>
      {around && history.isSuccess ? (
        <output>已定位搜索命中消息 · 可阅读前后文或刷新最新历史</output>
      ) : null}
      {history.isError ? (
        <Alert variant="destructive">
          <AlertTitle>历史读取失败</AlertTitle>
          <AlertDescription>{history.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <MessageScrollerProvider
        key={around ?? cursor ?? 'latest'}
        autoScroll={false}
        defaultScrollPosition={around ? 'start' : 'end'}
      >
        <MessageScroller>
          <RememberedViewport
            aria-label="持久化历史"
            sessionId={sessionId}
            surface={`history:${around ?? cursor ?? 'latest'}`}
            active={active}
            ready={history.isSuccess}
            locateMessage={around}
            navigation={<LatestMessagesButton count={0} label="返回本页末尾" />}
          >
            <MessageScrollerContent>
              {page?.diagnostics.map((diagnostic) => (
                <MessageScrollerItem key={diagnostic.id} messageId={`diagnostic:${diagnostic.id}`}>
                  <Alert variant="destructive">
                    <AlertTitle>记录诊断 · {diagnostic.code}</AlertTitle>
                    <AlertDescription>
                      <p className="whitespace-pre-wrap">
                        {diagnostic.source} · 第 {diagnostic.line} 行：{diagnostic.message}
                      </p>
                      {diagnostic.exportable ? (
                        <DiagnosticExport sessionId={sessionId} diagnosticId={diagnostic.id} />
                      ) : null}
                    </AlertDescription>
                  </Alert>
                </MessageScrollerItem>
              ))}
              {page?.messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  data-reading-id={message.id}
                  data-search-located={around === message.id || undefined}
                >
                  <HistoryEntry
                    sessionId={sessionId}
                    message={message}
                    located={around === message.id}
                  />
                  {message.turnId &&
                  page.messages.findLast((item) => item.turnId === message.turnId)?.id ===
                    message.id ? (
                    <ToolTimeline
                      sessionId={sessionId}
                      turnId={message.turnId}
                      tools={
                        page.toolTimelines?.find((timeline) => timeline.turnId === message.turnId)
                          ?.tools ?? []
                      }
                    />
                  ) : null}
                </MessageScrollerItem>
              ))}
              {page &&
              (page.queue.length > 0 || page.approvals.length > 0 || page.changes.length > 0) ? (
                <MessageScrollerItem messageId="recovery-records">
                  <Alert>
                    <AlertTitle>工作台恢复记录</AlertTitle>
                    <AlertDescription>
                      <ul aria-label="队列记录">
                        {page.queue.map((record) => (
                          <li key={record.id}>
                            {record.source === 'synthetic-fixture' ? '合成记录 · ' : ''}
                            {record.kind} · {record.status} · {record.text}
                          </li>
                        ))}
                      </ul>
                      <ul aria-label="审批记录">
                        {page.approvals.map((record) => (
                          <li key={record.id}>
                            {record.source === 'synthetic-fixture' ? '合成记录 · ' : ''}
                            {record.decision} · 仅审计，不可执行 · {record.reason}
                          </li>
                        ))}
                      </ul>
                      <ul aria-label="变更引用">
                        {page.changes.map((record) => (
                          <li key={record.id}>
                            {record.source === 'synthetic-fixture' ? '合成记录 · ' : ''}
                            <Button
                              variant="ghost"
                              aria-pressed={view?.selectedReference === record.id}
                              onClick={() =>
                                useSessionViews
                                  .getState()
                                  .update(sessionId, { selectedReference: record.id })
                              }
                            >
                              {record.reference}
                            </Button>
                          </li>
                        ))}
                      </ul>
                      {view?.selectedReference ? (
                        <p aria-label="当前变更引用">
                          只读引用：
                          {page.changes.find((item) => item.id === view.selectedReference)
                            ?.reference ?? '来源暂不可用'}{' '}
                          · 文件与 Diff 执行入口尚未开放
                        </p>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </RememberedViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  )
}
