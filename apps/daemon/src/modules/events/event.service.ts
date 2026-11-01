import type {
  RuntimeEvent,
  RuntimeFrame,
  RuntimeSnapshot,
  RuntimeSubscribe,
} from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import {
  applyRuntimeEvent,
  runtimeCapabilities,
  runtimeEventSchema,
  runtimeSnapshotSchema,
} from '@pi-workbench/shared'

interface Journal {
  snapshot: RuntimeSnapshot
  events: RuntimeEvent[]
  bytes: number
  listeners: Set<(frame: RuntimeFrame) => void>
}

/** In-memory observation journal owned by the daemon. Snapshot+cursor capture and replay-to-live
 * registration are synchronous, so a concurrent SDK event cannot fall between them.
 * Retention bounds apply to replay only; full text is never truncated or written back to SDK history.
 */
export class EventService {
  readonly daemonId = randomUUID()
  private readonly journals = new Map<string, Journal>()
  private persistence: ((snapshot: RuntimeSnapshot, immediate: boolean) => void) | undefined
  constructor(
    private readonly maxEvents = 1024,
    private readonly maxBytes = 2 * 1024 * 1024,
  ) {}

  setPersistence(capture: (snapshot: RuntimeSnapshot, immediate: boolean) => void): void {
    this.persistence = capture
  }

  restore(snapshot: RuntimeSnapshot): void {
    this.remove(snapshot.sessionId)
    this.journals.set(snapshot.sessionId, {
      snapshot: runtimeSnapshotSchema.parse({ ...snapshot, daemonId: this.daemonId, seq: 0 }),
      events: [],
      bytes: 0,
      listeners: new Set(),
    })
  }

  hello() {
    return {
      type: 'hello' as const,
      protocolVersion: 1,
      daemonId: this.daemonId,
      capabilities: [...runtimeCapabilities],
      mutations: false,
      realProviderEnabled: false,
    }
  }

  attach(sessionId: string, epoch: string, source: RuntimeSnapshot['source']): void {
    this.remove(sessionId)
    this.journals.set(sessionId, {
      snapshot: runtimeSnapshotSchema.parse({
        version: 1,
        daemonId: this.daemonId,
        sessionId,
        epoch,
        seq: 0,
        source,
        turns: [],
      }),
      events: [],
      bytes: 0,
      listeners: new Set(),
    })
  }

  snapshot(sessionId: string): RuntimeSnapshot | undefined {
    const value = this.journals.get(sessionId)?.snapshot
    return value ? structuredClone(value) : undefined
  }

  /** Trusted producer boundary; late old-generation/turn callbacks cannot publish a new terminal. */
  publish(
    sessionId: string,
    epoch: string,
    turnId: string,
    payload: RuntimeEvent['payload'],
  ): void {
    const journal = this.journals.get(sessionId)
    if (!journal || journal.snapshot.epoch !== epoch) {
      return
    }
    const active = journal.snapshot.turns.at(-1)
    if (
      payload.type !== 'turn.started' &&
      (!active || active.id !== turnId || !['running', 'stopping'].includes(active.phase))
    ) {
      return
    }
    const seq = journal.snapshot.seq + 1
    const event = runtimeEventSchema.parse({
      version: 1,
      daemonId: this.daemonId,
      sessionId,
      epoch,
      turnId,
      seq,
      id: `${epoch}:${seq}`,
      payload,
    })
    const next = applyRuntimeEvent(journal.snapshot, event)
    // Persistence precedes broadcast. Delta failures surface through store diagnostics;
    // a failed durable start prevents the application from dispatching a prompt.
    this.persistence?.(next, payload.type !== 'message.delta')
    journal.snapshot = next
    journal.events.push(event)
    journal.bytes += Buffer.byteLength(JSON.stringify(event))
    while (journal.events.length > this.maxEvents || journal.bytes > this.maxBytes) {
      const removed = journal.events.shift()
      if (removed) {
        journal.bytes -= Buffer.byteLength(JSON.stringify(removed))
      }
    }
    for (const listener of journal.listeners) {
      listener({ type: 'event', event })
    }
  }

  /** Read-only subscription: never starts/stops work. Slow clients are disconnected by transport.
   * All replayed records retain their IDs; a stale/ahead cursor, epoch or daemon requires REST resync.
   */
  subscribe(input: RuntimeSubscribe, listener: (frame: RuntimeFrame) => void): () => void {
    const journal = this.journals.get(input.sessionId)
    if (
      !journal ||
      input.daemonId !== this.daemonId ||
      input.epoch !== journal.snapshot.epoch ||
      input.since > journal.snapshot.seq ||
      input.since < (journal.events[0]?.seq ?? journal.snapshot.seq + 1) - 1
    ) {
      listener({
        type: 'resync-required',
        reason: 'Session, generation or replay cursor is unavailable',
      })
      return () => undefined
    }
    for (const event of journal.events) {
      if (event.seq > input.since) {
        listener({ type: 'event', event })
      }
    }
    listener({ type: 'caught-up', epoch: journal.snapshot.epoch, seq: journal.snapshot.seq })
    journal.listeners.add(listener)
    return () => {
      journal.listeners.delete(listener)
    }
  }

  remove(sessionId: string): void {
    const journal = this.journals.get(sessionId)
    if (journal) {
      for (const listener of journal.listeners) {
        listener({ type: 'resync-required', reason: 'Runtime was replaced or removed' })
      }
      journal.listeners.clear()
      this.journals.delete(sessionId)
    }
  }

  close(): void {
    for (const sessionId of this.journals.keys()) {
      this.remove(sessionId)
    }
  }
}
