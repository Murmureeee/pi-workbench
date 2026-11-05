import type { KernelCommand, KernelIdentity, KernelMessage } from './kernel-protocol.js'
import type { createOfflineRuntime } from './sdk-runtime.js'
import type { Reasoning } from '@pi-workbench/shared'

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
const tools = new ToolObserver(process.cwd())
let reasoning: Reasoning | undefined

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
  if (runtime) {
    await runtime.session.abort()
    await run
    unsubscribe?.()
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
    runtime = await create(command.cwd, command.runtimeDir, command.resume)
    if (closing || !process.connected) {
      // Parent disappeared during initialization; this process must not become an orphan.
      runtime.session.dispose()
      await runtime.provider.close()
      return
    }
    unsubscribe = runtime.session.subscribe((event) => {
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
  } else if (command.type === 'abort') {
    if (command.turnId !== currentTurn || !run) {
      throw new Error('Abort turn mismatch')
    }
    await runtime.session.abort()
  } else {
    if (run) {
      throw new Error('A turn is already running')
    }
    currentTurn = command.turnId
    tools.reset()
    reasoning = undefined
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
      send({
        type: 'finished',
        outcome,
        ...(error ? { error } : {}),
        ...activeRuntime.provider.stats(),
      })
      currentTurn = null
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
