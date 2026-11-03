import type { ComponentProps } from 'react'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import {
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '@pi-workbench/ui/components/message-scroller'

import { sessionView, useSessionViews } from '../../stores/session-views.js'

/** Bookmarks the first visible message and its pixel offset, with scrollTop as fallback.
 * Hidden/evicted views cannot overwrite the bookmark with zero geometry. Restoration
 * waits for page content and layout, never focuses, sends, or changes the active object.
 * MessageScroller still owns scrolling/auto-follow; this hook only persists its viewport.
 */
export function RememberedViewport({
  sessionId: id,
  surface,
  active,
  ready,
  latestToken,
  onReadLatest,
  locateMessage,
  ...props
}: ComponentProps<typeof MessageScrollerViewport> & {
  sessionId: string
  surface: string
  active: boolean
  ready: boolean
  latestToken?: string
  onReadLatest?: () => void
  locateMessage?: string | null
}) {
  const scroller = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const viewport = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const readLatest = useRef(onReadLatest)
  readLatest.current = onReadLatest
  const reportLatest = useCallback(() => {
    const element = viewport.current
    if (
      active &&
      ready &&
      restored.current &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      element?.clientHeight &&
      element.scrollHeight - element.scrollTop - element.clientHeight < 40
    ) {
      readLatest.current?.()
    }
  }, [active, ready])
  const save = useCallback(() => {
    const element = viewport.current
    if (!element?.clientHeight || !restored.current) {
      return
    }
    const bounds = element.getBoundingClientRect()
    const item = [...element.querySelectorAll<HTMLElement>('[data-reading-id]')].find(
      (child) => child.getBoundingClientRect().bottom > bounds.top,
    )
    const view = sessionView(id)
    useSessionViews.getState().update(id, {
      reading: {
        ...view.reading,
        [surface]: {
          anchor: item?.dataset.readingId ?? null,
          offset: item ? item.getBoundingClientRect().top - bounds.top : 0,
          top: element.scrollTop,
          follow: element.scrollHeight - element.scrollTop - element.clientHeight < 40,
        },
      },
    })
  }, [id, surface])
  useLayoutEffect(() => {
    restored.current = false
    if (!active || !ready) {
      return undefined
    }
    const element = viewport.current
    if (!element) {
      return undefined
    }
    let second = 0
    const position = sessionView(id).reading[surface]
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (locateMessage && element.clientHeight) {
          scroller.scrollToMessage(locateMessage, { align: 'center', behavior: 'instant' })
        } else if (position && element.clientHeight) {
          const content = element.querySelector<HTMLElement>(
            '[data-slot="message-scroller-content"]',
          )
          const padding = content
            ? Number.parseFloat(getComputedStyle(content).paddingBlockStart) || 0
            : 0
          if (position.follow) {
            scroller.scrollToEnd({ behavior: 'instant' })
          } else if (
            !position.anchor ||
            !scroller.scrollToMessage(position.anchor, {
              align: 'start',
              scrollMargin: position.offset - padding,
              behavior: 'instant',
            })
          ) {
            scroller.scrollToStart({ behavior: 'instant' })
            element.scrollTop = position.top
          }
        }
        restored.current = true
        reportLatest()
      })
    })
    const pagehide = () => save()
    window.addEventListener('pagehide', pagehide)
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      window.removeEventListener('pagehide', pagehide)
      save()
    }
  }, [id, surface, active, ready, save, scroller, reportLatest, locateMessage])
  useEffect(() => {
    // Existing MessageScroller owns geometry observation; no second scroll controller.
    reportLatest()
    window.addEventListener('focus', reportLatest)
    document.addEventListener('visibilitychange', reportLatest)
    return () => {
      window.removeEventListener('focus', reportLatest)
      document.removeEventListener('visibilitychange', reportLatest)
    }
  }, [scrollable.end, latestToken, reportLatest])
  return (
    <MessageScrollerViewport
      {...props}
      ref={viewport}
      onScroll={() => {
        save()
        reportLatest()
      }}
    />
  )
}
