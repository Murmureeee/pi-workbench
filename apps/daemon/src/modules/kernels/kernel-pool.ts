import type { SessionKernel } from '@pi-workbench/agent-adapter'
import type { ResourceLimits } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

interface Entry {
  kernel: SessionKernel
  ready: Promise<void>
  pins: number
  waiters: number
  lastUsedAt: number
  retiring: boolean
}
interface Request {
  id: string
  sessionId: string
  cwd: string
  pin: boolean
  signal?: AbortSignal
  resolve: (lease: KernelLease) => void
  reject: (error: unknown) => void
  cleanup: () => void
  cancelled: boolean
}
export interface KernelLease {
  kernel: SessionKernel
  release: () => void
}

/** Owns kernel admission, including startup/retirement slots. FIFO is per resource queue.
 * A slot is released only after the actual child exits. Running, reserved and pending-approval
 * entries are never LRU victims. Cancellation detaches only that caller, not another waiter.
 */
export class KernelPool {
  private readonly entries = new Map<string, Entry>()
  private readonly queue: Request[] = []
  private readonly granted = new Set<Request>()
  private readonly retirements = new Set<Promise<void>>()
  private readonly timer: NodeJS.Timeout
  private closing = false
  private draining = false

  constructor(
    private readonly limits: ResourceLimits,
    private readonly create: (
      sessionId: string,
      cwd: string,
    ) => { kernel: SessionKernel; ready: Promise<void> },
    private readonly waitingApproval: (sessionId: string) => boolean,
  ) {
    this.timer = setInterval(() => this.sweep(), Math.min(limits.idleMs, 30000))
    this.timer.unref()
  }

  acquire(
    sessionId: string,
    cwd: string,
    pin: boolean,
    signal?: AbortSignal,
  ): Promise<KernelLease> {
    if (this.closing) {
      return Promise.reject(new Error('Daemon is shutting down'))
    }
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Resource request cancelled', 'AbortError'))
    }
    if (this.queue.length + this.granted.size >= 256) {
      return Promise.reject(new Error('Kernel admission queue is full (256)'))
    }
    return new Promise((resolve, reject) => {
      const request: Request = {
        id: randomUUID(),
        sessionId,
        cwd,
        pin,
        signal,
        resolve,
        reject,
        cleanup: () => undefined,
        cancelled: false,
      }
      const cancel = () => {
        request.cancelled = true
        const index = this.queue.indexOf(request)
        if (index >= 0) {
          this.queue.splice(index, 1)
        }
        request.cleanup()
        reject(new DOMException('Resource request cancelled', 'AbortError'))
        this.drain()
      }
      request.cleanup = () => signal?.removeEventListener('abort', cancel)
      signal?.addEventListener('abort', cancel, { once: true })
      const existing = this.entries.get(sessionId)
      // Reusing a resident process consumes no new kernel slot and must not wait behind an
      // unrelated new-session request. New process allocations still use strict FIFO.
      if (existing && !existing.retiring && existing.kernel.snapshot.cwd === cwd) {
        this.grant(existing, request)
        return
      }
      this.queue.push(request)
      this.drain()
    })
  }

  list() {
    return [...this.entries.values()].map((entry) => entry.kernel.snapshot)
  }

  changed(): void {
    this.drain()
  }

  snapshot() {
    return {
      kernels: [...this.entries.values()].map((entry) =>
        Object.assign({}, entry.kernel.snapshot, {
          pins: entry.pins,
          lastUsedAt: entry.lastUsedAt,
          waitingApproval: this.waitingApproval(entry.kernel.snapshot.sessionId),
          retiring: entry.retiring,
        }),
      ),
      queue: this.queue.map((request, index) => ({
        id: request.id,
        sessionId: request.sessionId,
        kind: 'kernel' as const,
        stage: 'queued' as const,
        position: index + 1,
        reason: 'kernel-limit' as const,
        cancellable: true as const,
      })),
    }
  }

  private idle(entry: Entry): boolean {
    return (
      !entry.retiring &&
      entry.pins === 0 &&
      entry.waiters === 0 &&
      ['ready', 'stopped'].includes(entry.kernel.snapshot.state) &&
      !this.waitingApproval(entry.kernel.snapshot.sessionId)
    )
  }

  private drain(): void {
    if (this.draining || this.closing) {
      return
    }
    this.draining = true
    try {
      while (this.queue.length) {
        const request = this.queue[0]!
        let entry = this.entries.get(request.sessionId)
        if (entry?.retiring) {
          break
        }
        if (entry && entry.kernel.snapshot.cwd !== request.cwd) {
          this.queue.shift()
          request.cleanup()
          request.reject(new Error('Session cwd cannot change within a generation'))
          continue
        }
        if (!entry && this.entries.size >= this.limits.kernels) {
          const victim = [...this.entries.values()]
            .filter((candidate) => this.idle(candidate))
            .toSorted((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
          if (victim) {
            void this.retire(victim)
          }
          break
        }
        this.queue.shift()
        if (!entry) {
          try {
            entry = {
              ...this.create(request.sessionId, request.cwd),
              pins: 0,
              waiters: 0,
              lastUsedAt: Date.now(),
              retiring: false,
            }
            this.entries.set(request.sessionId, entry)
          } catch (error) {
            request.cleanup()
            request.reject(error)
            continue
          }
        }
        this.grant(entry, request)
      }
    } finally {
      this.draining = false
    }
  }

  private grant(entry: Entry, request: Request): void {
    entry.waiters += 1
    if (request.pin) {
      entry.pins += 1
    }
    this.granted.add(request)
    let released = false
    const release = () => {
      if (released) {
        return
      }
      released = true
      if (request.pin) {
        entry.pins -= 1
      }
      entry.lastUsedAt = Date.now()
      this.drain()
    }
    void entry.ready
      .then(
        () => {
          if (this.closing || request.cancelled || request.signal?.aborted || entry.retiring) {
            release()
            request.reject(new DOMException('Resource request cancelled', 'AbortError'))
          } else {
            request.resolve({ kernel: entry.kernel, release })
          }
          return undefined
        },
        (error: unknown) => {
          release()
          request.reject(error)
          // Failed startup owns its slot until disposal has reaped the child.
          void this.retire(entry)
          return undefined
        },
      )
      .finally(() => {
        request.cleanup()
        this.granted.delete(request)
        entry.waiters -= 1
        entry.lastUsedAt = Date.now()
        if (request.cancelled || request.signal?.aborted) {
          release()
        }
        this.drain()
      })
  }

  /** Idle expiry is automatic; this explicit sweep is also useful to configuration/diagnostics.
   * It never changes histories, pending approvals, UI caches or queued model inputs.
   */
  sweep(): void {
    if (this.closing) {
      return
    }
    for (const entry of this.entries.values()) {
      if (this.idle(entry) && Date.now() - entry.lastUsedAt >= this.limits.idleMs) {
        void this.retire(entry)
      }
    }
    this.drain()
  }

  private retire(entry: Entry): Promise<void> {
    entry.retiring = true
    const operation = entry.kernel.dispose().finally(() => {
      if (this.entries.get(entry.kernel.snapshot.sessionId) === entry) {
        this.entries.delete(entry.kernel.snapshot.sessionId)
      }
      this.retirements.delete(operation)
      this.drain()
    })
    this.retirements.add(operation)
    // Awaited by explicit destruction/shutdown; background reaping cannot create an unhandled rejection.
    void operation.catch(() =>
      console.error('Kernel retirement failed', 'Diagnostic details withheld'),
    )
    return operation
  }

  async destroy(sessionId: string): Promise<void> {
    for (const request of [...this.queue, ...this.granted]) {
      if (request.sessionId !== sessionId) {
        continue
      }
      request.cancelled = true
      const index = this.queue.indexOf(request)
      if (index >= 0) {
        this.queue.splice(index, 1)
      }
      request.cleanup()
      request.reject(new DOMException('Runtime destroyed', 'AbortError'))
    }
    const entry = this.entries.get(sessionId)
    if (entry) {
      await this.retire(entry)
    }
    this.drain()
  }

  /** Reject admission first, then reap every owned child before persistence is closed by caller. */
  async close(): Promise<void> {
    this.closing = true
    clearInterval(this.timer)
    for (const request of [...this.queue.splice(0), ...this.granted]) {
      request.cleanup()
      request.reject(new Error('Daemon is shutting down'))
    }
    const results = await Promise.allSettled(
      [...this.entries.values()].map((entry) => this.retire(entry)),
    )
    await Promise.allSettled(this.retirements)
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result): unknown => result.reason)
    if (errors.length) {
      throw new AggregateError(errors, 'Some kernels required forced termination')
    }
  }
}
