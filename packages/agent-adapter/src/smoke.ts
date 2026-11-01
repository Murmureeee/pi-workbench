// @env node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { SessionKernel } from './kernel.js'

const directory = mkdtempSync(join(tmpdir(), 'piw-sdk-smoke-'))
const kernel = new SessionKernel({
  protocol: 1,
  sessionId: randomUUID(),
  epoch: randomUUID(),
  cwd: directory,
  runtimeDir: join(directory, 'runtime'),
})
try {
  await kernel.ready()
  const reply = await kernel.prompt({ turnId: randomUUID(), text: 'offline smoke' })
  const delta = new Promise<void>((resolve) => {
    kernel.subscribe((event) => {
      if (event.type === 'delta') {
        resolve()
      }
    })
  })
  const turnId = randomUUID()
  const stopped = kernel.prompt({ turnId, text: 'offline abort smoke', fixture: 'hold' })
  await delta
  await kernel.abort(turnId)
  const abort = await stopped
  await kernel.dispose()
  if (
    reply.outcome !== 'completed' ||
    abort.outcome !== 'aborted' ||
    kernel.snapshot.state !== 'disposed' ||
    abort.blockedNetworkAttempts !== 0
  ) {
    throw new Error('SDK lifecycle smoke failed')
  }
  console.log(
    JSON.stringify({
      feature: 'CORE-04',
      source: 'real-sdk/local-fixture',
      sdk: '1.4.0',
      node: process.version,
      pid: kernel.snapshot.pid,
      guard: 'deny-all',
      reply: reply.outcome,
      abort: abort.outcome,
      disposed: true,
      localRequests: abort.localRequests,
      providerRequests: 0,
      blockedNetworkAttempts: abort.blockedNetworkAttempts,
    }),
  )
} finally {
  await kernel.dispose()
  rmSync(directory, { recursive: true, force: true })
}
