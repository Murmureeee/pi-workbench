// @env node
import type { DesktopPage } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, Menu, nativeTheme, shell, Tray } from 'electron'

import { hostAccessResultSchema } from '@pi-workbench/shared'

import { registerDirectoryPicker } from './directory-picker.js'
import { trayIcon } from './tray-icon.js'
import { registerWindowChrome } from './window-chrome.js'

const workbenchUrl = 'http://127.0.0.1:5173'
let exiting = false
let tray: Tray | undefined

/** Private parent process IPC. No renderer bridge or HTTP endpoint can issue host tickets. */
async function hostAccess(operation: 'desktop' | 'browser') {
  if (!process.send) {
    throw new Error('Launch desktop through the managed host')
  }
  const id = randomUUID()
  return new Promise<ReturnType<typeof hostAccessResultSchema.parse>>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      process.off('message', receive)
      process.off('disconnect', disconnected)
    }
    const receive = (message: unknown) => {
      const parsed = hostAccessResultSchema.safeParse(message)
      if (parsed.success && parsed.data.id === id) {
        cleanup()
        resolve(parsed.data)
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Host authorization timed out'))
    }, 5000)
    const disconnected = () => {
      cleanup()
      reject(new Error('Managed host disconnected'))
    }
    process.on('message', receive)
    process.once('disconnect', disconnected)
    process.send?.({ type: 'host-access', id, operation }, (error) => {
      if (error) {
        cleanup()
        reject(new Error('Managed host unavailable'))
      }
    })
  })
}

app.on('before-quit', () => {
  exiting = true
})
async function createDesktop() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Pi Workbench',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f4f5',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 40,
      color: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f4f5',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ededed' : '#262626',
    },
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  })
  registerDirectoryPicker(window, workbenchUrl)
  function showWindow() {
    window.show()
    window.focus()
  }
  const openBrowser = async () => {
    const result = await hostAccess('browser')
    // Only the fixed loopback workbench URL is opened; untrusted URLs never reach shell.
    await shell.openExternal(`${workbenchUrl}/?clients#pair=${result.ticket.code}`)
  }
  const browserItem = {
    label: '连接本机浏览器（两分钟有效）',
    enabled: typeof process.send === 'function',
    click: () => {
      void openBrowser().catch(() => console.error('Unable to authorize local browser'))
    },
  }
  const navigate = (page: DesktopPage) => window.webContents.send('piw:navigate', page)
  const menu = Menu.buildFromTemplate([
    {
      id: 'workbench',
      label: '文件',
      submenu: [
        browserItem,
        {
          label: '打开工作区…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            navigate('workspaces')
          },
        },
        {
          label: '客户端管理',
          click: () => {
            navigate('clients')
          },
        },
        {
          label: '模型与提供商',
          click: () => {
            navigate('models')
          },
        },
        { type: 'separator' },
        {
          id: 'open-settings',
          label: '设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => navigate('settings'),
        },
        { type: 'separator' },
        { label: '退出应用', click: () => app.quit() },
      ],
    },
    {
      id: 'edit',
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      id: 'view',
      label: '视图',
      submenu: [
        { label: '返回工作台', click: () => navigate('workbench') },
        { label: '设置', click: () => navigate('settings') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      id: 'help',
      label: '帮助',
      submenu: [
        { label: 'Pi Workbench · 本地优先工作台', enabled: false },
        { label: '当前为离线开发预览', enabled: false },
      ],
    },
  ])
  Menu.setApplicationMenu(menu)
  window.setMenuBarVisibility(false)
  registerWindowChrome(window, workbenchUrl, menu)

  // The development launcher owns the daemon and stops it after Electron exits.
  try {
    tray = new Tray(trayIcon())
    tray.setToolTip('Pi Workbench')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开工作台', click: showWindow },
        browserItem,
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
  if (process.send) {
    try {
      const result = await hostAccess('desktop')
      const response = await fetch(`${result.apiOrigin}/api/access/pair`, {
        signal: AbortSignal.timeout(5000),
        method: 'POST',
        headers: { origin: workbenchUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ code: result.ticket.code, label: 'Windows 桌面' }),
      })
      const cookie = response.headers.get('set-cookie')?.match(/^(piw_client_\d+)=([0-9a-f]{64});/)
      if (!response.ok || !cookie) {
        throw new Error('Desktop authorization failed')
      }
      await window.webContents.session.cookies.set({
        url: `${workbenchUrl}/api`,
        name: cookie[1]!,
        value: cookie[2]!,
        path: '/api',
        httpOnly: true,
        sameSite: 'strict',
      })
    } catch {
      console.error('Desktop client authorization unavailable; pairing is required')
    }
  }
  await window.loadURL(workbenchUrl)
  showWindow()
}

void app
  .whenReady()
  .then(createDesktop)
  .catch((error: unknown) => {
    console.error(error)
    app.exit(1)
  })
