import type { DirectorySelection } from '@pi-workbench/shared'
import type { BrowserWindow } from 'electron'

import { dialog, ipcMain } from 'electron'

/** Only the trusted workbench main frame may request this fixed native picker. It cannot
 * pass a default path, dialog options, IPC channel, command or executable to the host.
 * Cancellation is explicit; one outstanding dialog per window is allowed.
 */
export function registerDirectoryPicker(window: BrowserWindow, origin: string): void {
  let picking = false
  ipcMain.handle(
    'piw:select-directory',
    async (event, ...args: unknown[]): Promise<DirectorySelection> => {
      if (
        args.length !== 0 ||
        window.isDestroyed() ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        !event.senderFrame ||
        new URL(event.senderFrame.url).origin !== origin ||
        picking
      ) {
        return { status: 'unavailable' }
      }
      picking = true
      try {
        const result = await dialog.showOpenDialog(window, {
          title: '打开工作区',
          buttonLabel: '打开工作区',
          properties: ['openDirectory', 'dontAddToRecent'],
        })
        if (result.canceled || !result.filePaths[0]) {
          return { status: 'cancelled' }
        }
        return { status: 'selected', path: result.filePaths[0] }
      } catch {
        return { status: 'unavailable' }
      } finally {
        picking = false
      }
    },
  )
  window.once('closed', () => ipcMain.removeHandler('piw:select-directory'))
}
