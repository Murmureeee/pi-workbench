import electron = require('electron')

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
  }),
)
