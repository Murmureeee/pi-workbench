import type { RuntimeView } from '../../services/runtime-client.js'
import type { useInputQueue } from './use-input-queue.js'
import type {
  SessionOrganization,
  SessionOrganize,
  SessionSubmission,
  StopIntent,
} from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { historyPageSchema, submissionStatusNames } from '@pi-workbench/shared'
import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Bubble, BubbleContent } from '@pi-workbench/ui/components/bubble'
import { Button } from '@pi-workbench/ui/components/button'
import { Message, MessageContent, MessageHeader } from '@pi-workbench/ui/components/message'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
} from '@pi-workbench/ui/components/message-scroller'

import { RuntimeClient } from '../../services/runtime-client.js'
import { sessionJson } from '../../services/session-client.js'
import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { CurrentRunStatus } from './current-run-status.js'
import { ExecutionApprovals } from './execution-approvals.js'
import { LatestMessagesButton } from './latest-messages-button.js'
import { MessageBody } from './message-body.js'
import { messageStamp, updatedMessages } from './message-updates.js'
import { ModelRequestStatus } from './model-request-status.js'
import { ReasoningCard } from './reasoning-card.js'
import { RememberedViewport } from './remembered-viewport.js'
import { ToolTimeline } from './tool-timeline.js'

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
  queue,
  stop,
  submissionsSynchronized,
  csrf,
}: {
  sessionId: string
  submissions: SessionSubmission[]
  retry: (submission: SessionSubmission) => void
  retryDisabled: boolean
  active: boolean
  organization: SessionOrganization | undefined
  changeOrganization: (id: string, input: SessionOrganize) => Promise<SessionOrganization>
  organizationAvailable: boolean
  queue: ReturnType<typeof useInputQueue>
  stop: StopIntent | null
  submissionsSynchronized: boolean
  csrf: string
}) {
  const seen = useSessionViews((state) => state.views[sessionId]?.seenMessages ?? null)
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
  const currentSubmission = submissions.at(-1)
  const currentTurn = view?.snapshot?.turns.find((t) => t.id === currentSubmission?.turnId)
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
  // Receipts contain at most 200 IDs/stamps, never bodies. Committed messages are
  // immutable: their terminal status stays stable across SDK/HTTP preview changes.
  const stamps = useMemo(() => {
    const current: Record<string, string> = {}
    for (const submission of submissions.slice(-100)) {
      current[submission.messageId] = messageStamp(submission.text, '')
      const turn = view?.snapshot?.turns.find((item) => item.id === submission.turnId)
      const committed = history.data?.messages.findLast(
        (item) => item.turnId === submission.turnId && item.role === 'assistant',
      )
      const text = turn?.text ?? committed?.text ?? ''
      const terminal =
        !['pending', 'executing'].includes(submission.status) &&
        (committed ||
          (turn && ['completed', 'error', 'aborted', 'interrupted'].includes(turn.phase)))
      if (text || terminal || turn?.approval) {
        current[`${submission.messageId}:reply`] = terminal
          ? submission.status
          : messageStamp(text, turn?.approval?.id ?? '')
      }
    }
    return current
  }, [submissions, view?.snapshot, history.data])
  const stampToken = JSON.stringify(stamps)
  const stampsReady =
    history.isSuccess &&
    (view?.status === 'connected' ||
      !submissions.some((item) => ['pending', 'executing'].includes(item.status)))
  useEffect(() => {
    if (stampsReady && sessionView(sessionId).seenMessages === null) {
      useSessionViews.getState().update(sessionId, { seenMessages: stamps })
    }
  }, [sessionId, stampsReady, stamps])
  const readLatest = () => {
    if (
      active &&
      stampsReady &&
      JSON.stringify(sessionView(sessionId).seenMessages) !== stampToken
    ) {
      useSessionViews.getState().update(sessionId, { seenMessages: stamps })
    }
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
    <div className="managed-thread">
      <MessageScrollerProvider
        autoScroll={active && follow}
        defaultScrollPosition={initialPosition}
      >
        <MessageScroller>
          <RememberedViewport
            aria-label="受管会话消息"
            sessionId={sessionId}
            surface="conversation"
            active={active}
            ready={history.isSuccess && submissions.length > 0}
            latestToken={`${latestToken}:${stampToken}`}
            onReadLatest={readLatest}
            navigation={<LatestMessagesButton count={updatedMessages(stamps, seen)} />}
          >
            <MessageScrollerContent className="conversation-content">
              <MessageScrollerItem messageId="source">
                <p className="phase-note">
                  {view?.snapshot?.source === 'synthetic-ipc-fixture'
                    ? '合成观察记录；不代表真实工具执行或审批。'
                    : null}
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
                const text = turn?.text ?? committed?.text ?? ''
                const observedTools =
                  turn?.tools ??
                  history.data?.toolTimelines?.find(
                    (timeline) => timeline.turnId === submission.turnId,
                  )?.tools ??
                  []
                const request =
                  turn?.modelRequest ??
                  history.data?.modelRequests?.find((item) => item.turnId === submission.turnId)
                    ?.request
                return (
                  <MessageScrollerItem
                    key={submission.messageId}
                    messageId={submission.messageId}
                    data-reading-id={submission.messageId}
                  >
                    <Message align="end">
                      <MessageContent>
                        <MessageHeader>
                          {submission.retryOf ? '你 · 明确重试原任务' : '你'}
                        </MessageHeader>
                        <Bubble variant="muted">
                          <BubbleContent className="whitespace-pre-wrap">
                            <MessageBody
                              sessionId={sessionId}
                              messageId={submission.messageId}
                              text={submission.text}
                              rich={false}
                            />
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                    <Message>
                      <MessageContent>
                        <MessageHeader>Pi · 本地夹具</MessageHeader>
                        <Bubble variant="ghost">
                          <BubbleContent className="whitespace-pre-wrap">
                            <MessageBody
                              sessionId={sessionId}
                              messageId={`${submission.messageId}:reply`}
                              text={
                                text ||
                                (['pending', 'executing'].includes(submission.status)
                                  ? '正在等待本地运行时…'
                                  : '没有可显示的回复。')
                              }
                              streaming={turn?.phase === 'running' || turn?.phase === 'stopping'}
                              {...(!turn && committed?.truncated
                                ? { fullMessageId: committed.id }
                                : {})}
                            />
                          </BubbleContent>
                        </Bubble>
                        {submission.requestId !== currentSubmission?.requestId ? (
                          <output aria-label="任务状态">
                            {submission.status === 'executing' && turn?.phase === 'running'
                              ? '运行中'
                              : submissionStatusNames[submission.status]}
                          </output>
                        ) : null}
                        <ReasoningCard
                          sessionId={sessionId}
                          messageId={submission.turnId}
                          reasoning={turn?.reasoning ?? committed?.reasoning}
                        />
                        <ToolTimeline
                          sessionId={sessionId}
                          turnId={submission.turnId}
                          tools={
                            turn?.tools ??
                            history.data?.toolTimelines?.find(
                              (timeline) => timeline.turnId === submission.turnId,
                            )?.tools ??
                            []
                          }
                        />
                        {turn?.approval ? (
                          <Alert>
                            <AlertTitle>待审批 · 仅观察</AlertTitle>
                            <AlertDescription>
                              {turn.approval.command} · {turn.approval.cwd} · 未自动裁决
                            </AlertDescription>
                          </Alert>
                        ) : null}
                        <ModelRequestStatus
                          feedback={submission.requestId !== currentSubmission?.requestId}
                          request={request}
                          error={
                            submission.status === 'interrupted'
                              ? (submission.error ?? turn?.error ?? null)
                              : submission.status === 'failed' || turn?.phase === 'error'
                                ? (turn?.error ?? submission.error ?? request?.error ?? null)
                                : null
                          }
                        />
                        {submission.status === 'failed' && !observedTools.length ? (
                          <Button
                            variant="outline"
                            disabled={retryDisabled}
                            onClick={() => retry(submission)}
                          >
                            明确重试此任务
                          </Button>
                        ) : null}
                        {submission.status === 'failed' && observedTools.length ? (
                          <p className="phase-note">
                            此任务含工具记录，不能重放整项任务。请检查历史与现场，再明确输入新任务；旧拒绝不会重新授权。
                          </p>
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
        </MessageScroller>
      </MessageScrollerProvider>
      <ExecutionApprovals
        sessionId={sessionId}
        csrf={csrf}
        active={active}
        synchronized={view?.status === 'connected' && submissionsSynchronized}
      />
      {currentSubmission ? (
        <CurrentRunStatus
          submission={currentSubmission}
          turn={currentTurn}
          submissions={submissions}
          queue={queue}
          stop={stop}
          synchronized={view?.status === 'connected' && submissionsSynchronized}
        />
      ) : null}
    </div>
  )
}
