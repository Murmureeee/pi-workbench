import type {
  FixtureMode,
  KernelCommand,
  KernelIdentity,
  KernelMessage,
} from './kernel-protocol.js'
import type { TrustedContext } from '@pi-workbench/shared'

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
  private seq = 0
  private active: PendingTurn | undefined
  private readonly turns = new Set<string>()
  private disposal: Promise<void> | undefined
  private acknowledgedDisposal = false
  private hasExited = false
  private cancelledStartup = false
  private readonly listeners = new Set<(message: KernelMessage) => void>()
  private readonly startupTimer: NodeJS.Timeout

  constructor(
    options: KernelIdentity & {
      cwd: string
      runtimeDir: string
      timeoutMs?: number
      childEntry?: URL
      resume?: { sessionFile: string; nativeSessionId: string }
    },
  ) {
    this.identity = kernelIdentitySchema.parse({
      protocol: options.protocol,
      sessionId: options.sessionId,
      epoch: options.epoch,
    })
    this.runtimeDir = resolve(options.runtimeDir)
    this.resume = options.resume
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
      this.child.once('close', (code) => {
        this.hasExited = true
        clearTimeout(this.startupTimer)
        if (
          this.snapshotValue.state === 'disposing' &&
          ((this.acknowledgedDisposal && code === 0) || this.cancelledStartup)
        ) {
          this.snapshotValue.state = 'disposed'
        } else {
          this.fail(new Error(`Kernel exited (${code ?? 'signal'})`))
        }
        resolveExit()
      })
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
    this.send(command)
    return promise
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
    clearTimeout(this.startupTimer)
    this.snapshotValue.state = 'failed'
    this.snapshotValue.error ??= error.message
    this.rejectReady(error)
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
    } else {
      if (!this.active || message.turnId !== this.active.id) {
        // Old-turn output must never update a later turn, including terminal state.
        this.fail(new Error('Kernel turn binding mismatch'))
        return
      }
      if (message.type === 'finished') {
        if (this.snapshotValue.state !== 'disposing') {
          this.snapshotValue.state = message.outcome === 'aborted' ? 'stopped' : 'ready'
        }
        this.active.resolve(message)
        this.active = undefined
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
