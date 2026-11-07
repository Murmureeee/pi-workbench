import type {
  FixtureMode,
  KernelCommand,
  KernelIdentity,
  KernelMessage,
} from './kernel-protocol.js'
import type {
  ExecutionDecision,
  ExecutionRequest,
  ModelSelection,
  TrustedContext,
} from '@pi-workbench/shared'

import { fork } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'

import {
  kernelCommandSchema,
  kernelIdentitySchema,
  kernelMessageSchema,
} from './kernel-protocol.js'

export interface KernelSnapshot extends KernelIdentity {
  source: 'real-sdk/local-fixture' | 'synthetic-ipc-fixture'
  state:
    | 'starting'
    | 'ready'
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'disposing'
    | 'disposed'
    | 'failed'
  cwd: string
  pid?: number
  turnId: string | null
  sessionFile?: string
  nativeSessionId?: string
  error?: string
}

interface PendingTurn {
  id: string
  resolve: (message: Extract<KernelMessage, { type: 'finished' }>) => void
  reject: (error: Error) => void
  promise: Promise<Extract<KernelMessage, { type: 'finished' }>>
}

/** One SDK process. The daemon owns this object and must await dispose() on shutdown.
 * No automatic restart or replay; loss of IPC/guard invalidates the whole generation.
 */
export class SessionKernel {
  private readonly child
  private readonly identity: KernelIdentity
  private readonly runtimeDir: string
  private readonly resume: { sessionFile: string; nativeSessionId: string } | undefined
  private readonly timeoutMs: number
  private snapshotValue: KernelSnapshot
  private readonly readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private readonly exited: Promise<void>
  private readonly disposalAcknowledgement: Promise<void>
  private resolveDisposalAcknowledgement!: () => void
  private rejectDisposalAcknowledgement!: (error: Error) => void
  private seq = 0
  private active: PendingTurn | undefined
  private readonly turns = new Set<string>()
  private disposal: Promise<void> | undefined
  private acknowledgedDisposal = false
  private hasExited = false
  private cancelledStartup = false
  private readonly listeners = new Set<(message: KernelMessage) => void>()
  private readonly startupTimer: NodeJS.Timeout
  private readonly authorize:
    | ((request: ExecutionRequest, signal: AbortSignal) => Promise<ExecutionDecision>)
    | undefined
  private guardController = new AbortController()
  private readonly settleExecution:
    | ((id: string, digest: string, succeeded: boolean) => Promise<void>)
    | undefined
  private modelChoiceValue:
    | { boundaryId: string; revision: number; selection: ModelSelection }
    | undefined
  private readonly selectModel: () => { revision: number; selection: ModelSelection }

  constructor(
    options: KernelIdentity & {
      cwd: string
      runtimeDir: string
      timeoutMs?: number
      childEntry?: URL
      resume?: { sessionFile: string; nativeSessionId: string }
      authorize?: (request: ExecutionRequest, signal: AbortSignal) => Promise<ExecutionDecision>
      settleExecution?: (id: string, digest: string, succeeded: boolean) => Promise<void>
      selectModel?: () => { revision: number; selection: ModelSelection }
    },
  ) {
    this.identity = kernelIdentitySchema.parse({
      protocol: options.protocol,
      sessionId: options.sessionId,
      epoch: options.epoch,
    })
    this.runtimeDir = resolve(options.runtimeDir)
    this.resume = options.resume
    this.authorize = options.authorize
    this.settleExecution = options.settleExecution
    this.selectModel =
      options.selectModel ??
      (() => ({
        revision: 1,
        selection: {
          model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
          thinking: 'off',
        },
      }))
    this.timeoutMs = options.timeoutMs ?? 15000
    const cwd = realpathSync(options.cwd)
    this.snapshotValue = {
      ...this.identity,
      source: options.childEntry ? 'synthetic-ipc-fixture' : 'real-sdk/local-fixture',
      state: 'starting',
      cwd,
      turnId: null,
    }
    this.readyPromise = new Promise((resolveReady, rejectReady) => {
      this.resolveReady = resolveReady
      this.rejectReady = rejectReady
    })
    // A caller may dispose before awaiting readiness; still handle the rejection.
    void this.readyPromise.catch(() => undefined)
    this.disposalAcknowledgement = new Promise((resolveAck, rejectAck) => {
      this.resolveDisposalAcknowledgement = resolveAck
      this.rejectDisposalAcknowledgement = rejectAck
    })
    void this.disposalAcknowledgement.catch(() => undefined)
    const env: NodeJS.ProcessEnv = { PI_CODING_AGENT_DIR: resolve(this.runtimeDir, 'agent') }
    for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) {
      if (process.env[name]) {
        env[name] = process.env[name]
      }
    }
    this.child = fork(options.childEntry ?? new URL('./sdk-child.js', import.meta.url), [], {
      cwd,
      env,
      execArgv: [],
      windowsHide: true,
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    this.snapshotValue.pid = this.child.pid
    // Drain child diagnostics without leaking prompts or configuration into UI state.
    this.child.stderr?.resume()
    this.exited = new Promise((resolveExit) => {
      // IPC disconnect can strand Node's close bookkeeping on Windows after the OS
      // process has exited. Exit is the process-lifetime proof; stderr is diagnostics
      // only and must not retain shutdown or a directory lease after that proof.
      const exited = (code: number | null) => {
        if (this.hasExited) {
          return
        }
        this.hasExited = true
        this.child.stderr?.destroy()
        clearTimeout(this.startupTimer)
        if (this.snapshotValue.state === 'disposing' && (code === 0 || this.cancelledStartup)) {
          // Windows can report OS exit before delivering the final queued IPC message.
          // disposeProcess waits for both proofs; only startup cancellation needs no ack.
          if (this.cancelledStartup) {
            this.snapshotValue.state = 'disposed'
          }
        } else {
          this.fail(new Error(`Kernel exited (${code ?? 'signal'})`))
        }
        resolveExit()
      }
      this.child.once('exit', exited)
      // Failed spawn can emit close without exit; no live child exists in that case.
      this.child.once('close', exited)
    })
    this.startupTimer = setTimeout(
      () => this.fail(new Error('Kernel guard handshake timed out')),
      this.timeoutMs,
    )
    this.child.on('error', (error) => this.fail(error))
    this.child.on('disconnect', () => {
      if (!this.acknowledgedDisposal && !this.cancelledStartup) {
        this.fail(new Error('Kernel IPC disconnected'))
      }
    })
    this.child.on('message', (value: unknown) => this.receive(value))
    this.send({
      ...this.identity,
      type: 'init',
      cwd,
      runtimeDir: this.runtimeDir,
      guarded: Boolean(this.authorize),
      ...(this.resume ? { resume: this.resume } : {}),
    })
  }

  get snapshot(): KernelSnapshot {
    return { ...this.snapshotValue }
  }

  async ready(): Promise<void> {
    await this.readyPromise
  }

  /** Observers receive validated IPC only. Unsubscribe does not stop the real task. */
  subscribe(listener: (message: KernelMessage) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Single product turn, unique ID per generation. Host queues enter only at SDK boundaries. */
  async prompt(input: {
    turnId: string
    text: string
    fixture?: FixtureMode
    inputQueue?: boolean
    trustedContext?: TrustedContext[]
  }) {
    if (this.snapshotValue.state === 'starting') {
      await this.readyPromise
    }
    if (
      !['ready', 'stopped'].includes(this.snapshotValue.state) ||
      this.active ||
      this.turns.has(input.turnId)
    ) {
      throw new Error('Kernel is unavailable, busy, or turn ID was already used')
    }
    const command = kernelCommandSchema.parse({
      ...this.identity,
      ...input,
      fixture: input.fixture ?? 'reply',
      type: 'prompt',
    })
    let resolveTurn!: PendingTurn['resolve']
    let rejectTurn!: PendingTurn['reject']
    const promise = new Promise<Extract<KernelMessage, { type: 'finished' }>>(
      (resolveValue, rejectValue) => {
        resolveTurn = resolveValue
        rejectTurn = rejectValue
      },
    )
    this.active = { id: input.turnId, resolve: resolveTurn, reject: rejectTurn, promise }
    this.turns.add(input.turnId)
    this.snapshotValue.turnId = input.turnId
    this.snapshotValue.state = 'running'
    this.guardController = new AbortController()
    this.send(command)
    return promise
  }

  /** Replies to an active request boundary with one immutable host selection. The matched
   * acknowledgement may advance only this generation/turn and selected revision. */
  modelChoice(
    turnId: string,
    boundaryId: string,
    revision: number,
    selection: ModelSelection,
  ): void {
    if (this.active?.id !== turnId || this.snapshotValue.state !== 'running') {
      return
    }
    this.modelChoiceValue = { boundaryId, revision, selection }
    this.send(
      kernelCommandSchema.parse({
        ...this.identity,
        type: 'model-choice',
        turnId,
        boundaryId,
        revision,
        selection,
      }),
    )
  }

  /** Replies to one awaited SDK boundary with a host-selected immutable input or no input. */
  inputBoundary(
    turnId: string,
    boundaryId: string,
    item: { id: string; text: string } | null,
  ): void {
    if (this.active?.id !== turnId) {
      return
    }
    this.send(
      kernelCommandSchema.parse({
        ...this.identity,
        type: 'queue-boundary',
        turnId,
        boundaryId,
        item: this.snapshotValue.state === 'running' ? item : null,
      }),
    )
  }

  /** Resolves only after SDK prompt termination, or rejects and kills an unresponsive child. */
  async abort(turnId: string): Promise<void> {
    const active = this.active
    if (
      !active ||
      active.id !== turnId ||
      !['running', 'stopping'].includes(this.snapshotValue.state)
    ) {
      throw new Error('No matching active turn to abort')
    }
    if (this.snapshotValue.state !== 'stopping') {
      this.guardController.abort()
      this.snapshotValue.state = 'stopping'
      this.send({ ...this.identity, type: 'abort', turnId })
    }
    await this.bounded(active.promise, 'SDK abort timed out')
  }

  /** Idempotent, waits for actual child exit. Failed graceful shutdown is force-reaped. */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeProcess()
    return this.disposal
  }

  private async disposeProcess() {
    clearTimeout(this.startupTimer)
    this.guardController.abort()
    if (this.hasExited) {
      return
    }
    const wasStarting = this.snapshotValue.state === 'starting'
    this.snapshotValue.state = 'disposing'
    this.rejectReady(new Error('Kernel disposed before readiness'))
    if (wasStarting) {
      // Startup has no ready guard yet. Killing cannot execute an unverified tool.
      this.cancelledStartup = true
      this.child.kill('SIGKILL')
    } else {
      this.send({ ...this.identity, type: 'dispose', turnId: this.active?.id ?? null })
    }
    try {
      await this.bounded(this.exited, 'Kernel disposal timed out')
      if (this.snapshotValue.state === 'disposing' && !this.cancelledStartup) {
        await this.bounded(this.disposalAcknowledgement, 'Kernel disposal acknowledgement missing')
        if (this.snapshotValue.state === 'disposing') {
          this.snapshotValue.state = 'disposed'
        }
      }
    } finally {
      this.listeners.clear()
    }
  }

  private async bounded<T>(promise: Promise<T>, reason: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error(reason)
            this.fail(error)
            reject(error)
          }, this.timeoutMs)
        }),
      ])
    } catch (error) {
      if (!this.hasExited) {
        this.child.kill('SIGKILL')
        await this.exited
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private send(command: KernelCommand) {
    if (!this.child.connected) {
      this.fail(new Error('Kernel IPC unavailable'))
      return
    }
    this.child.send(command, (error) => {
      if (error) {
        this.fail(error)
      }
    })
  }

  private fail(error: Error) {
    this.guardController.abort()
    clearTimeout(this.startupTimer)
    this.snapshotValue.state = 'failed'
    this.snapshotValue.error ??= error.message
    this.rejectReady(error)
    this.rejectDisposalAcknowledgement(error)
    this.active?.reject(error)
    this.active = undefined
    if (!this.hasExited) {
      this.child.kill('SIGKILL')
    }
  }

  private receive(value: unknown) {
    const parsed = kernelMessageSchema.safeParse(value)
    if (!parsed.success) {
      this.fail(new Error('Invalid kernel IPC / execution guard handshake'))
      return
    }
    const message = parsed.data
    if (
      message.sessionId !== this.identity.sessionId ||
      message.epoch !== this.identity.epoch ||
      message.seq !== this.seq + 1
    ) {
      this.fail(new Error('Kernel identity, generation or sequence mismatch'))
      return
    }
    this.seq = message.seq
    if (message.type === 'fatal') {
      this.fail(new Error(message.error))
      return
    }
    if (message.type === 'ready') {
      const path = relative(resolve(this.runtimeDir, 'sessions'), message.sessionFile)
      if (
        this.snapshotValue.state !== 'starting' ||
        message.turnId !== null ||
        message.pid !== this.child.pid ||
        message.cwd !== this.snapshotValue.cwd ||
        message.guard.mode !== (this.authorize ? 'final-parameters-v1' : 'deny-all') ||
        message.guard.activeTools.join(',') !==
          (this.authorize ? 'read,write,edit,bash,powershell' : '') ||
        (this.resume
          ? resolve(message.sessionFile) !== resolve(this.resume.sessionFile) ||
            message.nativeSessionId !== this.resume.nativeSessionId
          : path.startsWith('..') || isAbsolute(path) || !path.endsWith('.jsonl'))
      ) {
        this.fail(new Error('Kernel ready binding mismatch'))
        return
      }
      clearTimeout(this.startupTimer)
      this.snapshotValue = {
        ...this.snapshotValue,
        state: 'ready',
        sessionFile: message.sessionFile,
        nativeSessionId: message.nativeSessionId,
      }
      this.resolveReady()
    } else if (message.type === 'disposed') {
      if (this.snapshotValue.state !== 'disposing') {
        this.fail(new Error('Unexpected disposal acknowledgement'))
        return
      }
      this.acknowledgedDisposal = true
      this.resolveDisposalAcknowledgement()
    } else {
      if (!this.active || message.turnId !== this.active.id) {
        // Old-turn output must never update a later turn, including terminal state.
        this.fail(new Error('Kernel turn binding mismatch'))
        return
      }
      if (message.type === 'finished') {
        this.guardController.abort()
        if (this.snapshotValue.state !== 'disposing') {
          this.snapshotValue.state = message.outcome === 'aborted' ? 'stopped' : 'ready'
        }
        this.active.resolve(message)
        this.active = undefined
      }
      if (message.type === 'model-applied') {
        const choice = this.modelChoiceValue
        if (
          !choice ||
          choice.boundaryId !== message.boundaryId ||
          choice.revision !== message.revision ||
          (!message.failed &&
            JSON.stringify(choice.selection) !== JSON.stringify(message.selection))
        ) {
          this.fail(new Error('Model boundary acknowledgement mismatch'))
          return
        }
        this.modelChoiceValue = undefined
      }
      if (message.type === 'model-boundary' && message.turnId) {
        try {
          const selected = this.selectModel()
          this.modelChoice(
            message.turnId,
            message.boundaryId,
            selected.revision,
            selected.selection,
          )
        } catch {
          this.fail(new Error('Host model selection unavailable'))
          return
        }
      }
      if (message.type === 'guard-finished') {
        const active = this.active,
          turnId = message.turnId
        if (!turnId) {
          this.fail(new Error('Tool settlement turn missing'))
          return
        }
        void (
          this.settleExecution?.(message.id, message.digest, message.succeeded) ?? Promise.resolve()
        )
          .then(() => {
            if (this.active === active && !this.hasExited) {
              this.send(
                kernelCommandSchema.parse({
                  ...this.identity,
                  type: 'guard-settled',
                  turnId,
                  id: message.id,
                  digest: message.digest,
                }),
              )
            }
            return undefined
          })
          .catch(() => this.fail(new Error('Tool settlement unavailable')))
      }
      if (message.type === 'guard-request') {
        const active = this.active,
          controller = this.guardController,
          authorize = this.authorize,
          turnId = message.turnId
        if (!authorize || !turnId) {
          this.fail(new Error('Final guard transport missing'))
          return
        }
        void authorize(message.request, controller.signal)
          .then((decision) => {
            if (
              this.active === active &&
              !controller.signal.aborted &&
              this.snapshotValue.state === 'running'
            ) {
              this.send(
                kernelCommandSchema.parse({
                  ...this.identity,
                  type: 'guard-result',
                  turnId,
                  decision,
                }),
              )
            }
            return undefined
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              this.fail(new Error('Final guard decision unavailable'))
            }
          })
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(message)
      } catch {
        // A view observer has no authority to change the SDK execution state.
        console.error('Kernel observer failed', 'Observer diagnostic details withheld')
      }
    }
  }
}
