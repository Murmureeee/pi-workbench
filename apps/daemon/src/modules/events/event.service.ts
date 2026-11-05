import type {
  RuntimeEvent,
  RuntimeFrame,
  RuntimeSnapshot,
  RuntimeSubscribe,
  SessionTitle,
  SessionTitleFrame,
} from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import {
  applyRuntimeEvent,
  Redactor,
  runtimeCapabilities,
  runtimeEventSchema,
  runtimeSnapshotSchema,
  visibleModelRequest,
  visibleReasoning,
  visibleToolObservation,
} from '@pi-workbench/shared'

interface Journal {
  snapshot: RuntimeSnapshot
  events: RuntimeEvent[]
  visibleEvents: RuntimeEvent[]
  visibleText: string
  bytes: number
  listeners: Set<{ send: (frame: RuntimeFrame) => void; visible: boolean }>
}

/** In-memory observation journal owned by the daemon. Snapshot+cursor capture and replay-to-live
 * registration are synchronous, so a concurrent SDK event cannot fall between them.
 * Retention bounds apply to replay only; full text is never truncated or written back to SDK history.
 */
export class EventService {
  readonly daemonId = randomUUID()
  private readonly journals = new Map<string, Journal>()
  private readonly changeListeners = new Set<() => void>()
  private readonly titleListeners = new Set<(frame: SessionTitleFrame) => void>()
  private persistence: ((snapshot: RuntimeSnapshot, immediate: boolean) => void) | undefined
  constructor(
    private readonly maxEvents = 1024,
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly redactor = new Redactor(),
  ) {}

  setPersistence(capture: (snapshot: RuntimeSnapshot, immediate: boolean) => void): void {
    this.persistence = capture
  }

  /** Internal state observers can wake admission when an approval is resolved. This does not
   * grant execution authority and is independent of any browser/WebSocket subscription.
   */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  /** Independent, read-only metadata channel. Register before acknowledging so the client
   * can fetch a fresh index without a notification gap; titles use the common redactor. */
  subscribeTitles(send: (frame: SessionTitleFrame) => void): () => void {
    this.titleListeners.add(send)
    send({ type: 'titles-subscribed', daemonId: this.daemonId })
    return () => {
      this.titleListeners.delete(send)
    }
  }

  publishTitle(title: SessionTitle): void {
    const frame: SessionTitleFrame = {
      type: 'title.updated',
      daemonId: this.daemonId,
      title: { ...title, title: this.redactor.text(title.title) },
    }
    for (const send of this.titleListeners) {
      send(frame)
    }
  }

  restore(snapshot: RuntimeSnapshot): void {
    this.remove(snapshot.sessionId)
    this.journals.set(snapshot.sessionId, {
      snapshot: runtimeSnapshotSchema.parse({ ...snapshot, daemonId: this.daemonId, seq: 0 }),
      events: [],
      visibleEvents: [],
      visibleText: '',
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
      visibleEvents: [],
      visibleText: '',
      bytes: 0,
      listeners: new Set(),
    })
  }

  snapshot(sessionId: string): RuntimeSnapshot | undefined {
    const value = this.journals.get(sessionId)?.snapshot
    return value ? structuredClone(value) : undefined
  }

  /** Presentation is separate from persistence and execution. Active text holds incomplete
   * tokens, so neither initial snapshots nor reconnects reveal partial secret values.
   */
  visibleSnapshot(sessionId: string): RuntimeSnapshot | undefined {
    const value = this.snapshot(sessionId)
    if (!value) {
      return undefined
    }
    const turns = value.turns.map((turn) => ({
      ...turn,
      text: this.redactor.text(turn.text, turn.phase !== 'completed'),
      tools: turn.tools.map((tool) => visibleToolObservation(tool, this.redactor)),
      ...(turn.reasoning ? { reasoning: visibleReasoning(turn.reasoning, this.redactor) } : {}),
      ...(turn.modelRequest
        ? { modelRequest: visibleModelRequest(turn.modelRequest, this.redactor) }
        : {}),
    }))
    return runtimeSnapshotSchema.parse(this.redactor.value({ ...value, turns }))
  }

  private visibleEvent(event: RuntimeEvent, next: RuntimeSnapshot, journal: Journal): RuntimeEvent {
    const turn = next.turns.at(-1)
    let payload = event.payload
    if (payload.type === 'turn.started') {
      journal.visibleText = ''
    } else if (payload.type === 'message.delta' && turn) {
      const text = this.redactor.text(turn.text, true)
      payload = {
        type: text.startsWith(journal.visibleText) ? 'message.delta' : 'message.replaced',
        messageId: payload.messageId,
        text: text.startsWith(journal.visibleText) ? text.slice(journal.visibleText.length) : text,
      }
      journal.visibleText = text
    } else if (payload.type === 'tool.updated' && turn) {
      const incoming = payload.tool
      const tool = turn.tools.find((item) => item.id === incoming.id)
      payload = {
        type: 'tool.updated',
        tool: visibleToolObservation(tool ?? incoming, this.redactor),
      }
    } else if (payload.type === 'reasoning.updated') {
      payload = { ...payload, reasoning: visibleReasoning(payload.reasoning, this.redactor) }
    } else if (payload.type === 'model.updated') {
      payload = {
        ...payload,
        modelRequest: visibleModelRequest(payload.modelRequest, this.redactor),
      }
    } else if (payload.type === 'turn.finished' && turn) {
      payload = { ...payload, text: this.redactor.text(turn.text, payload.outcome !== 'completed') }
    }
    return runtimeEventSchema.parse(this.redactor.value({ ...event, payload }))
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
    const visible = this.visibleEvent(event, next, journal)
    journal.visibleEvents.push(visible)
    journal.bytes +=
      Buffer.byteLength(JSON.stringify(event)) + Buffer.byteLength(JSON.stringify(visible))
    while (journal.events.length > this.maxEvents || journal.bytes > this.maxBytes) {
      const removed = journal.events.shift()
      const removedVisible = journal.visibleEvents.shift()
      if (removed) {
        journal.bytes -= Buffer.byteLength(JSON.stringify(removed))
      }
      if (removedVisible) {
        journal.bytes -= Buffer.byteLength(JSON.stringify(removedVisible))
      }
    }
    for (const listener of journal.listeners) {
      listener.send({ type: 'event', event: listener.visible ? visible : event })
    }
    for (const listener of this.changeListeners) {
      listener()
    }
  }

  /** Read-only subscription: never starts/stops work. Slow clients are disconnected by transport.
   * All replayed records retain their IDs; a stale/ahead cursor, epoch or daemon requires REST resync.
   */
  subscribe(
    input: RuntimeSubscribe,
    listener: (frame: RuntimeFrame) => void,
    visible = false,
  ): () => void {
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
    for (const event of visible ? journal.visibleEvents : journal.events) {
      if (event.seq > input.since) {
        listener({
          type: 'event',
          event: visible ? runtimeEventSchema.parse(this.redactor.value(event)) : event,
        })
      }
    }
    listener({ type: 'caught-up', epoch: journal.snapshot.epoch, seq: journal.snapshot.seq })
    const subscription = { send: listener, visible }
    journal.listeners.add(subscription)
    return () => {
      journal.listeners.delete(subscription)
    }
  }

  remove(sessionId: string): void {
    const journal = this.journals.get(sessionId)
    if (journal) {
      for (const listener of journal.listeners) {
        listener.send({ type: 'resync-required', reason: 'Runtime was replaced or removed' })
      }
      journal.listeners.clear()
      this.journals.delete(sessionId)
    }
  }

  close(): void {
    this.changeListeners.clear()
    this.titleListeners.clear()
    for (const sessionId of this.journals.keys()) {
      this.remove(sessionId)
    }
  }
}
