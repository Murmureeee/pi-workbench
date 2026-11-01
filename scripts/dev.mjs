// @env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { createServer } from 'vite'

import { createApp } from '../apps/daemon/dist/bootstrap/app.js'
import { readOptions } from '../apps/daemon/dist/bootstrap/options.js'

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
async function close() {
  if (closing) {
    return closing
  }
  closing = (async () => {
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
      stdio: 'inherit',
      windowsHide: true,
      env: desktopEnvironment,
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
