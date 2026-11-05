import { ArrowDownIcon } from 'lucide-react'
import { flushSync } from 'react-dom'

import {
  MessageScrollerButton,
  useMessageScroller,
} from '@pi-workbench/ui/components/message-scroller'

import { useReadingLayout } from './reading-layout.js'

/** User-requested navigation focuses the message viewport. Background updates never invoke
 * it; the official scroller continues to own visibility, geometry and scrolling. */
export function LatestMessagesButton({
  count,
  label = '返回最新',
}: {
  count: number
  label?: string
}) {
  const scroller = useMessageScroller()
  const reading = useReadingLayout()
  return (
    <MessageScrollerButton
      aria-label={label === '返回最新' ? '返回最新消息' : label}
      size="sm"
      onClick={(event) => {
        event.preventDefault()
        // The scroller reads its controlled autoScroll flag when jumping. Commit the
        // user's follow intent first, or it can remain in free-scrolling during a stream.
        flushSync(() => reading?.release())
        scroller.scrollToEnd({ behavior: 'instant' })
        event.currentTarget
          .closest('[data-slot="message-scroller"]')
          ?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
          ?.focus({ preventScroll: true })
      }}
    >
      <ArrowDownIcon data-icon="inline-start" />
      <span aria-live="polite" aria-atomic="true">
        {count > 0 ? `${count} 条新消息 · ${label}` : label}
      </span>
    </MessageScrollerButton>
  )
}
