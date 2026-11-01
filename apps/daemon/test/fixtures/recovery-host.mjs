// Test-only actual daemon + actual SDK + local HTTP model. No provider credentials or tools.
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import { createApp } from '../../dist/bootstrap/app.js'
import { KernelService } from '../../dist/modules/kernels/kernel.service.js'
import { SessionStore } from '../../dist/modules/sessions/session.store.js'

const dataDir = process.argv[2]
const app = await createApp({ dataDir, port: 4338 })
const kernels = app.get(KernelService)
const store = app.get(SessionStore)
const sessionId = randomUUID(),
  turnId = randomUUID()
const kernel = await kernels.open(sessionId, dataDir)
const epoch = kernel.snapshot.epoch
const delta = new Promise((resolve) =>
  kernel.subscribe((message) => {
    if (message.type === 'delta') {
      resolve()
    }
  }),
)
const run = kernels.prompt(sessionId, dataDir, {
  turnId,
  text: '真实 SDK 硬杀恢复夹具',
  fixture: 'hold',
})
void run.catch(() => undefined)
await delta
const identity = { sessionId, epoch, turnId, source: 'synthetic-fixture' }
store.saveQueue({
  ...identity,
  id: randomUUID(),
  kind: 'follow-up',
  position: 0,
  text: '合成排队记录，不会自动执行',
  status: 'queued',
})
store.saveApproval({
  ...identity,
  id: randomUUID(),
  parameters: { command: 'synthetic-only' },
  decision: 'pending',
  reason: '合成未决审批',
})
store.saveApproval({
  ...identity,
  id: randomUUID(),
  parameters: {},
  decision: 'allowed',
  reason: '合成历史允许，仅审计',
})
store.saveChangeReference({
  ...identity,
  id: randomUUID(),
  reference: 'synthetic-ledger:baseline-1',
})
await delay(1650)
process.send?.({
  type: 'ready',
  sessionId,
  turnId,
  epoch,
  sessionFile: kernel.snapshot.sessionFile,
  kernelPid: kernel.snapshot.pid,
})
process.on('message', (message) => {
  if (message === 'crash') {
    // Kill SDK first and then daemon in the same tick: no abort/dispose/finally hooks can flush.
    process.kill(kernel.snapshot.pid, 'SIGKILL')
    process.kill(process.pid, 'SIGKILL')
  }
})
process.on('disconnect', () => {
  void app.close()
})
