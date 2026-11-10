import electron = require('electron')
import type { DesktopBridge, DesktopPage } from '@pi-workbench/shared'

const { contextBridge, ipcRenderer } = electron

// Sandboxed CJS preload: Electron is the only runtime import. No Node, SDK, filesystem or
// generic IPC channel is exposed to page content, including third-party resource previews.
contextBridge.exposeInMainWorld(
  'piWorkbench',
  Object.freeze({
    selectDirectory: async (): Promise<unknown> => {
      const result: unknown = await ipcRenderer.invoke('piw:select-directory')
      return result
    },
    openMenu: async (menu): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('piw:open-menu', menu)
      return result === true
    },
    setTheme: async (theme): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('piw:theme', theme)
      return result === true
    },
    editorStatus: async (): Promise<unknown> => ipcRenderer.invoke('piw:editor-status'),
    configureEditor: async (command): Promise<unknown> =>
      ipcRenderer.invoke('piw:configure-editor', command),
    openFileExternally: async (request): Promise<unknown> =>
      ipcRenderer.invoke('piw:external-file', request),
    cancelExternal: async (id): Promise<boolean> =>
      (await ipcRenderer.invoke('piw:cancel-external', id)) === true,
    previewFile: async (request): Promise<unknown> =>
      ipcRenderer.invoke('piw:preview-file', request),
    cancelPreview: async (id): Promise<boolean> =>
      (await ipcRenderer.invoke('piw:cancel-preview', id)) === true,
    onNavigate: (receive) => {
      const listener = (_event: unknown, page: DesktopPage) => receive(page)
      ipcRenderer.on('piw:navigate', listener)
      return () => {
        ipcRenderer.removeListener('piw:navigate', listener)
      }
    },
  } satisfies DesktopBridge),
)
