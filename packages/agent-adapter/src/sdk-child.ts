import type { KernelCommand, KernelIdentity, KernelMessage } from './kernel-protocol.js'
import type { createOfflineRuntime } from './sdk-runtime.js'
import type { ModelRequest, Reasoning } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { mergeReasoning, publicReasoning } from '@pi-workbench/shared'

import { kernelCommandSchema } from './kernel-protocol.js'
import { ToolObserver } from './tool-observer.js'

let identity: KernelIdentity | undefined
let runtime: Awaited<ReturnType<typeof createOfflineRuntime>> | undefined
let currentTurn: string | null = null
let run: Promise<void> | undefined
let seq = 0
let closing = false
let unsubscribe: (() => void) | undefined
let unsubscribeBoundary: (() => void) | undefined
let boundary:
  | { id: string; resolve: (item: { id: string; text: string } | null) => void }
  | undefined
let deliveredInput: { id: string; timestamp: number } | undefined
let queueEnabled = false
const tools = new ToolObserver(process.cwd())
let reasoning: Reasoning | undefined
let modelRequest: ModelRequest = {
  attempts: 0,
  retryCount: 0,
  retryLimit: 0,
  state: 'requesting',
  waitUntil: null,
  error: null,
}

type Payload = KernelMessage extends infer Message
  ? Message extends KernelMessage
    ? Omit<Message, keyof KernelIdentity | 'seq' | 'turnId'>
    : never
  : never

function send(payload: Payload, turnId = currentTurn) {
  if (!identity || !process.connected) {
    return
  }
  process.send?.({ ...identity, seq: ++seq, turnId, ...payload })
}

/** Stop work before acknowledging disposal; IPC loss also revokes the runtime. */
async function dispose() {
  if (closing) {
    return
  }
  closing = true
  boundary?.resolve(null)
  if (runtime) {
    await runtime.session.abort()
    await run
    unsubscribe?.()
    unsubscribeBoundary?.()
    runtime.session.dispose()
    await runtime.provider.close()
  }
  send({ type: 'disposed' })
  if (process.connected) {
    process.disconnect()
  }
}

async function handle(command: KernelCommand) {
  if (closing) {
    throw new Error('Kernel is disposing')
  }
  if (command.type === 'init') {
    if (identity) {
      throw new Error('Duplicate initialization')
    }
    identity = { protocol: 1, sessionId: command.sessionId, epoch: command.epoch }
    const { createOfflineRuntime: create } = await import('./sdk-runtime.js')
    runtime = await create(command.cwd, command.runtimeDir, command.resume, () => {
      modelRequest = {
        ...modelRequest,
        attempts: (modelRequest.attempts ?? 0) + 1,
        state: 'requesting',
        waitUntil: null,
        error: null,
      }
      send({ type: 'model', modelRequest })
    })
    if (closing || !process.connected) {
      // Parent disappeared during initialization; this process must not become an orphan.
      runtime.session.dispose()
      await runtime.provider.close()
      return
    }
    unsubscribe = runtime.session.subscribe((event) => {
      if (
        event.type === 'message_start' &&
        event.message.role === 'user' &&
        deliveredInput &&
        event.message.timestamp === deliveredInput.timestamp
      ) {
        send({ type: 'queue-delivered', id: deliveredInput.id })
        deliveredInput = undefined
      }
      if (event.type === 'auto_retry_start') {
        modelRequest = {
          ...modelRequest,
          retryCount: event.attempt,
          retryLimit: event.maxAttempts,
          state: 'waiting',
          waitUntil:
            Number.isFinite(event.delayMs) && event.delayMs >= 0
              ? Date.now() + Math.ceil(event.delayMs)
              : null,
          error: event.errorMessage.slice(0, 65536),
        }
        send({ type: 'model', modelRequest })
      }
      if (event.type === 'auto_retry_end') {
        modelRequest = {
          ...modelRequest,
          state: 'requesting',
          waitUntil: null,
          error: event.finalError?.slice(0, 65536) ?? null,
        }
        send({ type: 'model', modelRequest })
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        reasoning = mergeReasoning(
          reasoning,
          publicReasoning(event.message.content, runtime?.session.model?.reasoning),
        )
        send({ type: 'reasoning', reasoning })
      }
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        send({ type: 'delta', text: event.assistantMessageEvent.delta })
      } else {
        const tool = tools.observe(event)
        if (tool) {
          const { id, ...observation } = tool
          send({ type: 'tool', toolId: id, ...observation })
        }
      }
    })
    // Agent listeners are awaited. The installed SDK emits turn_end after tools, before
    // draining steering input. Hold this boundary for the daemon's immutable selection;
    // follow-up never enters the SDK's uncheckpointed continuation queue.
    unsubscribeBoundary = runtime.session.agent.subscribe(async (event, signal) => {
      if (
        !queueEnabled ||
        event.type !== 'turn_end' ||
        signal.aborted ||
        event.message.role !== 'assistant' ||
        event.message.stopReason === 'error' ||
        event.message.stopReason === 'aborted'
      ) {
        return
      }
      const id = randomUUID()
      let timer: ReturnType<typeof setTimeout> | undefined
      const item = await new Promise<{ id: string; text: string } | null>((resolve, reject) => {
        boundary = { id, resolve }
        timer = setTimeout(
          () => reject(new Error('Host input boundary timed out; no input replayed')),
          10000,
        )
        send({ type: 'queue-boundary', boundaryId: id })
      }).finally(() => {
        clearTimeout(timer)
        boundary = undefined
      })
      if (!item || signal.aborted || closing) {
        return
      }
      deliveredInput = { id: item.id, timestamp: Date.now() }
      runtime?.session.agent.steer({
        role: 'user',
        content: [{ type: 'text', text: item.text }],
        timestamp: deliveredInput.timestamp,
      })
    })
    const sessionFile = runtime.session.sessionFile
    if (
      !sessionFile ||
      process.cwd() !== command.cwd ||
      runtime.session.sessionManager.getCwd() !== command.cwd
    ) {
      throw new Error('Native sessionFile or actual cwd binding mismatch')
    }
    send({
      type: 'ready',
      pid: process.pid,
      cwd: process.cwd(),
      sessionFile,
      nativeSessionId: runtime.session.sessionId,
      guard: {
        version: 1,
        mode: 'deny-all',
        activeTools: [],
        extensionsEnabled: false,
        realProviderEnabled: false,
      },
    })
    return
  }
  if (
    !identity ||
    !runtime ||
    command.sessionId !== identity.sessionId ||
    command.epoch !== identity.epoch
  ) {
    throw new Error('Runtime identity or readiness mismatch')
  }
  if (command.type === 'dispose') {
    if (currentTurn && command.turnId !== currentTurn) {
      throw new Error('Disposal turn mismatch')
    }
    await dispose()
  } else if (command.type === 'queue-boundary') {
    if (command.turnId === currentTurn && command.boundaryId === boundary?.id) {
      boundary.resolve(command.item)
    }
  } else if (command.type === 'abort') {
    if (command.turnId !== currentTurn || !run) {
      throw new Error('Abort turn mismatch')
    }
    boundary?.resolve(null)
    runtime.session.agent.clearAllQueues()
    await runtime.session.abort()
  } else {
    if (run) {
      throw new Error('A turn is already running')
    }
    currentTurn = command.turnId
    queueEnabled = command.inputQueue
    deliveredInput = undefined
    tools.reset()
    reasoning = undefined
    modelRequest = {
      attempts: 0,
      retryCount: 0,
      retryLimit: 0,
      state: 'requesting',
      waitUntil: null,
      error: null,
    }
    const activeRuntime = runtime
    if (
      activeRuntime.session.getActiveToolNames().length ||
      activeRuntime.session.agent.state.tools.length
    ) {
      throw new Error('Execution guard changed')
    }
    activeRuntime.setTrustedContext(command.trustedContext)
    activeRuntime.provider.prepare(command.fixture)
    // SDK-owned metadata binds native entries to the workbench turn without entering model context.
    activeRuntime.session.sessionManager.appendCustomEntry('pi-workbench.turn.v1', {
      version: 1,
      sessionId: identity.sessionId,
      epoch: identity.epoch,
      turnId: command.turnId,
      messageId: `${command.turnId}:assistant`,
    })
    send({ type: 'running' })
    send({ type: 'model', modelRequest })
    run = (async () => {
      let outcome: 'completed' | 'aborted' | 'error' = 'completed'
      let error: string | undefined
      try {
        await activeRuntime.session.prompt(command.text)
        const last = activeRuntime.session.agent.state.messages.at(-1)
        if (
          last?.role === 'assistant' &&
          (last.stopReason === 'aborted' || last.stopReason === 'error')
        ) {
          outcome = last.stopReason
          error = last.errorMessage
        }
      } catch (failure) {
        outcome = 'error'
        error = failure instanceof Error ? failure.message : 'SDK prompt failed'
      }
      modelRequest = {
        ...modelRequest,
        state: 'settled',
        waitUntil: null,
        error: error?.slice(0, 65536) ?? null,
      }
      send({ type: 'model', modelRequest })
      send({
        type: 'finished',
        outcome,
        ...(error ? { error } : {}),
        ...activeRuntime.provider.stats(),
      })
      currentTurn = null
      activeRuntime.session.agent.clearAllQueues()
      run = undefined
    })()
  }
}

function fatal(failure: unknown) {
  send({
    type: 'fatal',
    error: failure instanceof Error ? failure.message : 'Kernel protocol failure',
  })
  void dispose().catch(() => {
    process.exitCode = 1
  })
}

process.on('message', (message: unknown) => {
  const parsed = kernelCommandSchema.safeParse(message)
  if (!parsed.success) {
    fatal(new Error('Invalid kernel command'))
    return
  }
  void handle(parsed.data).catch(fatal)
})
function disconnected() {
  void dispose().catch(() => {
    process.exitCode = 1
  })
}
process.on('disconnect', disconnected)
