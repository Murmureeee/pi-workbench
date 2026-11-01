// @env node
import { app, BrowserWindow, Menu, Tray } from 'electron'

import { trayIcon } from './tray-icon.js'

const workbenchUrl = 'http://127.0.0.1:5173'
let exiting = false
let tray: Tray | undefined

app.on('before-quit', () => {
  exiting = true
})
async function createDesktop() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    title: 'Pi Workbench',
    backgroundColor: '#202020',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  function showWindow() {
    window.show()
    window.focus()
  }

  // The development launcher owns the daemon and stops it after Electron exits.
  try {
    tray = new Tray(trayIcon())
    tray.setToolTip('Pi Workbench')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开工作台', click: showWindow },
        { type: 'separator' },
        {
          label: '退出应用',
          click: () => app.quit(),
        },
      ]),
    )
    tray.on('double-click', showWindow)
  } catch (error) {
    console.error(
      'Unable to create the system tray; exiting rather than hiding an inaccessible window.',
      error,
    )
    app.quit()
    throw error
  }
  window.on('close', (event) => {
    if (!exiting) {
      event.preventDefault()
      window.hide()
    }
  })
  app.on('activate', showWindow)
  app.on('will-quit', () => {
    tray?.destroy()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== workbenchUrl) {
      event.preventDefault()
    }
  })
  await window.loadURL(workbenchUrl)
}

void app
  .whenReady()
  .then(createDesktop)
  .catch((error: unknown) => {
    console.error(error)
    app.exit(1)
  })
