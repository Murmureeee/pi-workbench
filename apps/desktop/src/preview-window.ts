import type { PreviewSnapshot } from '@pi-workbench/shared'
import type { WebContents, WebPreferences } from 'electron'

import { randomUUID } from 'node:crypto'

import { BrowserWindow, session, WebContentsView } from 'electron'

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const csp =
  "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; font-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"

const guard = (contents: WebContents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-frame-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('context-menu', (event) => event.preventDefault())
  contents.on('page-title-updated', (event) => event.preventDefault())
  contents.on('will-prevent-unload', (event) => event.preventDefault())
}

/** Fail closed before loading any content. A unique memory-only session has no host
 * cookie, pairing identity, preload, file resolver or network fallback. This is a static
 * document viewer, not a development-server browser or a sandbox for native extensions. */
export async function openIsolatedPreview(
  snapshot: PreviewSnapshot,
  active: () => boolean,
): Promise<BrowserWindow> {
  const bytes = Buffer.from(snapshot.content, 'base64')
  if (bytes.length !== snapshot.bytes || snapshot.expiresAt < Date.now()) {
    throw Error('预览快照无效或已过期，请重新选择。')
  }
  const isolated = session.fromPartition(`piw-preview-${randomUUID()}`, { cache: false })
  const base = `piw-preview://${randomUUID()}`,
    contentUrl = `${base}/document`,
    headerUrl = `${base}/header`
  isolated.setPermissionCheckHandler(() => false)
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setDevicePermissionHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel:
        details.method !== 'GET' ||
        details.resourceType !== 'mainFrame' ||
        (details.url !== contentUrl && details.url !== headerUrl),
    })
  })
  const preferences: WebPreferences = {
    session: isolated,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    javascript: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    plugins: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    disableDialogs: true,
  }
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 600,
    minHeight: 460,
    show: false,
    title: 'Pi Workbench · 隔离静态预览',
    autoHideMenuBar: true,
    webPreferences: preferences,
  })
  window.setMenu(null)
  const view = new WebContentsView({ webPreferences: preferences })
  window.contentView.addChildView(view)
  const layout = () => {
    if (!window.isDestroyed()) {
      const { width, height } = window.getContentBounds()
      view.setBounds({ x: 0, y: 180, width, height: Math.max(1, height - 180) })
    }
  }
  layout()
  window.on('resize', layout)
  guard(window.webContents)
  guard(view.webContents)
  // Static content cannot activate a file picker, link, form or browser shortcut.
  // Scrolling remains available; all actions belong to the separate trusted header.
  view.webContents.on('before-mouse-event', (event, mouse) => {
    if (mouse.type !== 'mouseWheel') {
      event.preventDefault()
    }
  })
  view.webContents.on('before-input-event', (event, input) => {
    if (
      !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(input.key) ||
      input.control ||
      input.alt ||
      input.meta
    ) {
      event.preventDefault()
    }
  })
  const header = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
  :root{color-scheme:light dark;font:13px system-ui}body{margin:12px;overflow:auto}p{margin:4px 0;overflow-wrap:anywhere}strong{font-size:15px}
  </style><strong>隔离静态预览 · HTML</strong><p>${escape(snapshot.absolutePath)}</p>
  <p>来源：读取时的磁盘快照，修改来源未判定；不代表历史产物版本。</p><p>内容版本：${escape(snapshot.version)} · ${snapshot.bytes} 字节 · ${new Date(snapshot.checkedAt).toISOString()}</p>
  <p>脚本、外链、导航、弹窗、文件选择和内容下载均关闭；方向键／滚轮滚动。关闭窗口返回工作台。</p></html>`
  window.once('closed', () => {
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false })
    }
    isolated.protocol.unhandle('piw-preview')
    bytes.fill(0)
    void isolated.clearStorageData().catch(() => undefined)
    void isolated.closeAllConnections().catch(() => undefined)
  })

  try {
    isolated.protocol.handle('piw-preview', (request) => {
      if (request.method !== 'GET') {
        return new Response(null, { status: 403 })
      }
      if (request.url === headerUrl) {
        return new Response(header, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': csp,
            'Cache-Control': 'no-store',
          },
        })
      }
      if (request.url !== contentUrl) {
        return new Response(null, { status: 403 })
      }
      return new Response(bytes, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': `${csp}; sandbox`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      })
    })
    view.webContents.on('render-process-gone', () => {
      if (!window.isDestroyed()) {
        window.contentView.removeChildView(view)
        window.setTitle('Pi Workbench · 预览已终止，请关闭后重新打开')
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close({ waitForBeforeUnload: false })
      }
    })
    if (!active()) {
      throw Error('预览已取消。')
    }
    await window.loadURL(headerUrl)
    if (!active()) {
      throw Error('预览已取消。')
    }
    await view.webContents.loadURL(contentUrl)
    if (!active()) {
      throw Error('预览已取消。')
    }
    window.show()
    return window
  } catch {
    window.destroy()
    throw Error('隔离预览初始化或加载失败，已拒绝内容；请刷新或使用 IDE／文件管理器。')
  }
}
