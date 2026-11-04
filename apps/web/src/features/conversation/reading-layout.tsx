import { createContext, useContext } from 'react'

/** Only explicit presentation actions can hold/release a reading position. The viewport
 * owns the bookmark and uses MessageScroller's public API; this context owns no task. */
export const ReadingLayout = createContext<{
  preserve: (clampAfterShrink?: boolean) => void
  restore: () => void
  release: () => void
} | null>(null)

export function useReadingLayout() {
  return useContext(ReadingLayout)
}
