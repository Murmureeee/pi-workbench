// Disposable host: an abrupt daemon exit must not leave its real SDK child behind.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import process from 'node:process'

import { z } from 'zod'

import { SessionKernel } from '../../dist/kernel.js'

/** @param {unknown} message */
async function start(message) {
  const { directory } = z.object({ directory: z.string() }).parse(message)
  const kernel = new SessionKernel({
    protocol: 1,
    sessionId: randomUUID(),
    epoch: randomUUID(),
    cwd: directory,
    runtimeDir: join(directory, 'runtime'),
  })
  await kernel.ready()
  const turnId = randomUUID()
  kernel.subscribe((event) => {
    if (event.type === 'delta') {
      // Intentionally simulate abrupt host loss, without calling dispose.
      process.send?.({ sdkPid: kernel.snapshot.pid }, () => {
        process.exit(0)
      })
    }
  })
  await kernel.prompt({ turnId, text: 'orphan cleanup fixture', fixture: 'hold' })
}
process.once('message', (message) => {
  void start(message).catch(() => {
    process.exitCode = 1
    process.disconnect()
  })
})
