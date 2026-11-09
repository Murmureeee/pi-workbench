import type { MessageTarget } from '@pi-workbench/shared'

import { LinkIcon, QuoteIcon } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'

import { messageLink, messageLocationSchema } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'

import { sessionJson } from '../../services/session-client.js'
import { MessageQuoteContext } from './message-quote-context.js'

/** Resolves original identities before copying/referencing; no execution or automatic send.
 * A quote reserves the destination draft at the click, so navigation, edits and eviction
 * during IO cannot append to another draft. Clipboard contains the link or code source only. */
export function MessageActions({
  sessionId,
  target,
  text = '',
}: {
  sessionId: string
  target?: MessageTarget
  text?: string
}) {
  const prepare = useContext(MessageQuoteContext)
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef<AbortController | null>(null)
  const identity = JSON.stringify(target ?? null)
  useEffect(() => {
    setStatus('')
    setPending(false)
    return () => {
      request.current?.abort()
    }
  }, [sessionId, identity, text])
  const act = async (quote: boolean) => {
    const append = quote ? prepare?.() : null
    if (quote && !append) {
      setStatus('当前输入不可引用；请返回可编辑的未发送草稿。')
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setStatus('')
    try {
      const location = target
        ? messageLocationSchema.parse(
            await sessionJson(
              `/api/sessions/${encodeURIComponent(sessionId)}/locate?${new URLSearchParams(Object.entries(target))}`,
              controller.signal,
            ),
          )
        : null
      if (controller.signal.aborted || request.current !== controller) {
        return
      }
      const link = location ? messageLink(location) : `/?session=${encodeURIComponent(sessionId)}`
      if (quote && append) {
        const points = Array.from(text)
        const excerpt = points.slice(0, 4000).join('')
        const result = append(
          `引用历史消息 [来源](${link})${location?.archived ? ' · 来源会话已归档' : ''}\n${excerpt
            .split('\n')
            .map((line) => `> ${line}`)
            .join(
              '\n',
            )}${points.length > 4000 ? '\n> [仅引用前 4000 字符；完整内容见来源]' : ''}\n`,
        )
        setStatus(result ?? '已加入本会话输入，尚未发送；这是历史文本引用。')
      } else {
        await navigator.clipboard.writeText(link)
        if (!controller.signal.aborted) {
          setStatus('链接已复制；打开时重新核对记录。')
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setStatus(cause instanceof Error ? cause.message : '操作失败，请重试；输入和历史保留。')
      }
    } finally {
      if (!controller.signal.aborted) {
        setPending(false)
      }
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void act(false)}>
        <LinkIcon />
        {target?.kind === 'tool' ? '复制工具链接' : target ? '复制消息链接' : '复制会话链接'}
      </Button>
      {target && target.kind !== 'tool' && prepare ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => void act(true)}>
          <QuoteIcon />
          引用到输入
        </Button>
      ) : null}
      {status ? (
        <output aria-live="polite" className="wrap-anywhere">
          {status}
        </output>
      ) : null}
    </div>
  )
}
