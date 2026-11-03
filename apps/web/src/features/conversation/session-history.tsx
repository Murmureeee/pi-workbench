import type { HistoryMessage } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { historyPageSchema } from '@pi-workbench/shared'
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
  MessageScrollerViewport,
} from '@pi-workbench/ui/components/message-scroller'

function HistoryEntry({ sessionId, message }: { sessionId: string; message: HistoryMessage }) {
  const [expanded, setExpanded] = useState(false)
  const full = useQuery({
    queryKey: ['native-message', sessionId, message.id],
    enabled: expanded,
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
            {expanded && full.data !== undefined ? full.data : message.text}
          </BubbleContent>
        </Bubble>
        {message.error ? (
          <Alert variant="destructive">
            <AlertTitle>本轮未完成</AlertTitle>
            <AlertDescription>{message.error}</AlertDescription>
          </Alert>
        ) : null}
        {message.truncated ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">预览 64 KiB / 原文 {message.bytes} 字节</Badge>
            <Button
              variant="outline"
              disabled={full.isFetching}
              onClick={() => setExpanded((value) => !value)}
            >
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
export function SessionHistory({ sessionId }: { sessionId: string }) {
  const [cursor, setCursor] = useState<string | null>(null)
  const history = useQuery({
    queryKey: ['session-history', sessionId, cursor],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/history?${params}`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error('历史暂不可用，请确认会话或刷新后重试。')
      }
      return historyPageSchema.parse(await response.json())
    },
  })
  const page = history.data
  return (
    <main className="mx-auto flex h-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <h1>会话历史与恢复 · 只读</h1>
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
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          更早的消息
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
      {history.isError ? (
        <Alert variant="destructive">
          <AlertTitle>历史读取失败</AlertTitle>
          <AlertDescription>{history.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <MessageScrollerProvider key={cursor ?? 'latest'} autoScroll={false}>
        <MessageScroller>
          <MessageScrollerViewport aria-label="持久化历史">
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
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <HistoryEntry sessionId={sessionId} message={message} />
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
                            {record.reference}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </main>
  )
}
