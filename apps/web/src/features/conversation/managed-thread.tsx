import type { RuntimeView } from '../../services/runtime-client.js'
import type { SessionSubmission } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

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
  MessageScrollerViewport,
} from '@pi-workbench/ui/components/message-scroller'

import { RuntimeClient } from '../../services/runtime-client.js'
import { sessionJson } from '../../services/session-client.js'

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
}: {
  sessionId: string
  submissions: SessionSubmission[]
  retry: (submission: SessionSubmission) => void
  retryDisabled: boolean
}) {
  const [view, setView] = useState<RuntimeView | null>(null)
  const history = useQuery({
    queryKey: ['chat-history', sessionId],
    queryFn: async ({ signal }) =>
      historyPageSchema.parse(
        await sessionJson(`/api/sessions/${encodeURIComponent(sessionId)}/history`, signal),
      ),
    refetchInterval: 1500,
  })
  useEffect(() => {
    const observer = new RuntimeClient(sessionId, setView)
    observer.connect()
    return () => observer.disconnect()
  }, [sessionId])
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport aria-label="受管会话消息">
          <MessageScrollerContent className="conversation-content">
            <MessageScrollerItem messageId="source">
              <p className="phase-note">
                真实 pi SDK + 本地 HTTP 夹具；回复为验收样本，不调用真实提供商，工具与扩展关闭。
              </p>
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
                >
                  <Message align="end">
                    <MessageContent>
                      <MessageHeader>
                        {submission.retryOf ? '你 · 明确重试原任务' : '你'}
                      </MessageHeader>
                      <Bubble variant="muted">
                        <BubbleContent>{submission.text}</BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                  <Message>
                    <MessageContent>
                      <MessageHeader>Pi · 本地夹具</MessageHeader>
                      <Bubble variant="ghost">
                        <BubbleContent>
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
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="返回最新消息" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
