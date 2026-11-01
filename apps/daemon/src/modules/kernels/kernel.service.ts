import type { EventService } from '../events/event.service.js'
import type { SessionStore } from '../sessions/session.store.js'

import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'

import { SessionKernel } from '@pi-workbench/agent-adapter'

/** Daemon-owned registry shared by all clients. View disconnect never disposes a kernel.
 * Reopening a failed generation requires explicit destruction first; no side-effect replay.
 */
export class KernelService {
  private readonly kernels = new Map<string, SessionKernel>()
  private closing = false

  constructor(
    private readonly dataDir: string,
    private readonly events: EventService,
    private readonly store: SessionStore,
  ) {}

  async open(sessionId: string, cwd: string): Promise<SessionKernel> {
    if (this.closing) {
      throw new Error('Daemon is shutting down')
    }
    const canonicalCwd = realpathSync(cwd)
    this.store.assertWritable(sessionId)
    let kernel = this.kernels.get(sessionId)
    if (kernel && kernel.snapshot.cwd !== canonicalCwd) {
      throw new Error('Session cwd cannot change within a generation')
    }
    if (!kernel) {
      const epoch = randomUUID()
      kernel = new SessionKernel({
        protocol: 1,
        sessionId,
        epoch,
        cwd: canonicalCwd,
        runtimeDir: join(this.dataDir, 'kernels', sessionId, epoch),
      })
      this.kernels.set(sessionId, kernel)
      this.events.attach(sessionId, epoch, kernel.snapshot.source)
      kernel.subscribe((message) => {
        if (!message.turnId) {
          return
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
            tool: {
              id: message.toolId,
              name: message.name,
              status: message.status,
              summary: message.summary,
            },
          })
        }
        if (message.type === 'finished') {
          this.events.publish(sessionId, epoch, message.turnId, {
            type: 'turn.finished',
            outcome: message.outcome,
            ...(message.error ? { error: message.error } : {}),
          })
        }
      })
    }
    await kernel.ready()
    const ready = kernel.snapshot
    if (!ready.sessionFile || !ready.nativeSessionId) {
      throw new Error('Native history binding missing')
    }
    this.store.registerRuntime({
      sessionId,
      epoch: ready.epoch,
      cwd: canonicalCwd,
      sessionFile: ready.sessionFile,
      nativeSessionId: ready.nativeSessionId,
      source: ready.source,
    })
    if (
      kernel.snapshot.state === 'failed' ||
      kernel.snapshot.state === 'disposed' ||
      kernel.snapshot.state === 'disposing'
    ) {
      throw new Error('Destroy the previous runtime before reopening this session')
    }
    return kernel
  }

  list() {
    return [...this.kernels.values()].map((kernel) => kernel.snapshot)
  }

  /** Internal application entry, not an HTTP command. Publishes start before SDK deltas and
   * terminal before resolving. Failures are observed once, never automatically retried.
   */
  async prompt(sessionId: string, cwd: string, input: Parameters<SessionKernel['prompt']>[0]) {
    const kernel = await this.open(sessionId, cwd)
    if (!['ready', 'stopped'].includes(kernel.snapshot.state)) {
      throw new Error('Kernel is busy')
    }
    const epoch = kernel.snapshot.epoch
    this.events.publish(sessionId, epoch, input.turnId, {
      type: 'turn.started',
      prompt: input.text,
      messageId: `${input.turnId}:assistant`,
    })
    try {
      return await kernel.prompt(input)
    } catch (error) {
      this.events.publish(sessionId, epoch, input.turnId, {
        type: 'turn.finished',
        outcome: 'error',
        error: error instanceof Error ? error.message : 'Kernel failed',
      })
      throw error
    }
  }

  async abort(sessionId: string, turnId: string): Promise<void> {
    const kernel = this.kernels.get(sessionId)
    if (!kernel || kernel.snapshot.turnId !== turnId) {
      throw new Error('Unknown active turn')
    }
    this.events.publish(sessionId, kernel.snapshot.epoch, turnId, { type: 'turn.stopping' })
    await kernel.abort(turnId)
  }

  async destroy(sessionId: string): Promise<void> {
    const kernel = this.kernels.get(sessionId)
    if (kernel) {
      await kernel.dispose()
      this.kernels.delete(sessionId)
      this.events.remove(sessionId)
    }
  }

  /** Nest waits for every owned process even when one disposal fails. */
  async onModuleDestroy(): Promise<void> {
    this.closing = true
    const results = await Promise.allSettled(
      [...this.kernels.values()].map((kernel) => kernel.dispose()),
    )
    this.kernels.clear()
    this.events.close()
    this.store.close()
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result): unknown => result.reason)
    if (errors.length) {
      throw new AggregateError(errors, 'Some kernels required forced termination')
    }
  }
}
