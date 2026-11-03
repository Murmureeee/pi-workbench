import type { SessionView } from '@pi-workbench/shared'

import { create } from 'zustand'

import { sessionViewSchema, sessionViewsSchema } from '@pi-workbench/shared'

const storageKey = 'piw-session-views-v1'
function read() {
  try {
    return sessionViewsSchema.parse(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}'))
  } catch {
    return {}
  }
}
interface ViewStore {
  views: Record<string, SessionView>
  storageFailed: boolean
  update: (id: string, patch: Partial<SessionView>) => void
}
/** Small per-session bookmarks survive view eviction and renderer reload in this window.
 * Message bodies and privileged state remain owned by the daemon. Storage failure keeps
 * in-memory state; it never affects task execution or claims a durable bookmark.
 */
export const useSessionViews = create<ViewStore>((set, get) => ({
  views: read(),
  storageFailed: false,
  update: (id, patch) => {
    const views = { ...get().views, [id]: { ...sessionView(id), ...patch } }
    let storageFailed = false
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(views))
    } catch {
      storageFailed = true
    }
    set({ views, storageFailed })
  },
}))
const empty = sessionViewSchema.parse({})
export function sessionView(id: string) {
  return useSessionViews.getState().views[id] ?? empty
}
/** MRU view cache is independent of the kernel pool. A draft occupies one view as well. */
export function retainSessionView(ids: string[], selected: string): string[] {
  return [selected, ...ids.filter((id) => id !== selected)].slice(0, 3)
}
