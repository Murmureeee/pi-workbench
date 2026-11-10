import type { FileReadInput, PreviewSnapshot } from '@pi-workbench/shared'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

import { ipcMain } from 'electron'

import { previewRequestSchema } from '@pi-workbench/shared'

import { openIsolatedPreview } from './preview-window.js'

/** Only the owner main frame can ask for a checked document. At most four captures or
 * live windows, bounded replay rejection, navigation/unmount cancellation and owner exit
 * cleanup. Preview windows have no preload and cannot invoke these handlers. */
export function registerFilePreviews(
  owner: BrowserWindow,
  origin: string,
  capture: (input: FileReadInput) => Promise<PreviewSnapshot>,
  exiting: () => boolean,
) {
  const pending = new Map<string, { cancelled: boolean }>(),
    seen = new Set<string>(),
    windows = new Set<BrowserWindow>()
  const trusted = (event: IpcMainInvokeEvent) =>
    !exiting() &&
    !owner.isDestroyed() &&
    event.sender === owner.webContents &&
    event.senderFrame === owner.webContents.mainFrame &&
    event.senderFrame !== null &&
    URL.canParse(event.senderFrame.url) &&
    new URL(event.senderFrame.url).origin === origin
  const cancel = () => {
    for (const state of pending.values()) {
      state.cancelled = true
    }
  }
  owner.webContents.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => {
    if (mainFrame) {
      cancel()
    }
  })
  ipcMain.handle('piw:preview-file', async (event, ...args: unknown[]) => {
    const parsed = previewRequestSchema.safeParse(args[0])
    if (!trusted(event) || args.length !== 1 || !parsed.success) {
      return { status: 'failed', message: '预览请求无效；请从当前授权文件重新选择。' }
    }
    const q = parsed.data
    if (seen.has(q.id) || pending.size + windows.size >= 4) {
      return {
        status: 'failed',
        message: '请求已处理或四个预览名额已满；请关闭一个预览后重新点击。',
      }
    }
    seen.add(q.id)
    if (seen.size > 512) {
      seen.delete(seen.values().next().value!)
    }
    const state = { cancelled: false }
    pending.set(q.id, state)
    const active = () => !state.cancelled && !exiting() && !owner.isDestroyed()
    let preview: BrowserWindow | undefined
    try {
      const snapshot = await capture(q.input)
      if (!active()) {
        return { status: 'cancelled', message: '预览已取消，未加载内容。' }
      }
      if (JSON.stringify(snapshot.target) !== JSON.stringify(q.input.target)) {
        throw Error('预览目标不匹配，已拒绝加载。')
      }
      preview = await openIsolatedPreview(snapshot, active)
      if (!active()) {
        preview.destroy()
        return { status: 'cancelled', message: '预览已取消。' }
      }
      windows.add(preview)
      preview.once('closed', () => windows.delete(preview!))
      return {
        status: 'requested',
        message: '已在独立窗口加载隔离静态预览；内容脚本和外部访问关闭。',
      }
    } catch (error) {
      if (preview && !preview.isDestroyed()) {
        preview.destroy()
      }
      if (!active()) {
        return { status: 'cancelled', message: '预览已取消，未保留窗口。' }
      }
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : '预览不可用，请刷新或使用原件入口。',
      }
    } finally {
      pending.delete(q.id)
    }
  })
  ipcMain.handle('piw:cancel-preview', (event, ...args: unknown[]) => {
    const id = previewRequestSchema.shape.id.safeParse(args[0])
    if (!trusted(event) || args.length !== 1 || !id.success) {
      return false
    }
    const state = pending.get(id.data)
    if (state) {
      state.cancelled = true
    }
    return true
  })
  owner.once('closed', () => {
    cancel()
    for (const preview of windows) {
      if (!preview.isDestroyed()) {
        preview.destroy()
      }
    }
    ipcMain.removeHandler('piw:preview-file')
    ipcMain.removeHandler('piw:cancel-preview')
  })
}
