import type { WorkbenchStore } from './types.js'
// @env browser
import { create } from 'zustand'

import { emptyProjection, reduceEvent } from '@pi-workbench/shared'

import { readTheme, saveTheme } from '../services/theme.js'

function readReasoningPrivacy(): boolean {
  try {
    return sessionStorage.getItem('piw-hide-reasoning') === 'true'
  } catch {
    return false
  }
}

export const useWorkbench = create<WorkbenchStore>((set, get) => ({
  scene: 'new',
  projection: emptyProjection(),
  draft: '',
  submitted: '',
  theme: readTheme(),
  hideReasoning: readReasoningPrivacy(),
  setHideReasoning: (hideReasoning) => {
    try {
      sessionStorage.setItem('piw-hide-reasoning', String(hideReasoning))
    } catch {
      /* Window memory remains authoritative when storage is unavailable. */
    }
    set({ hideReasoning })
  },
  navOpen: false,
  changesOpen: false,
  sessionListFilter: 'active',
  projectQuery: '',
  collapsedProjects: {},
  setProjectQuery: (projectQuery) => set({ projectQuery }),
  toggleProject: (id) =>
    set((state) => ({
      collapsedProjects: { ...state.collapsedProjects, [id]: !state.collapsedProjects[id] },
    })),
  setSessionListFilter: (sessionListFilter) => set({ sessionListFilter }),
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
  setTheme: (theme) => {
    saveTheme(theme)
    set({ theme })
  },
  toggleNav: () => set((state) => ({ navOpen: !state.navOpen })),
  toggleChanges: () => set((state) => ({ changesOpen: !state.changesOpen })),
}))
