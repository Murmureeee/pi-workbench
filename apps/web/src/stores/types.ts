import type { Fixture, Projection, Scene } from '@pi-workbench/shared'

type Theme = 'system' | 'light' | 'dark'
export interface WorkbenchStore {
  scene: Scene
  projection: Projection
  draft: string
  submitted: string
  theme: Theme
  navOpen: boolean
  changesOpen: boolean
  sessionListFilter: 'active' | 'archived'
  projectQuery: string
  collapsedProjects: Record<string, boolean>
  setProjectQuery: (query: string) => void
  toggleProject: (id: string) => void
  setSessionListFilter: (filter: 'active' | 'archived') => void
  setScene: (scene: Scene) => void
  setDraft: (draft: string) => void
  send: () => void
  applyFixture: (fixture: Fixture) => void
  setTheme: (theme: Theme) => void
  toggleNav: () => void
  toggleChanges: () => void
}
