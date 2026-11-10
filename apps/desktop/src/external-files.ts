import type { ExternalFileInput, ExternalResult, ExternalTarget } from '@pi-workbench/shared'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

import { randomUUID } from 'node:crypto'

import { app, dialog, ipcMain, shell } from 'electron'

import { editorCommandSchema, externalFileRequestSchema } from '@pi-workbench/shared'

import { ExternalEditor } from './external-editor.js'
import { externalFailure, ExternalOpenError, verifyExternalTarget } from './external-target.js'

const cancelled = (): ExternalResult => ({
  status: 'cancelled',
  message: '操作已取消，未交付外部程序。',
})
const failed = (message: string): ExternalResult => ({ status: 'failed', message })

/** Window-owned fixed privileges only. Origin/main-frame checks, one actual operation
 * until settle, cancellation before handoff and bounded replay rejection are independent
 * of renderer view state. An already handed-off external app is never killed on cancel. */
export function registerExternalFiles(
  window: BrowserWindow,
  origin: string,
  resolveTarget: (input: ExternalFileInput) => Promise<ExternalTarget>,
  exiting: () => boolean,
) {
  const editor = new ExternalEditor(app.getPath('userData'))
  let pending: { id: string; cancelled: boolean } | undefined
  const seen = new Set<string>()
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame && pending) {
      pending.cancelled = true
    }
  })
  const trusted = (event: IpcMainInvokeEvent) =>
    !exiting() &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame !== null &&
    URL.canParse(event.senderFrame.url) &&
    new URL(event.senderFrame.url).origin === origin
  const run = async (
    id: string,
    operation: (active: () => boolean) => Promise<ExternalResult>,
    stillActive: () => boolean = () => true,
  ) => {
    if (exiting() || window.isDestroyed() || !stillActive()) {
      return cancelled()
    }
    if (pending) {
      return failed('另一个外部操作尚未结束；请先完成或取消，再重试。')
    }
    if (seen.has(id)) {
      return failed('该操作已处理；请重新点击，不复用旧打开请求。')
    }
    seen.add(id)
    if (seen.size > 512) {
      seen.delete(seen.values().next().value!)
    }
    const operationState = { id, cancelled: false }
    pending = operationState
    const active = () =>
      pending === operationState &&
      !operationState.cancelled &&
      !exiting() &&
      !window.isDestroyed() &&
      stillActive()
    try {
      return await operation(active)
    } catch (error) {
      return active() ? failed(externalFailure(error)) : cancelled()
    } finally {
      if (pending === operationState) {
        pending = undefined
      }
    }
  }
  ipcMain.handle('piw:editor-status', async (event, ...args: unknown[]) => {
    if (!trusted(event) || args.length !== 0) {
      return null
    }
    return editor.status()
  })
  ipcMain.handle('piw:configure-editor', async (event, ...args: unknown[]) => {
    const parsed = editorCommandSchema.safeParse(args[0])
    if (!trusted(event) || args.length !== 1 || !parsed.success) {
      return failed('编辑器选择请求无效；请在工作台重新操作。')
    }
    const q = parsed.data
    return run(q.id, async (active) => {
      if (q.adapter === 'auto') {
        if (!active()) {
          return cancelled()
        }
        await editor.reset()
        return { status: 'saved', message: '已恢复 VS Code 自动发现；尚未打开文件。' }
      }
      const selected = await dialog.showOpenDialog(window, {
        title: '选择已安装的外部编辑器',
        buttonLabel: '选择此程序',
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: '可执行程序', extensions: ['exe'] }],
      })
      if (selected.canceled || !selected.filePaths[0] || !active()) {
        return cancelled()
      }
      return (await editor.select(selected.filePaths[0], q.adapter, active))
        ? { status: 'saved', message: '编辑器选择已保存；单独点击打开才启动程序。' }
        : cancelled()
    })
  })
  const open = (q: { id: string; input: ExternalFileInput }, stillActive?: () => boolean) => {
    return run(
      q.id,
      async (active) => {
        const target = await resolveTarget(q.input)
        if (!active()) {
          return cancelled()
        }
        if (target.action !== q.input.action || target.line !== q.input.line) {
          throw new ExternalOpenError('宿主返回的目标不匹配；请重新连接后重试。')
        }
        if (target.action === 'ide') {
          return (await editor.open(target, active))
            ? { status: 'requested', message: '已请求 IDE 打开核验后的路径；外部应用独立运行。' }
            : cancelled()
        }
        const absolute = await verifyExternalTarget(target)
        if (!active()) {
          return cancelled()
        }
        if (target.action === 'reveal') {
          shell.showItemInFolder(absolute)
          return { status: 'requested', message: '已请求文件管理器定位；请在系统窗口核对结果。' }
        }
        const error = await shell.openPath(absolute)
        if (error) {
          return failed('系统关联打开失败；请检查关联程序，或选择 IDE／文件管理器。')
        }
        return { status: 'requested', message: '系统已接收打开请求；外部应用独立运行。' }
      },
      stillActive,
    )
  }
  ipcMain.handle('piw:external-file', async (event, ...args: unknown[]) => {
    const parsed = externalFileRequestSchema.safeParse(args[0])
    if (!trusted(event) || args.length !== 1 || !parsed.success) {
      return failed('外部打开请求无效；请从授权文件重新选择。')
    }
    return open(parsed.data)
  })
  ipcMain.handle('piw:cancel-external', (event, ...args: unknown[]) => {
    const id = editorCommandSchema.shape.id.safeParse(args[0])
    if (!trusted(event) || args.length !== 1 || !id.success) {
      return false
    }
    if (pending?.id === id.data) {
      pending.cancelled = true
    }
    return true
  })
  window.once('closed', () => {
    if (pending) {
      pending.cancelled = true
    }
    for (const channel of [
      'piw:editor-status',
      'piw:configure-editor',
      'piw:external-file',
      'piw:cancel-external',
    ]) {
      ipcMain.removeHandler(channel)
    }
  })
  // Host-only native preview menu reuses exactly the same single-operation lane and
  // revalidation. No new content IPC or privilege is exposed to preview renderers.
  return (input: ExternalFileInput, active: () => boolean) =>
    open({ id: randomUUID(), input }, active)
}
