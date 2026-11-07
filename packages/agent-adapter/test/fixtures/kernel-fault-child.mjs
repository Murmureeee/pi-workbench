// Synthetic IPC faults only. This process never imports pi or represents SDK evidence.
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import process from 'node:process'

import { kernelCommandSchema } from '../../dist/kernel-protocol.js'

/** @type {Extract<import('../../dist/kernel-protocol.js').KernelCommand, { type: 'init' }> | undefined} */
let init
let seq = 0
let mode = ''
let previousTurn = ''
/** @param {string} type @param {Record<string, unknown>} payload @param {string | null} turnId */
function emit(type, payload = {}, turnId = null) {
  if (!init) {
    throw new Error('Fault fixture not initialized')
  }
  process.send?.({
    protocol: 1,
    sessionId: init.sessionId,
    epoch: init.epoch,
    seq: ++seq,
    turnId,
    type,
    ...payload,
  })
}
process.on('message', (/** @type {unknown} */ message) => {
  const command = kernelCommandSchema.parse(message)
  if (command.type === 'init') {
    init = command
    mode = basename(init.runtimeDir)
    if (mode === 'no-handshake') {
      return
    }
    if (mode === 'invalid-json') {
      process.send?.('bad')
      return
    }
    /** @type {Record<string, Record<string, unknown>>} */
    const overrides = {
      'bad-guard': { guard: { version: 1, mode: 'allow-all', activeTools: ['bash'] } },
      'wrong-session': { sessionId: randomUUID() },
      'wrong-epoch': { epoch: randomUUID() },
      'bad-cwd': { cwd: 'wrong' },
      'bad-path': { sessionFile: join(init.cwd, 'outside.jsonl') },
      'bad-pid': { pid: 1 },
      'bad-sequence': { seq: 10 },
      'bad-version': { protocol: 2 },
    }
    emit('ready', {
      pid: process.pid,
      cwd: init.cwd,
      sessionFile: join(init.runtimeDir, 'sessions', 'fake.jsonl'),
      nativeSessionId: randomUUID(),
      guard: {
        version: 1,
        settlement: 'host-ack-v1',
        mode: 'deny-all',
        activeTools: [],
        extensionsEnabled: false,
        realProviderEnabled: false,
      },
      ...overrides[mode],
    })
  } else if (command.type === 'prompt') {
    if (mode === 'crash') {
      process.exitCode = 17
      process.disconnect()
      return
    }
    if (mode === 'disconnect') {
      setInterval(() => {}, 1000)
      process.disconnect()
      return
    }
    emit('running', {}, command.turnId)
    emit('delta', { text: 'synthetic-fault-fixture' }, command.turnId)
    if (mode === 'duplicate-delta') {
      emit('delta', { text: 'duplicate', seq }, command.turnId)
    }
    if (mode === 'gap-delta') {
      emit('delta', { text: 'gap', seq: seq + 2 }, command.turnId)
    }
    if (mode === 'wrong-turn-delta') {
      emit('delta', { text: 'wrong turn' }, randomUUID())
    }
    if (mode === 'late-finished' && previousTurn) {
      emit(
        'finished',
        { outcome: 'completed', localRequests: 0, blockedNetworkAttempts: 0 },
        previousTurn,
      )
      return
    }
    if (mode === 'hang-abort' || mode === 'hang-dispose') {
      return
    }
    emit(
      'finished',
      {
        outcome: mode === 'unknown-outcome' ? 'unrecognized' : 'completed',
        localRequests: 0,
        blockedNetworkAttempts: 0,
      },
      mode === 'stale-turn' ? randomUUID() : command.turnId,
    )
    previousTurn = command.turnId
  } else if (command.type === 'dispose') {
    if (mode === 'hang-dispose') {
      return
    }
    if (mode === 'missing-dispose-ack') {
      process.disconnect()
      return
    }
    emit('disposed')
    process.disconnect()
  }
})
