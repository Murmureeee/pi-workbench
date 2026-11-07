import type { createApp } from '../../apps/daemon/dist/bootstrap/app.js'

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, expect } from '@playwright/test'

import { AccessService } from '../../apps/daemon/dist/modules/security/access.service.js'
import { hostAccessRequestSchema } from '../../packages/shared/dist/index.js'

/** Actual Electron main/preload, SEC-08 parent IPC, native cookie store, renderer and daemon.
 * Only the OS dialog result is an explicit fixture for deterministic CI. Native dialog input
 * is separately checked with Windows computer use; this helper never emulates model work.
 */
export async function launchWorkspaceDesktop(
  directory: string,
  app: Awaited<ReturnType<typeof createApp>>,
) {
  const requireDesktop = createRequire(resolve('apps/desktop/package.json'))
  const electronPath: unknown = requireDesktop('electron')
  if (typeof electronPath !== 'string') {
    throw new Error('Electron path unavailable')
  }
  const driver = join(directory, 'desktop-driver.cjs')
  writeFileSync(
    driver,
    `const { app, dialog } = require('electron');
let selection = null;
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', () => process.send({type: 'renderer-ready'}));
});
dialog.showOpenDialog = async () => selection ? {canceled: false, filePaths: [selection]} : {canceled: true, filePaths: []};
process.on('message', message => {
  if (message === 'quit') app.quit();
  if (message && message.type === 'selection') {selection = message.path; process.send({selected: message.path});}
});
void import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/dist/main.js')).href)});\n`,
  )
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(
    electronPath,
    [driver, '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'profile')}`],
    {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      env: environment,
    },
  )
  const exited = new Promise<number | null>((done) => child.once('exit', done))
  let endpoint = '',
    diagnostics = '',
    rendererReady = false,
    selected: unknown
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-16000)
    endpoint ||=
      chunk.toString().match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1] ?? ''
  })
  child.stdout?.resume()
  child.on('message', (message: unknown) => {
    const request = hostAccessRequestSchema.safeParse(message)
    if (request.success && child.connected) {
      child.send({
        type: 'host-access-result',
        id: request.data.id,
        apiOrigin: 'http://127.0.0.1:4318',
        ticket: app.get(AccessService).issueTicket(request.data.operation),
      })
    } else if (message && typeof message === 'object') {
      if ('selected' in message) {
        selected = message.selected
      }
      if ('type' in message && message.type === 'renderer-ready') {
        rendererReady = true
      }
    }
  })
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  let closing = false
  const close = async () => {
    closing = true
    // Unmount pollers before removing the fixture's forwarding route. Otherwise new
    // requests can escape to the unrelated development daemon during teardown.
    await Promise.all(
      browser
        ?.contexts()
        .flatMap((context) => context.pages().map((page) => page.goto('about:blank'))) ?? [],
    )
    // Polling can still be inside route.fetch when the renderer closes. Drain those
    // callbacks before Electron disposes its request context; keep their errors visible.
    await Promise.all(
      browser
        ?.contexts()
        .flatMap((context) =>
          context.pages().map((page) => page.unrouteAll({ behavior: 'wait' })),
        ) ?? [],
    )
    await Promise.all(
      browser?.contexts().map((context) => context.unrouteAll({ behavior: 'wait' })) ?? [],
    )
    if (child.connected) {
      child.send('quit')
    }
    const timer = setTimeout(() => child.kill(), 5000)
    await exited
    clearTimeout(timer)
    await browser?.close()
  }
  try {
    await expect.poll(() => endpoint).not.toBe('')
    // Connecting CDP while Electron is creating its first target can miss that page.
    // Observe actual native load before attaching; reload after the isolated routes exist.
    await expect.poll(() => rendererReady, { timeout: 15000 }).toBe(true)
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    if (!context) {
      throw new Error('Missing Electron context')
    }
    // REST and the real TCP observation stream must share this fixture's daemon.
    // HTTP routing alone leaves WebSocket on the unrelated development instance.
    await context.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const streamUrl = new URL(url)
          if (streamUrl.pathname === '/api/events') {
            streamUrl.port = '4318'
          }
          super(streamUrl, protocols)
        }
      }
    })
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      try {
        const response = await route.fetch({
          url: `http://127.0.0.1:4318${url.pathname}${url.search}`,
          headers: {
            ...route.request().headers(),
            host: '127.0.0.1:4318',
            origin: 'http://127.0.0.1:5173',
          },
        })
        await route.fulfill({ response })
      } catch (error) {
        // Chromium can have already completed an aborted poll while the detached fetch
        // returns. Only that already-handled cancellation/fixture-exit case is expected;
        // live request failures and every other transport error still fail the test.
        if (
          error instanceof Error &&
          error.message.includes('Route is already handled') &&
          (closing || route.request().failure()?.errorText.includes('ERR_ABORTED'))
        ) {
          // The server has continued the cancelled request, but the client handler
          // still needs to complete its handling promise so unrouteAll(wait) drains.
          await route.fallback()
          return
        }
        throw error
      }
    })
    await expect.poll(() => context.pages().length, { timeout: 15000 }).toBeGreaterThan(0)
    const page = context.pages()[0]
    if (!page) {
      throw new Error('Missing Electron page')
    }
    await page.reload()
    await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible()
    return {
      page,
      context,
      close,
      setSelection: async (path: string | null) => {
        selected = undefined
        child.send({ type: 'selection', path })
        await expect.poll(() => selected).toBe(path)
      },
    }
  } catch (error) {
    await close()
    throw new Error(`Electron fixture failed (rendererReady=${rendererReady}): ${diagnostics}`, {
      cause: error,
    })
  }
}
