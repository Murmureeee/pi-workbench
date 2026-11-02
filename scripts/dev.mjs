// @env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { createServer } from 'vite'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { readOptions } from '../apps/daemon/dist/bootstrap/options.js'
import { AccessService } from '../apps/daemon/dist/modules/security/access.service.js'
import { pairingConsole } from '../apps/daemon/dist/modules/security/host-access.js'
import { hostAccessRequestSchema } from '../packages/shared/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const options = readOptions({
  ...process.env,
  PIW_DATA_DIR: process.env.PIW_DATA_DIR || resolve(root, '.workbench/dev'),
})
const daemon = await createApp({ ...options, development: true })
/** @type {import('vite').ViteDevServer | undefined} */
let server
/** @type {import('node:child_process').ChildProcess | undefined} */
let desktop
/** @type {Promise<void> | undefined} */
let closing
const closeConsole = pairingConsole(daemon.get(AccessService))
async function close() {
  if (closing) {
    return closing
  }
  closing = (async () => {
    closeConsole()
    desktop?.kill()
    await server?.close()
    await daemon.close()
    if (process.connected) {
      process.disconnect()
    }
  })()
  return closing
}
process.once('SIGINT', () => {
  void close()
})
process.once('SIGTERM', () => {
  void close()
})
if (process.send) {
  process.on('message', (message) => {
    if (message === 'shutdown') {
      void close()
    }
  })
}
try {
  await daemon.listen(options.port, '127.0.0.1')
  server = await createServer({
    root: resolve(root, 'apps/web'),
    configFile: resolve(root, 'apps/web/vite.config.ts'),
  })
  await server.listen()
  console.log('Pi Workbench http://127.0.0.1:5173; offline fake kernel; no model calls')
  if (process.argv.includes('--desktop')) {
    const desktopRequire = createRequire(resolve(root, 'apps/desktop/package.json'))
    /** @type {unknown} */
    const electronPath = desktopRequire('electron')
    if (typeof electronPath !== 'string') {
      throw new Error('Electron executable path is unavailable')
    }
    const desktopEnvironment = { ...process.env }
    delete desktopEnvironment.ELECTRON_RUN_AS_NODE
    desktop = spawn(electronPath, [resolve(root, 'apps/desktop')], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      // Electron is the visible product window; hiding its startup window suppresses the
      // native UI on Windows. Background SDK/helper processes remain hidden separately.
      windowsHide: false,
      env: desktopEnvironment,
    })
    desktop.on('message', (message) => {
      const parsed = hostAccessRequestSchema.safeParse(message)
      if (!parsed.success || !desktop?.connected) {
        return
      }
      try {
        desktop.send({
          type: 'host-access-result',
          id: parsed.data.id,
          apiOrigin: `http://127.0.0.1:${options.port}`,
          ticket: daemon.get(AccessService).issueTicket(parsed.data.operation),
        })
      } catch {
        // No raw native IPC payload or ticket is ever written to diagnostic output.
        process.stderr.write('Host client authorization unavailable\n')
      }
    })
    desktop.once('error', () => {
      process.exitCode = 1
      void close()
    })
    desktop.once('exit', () => {
      void close()
    })
  }
} catch (error) {
  await close()
  throw error
}
