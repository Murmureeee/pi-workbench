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
  setScene: (scene: Scene) => void
  setDraft: (draft: string) => void
  send: () => void
  applyFixture: (fixture: Fixture) => void
  setTheme: (theme: Theme) => void
  toggleNav: () => void
  toggleChanges: () => void
}
