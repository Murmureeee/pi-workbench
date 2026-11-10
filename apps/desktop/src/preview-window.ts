import type { ExternalFileInput, ExternalResult, PreviewSnapshot } from '@pi-workbench/shared'
import type { WebContents, WebPreferences } from 'electron'

import { randomUUID } from 'node:crypto'

import { BrowserWindow, Menu, session, WebContentsView } from 'electron'

import { systemOpenAllowed } from '@pi-workbench/shared'

import { escapePreviewText as escape, renderPreview } from './preview-rendering.js'

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

/** Unique nonpersistent session with FILE-07 guards installed before loading. Raster
 * assets are fixed normalized bytes, available only to this view and only as images.
 * Content has no preload/host identity; native original actions revalidate separately.
 * Visible checks are sampled, sticky failures hide content until explicit reopen. */
export async function openIsolatedPreview(
  snapshot: PreviewSnapshot,
  active: () => boolean,
  verify: () => Promise<void>,
  openOriginal: (
    action: ExternalFileInput['action'],
    active: () => boolean,
  ) => Promise<ExternalResult>,
): Promise<BrowserWindow> {
  const bytes = Buffer.from(snapshot.content, 'base64')
  if (bytes.length !== snapshot.bytes || snapshot.expiresAt < Date.now() || !active()) {
    throw Error('预览快照无效、过期或已取消，请重新选择。')
  }
  const base = `piw-preview://${randomUUID()}`,
    contentUrl = `${base}/document`,
    headerUrl = `${base}/header`
  const rendered = await renderPreview(snapshot, bytes, active, base).catch((error) => {
    bytes.fill(0)
    throw error
  })
  const isolated = session.fromPartition(`piw-preview-${randomUUID()}`, { cache: false })
  isolated.setPermissionCheckHandler(() => false)
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setDevicePermissionHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
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
    webPreferences: preferences,
  })
  const view = new WebContentsView({ webPreferences: preferences })
  // Electron clears view.webContents after close; retain the owned object and IDs
  // so late request/closed callbacks can clean up an already invalidated view.
  const contents = view.webContents,
    contentId = contents.id,
    headerId = window.webContents.id
  window.contentView.addChildView(view)
  const assetUrls = rendered.assets.map((_, i) => `${base}/asset/${i}`)
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel:
        details.method !== 'GET' ||
        !(
          (details.resourceType === 'mainFrame' &&
            ((details.url === contentUrl && details.webContentsId === contentId) ||
              (details.url === headerUrl && details.webContentsId === headerId))) ||
          (details.resourceType === 'image' &&
            details.webContentsId === contentId &&
            assetUrls.includes(details.url))
        ),
    }),
  )
  let invalid = false,
    checking = false,
    opening = false,
    notice = '',
    interval: ReturnType<typeof setInterval> | undefined
  let verification: Promise<void> | null = null,
    appearance = 'light dark'
  const reverify = () => {
    verification ??= verify().finally(() => {
      verification = null
    })
    return verification
  }
  const live = () => active() && !window.isDestroyed()
  const layout = () => {
    if (live()) {
      const { width, height } = window.getContentBounds()
      view.setBounds({ x: 0, y: 210, width, height: Math.max(1, height - 210) })
    }
  }
  layout()
  window.on('resize', layout)
  guard(window.webContents)
  guard(contents)
  contents.on('before-mouse-event', (event, mouse) => {
    if (mouse.type !== 'mouseWheel') {
      event.preventDefault()
    }
  })
  contents.on('before-input-event', (event, input) => {
    if (
      !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(input.key) ||
      input.control ||
      input.alt ||
      input.meta
    ) {
      event.preventDefault()
    }
  })
  const header =
    () => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>:root{color-scheme:${appearance};font:13px system-ui}body{margin:12px;max-height:186px;overflow:auto}p{margin:4px 0;overflow-wrap:anywhere}strong{font-size:15px}</style>
    <strong>隔离静态预览 · ${escape(snapshot.kind.toUpperCase())}</strong><p>${escape(snapshot.absolutePath)}</p>
    <p>来源：读取时的磁盘快照，修改来源未判定；不代表历史产物版本。</p>
    <p>内容版本：${escape(snapshot.version)} · ${snapshot.bytes} 字节 · ${new Date(snapshot.checkedAt).toISOString()}</p>
    <p>${escape(rendered.summary)}；可见时每两秒及聚焦复验，非 OS 锁。原件通过上方“原件”菜单单独核验打开。</p>
    <p>脚本、网络、导航、弹窗、文件选择和内容下载关闭；滚轮／方向键滚动。${snapshot.kind === 'png' || snapshot.kind === 'jpeg' || snapshot.kind === 'pdf' ? '图像未做 OCR 脱敏；仅本机显示。' : ''}</p>
    <p role="status">${escape(notice || '读取版本已核对。')}</p></html>`
  const updateHeader = async () => {
    if (live()) {
      await window.loadURL(headerUrl).catch(() => {
        if (live()) {
          window.destroy()
        }
      })
    }
  }
  const hideContent = (message: string) => {
    if (!live() || invalid) {
      return
    }
    invalid = true
    notice = `${message} 旧内容已隐藏；请关闭后从当前文件明确重新预览。`
    for (const action of ['system', 'ide', 'reveal']) {
      const item = originalMenu?.getMenuItemById('preview-' + action)
      if (item) {
        item.enabled = false
      }
    }
    clearInterval(interval)
    window.contentView.removeChildView(view)
    if (!contents.isDestroyed()) {
      contents.close({ waitForBeforeUnload: false })
    }
    void updateHeader()
  }
  const check = async () => {
    if (!live() || invalid || checking || !window.isVisible() || window.isMinimized()) {
      return
    }
    checking = true
    try {
      await reverify()
    } catch (error) {
      hideContent(error instanceof Error ? error.message : '文件校验失败。')
    } finally {
      checking = false
    }
  }
  const original = async (action: ExternalFileInput['action']) => {
    if (!live() || invalid || opening) {
      return
    }
    opening = true
    try {
      await reverify()
      if (!live() || invalid) {
        return
      }
      const result = await openOriginal(action, () => live() && !invalid)
      if (!live() || invalid) {
        return
      }
      notice = result.message
      if (result.status === 'failed') {
        await check()
      }
      await updateHeader()
    } catch (error) {
      hideContent(error instanceof Error ? error.message : '原件校验失败。')
    } finally {
      opening = false
    }
  }
  const originalMenu = Menu.buildFromTemplate([
    {
      label: '原件',
      submenu: [
        {
          id: 'preview-system',
          label: '核验并用系统应用打开原件',
          enabled: systemOpenAllowed(snapshot.path),
          click: () => {
            void original('system')
          },
        },
        {
          id: 'preview-ide',
          label: '核验并用 IDE 打开原件',
          click: () => {
            void original('ide')
          },
        },
        {
          id: 'preview-reveal',
          label: '核验并在文件管理器定位原件',
          click: () => {
            void original('reveal')
          },
        },
      ],
    },
    { label: '关闭预览', click: () => window.close() },
    {
      label: '外观',
      submenu: [
        {
          id: 'preview-light',
          label: '浅色顶部',
          type: 'radio',
          click: () => {
            appearance = 'light'
            void updateHeader()
          },
        },
        {
          id: 'preview-dark',
          label: '深色顶部',
          type: 'radio',
          click: () => {
            appearance = 'dark'
            void updateHeader()
          },
        },
        {
          label: '跟随系统',
          type: 'radio',
          checked: true,
          click: () => {
            appearance = 'light dark'
            void updateHeader()
          },
        },
      ],
    },
  ])
  window.setMenu(originalMenu)
  window.once('closed', () => {
    clearInterval(interval)
    if (!contents.isDestroyed()) {
      contents.close({ waitForBeforeUnload: false })
    }
    isolated.protocol.unhandle('piw-preview')
    bytes.fill(0)
    rendered.document.fill(0)
    rendered.assets.forEach((asset) => asset.fill(0))
    void isolated.clearStorageData().catch(() => undefined)
    void isolated.closeAllConnections().catch(() => undefined)
  })
  try {
    isolated.protocol.handle('piw-preview', (request) => {
      if (request.method !== 'GET') {
        return new Response(null, { status: 403 })
      }
      if (request.url === headerUrl) {
        return new Response(header(), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': csp,
            'Cache-Control': 'no-store',
          },
        })
      }
      const index = assetUrls.indexOf(request.url)
      if (index >= 0 && !invalid) {
        return new Response(new Uint8Array(rendered.assets[index]!), {
          headers: {
            'Content-Type': 'image/png',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          },
        })
      }
      if (request.url !== contentUrl || invalid) {
        return new Response(null, { status: 403 })
      }
      return new Response(new Uint8Array(rendered.document), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': `${rendered.assets.length ? csp.replace("img-src 'none'", 'img-src piw-preview:') : csp}; sandbox`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      })
    })
    contents.on('render-process-gone', () => hideContent('预览已终止，工作台及后台任务独立运行。'))
    if (!live()) {
      throw Error('预览已取消。')
    }
    await window.loadURL(headerUrl)
    if (!live()) {
      throw Error('预览已取消。')
    }
    await contents.loadURL(contentUrl)
    await reverify()
    if (!live() || invalid) {
      throw Error('预览已取消或失效。')
    }
    window.show()
    interval = setInterval(() => {
      void check()
    }, 2000)
    window.on('focus', () => {
      void check()
    })
    return window
  } catch {
    if (!window.isDestroyed()) {
      window.destroy()
    }
    throw Error('隔离预览初始化、版本复验或加载失败，已拒绝内容；请刷新或使用 IDE／文件管理器。')
  }
}
