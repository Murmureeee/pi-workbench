import type { RuntimeView } from '../../services/runtime-client.js'

import { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Bubble, BubbleContent } from '@pi-workbench/ui/components/bubble'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'

import { RuntimeClient } from '../../services/runtime-client.js'
import { MessageBody } from './message-body.js'
import { ModelRequestStatus } from './model-request-status.js'
import { ReasoningCard } from './reasoning-card.js'
import { ToolTimeline } from './tool-timeline.js'

/** CORE-05 read-only diagnostics; it does not create sessions, send prompts or decide approvals. */
export function RuntimeObserver({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<RuntimeView>({
    status: 'connecting',
    snapshot: null,
    message: '',
    canMutate: false,
  })
  const [client, setClient] = useState<RuntimeClient | null>(null)
  useEffect(() => {
    const observer = new RuntimeClient(sessionId, setView)
    setClient(observer)
    observer.connect()
    return () => observer.disconnect()
  }, [sessionId])
  return (
    <main className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-auto p-6">
      <h1>会话实时观察 · 只读</h1>
      <p>
        {view.snapshot?.source === 'synthetic-ipc-fixture'
          ? '合成契约样本；不代表真实 SDK 执行。'
          : view.snapshot
            ? '真实 SDK + 本地模型夹具；受限读取经宿主核验，写入和命令未批准不执行，真实提供商关闭。'
            : '正在确认会话来源。'}
        关闭观察不会停止后台任务。
      </p>
      <Alert>
        <AlertTitle>
          <output aria-label="同步状态">
            {
              {
                connecting: '连接中',
                syncing: '同步中',
                connected: '已同步',
                disconnected: '观察已断开',
                incompatible: '版本或能力不兼容',
                error: '同步失败',
              }[view.status]
            }
          </output>
        </AlertTitle>
        <AlertDescription>{view.message}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => client?.disconnect()}>
          断开观察
        </Button>
        <Button variant="outline" onClick={() => client?.connect()}>
          重新连接
        </Button>
        <Button disabled>发送任务（尚未开放）</Button>
        <a className={buttonVariants({ variant: 'outline' })} href="/?resources">
          资源状态
        </a>
        <a
          className={buttonVariants({ variant: 'outline' })}
          href={`/?history=${encodeURIComponent(sessionId)}`}
        >
          历史与恢复记录
        </a>
      </div>
      <output aria-label="会话游标">
        {view.snapshot ? `${view.snapshot.epoch} / ${view.snapshot.seq}` : '尚无快照'}
      </output>
      <section aria-label="实时会话消息" className="flex flex-col gap-4">
        {view.snapshot?.turns.map((turn) => (
          <article key={turn.id} className="flex flex-col gap-2">
            <Bubble variant="muted">
              <BubbleContent>{turn.prompt}</BubbleContent>
            </Bubble>
            <Bubble variant="ghost">
              <BubbleContent>
                <MessageBody
                  sessionId={sessionId}
                  messageId={turn.messageId}
                  text={turn.text}
                  streaming={turn.phase === 'running' || turn.phase === 'stopping'}
                />
              </BubbleContent>
            </Bubble>
            <output aria-label="轮次状态">
              {
                {
                  running: '运行中',
                  stopping: '正在停止',
                  completed: '本轮已结束',
                  aborted: '本轮已停止',
                  error: '本轮失败',
                  interrupted: '已中断 · 未自动继续',
                }[turn.phase]
              }
            </output>
            <ToolTimeline sessionId={sessionId} turnId={turn.id} tools={turn.tools} />
            <ReasoningCard sessionId={sessionId} messageId={turn.id} reasoning={turn.reasoning} />
            {turn.approval ? (
              <Alert>
                <AlertTitle>等待审批（仅观察）</AlertTitle>
                <AlertDescription>{turn.approval.command}</AlertDescription>
              </Alert>
            ) : null}
            <ModelRequestStatus
              request={turn.modelRequest}
              error={turn.phase === 'error' ? turn.error : null}
            />
          </article>
        ))}
      </section>
    </main>
  )
}
