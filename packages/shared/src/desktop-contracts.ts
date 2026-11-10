import type { editorCommandSchema, externalFileRequestSchema } from './external-files.js'
import type { previewRequestSchema } from './file-preview.js'

import { z } from 'zod'

export const desktopThemeSchema = z.enum(['system', 'light', 'dark'])
export const desktopMenuSchema = z.enum(['workbench', 'edit', 'view', 'help'])
export const desktopPageSchema = z.enum([
  'workbench',
  'settings',
  'workspaces',
  'models',
  'clients',
  'audit',
])

export type DesktopTheme = z.infer<typeof desktopThemeSchema>
export type DesktopPage = z.infer<typeof desktopPageSchema>

/** Fixed, window-scoped chrome operations only. No arbitrary channels, URLs, window handles
 * or execution options cross the sandbox. Each subscription owns its cleanup function.
 */
export interface DesktopBridge {
  selectDirectory: () => Promise<unknown>
  openMenu: (menu: z.infer<typeof desktopMenuSchema>) => Promise<boolean>
  setTheme: (theme: DesktopTheme) => Promise<boolean>
  onNavigate: (receive: (page: DesktopPage) => void) => () => void
  editorStatus: () => Promise<unknown>
  configureEditor: (command: z.infer<typeof editorCommandSchema>) => Promise<unknown>
  openFileExternally: (request: z.infer<typeof externalFileRequestSchema>) => Promise<unknown>
  cancelExternal: (id: string) => Promise<boolean>
  previewFile: (request: z.infer<typeof previewRequestSchema>) => Promise<unknown>
  cancelPreview: (id: string) => Promise<boolean>
}
