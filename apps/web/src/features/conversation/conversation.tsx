import { CheckIcon, ClockIcon, ShieldCheckIcon } from 'lucide-react'

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
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@pi-workbench/ui/components/trace'

import { useWorkbench } from '../../stores/workbench.js'

export function Conversation() {
  const projection = useWorkbench((state) => state.projection)
  const scene = useWorkbench((state) => state.scene)
  const setScene = useWorkbench((state) => state.setScene)
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport aria-label="对话消息">
          <MessageScrollerContent className="conversation-content">
            <MessageScrollerItem messageId="user" scrollAnchor>
              <Message align="end">
                <MessageContent>
                  <Bubble variant="muted" align="end">
                    <BubbleContent>{projection.prompt}</BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </MessageScrollerItem>
            <MessageScrollerItem messageId="assistant">
              <Message>
                <MessageContent>
                  <MessageHeader>
                    <span className="pi-mark">π</span>
                    Pi
                  </MessageHeader>
                  <Bubble variant="ghost">
                    <BubbleContent>{projection.answer}</BubbleContent>
                  </Bubble>
                  <Trace>
                    <TraceLine>
                      <TraceIcon>
                        <CheckIcon />
                      </TraceIcon>
                      <TraceTitle>检查会话失效的处理入口</TraceTitle>
                    </TraceLine>
                    <TraceLine status={scene === 'running' ? 'running' : 'pending'}>
                      <TraceIcon>
                        <ClockIcon />
                      </TraceIcon>
                      <TraceTitle>
                        {scene === 'approval' ? '准备运行定向测试' : '整理认证流程的边界条件'}
                      </TraceTitle>
                    </TraceLine>
                  </Trace>
                </MessageContent>
              </Message>
            </MessageScrollerItem>
            {scene === 'approval' && projection.approval ? (
              <MessageScrollerItem messageId="approval">
                <section className="approval-card" aria-label="执行前审批">
                  <div className="approval-heading">
                    <ShieldCheckIcon />
                    <h2>允许运行这条测试命令？</h2>
                    <span>仅本次</span>
                  </div>
                  <p>命令尚未执行，持续等待你的决定。</p>
                  <pre>{projection.approval.command}</pre>
                  <dl>
                    <dt>执行目录</dt>
                    <dd>
                      <code>{projection.approval.cwd}</code>
                    </dd>
                    <dt>影响范围</dt>
                    <dd>可能写入测试缓存；命令的外部副作用不在文件回滚范围。</dd>
                    <dt>授权绑定</dt>
                    <dd>当前命令、目录与最终参数；参数改变后重新审批。</dd>
                  </dl>
                  <div className="approval-actions">
                    <Button variant="ghost" onClick={() => setScene('denied')}>
                      拒绝
                    </Button>
                    <Button onClick={() => setScene('running')}>允许一次</Button>
                  </div>
                </section>
              </MessageScrollerItem>
            ) : null}
            {scene === 'error' ? (
              <MessageScrollerItem messageId="error">
                <Alert variant="destructive">
                  <AlertTitle>请求未完成</AlertTitle>
                  <AlertDescription>
                    {projection.error}
                    <Button variant="outline" onClick={() => setScene('running')}>
                      手动重试
                    </Button>
                  </AlertDescription>
                </Alert>
              </MessageScrollerItem>
            ) : null}
            {scene === 'offline' ? (
              <MessageScrollerItem messageId="offline">
                <Alert>
                  <AlertTitle>连接中断，运行状态待确认</AlertTitle>
                  <AlertDescription>
                    保留当前查看与草稿，发送及审批决定暂停。
                    <Button variant="outline" onClick={() => setScene('running')}>
                      重新连接
                    </Button>
                  </AlertDescription>
                </Alert>
              </MessageScrollerItem>
            ) : null}
            {scene === 'settling' ? (
              <MessageScrollerItem messageId="settling">
                <Alert>
                  <AlertTitle>回复已结束，正在检查变更</AlertTitle>
                  <AlertDescription>等待工具与快照收尾，本轮尚未完成。</AlertDescription>
                </Alert>
              </MessageScrollerItem>
            ) : null}
            {scene === 'denied' ? (
              <MessageScrollerItem messageId="denied">
                <Alert>
                  <AlertTitle>已拒绝执行</AlertTitle>
                  <AlertDescription>这条命令未执行。可以修改任务后继续。</AlertDescription>
                </Alert>
              </MessageScrollerItem>
            ) : null}
            {scene === 'stopping' ? (
              <MessageScrollerItem messageId="stopping">
                <Alert>
                  <AlertTitle>正在停止本轮</AlertTitle>
                  <AlertDescription>
                    等待内核和工具确认结束。此处为离线样本，可在上方切换到“已停止”查看终态。
                  </AlertDescription>
                </Alert>
              </MessageScrollerItem>
            ) : null}
            {scene === 'stopped' ? (
              <MessageScrollerItem messageId="stopped">
                <Alert>
                  <AlertTitle>本轮已停止</AlertTitle>
                  <AlertDescription>已有输出保留；停止不会自动撤销文件修改。</AlertDescription>
                </Alert>
              </MessageScrollerItem>
            ) : null}
            {scene === 'review' ? (
              <MessageScrollerItem messageId="review">
                <p className="phase-note">本轮完成，2 个文件等待审查。</p>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="返回最新消息" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
