import type { BrowserWindow, IpcMainInvokeEvent, Menu } from 'electron'

import { ipcMain, nativeTheme } from 'electron'

import { desktopMenuSchema, desktopThemeSchema } from '@pi-workbench/shared'

/** Native caption buttons stay owned by Windows. Only the trusted main frame may change
 * the chrome palette or open a predefined application submenu; malformed IPC fails closed.
 * No operation accepts a URL or provides minimize/close/process execution privileges.
 */
export function registerWindowChrome(window: BrowserWindow, origin: string, menu: Menu): void {
  let theme: 'system' | 'light' | 'dark' = 'system'
  const trusted = (event: IpcMainInvokeEvent) =>
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame !== null &&
    URL.canParse(event.senderFrame.url) &&
    new URL(event.senderFrame.url).origin === origin
  const apply = () => {
    if (window.isDestroyed()) {
      return
    }
    const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
    const color = dark ? '#202020' : '#f3f4f5'
    window.setBackgroundColor(color)
    window.setTitleBarOverlay({ color, symbolColor: dark ? '#ededed' : '#262626', height: 40 })
  }
  ipcMain.handle('piw:open-menu', (event, ...args: unknown[]) => {
    const parsed = desktopMenuSchema.safeParse(args[0])
    if (!trusted(event) || args.length !== 1 || !parsed.success) {
      return false
    }
    const submenu = menu.getMenuItemById(parsed.data)?.submenu
    if (!submenu) {
      return false
    }
    submenu.popup({
      window,
      x: { workbench: 84, edit: 130, view: 176, help: 222 }[parsed.data],
      y: 40,
    })
    return true
  })
  ipcMain.handle('piw:theme', (event, ...args: unknown[]) => {
    const parsed = desktopThemeSchema.safeParse(args[0])
    if (!trusted(event) || args.length !== 1 || !parsed.success) {
      return false
    }
    theme = parsed.data
    apply()
    return true
  })
  nativeTheme.on('updated', apply)
  window.once('closed', () => {
    nativeTheme.off('updated', apply)
    ipcMain.removeHandler('piw:open-menu')
    ipcMain.removeHandler('piw:theme')
  })
}
