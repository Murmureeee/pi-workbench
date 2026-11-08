import type { KernelCommand, KernelIdentity, KernelMessage } from './kernel-protocol.js'
import type { createOfflineRuntime } from './sdk-runtime.js'
import type {
  ExecutionDecision,
  ModelRequest,
  ModelSelection,
  Reasoning,
  RunStage,
} from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { mergeReasoning, publicReasoning } from '@pi-workbench/shared'

import { FinalToolGuard } from './final-tool-guard.js'
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
let modelBoundary:
  | {
      id: string
      resolve: (choice: { revision: number; selection: ModelSelection }) => void
      reject: (error: Error) => void
    }
  | undefined
const tools = new ToolObserver(process.cwd())
let reasoning: Reasoning | undefined
let stage: RunStage | undefined
let guard: FinalToolGuard | undefined
const decisions = new Map<
  string,
  { resolve: (decision: ExecutionDecision) => void; reject: (error: Error) => void }
>()
const settlements = new Map<
  string,
  { digest: string; resolve: () => void; reject: (error: Error) => void }
>()
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

/** Stages come from actual SDK lifecycle boundaries, deduplicated across text chunks. */
function setStage(next: RunStage) {
  if (next !== stage) {
    stage = next
    send({ type: 'stage', stage: next })
  }
}

/** Stop work before acknowledging disposal; IPC loss also revokes the runtime. */
async function dispose() {
  if (closing) {
    return
  }
  closing = true
  boundary?.resolve(null)
  modelBoundary?.reject(new Error('Model boundary closed'))
  for (const pending of decisions.values()) {
    pending.reject(new Error('Final guard runtime closed'))
  }
  decisions.clear()
  for (const pending of settlements.values()) {
    pending.reject(new Error('Tool settlement runtime closed'))
  }
  settlements.clear()
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
    if (command.guarded) {
      guard = new FinalToolGuard(
        () => {
          if (!identity || !currentTurn || closing || !process.connected) {
            throw new Error('Final guard runtime unavailable')
          }
          return { ...identity, turnId: currentTurn, cwd: process.cwd() }
        },
        (request, signal) =>
          new Promise((resolve, reject) => {
            if (signal?.aborted || !process.connected) {
              reject(new Error('Final guard cancelled'))
              return
            }
            const cancel = () => {
              decisions.delete(request.id)
              reject(new Error('Final guard cancelled'))
            }
            signal?.addEventListener('abort', cancel, { once: true })
            decisions.set(request.id, {
              resolve: (decision) => {
                signal?.removeEventListener('abort', cancel)
                resolve(decision)
              },
              reject: (error) => {
                signal?.removeEventListener('abort', cancel)
                reject(error)
              },
            })
            send({ type: 'guard-request', request })
          }),
        (request) => tools.final(request.callId, request.parameters, request.parentId),
        () => setStage('executing-tools'),
        (request, succeeded) =>
          request.tool === 'read'
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                if (closing || !process.connected) {
                  reject(new Error('Tool settlement disconnected'))
                  return
                }
                settlements.set(request.id, { digest: request.digest, resolve, reject })
                send({ type: 'guard-finished', id: request.id, digest: request.digest, succeeded })
              }),
      )
    }
    const { createOfflineRuntime: create } = await import('./sdk-runtime.js')
    runtime = await create(
      command.cwd,
      command.runtimeDir,
      command.resume,
      () => {
        modelRequest = {
          ...modelRequest,
          attempts: (modelRequest.attempts ?? 0) + 1,
          state: 'requesting',
          waitUntil: null,
          error: null,
        }
        send({ type: 'model', modelRequest })
        setStage('waiting-model')
      },
      guard,
    )
    if (closing || !process.connected) {
      // Parent disappeared during initialization; this process must not become an orphan.
      runtime.session.dispose()
      await runtime.provider.close()
      return
    }
    const requestPreparation = runtime.session.agent.prepareRequest
    // This SDK hook precedes every conversational request, including tool continuations.
    // Await host intent without polling steering input or starting an extra model call.
    runtime.session.agent.prepareRequest = async (context, signal) => {
      const prepared = await requestPreparation?.(context, signal)
      const activeRuntime = runtime
      if (!activeRuntime || !currentTurn || signal?.aborted || closing) {
        throw new Error('Model request cancelled')
      }
      const id = randomUUID()
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = () => {
        if (modelBoundary?.id === id) {
          modelBoundary.reject(new Error('Model request cancelled'))
        }
      }
      const choice = await new Promise<{ revision: number; selection: ModelSelection }>(
        (resolve, reject) => {
          modelBoundary = { id, resolve, reject }
          signal?.addEventListener('abort', cancel, { once: true })
          timer = setTimeout(() => reject(new Error('Host model boundary timed out')), 10000)
          send({ type: 'model-boundary', boundaryId: id })
        },
      ).finally(() => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        modelBoundary = undefined
      })
      if (signal?.aborted || closing) {
        throw new Error('Model request cancelled')
      }
      const previous: ModelSelection = {
        model: {
          kind: 'local-fixture',
          provider: 'piw-offline',
          model:
            activeRuntime.session.model?.id === 'fixture-reasoning'
              ? 'fixture-reasoning'
              : 'fixture',
        },
        thinking: activeRuntime.session.thinkingLevel,
      }
      try {
        await activeRuntime.selectModel(choice.selection)
        activeRuntime.session.sessionManager.appendCustomEntry('pi-workbench.model.v1', {
          turnId: currentTurn,
          revision: choice.revision,
          selection: choice.selection,
        })
        send({ type: 'model-applied', boundaryId: id, ...choice, failed: false })
      } catch (error) {
        send({
          type: 'model-applied',
          boundaryId: id,
          revision: choice.revision,
          selection: previous,
          failed: true,
        })
        throw error
      }
      return {
        ...prepared,
        model: activeRuntime.session.model,
        thinkingLevel: activeRuntime.session.thinkingLevel,
      }
    }
    unsubscribe = runtime.session.subscribe((event) => {
      if (event.type === 'compaction_start') {
        setStage('compacting')
      }
      if (event.type === 'compaction_end') {
        setStage('settling')
      }
      if (event.type === 'tool_execution_start') {
        guard?.observe(event.toolCallId, event.parentToolCallId ?? null)
        setStage(guard ? 'preparing-tools' : 'executing-tools')
      }
      if (event.type === 'tool_execution_end') {
        setStage('settling')
      }
      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'toolcall_start'
      ) {
        setStage('preparing-tools')
      }
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
        setStage('streaming')
        send({ type: 'delta', text: event.assistantMessageEvent.delta })
      } else {
        const guardedStart =
          guard &&
          event.type === 'tool_execution_start' &&
          runtime?.activeTools.includes(event.toolName)
        const tool = guardedStart ? undefined : tools.observe(event)
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
      setStage('settling')
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
        settlement: 'host-ack-v1',
        mode: guard ? 'final-parameters-v1' : 'deny-all',
        activeTools: guard ? ['read', 'write', 'edit', 'bash', 'powershell'] : [],
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
  } else if (command.type === 'guard-result') {
    if (command.turnId !== currentTurn) {
      throw new Error('Final guard turn mismatch')
    }
    const pending = decisions.get(command.decision.id)
    if (pending) {
      decisions.delete(command.decision.id)
      pending.resolve(command.decision)
    }
  } else if (command.type === 'guard-settled') {
    const pending = settlements.get(command.id)
    if (command.turnId !== currentTurn || !pending || pending.digest !== command.digest) {
      throw new Error('Tool settlement identity mismatch')
    }
    settlements.delete(command.id)
    pending.resolve()
  } else if (command.type === 'queue-boundary') {
    if (command.turnId === currentTurn && command.boundaryId === boundary?.id) {
      boundary.resolve(command.item)
    }
  } else if (command.type === 'model-choice') {
    if (command.turnId === currentTurn && command.boundaryId === modelBoundary?.id) {
      modelBoundary.resolve({ revision: command.revision, selection: command.selection })
    }
  } else if (command.type === 'abort') {
    if (command.turnId !== currentTurn || !run) {
      throw new Error('Abort turn mismatch')
    }
    boundary?.resolve(null)
    modelBoundary?.reject(new Error('Model request cancelled'))
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
    guard?.reset()
    reasoning = undefined
    stage = undefined
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
      activeRuntime.session.getActiveToolNames().join(',') !==
        activeRuntime.activeTools.join(',') ||
      activeRuntime.session.agent.state.tools.map((tool) => tool.name).join(',') !==
        activeRuntime.activeTools.join(',')
    ) {
      throw new Error('Execution guard changed')
    }
    activeRuntime.setTrustedContext(command.trustedContext, command.environmentChanges)
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
    setStage('starting')
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
      setStage('settling')
      send({
        type: 'finished',
        // This is sent only after session.prompt has settled, never on abort request.
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
