import type { FileEditSnapshot } from '@pi-workbench/shared'

import { create } from 'zustand'

import { fileEditDraftsSchema } from '@pi-workbench/shared'

type Draft = { snapshot: FileEditSnapshot; text: string; undo: string[]; uncertain: boolean }
const storageKey = 'piw-file-edit-drafts-v1'
const serialized = (drafts: Record<string, Draft>) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(drafts).map(([k, { undo: _undo, ...d }]) => [k, d])),
  )
function read(): Record<string, Draft> {
  try {
    const value = fileEditDraftsSchema.parse(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}'))
    return Object.fromEntries(Object.entries(value).map(([k, d]) => [k, { ...d, undo: [] }]))
  } catch {
    return {}
  }
}
/** Four per-window drafts survive file/session switches, view eviction and refresh.
 * Exact unredacted text was explicitly admitted by the host. No permit survives daemon
 * restart. Undo is bounded to 20 states / 1 MiB per draft and resets on refresh. */
export const useFileEditDrafts = create<{
  drafts: Record<string, Draft>
  storageFailed: boolean
  put: (key: string, draft: Draft) => void
  remove: (key: string) => void
}>((set, get) => ({
  drafts: read(),
  storageFailed: false,
  put: (key, draft) => {
    const drafts = { ...get().drafts, [key]: draft }
    let storageFailed = false
    try {
      sessionStorage.setItem(storageKey, serialized(drafts))
    } catch {
      storageFailed = true
    }
    set({ drafts, storageFailed })
  },
  remove: (key) => {
    const drafts = { ...get().drafts }
    delete drafts[key]
    let storageFailed = false
    try {
      sessionStorage.setItem(storageKey, serialized(drafts))
    } catch {
      storageFailed = true
    }
    set({ drafts, storageFailed })
  },
}))
export const fileDraftKey = (snapshot: Pick<FileEditSnapshot, 'target' | 'absolutePath'>) =>
  JSON.stringify([snapshot.target, snapshot.absolutePath])
export const hasUnsavedFiles = () =>
  Object.values(useFileEditDrafts.getState().drafts).some(
    (d) => d.text !== d.snapshot.text || d.uncertain,
  )
