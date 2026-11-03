import type { RuntimeView } from '../../services/runtime-client.js'
import type { SessionOrganization, SessionOrganize, SessionSubmission } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { historyPageSchema } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Bubble, BubbleContent } from '@pi-workbench/ui/components/bubble'
import { Button } from '@pi-workbench/ui/components/button'
import { Message, MessageContent, MessageHeader } from '@pi-workbench/ui/components/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
} from '@pi-workbench/ui/components/message-scroller'

import { RuntimeClient } from '../../services/runtime-client.js'
import { sessionJson } from '../../services/session-client.js'
import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { RememberedViewport } from './remembered-viewport.js'

const statusNames = {
  pending: '等待执行资源',
  executing: '已保存 · 等待运行时确认',
  completed: '本轮已结束',
  failed: '本轮失败',
  aborted: '本轮已停止',
  interrupted: '已中断 · 未自动重发',
}

/** Accepted user input uses its durable command identity; committed replies read SDK JSONL
 * and active text uses CORE-05. Reconnecting observers never resubmit a command.
 */
export function ManagedThread({
  sessionId,
  submissions,
  retry,
  retryDisabled,
  active,
  organization,
  changeOrganization,
  organizationAvailable,
}: {
  sessionId: string
  submissions: SessionSubmission[]
  retry: (submission: SessionSubmission) => void
  retryDisabled: boolean
  active: boolean
  organization: SessionOrganization | undefined
  changeOrganization: (id: string, input: SessionOrganize) => Promise<SessionOrganization>
  organizationAvailable: boolean
}) {
  const expanded = useSessionViews((state) => state.views[sessionId]?.expanded ?? emptyExpanded)
  const follow = useSessionViews(
    (state) => state.views[sessionId]?.reading.conversation?.follow ?? true,
  )
  const [view, setView] = useState<RuntimeView | null>(null)
  const [readError, setReadError] = useState('')
  const readAttempt = useRef('')
  const [initialPosition] = useState<'start' | 'end'>(() =>
    sessionView(sessionId).reading.conversation?.follow === false ? 'start' : 'end',
  )
  const history = useQuery({
    queryKey: ['chat-history', sessionId],
    queryFn: async ({ signal }) =>
      historyPageSchema.parse(
        await sessionJson(`/api/sessions/${encodeURIComponent(sessionId)}/history`, signal),
      ),
    refetchInterval: 1500,
    gcTime: 0,
  })
  useEffect(() => {
    const observer = new RuntimeClient(sessionId, setView)
    observer.connect()
    return () => observer.disconnect()
  }, [sessionId])
  const latest = submissions.find((item) => item.requestId === organization?.resultRequestId)
  const latestTurn = view?.snapshot?.turns.find((item) => item.id === latest?.turnId)
  const latestMessage = history.data?.messages.findLast(
    (item) => item.turnId === latest?.turnId && item.role === 'assistant',
  )
  const displayed =
    latest &&
    !['pending', 'executing'].includes(latest.status) &&
    (latest.status !== 'completed' ||
      Boolean(
        latestMessage ||
        (latestTurn && ['completed', 'error', 'aborted'].includes(latestTurn.phase)),
      ))
  const latestToken = displayed ? `${organization?.resultVersion}:${latest.requestId}` : ''
  const readLatest = () => {
    if (!active || !displayed || !organization?.unread || !organizationAvailable) {
      return
    }
    const token = `${sessionId}:${organization.revision}`
    if (readAttempt.current === token) {
      return
    }
    readAttempt.current = token
    void changeOrganization(sessionId, {
      action: 'read',
      expectedRevision: organization.revision,
      throughVersion: organization.resultVersion,
    })
      .then(() => setReadError(''))
      .catch((cause: unknown) =>
        setReadError(cause instanceof Error ? cause.message : '已读状态未保存，请刷新核对。'),
      )
  }
  return (
    <MessageScrollerProvider autoScroll={active && follow} defaultScrollPosition={initialPosition}>
      <MessageScroller>
        <RememberedViewport
          aria-label="受管会话消息"
          sessionId={sessionId}
          surface="conversation"
          active={active}
          ready={history.isSuccess && submissions.length > 0}
          latestToken={latestToken}
          onReadLatest={readLatest}
        >
          <MessageScrollerContent className="conversation-content">
            <MessageScrollerItem messageId="source">
              <p className="phase-note">
                {view?.snapshot?.source === 'synthetic-ipc-fixture'
                  ? '合成观察记录；不代表真实工具执行或审批。'
                  : '真实 pi SDK + 本地 HTTP 夹具；回复为验收样本，不调用真实提供商，工具与扩展关闭。'}
                <output aria-label="会话同步状态">
                  {view?.status === 'connected'
                    ? '已同步'
                    : view?.status === 'incompatible'
                      ? '协议不兼容'
                      : view?.status === 'error' || view?.status === 'disconnected'
                        ? '等待重新连接 · 后台任务继续'
                        : '正在同步会话'}
                </output>
              </p>
              {readError ? <output>已读状态待核对：{readError}</output> : null}
            </MessageScrollerItem>
            {view?.status === 'disconnected' || history.isError ? (
              <MessageScrollerItem messageId="offline">
                <Alert>
                  <AlertTitle>观察暂未同步</AlertTitle>
                  <AlertDescription>
                    已保存内容保留；请恢复连接，后台任务不会因离开页面而停止。
                  </AlertDescription>
                </Alert>
              </MessageScrollerItem>
            ) : null}
            {submissions.map((submission) => {
              const turn = view?.snapshot?.turns.find((item) => item.id === submission.turnId)
              const committed = history.data?.messages.findLast(
                (message) => message.turnId === submission.turnId && message.role === 'assistant',
              )
              const text = turn?.text || committed?.text || ''
              return (
                <MessageScrollerItem
                  key={submission.messageId}
                  messageId={submission.messageId}
                  scrollAnchor
                  data-reading-id={submission.messageId}
                >
                  <Message align="end">
                    <MessageContent>
                      <MessageHeader>
                        {submission.retryOf ? '你 · 明确重试原任务' : '你'}
                      </MessageHeader>
                      <Bubble variant="muted">
                        <BubbleContent className="whitespace-pre-wrap">
                          {submission.text}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                  <Message>
                    <MessageContent>
                      <MessageHeader>Pi · 本地夹具</MessageHeader>
                      <Bubble variant="ghost">
                        <BubbleContent className="whitespace-pre-wrap">
                          {text ||
                            (['pending', 'executing'].includes(submission.status)
                              ? '正在等待本地运行时…'
                              : '没有可显示的回复。')}
                        </BubbleContent>
                      </Bubble>
                      <output aria-label="任务状态">
                        {submission.status === 'executing' && turn?.phase === 'running'
                          ? '运行中'
                          : statusNames[submission.status]}
                      </output>
                      {turn?.tools.map((tool) => (
                        <details
                          key={tool.id}
                          open={expanded.includes(tool.id)}
                          onToggle={(event) => {
                            const prior = sessionView(sessionId).expanded
                            const next = event.currentTarget.open
                              ? [...new Set([...prior, tool.id])]
                              : prior.filter((id) => id !== tool.id)
                            if (JSON.stringify(next) !== JSON.stringify(prior)) {
                              useSessionViews.getState().update(sessionId, { expanded: next })
                            }
                          }}
                        >
                          <summary>
                            {tool.name} · {tool.status} · 只读过程
                          </summary>
                          <p className="whitespace-pre-wrap">{tool.summary}</p>
                        </details>
                      ))}
                      {turn?.approval ? (
                        <Alert>
                          <AlertTitle>待审批 · 仅观察</AlertTitle>
                          <AlertDescription>
                            {turn.approval.command} · {turn.approval.cwd} · 未自动裁决
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      {submission.error ? (
                        <Alert variant="destructive">
                          <AlertTitle>任务未完成</AlertTitle>
                          <AlertDescription>{submission.error}</AlertDescription>
                        </Alert>
                      ) : null}
                      {submission.status === 'failed' ? (
                        <Button
                          variant="outline"
                          disabled={retryDisabled}
                          onClick={() => retry(submission)}
                        >
                          明确重试此任务
                        </Button>
                      ) : null}
                      {submission.status === 'interrupted' ? (
                        <p className="phase-note">
                          请先查看历史和现场；未自动重复执行。可在当前会话另行输入新任务。
                        </p>
                      ) : null}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )
            })}
          </MessageScrollerContent>
        </RememberedViewport>
        <MessageScrollerButton aria-label="返回最新消息" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
const emptyExpanded: string[] = []
