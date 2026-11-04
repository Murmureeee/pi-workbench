import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect } from '@playwright/test'

import { createApp } from '../../apps/daemon/dist/bootstrap/app.js'
import { EventService } from '../../apps/daemon/dist/modules/events/event.service.js'
import { KernelService } from '../../apps/daemon/dist/modules/kernels/kernel.service.js'
import { SessionService } from '../../apps/daemon/dist/modules/sessions/session.service.js'
import { SessionStore } from '../../apps/daemon/dist/modules/sessions/session.store.js'
import { launchWorkspaceDesktop } from './desktop.js'

/** Actual Electron/SQLite/SDK through the local SSE fixture. Only fixture selection is
 * injected in the host; the renderer still sends via the production daemon/CSRF boundary. */
export async function renderingDesktop(modelTasks = 1) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-render-ui-'))
  const app = await createApp({
    dataDir: join(directory, 'data'),
    port: 4318,
    development: true,
    resourceLimits: { modelTasks },
  })
  await app.listen(4318, '127.0.0.1')
  const kernels = app.get(KernelService),
    original = kernels.prompt.bind(kernels)
  let prompts = 0
  kernels.prompt = (id, cwd, input, options) => {
    prompts++
    return original(
      id,
      cwd,
      {
        ...input,
        fixture: input.text.includes('持续滚动')
          ? 'scrolling'
          : input.text.includes('保持运行')
            ? 'hold'
            : input.text.includes('长内容')
              ? 'rendering-long'
              : 'rendering',
      },
      options,
    )
  }
  const desktop = await launchWorkspaceDesktop(directory, app)
  // REST and the real TCP event stream must observe the same isolated daemon.
  await desktop.context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const endpoint = new URL(url)
        if (endpoint.pathname === '/api/events') {
          endpoint.port = '4318'
        }
        super(endpoint, protocols)
      }
    }
  })
  await desktop.page.reload()
  const store = app.get(SessionStore)
  const send = async (text: string) => {
    const before = store.managedSessions().length
    await desktop.page.getByRole('textbox', { name: '任务内容' }).fill(text)
    await desktop.page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect.poll(() => store.managedSessions().length).toBe(before + 1)
    const session = store.managedSessions().find((s) => s.title === text)
    if (!session) {
      throw new Error('Missing rendering session')
    }
    await expect
      .poll(() => store.submissions(session.id)[0]?.status, { timeout: 20000 })
      .toBe('completed')
    const pane = desktop.page.locator('.retained-session:not([hidden])')
    await expect(pane.getByLabel('任务状态')).toHaveText('本轮已结束')
    await expect(pane.getByLabel('会话同步状态')).toHaveText('已同步')
    return session
  }
  return {
    desktop,
    sessions: app.get(SessionService),
    events: app.get(EventService),
    kernels,
    store,
    directory,
    send,
    prompts: () => prompts,
    close: async () => {
      await desktop.close()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
