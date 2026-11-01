import type { ReactNode } from 'react'

import { ChevronDownIcon, FolderIcon } from 'lucide-react'
import { Component } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@pi-workbench/ui/components/alert'
import { Button } from '@pi-workbench/ui/components/button'

import { Conversation } from '../features/conversation/conversation.js'
import { useWorkbench } from '../stores/workbench.js'

/** Isolates optional conversation rendering failures from the composer and workspace.
 * Reset changes only the view; it never retries SDK work or modifies recorded history.
 */
class ConversationBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="service-error">
          <Alert variant="destructive">
            <AlertTitle>消息显示失败</AlertTitle>
            <AlertDescription>
              对话内容暂时无法显示，草稿仍保留。
              <Button variant="outline" onClick={this.props.onReset}>
                返回新会话
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )
    }
    return this.props.children
  }
}

export function SceneContent({
  failed,
  invalidContract,
  pending,
  reconnect,
}: {
  failed: boolean
  invalidContract: boolean
  pending: boolean
  reconnect: () => void
}) {
  const scene = useWorkbench((state) => state.scene)
  const needsSync = useWorkbench((state) => state.projection.needsSync)
  const setScene = useWorkbench((state) => state.setScene)
  if (failed) {
    return (
      <div className="service-error">
        <Alert>
          <AlertTitle>{invalidContract ? '服务数据格式不兼容' : '无法连接本地服务'}</AlertTitle>
          <AlertDescription>
            {invalidContract
              ? '返回内容与客户端不兼容，已暂停发送。草稿保留，请确认版本后重试。'
              : '原草稿保留。检查服务后重连。'}
            <Button variant="outline" onClick={reconnect}>
              重连本地服务
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (scene === 'new') {
    return (
      <div className="new-conversation">
        <span className="pi-mark">π</span>
        <h1>今天想完成什么？</h1>
        <p>描述任务，从这里开始。</p>
        <div className="new-project">
          <FolderIcon />
          无项目
          <ChevronDownIcon />
        </div>
      </div>
    )
  }
  if (pending) {
    return <output className="loading-state">正在读取离线状态样本…</output>
  }
  if (needsSync && scene !== 'offline') {
    return (
      <div className="service-error">
        <Alert>
          <AlertTitle>需要重新同步会话</AlertTitle>
          <AlertDescription>
            事件不完整，已暂停发送。现有内容与草稿保留。
            <Button variant="outline" onClick={reconnect}>
              重新同步状态
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  return (
    <ConversationBoundary key={scene} onReset={() => setScene('new')}>
      <Conversation />
    </ConversationBoundary>
  )
}
