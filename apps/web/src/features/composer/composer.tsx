import { ArrowUpIcon, ChevronDownIcon, PlusIcon, ShieldCheckIcon, SquareIcon } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@pi-workbench/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@pi-workbench/ui/components/input-group'

import { useWorkbench } from '../../stores/workbench.js'

export function Composer({ connected }: { connected: boolean }) {
  const draft = useWorkbench((state) => state.draft)
  const scene = useWorkbench((state) => state.scene)
  const setDraft = useWorkbench((state) => state.setDraft)
  const send = useWorkbench((state) => state.send)
  const setScene = useWorkbench((state) => state.setScene)
  const composingRef = useRef(false)
  const canSend =
    connected && ['new', 'review', 'error', 'denied', 'stopped'].includes(scene) && !!draft.trim()
  return (
    <div className="composer-area">
      <InputGroup className="composer-box">
        <InputGroupTextarea
          aria-label="任务内容"
          placeholder={scene === 'new' ? '描述任务，或提出一个问题…' : '补充说明，或排到下一轮…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !composingRef.current &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault()
              if (canSend) {
                send()
              }
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton aria-label="添加上下文（M4 接入）" disabled>
            <PlusIcon />
          </InputGroupButton>
          <span className="composer-option">
            执行
            <ChevronDownIcon />
          </span>
          <span className="composer-option">
            模型未接入
            <ChevronDownIcon />
          </span>
          <span className="flex-1" />
          {scene === 'running' ? (
            <InputGroupButton
              aria-label="停止本轮"
              variant="secondary"
              onClick={() => setScene('stopping')}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : null}
          <Button aria-label="发送任务" size="icon-sm" disabled={!canSend} onClick={send}>
            <ArrowUpIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <div className="composer-hint">
        <span>
          <ShieldCheckIcon />
          写文件与命令先审批
        </span>
        <span>
          费用未知
          <span className="keyboard-hint"> Enter 发送 · Shift Enter 换行</span>
        </span>
      </div>
    </div>
  )
}
