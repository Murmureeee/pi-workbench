import type { WorkbenchStore } from './types.js'
// @env browser
import { create } from 'zustand'

import { emptyProjection, reduceEvent } from '@pi-workbench/shared'

export const useWorkbench = create<WorkbenchStore>((set, get) => ({
  scene: 'new',
  projection: emptyProjection(),
  draft: '',
  submitted: '',
  theme: 'system',
  navOpen: false,
  changesOpen: false,
  setScene: (scene) =>
    set({
      scene,
      changesOpen: scene === 'review',
      navOpen: false,
      submitted: '',
    }),
  setDraft: (draft) => set({ draft }),
  send: () => {
    const state = get()
    if (
      !state.draft.trim() ||
      !['new', 'review', 'error', 'denied', 'stopped'].includes(state.scene)
    ) {
      return
    }
    set({
      scene: 'running',
      submitted: state.draft.trim(),
      draft: '',
      navOpen: false,
      changesOpen: false,
    })
  },
  applyFixture: (fixture) => {
    if (fixture.scene !== get().scene) {
      return
    }
    const projection = fixture.events.reduce(reduceEvent, emptyProjection())
    set({
      projection: {
        ...projection,
        prompt: get().submitted || projection.prompt,
        phase: fixture.scene === 'offline' ? 'offline' : projection.phase,
      },
    })
  },
  setTheme: (theme) => set({ theme }),
  toggleNav: () => set((state) => ({ navOpen: !state.navOpen })),
  toggleChanges: () => set((state) => ({ changesOpen: !state.changesOpen })),
}))
