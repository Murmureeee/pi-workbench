import type { EventService } from '../events/event.service.js'
import type { ApprovalService } from '../security/approval.service.js'
import type { TrustService } from '../security/trust.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { KernelSnapshot } from '@pi-workbench/agent-adapter'
import type { ResourceLimits, ResourceSnapshot } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { SessionKernel } from '@pi-workbench/agent-adapter'
import {
  resourceLimitsSchema,
  resourceSnapshotSchema,
  runtimeToolSchema,
} from '@pi-workbench/shared'

import { ExecutionPolicyService } from '../security/execution-policy.service.js'
import { KernelPool } from './kernel-pool.js'

const promptSchema = z.strictObject({
  turnId: z.uuid(),
  text: z.string().min(1).max(65536),
  fixture: z
    .enum([
      'reply',
      'hold',
      'error',
      'unknown-tool',
      'context',
      'trust-context',
      'rendering',
      'rendering-long',
      'scrolling',
      'reasoning',
      'queue',
      'queue-fast',
      'guard-read',
      'guard-denied',
      'approval-write',
      'approval-command',
      'approval-running',
    ])
    .optional(),
})
type Prompt = z.infer<typeof promptSchema>
type Result = Awaited<ReturnType<SessionKernel['prompt']>>
interface Task {
  sessionId: string
  cwd: string
  input: Prompt
  stage: 'queued' | 'acquiring-kernel' | 'running'
  controller: AbortController
  kernel?: SessionKernel
  resolve: (result: Result) => void
  reject: (error: unknown) => void
  promise: Promise<Result>
  cancellation?: Promise<void>
  preflight?: () => Promise<void>
  directoryCheck?: () => Promise<void>
  directoryTimer?: ReturnType<typeof setTimeout>
  directoryFailure?: KernelDirectoryUnavailable
}
/** Observation-only application handle. All model work enters KernelService.prompt() so a caller
 * cannot bypass admission by retaining an earlier raw SessionKernel.
 */
export type ManagedKernelView = Pick<SessionKernel, 'snapshot' | 'ready' | 'subscribe'>

/** An IPC/child failure after dispatch cannot prove whether a task reached the provider.
 * Business callers must retain it as interrupted instead of offering an automatic replay.
 */
export class KernelExecutionUncertain extends Error {}

/** Loss of a saved execution directory stops admission or interrupts an active turn.
 * A dispatched turn must not be offered as a known-safe replay after recovery. */
export class KernelDirectoryUnavailable extends Error {
  constructor(
    readonly dispatched: boolean,
    diagnostic: string,
  ) {
    super(
      `执行目录不可用：${diagnostic} ${dispatched ? '本轮已中断，请核对历史与现场后明确发送；未自动重发。' : '任务尚未发送，恢复原目录后可明确重试。'}`,
    )
  }
}

/** Single daemon authority for bounded kernels/model tasks. Each resource has its own FIFO.
 * Queued inputs never pin idle processes or enter model context before admission.
 */
export class KernelService {
  private readonly pool: KernelPool
  private readonly limits: ResourceLimits
  private readonly tasks = new Map<string, Task>()
  private readonly modelQueue: Task[] = []
  private readonly handles = new WeakMap<SessionKernel, ManagedKernelView>()
  private closing = false
  private disposal: Promise<void> | undefined
  private readonly unsubscribeResources: () => void
  private inputQueue:
    | {
        take: (
          sessionId: string,
          epoch: string,
          turnId: string,
        ) => { id: string; text: string } | null
        delivered: (sessionId: string, epoch: string, turnId: string, id: string) => void
      }
    | undefined

  /** Only the daemon queue owner can select input; no HTTP/client can talk to SDK IPC. */
  setInputQueue(owner: NonNullable<KernelService['inputQueue']>): void {
    this.inputQueue = owner
  }

  constructor(
    private readonly dataDir: string,
    private readonly events: EventService,
    private readonly store: SessionStore,
    limits: Partial<ResourceLimits> = {},
    private readonly trust?: TrustService,
    private readonly executionPolicy: ExecutionPolicyService = new ExecutionPolicyService(),
    private readonly approvals?: ApprovalService,
  ) {
    this.limits = resourceLimitsSchema.parse(limits)
    this.pool = new KernelPool(
      this.limits,
      (sessionId, cwd) => this.create(sessionId, cwd),
      (sessionId) =>
        Boolean(this.events.snapshot(sessionId)?.turns.at(-1)?.approval) ||
        this.store.hasPendingApproval(sessionId),
    )
    this.unsubscribeResources = this.events.onChange(() => this.pool.changed())
  }

  private create(sessionId: string, cwd: string) {
    const epoch = randomUUID()
    const resume = this.store.resumeRuntime(sessionId, cwd)
    const kernel = new SessionKernel({
      protocol: 1,
      sessionId,
      epoch,
      cwd,
      runtimeDir: join(this.dataDir, 'kernels', sessionId, epoch),
      authorize: async (request, signal) => {
        const turnId = kernel.snapshot.turnId
        if (!turnId) {
          throw new Error('Final tool turn unavailable')
        }
        const task = this.tasks.get(sessionId)
        const current = () =>
          !signal.aborted &&
          !task?.controller.signal.aborted &&
          !this.closing &&
          this.tasks.get(sessionId) === task &&
          task?.input.turnId === turnId &&
          kernel.snapshot.state === 'running'
        if (!current()) {
          throw new Error('Final tool task unavailable')
        }
        await task?.directoryCheck?.()
        let decision = await this.executionPolicy.decide(
          { sessionId, epoch, turnId, cwd },
          request,
          current,
        )
        if (this.approvals?.rejectedTurn(turnId)) {
          decision = {
            ...decision,
            allowed: false,
            risk: { ...decision.risk, automatic: false },
            reason: '本轮已有拒绝或取消；未执行，不会自动改换形式执行工具。',
            readText: undefined,
          }
        } else if (!decision.allowed && this.approvals && current()) {
          try {
            const target = await this.executionPolicy.explicitTarget(
              { sessionId, epoch, turnId, cwd },
              request,
            )
            const scope = await this.executionPolicy.sessionScope(
              { sessionId, epoch, turnId, cwd },
              request,
            )
            this.events.publish(sessionId, epoch, turnId, {
              type: 'tool.updated',
              tool: {
                id: request.callId,
                name: request.tool,
                status: 'pending',
                parameters: request.parameters,
                parentId: request.parentId,
                cwd,
                origin: 'sdk',
                summary: '等待明确审批；未执行，无倒计时。',
                risk: decision.risk,
              },
            })
            const approved = await this.approvals.wait(
              { sessionId, epoch, turnId, cwd },
              request,
              decision,
              task ? AbortSignal.any([signal, task.controller.signal]) : signal,
              current,
              scope,
            )
            decision = approved.decision
            if (decision.allowed) {
              await task?.directoryCheck?.()
              const finalTarget = await this.executionPolicy.explicitTarget(
                { sessionId, epoch, turnId, cwd },
                request,
              )
              const finalScope = await this.executionPolicy.sessionScope(
                { sessionId, epoch, turnId, cwd },
                request,
              )
              if (
                !current() ||
                decision.risk.policyVersion !== this.executionPolicy.policyVersion ||
                this.approvals.rejectedTurn(turnId) ||
                target !== finalTarget ||
                scope.key !== finalScope.key ||
                !approved.authorizationCurrent()
              ) {
                throw new Error('批准后的目录、文件、策略或任务已改变；未执行。')
              }
            }
          } catch (error) {
            decision = {
              ...decision,
              allowed: false,
              readText: undefined,
              reason: error instanceof Error ? error.message : '最终审批不可用；未执行。',
            }
          }
        }
        this.events.publish(sessionId, epoch, turnId, {
          type: 'tool.updated',
          tool: {
            id: request.callId,
            name: request.tool,
            status: decision.allowed ? 'running' : 'denied',
            parameters: request.parameters,
            parentId: request.parentId,
            cwd,
            origin: 'sdk',
            summary: decision.reason,
            risk: decision.risk,
          },
        })
        return decision
      },
      ...(resume ? { resume } : {}),
    })
    this.events.attach(sessionId, epoch, kernel.snapshot.source)
    kernel.subscribe((message) => {
      if (!message.turnId) {
        return
      }
      if (message.type === 'queue-delivered') {
        this.inputQueue?.delivered(sessionId, epoch, message.turnId, message.id)
      }
      if (message.type === 'queue-boundary') {
        const turnId = message.turnId,
          task = this.tasks.get(sessionId)
        void (async () => {
          try {
            await task?.directoryCheck?.()
            const item =
              task &&
              this.tasks.get(sessionId) === task &&
              task.input.turnId === turnId &&
              !task.controller.signal.aborted &&
              !this.closing
                ? (this.inputQueue?.take(sessionId, epoch, turnId) ?? null)
                : null
            kernel.inputBoundary(turnId, message.boundaryId, item)
          } catch {
            kernel.inputBoundary(turnId, message.boundaryId, null)
            if (task && this.tasks.get(sessionId) === task) {
              await this.abort(sessionId, turnId)
            }
          }
        })().catch(() => console.error('Input boundary failed; no automatic replay'))
      }
      if (message.type === 'delta') {
        this.events.publish(sessionId, epoch, message.turnId, {
          type: 'message.delta',
          messageId: `${message.turnId}:assistant`,
          text: message.text,
        })
      }
      if (message.type === 'tool') {
        this.events.publish(sessionId, epoch, message.turnId, {
          type: 'tool.updated',
          // Strip the private IPC envelope; no host/transport fields enter public observations.
          tool: runtimeToolSchema.strip().parse({ ...message, id: message.toolId }),
        })
      }
      if (message.type === 'reasoning') {
        this.events.publish(sessionId, epoch, message.turnId, {
          type: 'reasoning.updated',
          reasoning: message.reasoning,
        })
      }
      if (message.type === 'model') {
        this.events.publish(sessionId, epoch, message.turnId, {
          type: 'model.updated',
          modelRequest: message.modelRequest,
        })
      }
      if (message.type === 'finished') {
        // SDK finished acknowledges its awaited prompt; transport abort alone does not.
        this.events.publish(sessionId, epoch, message.turnId, {
          type: 'turn.finished',
          outcome: message.outcome,
          ...(message.error ? { error: message.error } : {}),
        })
      }
      if (message.type === 'stage') {
        this.events.publish(sessionId, epoch, message.turnId, {
          type: 'stage.updated',
          stage: message.stage,
        })
      }
    })
    const ready = kernel.ready().then(() => {
      const binding = kernel.snapshot
      if (!binding.sessionFile || !binding.nativeSessionId) {
        throw new Error('Native history binding missing')
      }
      this.store.registerRuntime({
        sessionId,
        epoch,
        cwd,
        sessionFile: binding.sessionFile,
        nativeSessionId: binding.nativeSessionId,
        source: binding.source,
      })
      return undefined
    })
    return { kernel, ready }
  }

  async open(
    sessionId: string,
    cwd: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ManagedKernelView> {
    if (this.closing) {
      throw new Error('Daemon is shutting down')
    }
    z.uuid().parse(sessionId)
    this.store.assertWritable(sessionId)
    const lease = await this.pool.acquire(sessionId, realpathSync(cwd), false, options.signal)
    try {
      const kernel = lease.kernel
      if (!['ready', 'stopped', 'running', 'stopping'].includes(kernel.snapshot.state)) {
        throw new Error('Destroy the previous runtime before reopening this session')
      }
      let handle = this.handles.get(kernel)
      if (!handle) {
        handle = Object.freeze({
          get snapshot(): KernelSnapshot {
            return kernel.snapshot
          },
          ready: () => kernel.ready(),
          subscribe: (listener: Parameters<SessionKernel['subscribe']>[0]) =>
            kernel.subscribe(listener),
        })
        this.handles.set(kernel, handle)
      }
      return handle
    } finally {
      lease.release()
    }
  }

  list() {
    return this.pool.list()
  }

  /** Read-only diagnostics. Positions are per resource queue, never a claimed finish time. */
  resources(): ResourceSnapshot {
    const pool = this.pool.snapshot()
    const modelTasks = [...this.tasks.values()].filter((task) => task.stage !== 'queued').length
    return resourceSnapshotSchema.parse({
      version: 1,
      source: 'real-sdk/local-fixture',
      realProviderEnabled: false,
      limits: this.limits,
      modelTasks,
      terminalEnforcement: 'reserved-until-M4',
      viewCacheIndependent: true,
      kernels: pool.kernels.map(
        ({ sessionId, epoch, state, pid, pins, lastUsedAt, waitingApproval, retiring }) => ({
          sessionId,
          epoch,
          state,
          pid,
          pins,
          lastUsedAt,
          waitingApproval,
          retiring,
        }),
      ),
      queue: [
        ...pool.queue,
        ...[...this.tasks.values()].map((task) => ({
          id: task.input.turnId,
          sessionId: task.sessionId,
          kind: 'model',
          stage: task.stage,
          position: task.stage === 'queued' ? this.modelQueue.indexOf(task) + 1 : 0,
          reason:
            task.stage === 'queued'
              ? 'model-limit'
              : task.stage === 'running'
                ? 'running'
                : 'starting-kernel',
          cancellable: true,
        })),
      ],
    })
  }

  /** Internal application command, not a public HTTP mutation. One accepted task per session;
   * M2 steer/follow-up are separate business queues. Validate before any resource use.
   */
  prompt(
    sessionId: string,
    cwd: string,
    input: Prompt,
    options: { preflight?: () => Promise<void>; directoryCheck?: () => Promise<void> } = {},
  ): Promise<Result> {
    try {
      if (this.closing) {
        throw new Error('Daemon is shutting down')
      }
      z.uuid().parse(sessionId)
      const parsed = promptSchema.parse(input)
      this.store.assertWritable(sessionId)
      if (this.tasks.has(sessionId)) {
        throw new Error('Kernel is busy or already queued')
      }
      if ([...this.tasks.values()].some((task) => task.input.turnId === parsed.turnId)) {
        throw new Error('Duplicate turn ID')
      }
      if (this.modelQueue.length >= 256) {
        throw new Error('Model admission queue is full (256)')
      }
      const canonicalCwd = realpathSync(cwd)
      let resolve!: Task['resolve'], reject!: Task['reject']
      const promise = new Promise<Result>((ok, fail) => {
        resolve = ok
        reject = fail
      })
      void promise.catch(() => undefined)
      const task: Task = {
        sessionId,
        cwd: canonicalCwd,
        input: parsed,
        stage: 'queued',
        controller: new AbortController(),
        resolve,
        reject,
        promise,
        ...(options.preflight ? { preflight: options.preflight } : {}),
        ...(options.directoryCheck ? { directoryCheck: options.directoryCheck } : {}),
      }
      this.tasks.set(sessionId, task)
      this.modelQueue.push(task)
      this.watchDirectory(task)
      this.drainModels()
      return promise
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Daemon-owned, non-overlapping, read-only checks also cover queued/background tasks.
   * An awaited check is identity-bound: a late failure cannot cancel a subsequent turn.
   * Detection is sampled (1 s), not an OS sandbox or a substitute for future tool guards. */
  private watchDirectory(task: Task): void {
    const check = task.directoryCheck
    if (
      !check ||
      this.closing ||
      task.controller.signal.aborted ||
      this.tasks.get(task.sessionId) !== task
    ) {
      return
    }
    task.directoryTimer = setTimeout(() => {
      void (async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            check(),
            new Promise<never>((_resolve, reject) => {
              deadline = setTimeout(
                () => reject(new Error('目录检查超时，请核对挂载或访问状态。')),
                3000,
              )
              deadline.unref()
            }),
          ])
        } catch (error) {
          if (
            !this.closing &&
            !task.controller.signal.aborted &&
            this.tasks.get(task.sessionId) === task
          ) {
            task.directoryFailure = new KernelDirectoryUnavailable(
              task.stage === 'running',
              error instanceof Error ? error.message : '目录检查未完成。',
            )
            await this.abort(task.sessionId, task.input.turnId)
          }
        } finally {
          clearTimeout(deadline)
          this.watchDirectory(task)
        }
      })().catch(() => console.error('Directory stop failed; diagnostic details withheld'))
    }, 1000)
    task.directoryTimer.unref()
  }

  private drainModels(): void {
    if (this.closing) {
      return
    }
    let count = [...this.tasks.values()].filter((task) => task.stage !== 'queued').length
    while (count < this.limits.modelTasks && this.modelQueue.length) {
      const task = this.modelQueue.shift()!
      task.stage = 'acquiring-kernel'
      count += 1
      void this.run(task).then(task.resolve, task.reject)
    }
  }

  private async run(task: Task): Promise<Result> {
    let release: (() => void) | undefined
    let kernel: SessionKernel | undefined
    let started = false
    let dispatched = false
    let settled = false
    try {
      if (task.preflight) {
        await task.preflight()
      }
      const lease = await this.pool.acquire(task.sessionId, task.cwd, true, task.controller.signal)
      release = lease.release
      kernel = lease.kernel
      if (this.closing || task.controller.signal.aborted) {
        throw new DOMException('Task cancelled', 'AbortError')
      }
      this.store.assertWritable(task.sessionId)
      if (task.preflight) {
        await task.preflight()
      }
      if (!['ready', 'stopped'].includes(kernel.snapshot.state)) {
        throw new Error('Kernel is busy or unavailable')
      }
      this.events.publish(task.sessionId, kernel.snapshot.epoch, task.input.turnId, {
        type: 'turn.started',
        prompt: task.input.text,
        messageId: `${task.input.turnId}:assistant`,
      })
      started = true
      if (task.controller.signal.aborted) {
        throw new DOMException('Task cancelled', 'AbortError')
      }
      task.kernel = kernel
      task.stage = 'running'
      const trustedContext =
        this.trust?.beginTurn(task.cwd, task.sessionId, task.input.turnId) ?? []
      dispatched = true
      const result = await kernel.prompt({
        ...task.input,
        trustedContext,
        inputQueue: Boolean(this.inputQueue),
      })
      settled = true
      if (task.directoryFailure) {
        throw task.directoryFailure
      }
      return result
    } catch (error) {
      if (task.directoryFailure) {
        try {
          // Preserve observations/history, releasing only this invalid runtime's OS handles.
          await this.pool.destroy(task.sessionId)
        } catch (cause) {
          throw new KernelExecutionUncertain(
            'Directory loss runtime shutdown was not acknowledged',
            { cause },
          )
        }
      }
      if (kernel?.snapshot.state === 'failed') {
        await this.pool.destroy(task.sessionId)
      }
      // A failed IPC/abort is not an SDK acknowledgement. Reap failed runtimes before
      // publishing a fallback; dispatched work with no result stays uncertain to callers.
      if (started && kernel && !settled) {
        this.events.publish(task.sessionId, kernel.snapshot.epoch, task.input.turnId, {
          type: 'turn.finished',
          outcome: !dispatched && task.controller.signal.aborted ? 'aborted' : 'error',
          error: error instanceof Error ? error.message : 'Kernel failed',
        })
      }
      if (task.directoryFailure) {
        throw task.directoryFailure
      }
      if (dispatched) {
        throw new KernelExecutionUncertain(
          error instanceof Error ? error.message : 'Kernel execution result is unknown',
          { cause: error },
        )
      }
      throw error
    } finally {
      clearTimeout(task.directoryTimer)
      this.approvals?.endTurn(task.input.turnId)
      this.trust?.endTurn(task.input.turnId)
      release?.()
      this.tasks.delete(task.sessionId)
      this.drainModels()
    }
  }

  /** Cancel by task identity, including admission waits. Running slots remain held until SDK
   * termination; a cancelled queued task never creates a prompt or automatically retries.
   */
  async abort(sessionId: string, turnId: string): Promise<void> {
    const task = this.tasks.get(sessionId)
    if (!task || task.input.turnId !== turnId) {
      throw new Error('Unknown active turn')
    }
    task.controller.abort()
    clearTimeout(task.directoryTimer)
    if (task.stage === 'queued') {
      task.cancellation ??= (async () => {
        const index = this.modelQueue.indexOf(task)
        if (index >= 0) {
          this.modelQueue.splice(index, 1)
        }
        try {
          if (task.directoryFailure) {
            await this.pool.destroy(sessionId)
          }
        } finally {
          this.tasks.delete(sessionId)
          task.reject(
            task.directoryFailure ?? new DOMException('Queued task cancelled', 'AbortError'),
          )
          this.drainModels()
        }
      })()
      await task.cancellation
    } else if (task.stage === 'running' && task.kernel) {
      const kernel = task.kernel
      task.cancellation ??= (async () => {
        this.events.publish(sessionId, kernel.snapshot.epoch, turnId, { type: 'turn.stopping' })
        await kernel.abort(turnId)
      })()
      await task.cancellation
    } else {
      await task.promise.catch(() => undefined)
    }
  }

  async destroy(sessionId: string): Promise<void> {
    const task = this.tasks.get(sessionId)
    if (task) {
      await this.abort(sessionId, task.input.turnId)
    }
    await this.pool.destroy(sessionId)
    this.events.remove(sessionId)
  }

  /** Stop/reap children and settle admission before closing event/store/database resources. */
  onModuleDestroy(): Promise<void> {
    this.disposal ??= this.close()
    return this.disposal
  }

  private async close(): Promise<void> {
    this.closing = true
    this.approvals?.close()
    this.unsubscribeResources()
    for (const task of this.modelQueue.splice(0)) {
      clearTimeout(task.directoryTimer)
      this.tasks.delete(task.sessionId)
      task.reject(new Error('Daemon is shutting down'))
    }
    for (const task of this.tasks.values()) {
      task.controller.abort()
      clearTimeout(task.directoryTimer)
    }
    const result = await Promise.allSettled([
      this.pool.close(),
      ...[...this.tasks.values()].map((task) => task.promise),
    ])
    this.events.close()
    this.store.close()
    if (result[0]?.status === 'rejected') {
      throw result[0].reason
    }
  }
}
