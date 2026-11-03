import type { SessionDraft } from '@pi-workbench/shared'

import { create } from 'zustand'

import { sessionDraftCollectionSchema } from '@pi-workbench/shared'
const storageKey = 'piw-session-drafts-v1'
const empty = (): SessionDraft => ({
  text: '',
  projectId: null,
  model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
  workspace: null,
  pending: null,
  lastAttempt: null,
})
function read(): Record<string, SessionDraft> {
  try {
    const parsed = sessionDraftCollectionSchema.safeParse(
      JSON.parse(sessionStorage.getItem(storageKey) ?? '{}'),
    )
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}
interface DraftStore {
  drafts: Record<string, SessionDraft>
  storageFailed: boolean
  update: (key: string, patch: Partial<SessionDraft>) => void
  newDraft: (projectId?: string | null) => void
}
/** Per-window client drafts survive refresh, separately from accepted daemon inputs. No
 * credential or pairing value is stored. Unavailable storage falls back to this window.
 */
export const useSessionDrafts = create<DraftStore>((set, get) => ({
  drafts: read(),
  storageFailed: false,
  update: (key, patch) => {
    const drafts = { ...get().drafts, [key]: { ...(get().drafts[key] ?? empty()), ...patch } }
    let storageFailed = false
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(drafts))
    } catch {
      storageFailed = true
    }
    set({ drafts, storageFailed })
  },
  newDraft: (projectId = null) => {
    const prior = get().drafts.new
    // An unresolved create retains its immutable identity until reconciled.
    // Returning to the same draft also retains its explicitly chosen execution directory.
    // A different project entry resets that override to the new project's default.
    if (prior?.pending || prior?.projectId === projectId) {
      return
    }
    get().update('new', { projectId, workspace: null })
  },
}))
export function sessionDraft(key: string) {
  return useSessionDrafts.getState().drafts[key] ?? empty()
}
