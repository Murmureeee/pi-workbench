import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { legacyCatalogSchema, legacyPageSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
} from '@pi-workbench/ui/components/message-scroller'

import { workbenchHref } from '../../services/navigation.js'
import { sessionJson } from '../../services/session-client.js'
import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { RememberedViewport } from './remembered-viewport.js'

/** A separate, read-only source browser. Request keys include object, immutable file
 * version, cursor and refresh generation; late pages cannot replace another source. */
export function LegacyHistory() {
  const catalog = useQuery({
    queryKey: ['legacy-catalog'],
    queryFn: async ({ signal }) =>
      legacyCatalogSchema.parse(await sessionJson('/api/legacy-history', signal)),
  })
  const [id, setId] = useState<string | null>(null)
  return (
    <main className="legacy-browser">
      <header>
        <div>
          <h1>旧 pi 历史</h1>
          <p>外部 pi JSONL · 只读 · 打开不会运行或续聊</p>
        </div>
        <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={workbenchHref()}>
          返回工作台
        </a>
      </header>
      <div className="legacy-body">
        <aside aria-label="旧历史来源">
          <Button
            variant="outline"
            disabled={catalog.isFetching}
            onClick={() => void catalog.refetch()}
          >
            重新扫描来源
          </Button>
          <p className="legacy-path">
            {catalog.data?.root ?? '未指定来源：通过 PIW_PI_AGENT_DIR 指定已有 pi 目录后重启宿主。'}
          </p>
          {catalog.isFetching ? <output>正在发现历史…</output> : null}
          {catalog.isError ? (
            <Alert variant="destructive">
              <AlertTitle>发现失败</AlertTitle>
              <AlertDescription>{catalog.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {catalog.data?.diagnostics.map((item) => (
            <output key={`${item.code}:${item.line}:${item.message}`}>{item.message}</output>
          ))}
          {catalog.isSuccess && !catalog.data.sessions.length ? (
            <p>没有发现可展示的旧历史。没有启动运行时。</p>
          ) : null}
          {catalog.data?.sessions.map((source) => (
            <Button
              variant="ghost"
              key={source.id}
              aria-current={id === source.id ? 'page' : undefined}
              className="legacy-source"
              title={source.path}
              onClick={() => setId(source.id)}
            >
              <span>{source.cwd ?? '来源待检查'}</span>
              <small>
                {source.timestamp ?? new Date(source.modifiedAt).toLocaleString()} · 只读
              </small>
              {source.diagnostic ? <small>{source.diagnostic}</small> : null}
            </Button>
          ))}
        </aside>
        {id ? (
          <LegacyReader key={id} id={id} />
        ) : (
          <section className="legacy-empty">选择一份旧历史，查看原目录、消息与诊断。</section>
        )}
      </div>
    </main>
  )
}
function LegacyReader({ id }: { id: string }) {
  const [selection, setSelection] = useState<{
    version?: string
    cursor?: string
    generation: number
  }>({ generation: 0 })
  const history = useQuery({
    queryKey: ['legacy-history', id, selection],
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        ...(selection.version ? { version: selection.version } : {}),
        ...(selection.cursor ? { cursor: selection.cursor } : {}),
      })
      return legacyPageSchema.parse(
        await sessionJson(`/api/legacy-history/${id}?${params}`, signal),
      )
    },
  })
  const page = history.data
  return (
    <section className="legacy-reader" aria-label="旧历史内容">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">外部 pi · 只读</Badge>
        <Button
          variant="outline"
          disabled={history.isFetching}
          onClick={() => setSelection({ generation: selection.generation + 1 })}
        >
          刷新最新历史
        </Button>
        <Button
          variant="outline"
          disabled={!page?.nextCursor || history.isFetching}
          onClick={() =>
            setSelection({
              version: page?.version,
              cursor: page?.nextCursor ?? undefined,
              generation: selection.generation + 1,
            })
          }
        >
          更早的消息
        </Button>
        <Button disabled>继续旧会话（尚未开放）</Button>
      </div>
      {page ? (
        <div className="legacy-path">
          <p>源文件：{page.session.path}</p>
          <p>
            原执行目录：{page.session.cwd ?? '未知'} · {page.session.timestamp ?? '时间未知'}
          </p>
          <p>
            读取版本：{page.version.slice(0, 16)} · 本页 {page.messages.length} 条
          </p>
        </div>
      ) : null}
      {history.isFetching ? <output>正在读取旧历史…</output> : null}
      {history.isError ? (
        <Alert variant="destructive">
          <AlertTitle>旧历史未同步</AlertTitle>
          <AlertDescription>{history.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <MessageScrollerProvider
        key={`${id}:${selection.cursor ?? 'latest'}:${selection.generation}`}
        autoScroll={false}
        defaultScrollPosition="start"
      >
        <MessageScroller>
          <RememberedViewport
            aria-label="旧 pi 历史消息"
            sessionId={`legacy:${id}`}
            surface={`page:${selection.cursor ?? 'latest'}`}
            active
            ready={history.isSuccess}
          >
            <MessageScrollerContent>
              {page?.diagnostics.map((item) => (
                <Alert key={`${item.code}:${item.line}:${item.message}`}>
                  <AlertTitle>
                    {item.code} · 第 {item.line} 行
                  </AlertTitle>
                  <AlertDescription>{item.message}</AlertDescription>
                </Alert>
              ))}
              {page?.messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  data-reading-id={message.id}
                >
                  <p className="text-xs text-muted-foreground">
                    {message.role === 'user'
                      ? '你'
                      : message.role === 'assistant'
                        ? 'Pi'
                        : '工具结果'}{' '}
                    · 外部只读记录
                  </p>
                  <LegacyMessage id={id} version={page.version} message={message} />
                  {message.truncated ? (
                    <p>预览 64 KiB · 原文 {message.bytes} 字节；展示副本不写回源文件。</p>
                  ) : null}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </RememberedViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  )
}

function LegacyMessage({
  id,
  version,
  message,
}: {
  id: string
  version: string
  message: { id: string; text: string; truncated: boolean }
}) {
  const key = `legacy:${id}`
  const expanded = useSessionViews(
    (state) => state.views[key]?.expanded.includes(message.id) ?? false,
  )
  const full = useQuery({
    queryKey: ['legacy-full', id, version, message.id],
    enabled: expanded && message.truncated,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/legacy-history/${id}/messages/${encodeURIComponent(message.id)}?version=${version}`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error('全文版本已变化或暂不可读，请刷新历史后重新展开。')
      }
      return response.text()
    },
  })
  return (
    <>
      <p className="break-words whitespace-pre-wrap">
        {expanded && full.data !== undefined ? full.data : message.text}
      </p>
      {message.truncated ? (
        <Button
          variant="outline"
          size="sm"
          disabled={full.isFetching}
          onClick={() => {
            const prior = sessionView(key).expanded
            useSessionViews.getState().update(key, {
              expanded: expanded
                ? prior.filter((item) => item !== message.id)
                : [...prior, message.id],
            })
          }}
        >
          {expanded ? '收起旧历史全文' : '读取旧历史全文'}
        </Button>
      ) : null}
      {full.isError ? <p role="alert">{full.error.message}</p> : null}
    </>
  )
}
