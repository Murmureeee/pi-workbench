import type { SessionView } from '@pi-workbench/shared'
import type { ComponentProps, ReactNode } from 'react'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import {
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '@pi-workbench/ui/components/message-scroller'

import { sessionView, useSessionViews } from '../../stores/session-views.js'
import { ReadingLayout } from './reading-layout.js'

/** Bookmarks the first visible message and its pixel offset, with scrollTop as fallback.
 * Hidden/evicted views cannot overwrite the bookmark with zero geometry. Restoration
 * waits for page content and layout, never focuses, sends, or changes the active object.
 * MessageScroller owns scrolling/auto-follow. Explicit content expansion temporarily
 * holds this bookmark across async layout changes until the user scrolls or returns latest.
 */
export function RememberedViewport({
  sessionId: id,
  surface,
  active,
  ready,
  latestToken,
  onReadLatest,
  locateMessage,
  children,
  navigation,
  ...props
}: ComponentProps<typeof MessageScrollerViewport> & {
  sessionId: string
  surface: string
  active: boolean
  ready: boolean
  latestToken?: string
  onReadLatest?: () => void
  locateMessage?: string | null
  navigation?: ReactNode
}) {
  const scroller = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const viewport = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const held = useRef<SessionView['reading'][string] | null>(null)
  const clampAfterShrink = useRef(false)
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
  const capture = useCallback(() => {
    const element = viewport.current
    if (!element?.clientHeight || !restored.current) {
      return null
    }
    const bounds = element.getBoundingClientRect()
    const item = [...element.querySelectorAll<HTMLElement>('[data-reading-id]')].find(
      (child) => child.getBoundingClientRect().bottom > bounds.top,
    )
    return {
      anchor: item?.dataset.readingId ?? null,
      offset: item ? item.getBoundingClientRect().top - bounds.top : 0,
      top: element.scrollTop,
      follow: !held.current && element.scrollHeight - element.scrollTop - element.clientHeight < 40,
    }
  }, [])
  const save = useCallback(() => {
    const position = capture()
    if (!position) {
      return
    }
    useSessionViews.getState().update(id, {
      reading: {
        ...sessionView(id).reading,
        [surface]: position,
      },
    })
  }, [capture, id, surface])
  const applyPosition = useCallback(
    (position: SessionView['reading'][string], clamp = false) => {
      const element = viewport.current
      if (!element?.clientHeight) {
        return
      }
      const content = element.querySelector<HTMLElement>('[data-slot="message-scroller-content"]')
      const padding = content
        ? Number.parseFloat(getComputedStyle(content).paddingBlockStart) || 0
        : 0
      const anchor =
        clamp && position.anchor
          ? [...element.querySelectorAll<HTMLElement>('[data-reading-id]')].find(
              (item) => item.dataset.readingId === position.anchor,
            )
          : undefined
      // Collapsing from the end of a long body must not leave a synthetic blank spacer.
      // Clamp only explicit shrink operations; lazy initial layout retains the exact bookmark.
      const offset = anchor
        ? Math.max(
            position.offset,
            Math.min(0, element.clientHeight - anchor.getBoundingClientRect().height),
          )
        : position.offset
      if (position.follow) {
        scroller.scrollToEnd({ behavior: 'instant' })
      } else if (
        !position.anchor ||
        !scroller.scrollToMessage(position.anchor, {
          align: 'start',
          scrollMargin: offset - padding,
          behavior: 'instant',
        })
      ) {
        scroller.scrollToStart({ behavior: 'instant' })
        element.scrollTop = position.top
      }
    },
    [scroller],
  )
  const preserve = useCallback(
    (clamp = false) => {
      if (!active || !ready) {
        return
      }
      const position = capture()
      if (position) {
        clampAfterShrink.current = clamp
        held.current = { ...position, follow: false }
        applyPosition(held.current, clamp)
        save()
      }
    },
    [active, ready, capture, applyPosition, save],
  )
  const restore = useCallback(() => {
    if (active && ready && held.current) {
      applyPosition(held.current, clampAfterShrink.current)
      save()
    }
  }, [active, ready, applyPosition, save])
  const release = useCallback(() => {
    held.current = null
    const position = capture()
    if (position) {
      useSessionViews.getState().update(id, {
        reading: { ...sessionView(id).reading, [surface]: { ...position, follow: true } },
      })
    }
  }, [capture, id, surface])
  const layout = useMemo(() => ({ preserve, restore, release }), [preserve, restore, release])
  useEffect(() => {
    const content = viewport.current?.querySelector('[data-slot="message-scroller-content"]')
    if (!active || !ready || !content) {
      return undefined
    }
    const observer = new ResizeObserver(restore)
    observer.observe(content)
    return () => observer.disconnect()
  }, [active, ready, restore])
  useLayoutEffect(() => {
    held.current = null
    clampAfterShrink.current = false
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
          // Lazy Markdown and content-visibility may settle after this frame.
          // Keep restoring this anchor until the user scrolls or returns latest.
          held.current = position.follow ? null : position
          applyPosition(position)
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
  }, [id, surface, active, ready, save, scroller, reportLatest, locateMessage, applyPosition])
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
    <ReadingLayout value={layout}>
      <MessageScrollerViewport
        {...props}
        ref={viewport}
        onPointerDown={() => {
          held.current = null
        }}
        onWheel={() => {
          held.current = null
        }}
        onTouchMove={() => {
          held.current = null
        }}
        onKeyDown={() => {
          held.current = null
        }}
        onScroll={() => {
          save()
          reportLatest()
        }}
      >
        {children}
      </MessageScrollerViewport>
      {navigation}
    </ReadingLayout>
  )
}
