import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { HistoryDiagnostic, HistoryMessage, RuntimeSnapshot } from '@pi-workbench/shared'

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { and, asc, eq } from 'drizzle-orm'

import {
  previewText,
  readNativeHistory,
  readNativeMessage,
  readNativeRange,
} from '@pi-workbench/agent-adapter'
import {
  approvalRecordSchema,
  changeReferenceSchema,
  historyPageSchema,
  historyPageSize,
  historyPreviewBytes,
  queueRecordSchema,
  runtimeSnapshotSchema,
} from '@pi-workbench/shared'

import {
  sessionApprovals,
  sessionChanges,
  sessionQueue,
  sessionRuntimes,
  sessions,
  sessionTurns,
} from '../../infrastructure/database/schema.js'

type RuntimeRow = typeof sessionRuntimes.$inferSelect
type TurnRow = typeof sessionTurns.$inferSelect
interface LoadedMessage {
  message: HistoryMessage
  text: () => string
}
interface LoadedHistory {
  messages: LoadedMessage[]
  diagnostics: HistoryDiagnostic[]
  exports: Map<string, () => Buffer>
}

/** Daemon-owned index and recovery records. SDK JSONL remains the only committed message source.
 * Checkpoints contain a single inflight turn and are never imported into SDK history/context.
 * Synchronous transactions/atomic replacement preserve event order; only deltas are coalesced.
 */
export class SessionStore {
  private readonly pending = new Map<string, RuntimeSnapshot>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly failures = new Map<string, string>()
  private readonly sequences = new Map<string, number>()
  private closed = false
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly dataDir: string,
  ) {
    this.recoverRecords()
  }

  list() {
    return this.database.db.select().from(sessions).orderBy(asc(sessions.createdAt)).all()
  }

  /** Register a validated ready handshake before accepting any task. It never loads/resumes SDK. */
  registerRuntime(input: {
    sessionId: string
    epoch: string
    cwd: string
    nativeSessionId: string
    sessionFile: string
    source: RuntimeSnapshot['source']
  }): void {
    this.assertWritable(input.sessionId)
    const path = resolve(input.sessionFile)
    const boundary = relative(resolve(this.dataDir, 'kernels', input.sessionId, input.epoch), path)
    const prior = this.database.db
      .select()
      .from(sessionRuntimes)
      .where(eq(sessionRuntimes.sessionId, input.sessionId))
      .all()
    const managedResume = prior.some(
      (runtime) =>
        runtime.sessionFile === path &&
        runtime.nativeSessionId === input.nativeSessionId &&
        runtime.source === input.source,
    )
    if ((boundary.startsWith('..') || isAbsolute(boundary)) && !managedResume) {
      throw new Error('Native history is outside its managed runtime')
    }
    this.database.db.transaction((tx) => {
      const existing = tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
      if (existing && existing.cwd !== input.cwd) {
        throw new Error('Persisted session cwd cannot change')
      }
      tx.insert(sessions)
        .values({ id: input.sessionId, cwd: input.cwd, createdAt: Date.now() })
        .onConflictDoNothing()
        .run()
      tx.insert(sessionRuntimes)
        .values({
          epoch: input.epoch,
          sessionId: input.sessionId,
          nativeSessionId: input.nativeSessionId,
          sessionFile: path,
          source: input.source,
          createdAt: Math.max(Date.now(), ...prior.map((runtime) => runtime.createdAt + 1)),
        })
        .onConflictDoNothing()
        .run()
    })
  }

  /** Only an explicit daemon request can reopen its own validated native session. The directory
   * lease excludes another daemon; old CLI histories and display checkpoints are never adopted.
   */
  resumeRuntime(
    sessionId: string,
    cwd: string,
  ): { sessionFile: string; nativeSessionId: string } | undefined {
    this.assertWritable(sessionId)
    const session = this.list().find((item) => item.id === sessionId)
    if (!session) {
      return undefined
    }
    if (session.cwd !== cwd) {
      throw new Error('Persisted session cwd cannot change')
    }
    const runtime = this.database.db
      .select()
      .from(sessionRuntimes)
      .where(eq(sessionRuntimes.sessionId, sessionId))
      .orderBy(asc(sessionRuntimes.createdAt), asc(sessionRuntimes.epoch))
      .all()
      .at(-1)
    if (!runtime) {
      return undefined
    }
    if (runtime.source !== 'real-sdk/local-fixture') {
      throw new Error('Only managed real SDK history can cold restore')
    }
    if (!existsSync(runtime.sessionFile)) {
      // SDK does not create a JSONL file until it has committed a message.
      if (
        this.database.db
          .select()
          .from(sessionTurns)
          .where(eq(sessionTurns.epoch, runtime.epoch))
          .get()
      ) {
        throw new Error('Managed native history is missing')
      }
      return undefined
    }
    if (this.native(runtime).diagnostics.length) {
      throw new Error('Managed history requires diagnosis before cold restore')
    }
    return { sessionFile: runtime.sessionFile, nativeSessionId: runtime.nativeSessionId }
  }

  hasPendingApproval(sessionId: string): boolean {
    return this.database.db
      .select()
      .from(sessionApprovals)
      .where(eq(sessionApprovals.sessionId, sessionId))
      .all()
      .some((row) => {
        const record = approvalRecordSchema.safeParse(this.parse(row.data))
        return record.success && record.data.decision === 'pending'
      })
  }

  assertWritable(sessionId: string): void {
    if (this.closed) {
      throw new Error('Session store is closed')
    }
    if (this.failures.has(sessionId)) {
      throw new Error(`Session persistence unavailable: ${this.failures.get(sessionId)}`)
    }
    if (
      this.list().some((session) => session.id === sessionId) &&
      this.load(sessionId).diagnostics.some((diagnostic) => diagnostic.code !== 'unavailable')
    ) {
      throw new Error('Session history requires diagnosis before executing further work')
    }
  }

  /** Captures the authoritative event projection. Start is durable before prompt; intermediate
   * deltas target a 1.5 s checkpoint interval, terminal/approval/stopping flush immediately.
   * Timer failures remain diagnosable and block subsequent work without losing the old file.
   */
  capture(snapshot: RuntimeSnapshot, immediate: boolean): void {
    if (this.closed) {
      return
    }
    const active = snapshot.turns.at(-1)
    if (!active) {
      return
    }
    const runtime = this.database.db
      .select()
      .from(sessionRuntimes)
      .where(eq(sessionRuntimes.epoch, snapshot.epoch))
      .get()
    if (!runtime || runtime.sessionId !== snapshot.sessionId) {
      return
    }
    const existing = this.database.db
      .select()
      .from(sessionTurns)
      .where(eq(sessionTurns.id, active.id))
      .get()
    if (
      existing &&
      (existing.epoch !== snapshot.epoch ||
        existing.sessionId !== snapshot.sessionId ||
        existing.messageId !== active.messageId)
    ) {
      throw new Error('Persisted turn identity mismatch')
    }
    if (existing && existing.phase !== 'running') {
      return
    }
    if (!existing) {
      this.database.db
        .insert(sessionTurns)
        .values({
          id: active.id,
          sessionId: snapshot.sessionId,
          epoch: snapshot.epoch,
          messageId: active.messageId,
          phase: 'running',
          createdAt: Date.now(),
        })
        .run()
    }
    const key = active.id
    const sequenceKey = `${snapshot.epoch}:${key}`
    if (snapshot.seq <= (this.sequences.get(sequenceKey) ?? -1)) {
      return
    }
    this.sequences.set(sequenceKey, snapshot.seq)
    this.pending.set(key, { ...snapshot, turns: [structuredClone(active)] })
    if (immediate) {
      try {
        this.flush(key)
      } catch (error) {
        this.failures.set(
          snapshot.sessionId,
          error instanceof Error ? error.message : 'Checkpoint failed',
        )
        if (!existing) {
          throw error
        }
      }
    } else if (!this.timers.has(key)) {
      const timer = setTimeout(() => {
        this.timers.delete(key)
        try {
          this.flush(key)
        } catch (error) {
          this.failures.set(
            snapshot.sessionId,
            error instanceof Error ? error.message : 'Checkpoint failed',
          )
        }
      }, 1500)
      timer.unref()
      this.timers.set(key, timer)
    }
  }

  private checkpointPath(turn: Pick<TurnRow, 'sessionId' | 'epoch' | 'id'>): string {
    return join(this.dataDir, 'inflight', turn.sessionId, `${turn.epoch}-${turn.id}.json`)
  }

  private flush(key: string): void {
    const snapshot = this.pending.get(key)
    if (!snapshot) {
      return
    }
    const turn = snapshot.turns[0]
    if (!turn) {
      return
    }
    const path = this.checkpointPath({
      sessionId: snapshot.sessionId,
      epoch: snapshot.epoch,
      id: turn.id,
    })
    mkdirSync(join(this.dataDir, 'inflight', snapshot.sessionId), { recursive: true })
    const temp = `${path}.tmp`
    const fd = openSync(temp, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(snapshot))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    // Never remove the old checkpoint before replacement. A failed rename leaves it readable.
    renameSync(temp, path)
    if (turn.phase !== 'running' && turn.phase !== 'stopping') {
      this.database.db
        .update(sessionTurns)
        .set({ phase: turn.phase, tools: JSON.stringify(turn.tools) })
        .where(eq(sessionTurns.id, turn.id))
        .run()
      // The final native message can win even if a crash leaves this checkpoint behind.
      const runtime = this.database.db
        .select()
        .from(sessionRuntimes)
        .where(eq(sessionRuntimes.epoch, snapshot.epoch))
        .get()
      if (
        runtime &&
        this.native(runtime).records.some(
          (entry) =>
            entry.binding?.turnId === turn.id &&
            entry.message?.role === 'assistant' &&
            ['stop', 'length', 'aborted', 'error'].includes(entry.message.outcome ?? ''),
        )
      ) {
        unlinkSync(path)
      }
    }
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
    this.pending.delete(key)
    this.failures.delete(snapshot.sessionId)
  }

  saveQueue(value: unknown): void {
    const record = queueRecordSchema.parse(value)
    this.assertRecordIdentity(record, sessionQueue)
    this.database.db
      .insert(sessionQueue)
      .values({ id: record.id, sessionId: record.sessionId, data: JSON.stringify(record) })
      .onConflictDoUpdate({ target: sessionQueue.id, set: { data: JSON.stringify(record) } })
      .run()
  }
  saveApproval(value: unknown): void {
    const record = approvalRecordSchema.parse(value)
    this.assertRecordIdentity(record, sessionApprovals)
    const prior = this.database.db
      .select()
      .from(sessionApprovals)
      .where(eq(sessionApprovals.id, record.id))
      .get()
    if (prior && approvalRecordSchema.parse(JSON.parse(prior.data)).decision !== 'pending') {
      return
    }
    this.database.db
      .insert(sessionApprovals)
      .values({ id: record.id, sessionId: record.sessionId, data: JSON.stringify(record) })
      .onConflictDoUpdate({ target: sessionApprovals.id, set: { data: JSON.stringify(record) } })
      .run()
  }
  saveChangeReference(value: unknown): void {
    const record = changeReferenceSchema.parse(value)
    this.assertRecordIdentity(record, sessionChanges)
    this.database.db
      .insert(sessionChanges)
      .values({ id: record.id, sessionId: record.sessionId, data: JSON.stringify(record) })
      .onConflictDoNothing()
      .run()
  }

  private assertRecordIdentity(
    record: { id: string; sessionId: string; epoch: string; turnId: string },
    table: typeof sessionQueue | typeof sessionApprovals | typeof sessionChanges,
  ): void {
    this.assertWritable(record.sessionId)
    const runtime = this.database.db
      .select()
      .from(sessionRuntimes)
      .where(eq(sessionRuntimes.epoch, record.epoch))
      .get()
    if (!runtime || runtime.sessionId !== record.sessionId) {
      throw new Error('Record runtime identity mismatch')
    }
    const prior = this.database.db.select().from(table).where(eq(table.id, record.id)).get()
    if (prior) {
      const parsed = approvalRecordSchema
        .pick({ id: true, sessionId: true, epoch: true, turnId: true })
        .strip()
        .parse(this.parse(prior.data))
      if (
        parsed.sessionId !== record.sessionId ||
        parsed.epoch !== record.epoch ||
        parsed.turnId !== record.turnId
      ) {
        throw new Error('Record identity cannot be reassigned')
      }
    }
  }

  private recoverRecords(): void {
    this.database.db.transaction((tx) => {
      for (const row of tx.select().from(sessionQueue).all()) {
        const parsed = queueRecordSchema.safeParse(this.parse(row.data))
        if (parsed.success && parsed.data.status === 'queued') {
          tx.update(sessionQueue)
            .set({ data: JSON.stringify({ ...parsed.data, status: 'held' }) })
            .where(eq(sessionQueue.id, row.id))
            .run()
        }
      }
      for (const row of tx.select().from(sessionApprovals).all()) {
        const parsed = approvalRecordSchema.safeParse(this.parse(row.data))
        if (parsed.success && parsed.data.decision === 'pending') {
          tx.update(sessionApprovals)
            .set({
              data: JSON.stringify({
                ...parsed.data,
                decision: 'invalidated',
                reason: '服务已重启，旧待审批已失效；不会自动执行。',
              }),
            })
            .where(eq(sessionApprovals.id, row.id))
            .run()
        }
      }
      tx.update(sessionTurns)
        .set({ phase: 'interrupted' })
        .where(eq(sessionTurns.phase, 'running'))
        .run()
    })
  }

  private parse(text: string): unknown {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  private native(runtime: RuntimeRow) {
    // A tampered derived index cannot turn read-only history/export into an arbitrary file read.
    const path = resolve(runtime.sessionFile)
    const base = resolve(this.dataDir, 'kernels', runtime.sessionId)
    const inside = (candidate: string) => {
      const rel = relative(base, candidate)
      return !rel.startsWith('..') && !isAbsolute(rel)
    }
    if (!inside(path) || (existsSync(path) && !inside(realpathSync(path)))) {
      throw new Error('Unsafe managed history path')
    }
    return readNativeHistory(path, runtime.nativeSessionId)
  }

  private load(sessionId: string): LoadedHistory {
    const result: LoadedHistory = { messages: [], diagnostics: [], exports: new Map() }
    const runtimes = this.database.db
      .select()
      .from(sessionRuntimes)
      .where(eq(sessionRuntimes.sessionId, sessionId))
      .orderBy(asc(sessionRuntimes.createdAt), asc(sessionRuntimes.epoch))
      .all()
    const seenNative = new Set<string>()
    const finalTurns = new Set<string>()
    for (const runtime of runtimes) {
      let history: ReturnType<SessionStore['native']>
      try {
        history = this.native(runtime)
      } catch (error) {
        result.diagnostics.push({
          id: `index-${runtime.epoch}`,
          source: 'index',
          code: 'unsafe-reference',
          message: error instanceof Error ? error.message : 'Invalid native reference',
          line: 0,
          exportable: false,
        })
        continue
      }
      const alreadyRead = seenNative.has(runtime.sessionFile)
      seenNative.add(runtime.sessionFile)
      for (const diagnostic of alreadyRead ? [] : history.diagnostics) {
        const id = `${runtime.epoch}-${diagnostic.offset}`
        const missingCommittedHistory =
          diagnostic.code === 'unavailable' &&
          this.database.db
            .select()
            .from(sessionTurns)
            .where(eq(sessionTurns.epoch, runtime.epoch))
            .get() !== undefined
        result.diagnostics.push({
          id,
          source: 'sdk-jsonl',
          code: missingCommittedHistory ? 'missing-history' : diagnostic.code,
          message: diagnostic.message,
          line: diagnostic.line,
          exportable: diagnostic.length > 0,
        })
        if (diagnostic.length > 0) {
          result.exports.set(id, () =>
            readNativeRange(runtime.sessionFile, diagnostic.offset, diagnostic.length),
          )
        }
      }
      for (const entry of history.records) {
        if (!entry.message) {
          continue
        }
        const binding = entry.binding
        if (
          binding &&
          (binding.sessionId !== sessionId ||
            !runtimes.some(
              (owner) =>
                owner.epoch === binding.epoch &&
                owner.sessionFile === runtime.sessionFile &&
                owner.nativeSessionId === runtime.nativeSessionId,
            ))
        ) {
          if (alreadyRead) {
            continue
          }
          result.diagnostics.push({
            id: `binding-${entry.id}`,
            source: 'sdk-jsonl',
            code: 'identity-mismatch',
            message: '原生轮次标识与索引不一致。',
            line: entry.line,
            exportable: true,
          })
          result.exports.set(`binding-${entry.id}`, () =>
            readNativeRange(runtime.sessionFile, entry.offset, entry.length),
          )
          continue
        }
        // A retained native file can span cold generations. Keep each generation's native
        // records next to its interrupted checkpoints, instead of moving old partials last.
        if (binding ? binding.epoch !== runtime.epoch : alreadyRead) {
          continue
        }
        const message: HistoryMessage = {
          id: `${binding?.epoch ?? runtime.epoch}:${entry.id}`,
          epoch: binding?.epoch ?? runtime.epoch,
          nativeEntryId: entry.id,
          turnId: binding?.turnId ?? null,
          role: entry.message.role,
          text: entry.message.text,
          bytes: entry.message.bytes,
          truncated: entry.message.truncated,
          origin: 'sdk-jsonl',
          outcome: entry.message.outcome,
          error: entry.message.error,
        }
        result.messages.push({ message, text: () => readNativeMessage(runtime.sessionFile, entry) })
        if (
          binding &&
          message.role === 'assistant' &&
          ['stop', 'length', 'aborted', 'error'].includes(message.outcome ?? '')
        ) {
          finalTurns.add(binding.turnId)
        }
      }
      const turns = this.database.db
        .select()
        .from(sessionTurns)
        .where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.epoch, runtime.epoch)))
        .orderBy(asc(sessionTurns.createdAt), asc(sessionTurns.id))
        .all()
      for (const turn of turns) {
        if (
          !runtimeSnapshotSchema.shape.turns.element.shape.tools.safeParse(this.parse(turn.tools))
            .success
        ) {
          const id = `turn-${turn.id}`
          result.diagnostics.push({
            id,
            source: 'index',
            code: 'invalid-turn',
            message: '轮次工具索引损坏，保留原始记录。',
            line: 0,
            exportable: true,
          })
          result.exports.set(id, () => Buffer.from(JSON.stringify(turn)))
        }
        if (turn.phase === 'running') {
          continue
        }
        const path = this.checkpointPath(turn)
        if (!existsSync(path)) {
          continue
        }
        try {
          const snapshot = runtimeSnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
          const partial = snapshot.turns[0]
          if (
            snapshot.sessionId !== sessionId ||
            snapshot.epoch !== runtime.epoch ||
            snapshot.turns.length !== 1 ||
            !partial ||
            partial.id !== turn.id ||
            partial.messageId !== turn.messageId
          ) {
            throw new Error('Checkpoint identity mismatch')
          }
          if (finalTurns.has(turn.id)) {
            continue
          }
          if (
            !result.messages.some(
              (item) =>
                item.message.turnId === turn.id &&
                item.message.epoch === runtime.epoch &&
                item.message.role === 'user',
            )
          ) {
            result.messages.push({
              message: {
                id: `inflight:${runtime.epoch}:${turn.id}:input`,
                epoch: runtime.epoch,
                nativeEntryId: '',
                turnId: turn.id,
                role: 'user',
                text: previewText(partial.prompt),
                bytes: Buffer.byteLength(partial.prompt),
                truncated: Buffer.byteLength(partial.prompt) > historyPreviewBytes,
                origin: 'interrupted-checkpoint',
                outcome: 'interrupted',
                error: null,
              },
              text: () => partial.prompt,
            })
          }
          result.messages.push({
            message: {
              id: `inflight:${runtime.epoch}:${turn.id}:${turn.messageId}`,
              epoch: runtime.epoch,
              nativeEntryId: '',
              turnId: turn.id,
              role: 'assistant',
              text: previewText(partial.text),
              bytes: Buffer.byteLength(partial.text),
              truncated: Buffer.byteLength(partial.text) > historyPreviewBytes,
              origin: 'interrupted-checkpoint',
              outcome: 'interrupted',
              error: null,
            },
            text: () => partial.text,
          })
        } catch (error) {
          const id = `inflight-${turn.id}`
          result.diagnostics.push({
            id,
            source: 'inflight',
            code: 'invalid-checkpoint',
            message: error instanceof Error ? error.message : 'Invalid checkpoint',
            line: 0,
            exportable: true,
          })
          result.exports.set(id, () => readFileSync(path))
        }
      }
    }
    if (this.failures.has(sessionId)) {
      result.diagnostics.push({
        id: 'checkpoint-write',
        source: 'inflight',
        code: 'write-failed',
        message: this.failures.get(sessionId)!,
        line: 0,
        exportable: false,
      })
    }
    return result
  }

  /** Newest page by default, at most 100 messages, 64 KiB UTF-8 preview each. Stable IDs anchor
   * earlier pages. A vanished cursor is an explicit refresh error, never a silent history splice.
   */
  history(sessionId: string, cursor?: string, limit = historyPageSize) {
    if (!this.list().some((session) => session.id === sessionId)) {
      return undefined
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > historyPageSize) {
      throw new Error('History limit must be 1..100')
    }
    const loaded = this.load(sessionId)
    const end = cursor
      ? loaded.messages.findIndex((item) => item.message.id === cursor)
      : loaded.messages.length
    if (end < 0) {
      throw new Error('History cursor expired; refresh')
    }
    const start = Math.max(0, end - limit)
    const diagnostics = loaded.diagnostics
    const decode = <T>(
      rows: { id: string; data: string }[],
      parser: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    ): T[] =>
      rows.flatMap((row) => {
        const value = parser.safeParse(this.parse(row.data))
        if (value.success) {
          return [value.data]
        }
        diagnostics.push({
          id: `record-${row.id}`,
          source: 'index',
          code: 'invalid-record',
          message: '工作台记录损坏，原始数据保留且不可执行。',
          line: 0,
          exportable: true,
        })
        return []
      })
    const queue = decode(
      this.database.db
        .select()
        .from(sessionQueue)
        .where(eq(sessionQueue.sessionId, sessionId))
        .all(),
      queueRecordSchema,
    ).toSorted(
      (a, b) => a.kind.localeCompare(b.kind) || a.position - b.position || a.id.localeCompare(b.id),
    )
    const approvals = decode(
      this.database.db
        .select()
        .from(sessionApprovals)
        .where(eq(sessionApprovals.sessionId, sessionId))
        .all(),
      approvalRecordSchema,
    ).map((item) => Object.assign({}, item, { executable: false as const }))
    const changes = decode(
      this.database.db
        .select()
        .from(sessionChanges)
        .where(eq(sessionChanges.sessionId, sessionId))
        .all(),
      changeReferenceSchema,
    )
    const runtime = this.database.db
      .select()
      .from(sessionRuntimes)
      .where(eq(sessionRuntimes.sessionId, sessionId))
      .get()
    return historyPageSchema.parse({
      sessionId,
      source: runtime?.source ?? 'synthetic-ipc-fixture',
      messages: loaded.messages.slice(start, end).map((item) => item.message),
      nextCursor: start > 0 ? loaded.messages[start]?.message.id : null,
      diagnostics,
      queue,
      approvals,
      changes,
      canResume: false,
    })
  }

  /** Full original content plus termination metadata, so presentation can protect unfinished
   * credential fragments. The source is read-only; callers must filter at the output boundary.
   */
  content(
    sessionId: string,
    messageId: string,
  ): (Pick<HistoryMessage, 'origin' | 'outcome'> & { text: string }) | undefined {
    const loaded = this.load(sessionId).messages.find((item) => item.message.id === messageId)
    return loaded
      ? { text: loaded.text(), origin: loaded.message.origin, outcome: loaded.message.outcome }
      : undefined
  }
  raw(sessionId: string, diagnosticId: string): Buffer | undefined {
    const raw = this.load(sessionId).exports.get(diagnosticId)
    if (raw) {
      return raw()
    }
    for (const table of [sessionQueue, sessionApprovals, sessionChanges]) {
      const row = this.database.db
        .select()
        .from(table)
        .where(eq(table.sessionId, sessionId))
        .all()
        .find((item) => `record-${item.id}` === diagnosticId)
      if (row) {
        return Buffer.from(row.data)
      }
    }
    return undefined
  }

  /** Restores only the latest observed turn to CORE-05. Older messages use bounded history pages.
   * A fresh daemon identity resets replay cursors; no SDK process or authorization is recreated.
   */
  observations(daemonId: string): RuntimeSnapshot[] {
    return this.list().flatMap((session) => {
      const runtime = this.database.db
        .select()
        .from(sessionRuntimes)
        .where(eq(sessionRuntimes.sessionId, session.id))
        .orderBy(asc(sessionRuntimes.createdAt), asc(sessionRuntimes.epoch))
        .all()
        .at(-1)
      if (!runtime) {
        return []
      }
      const turn = this.database.db
        .select()
        .from(sessionTurns)
        .where(eq(sessionTurns.epoch, runtime.epoch))
        .orderBy(asc(sessionTurns.createdAt), asc(sessionTurns.id))
        .all()
        .at(-1)
      const loaded = this.load(session.id)
      const messages = loaded.messages.filter(
        (item) => item.message.epoch === runtime.epoch && item.message.turnId === turn?.id,
      )
      const last = messages.findLast((item) => item.message.role === 'assistant')
      const phase =
        last?.message.origin === 'interrupted-checkpoint' ||
        !last ||
        !['stop', 'length', 'aborted', 'error'].includes(last.message.outcome ?? '')
          ? 'interrupted'
          : last.message.outcome === 'aborted'
            ? 'aborted'
            : last.message.outcome === 'error'
              ? 'error'
              : 'completed'
      const tools = runtimeSnapshotSchema.shape.turns.element.shape.tools.safeParse(
        this.parse(turn?.tools ?? '[]'),
      )
      return [
        runtimeSnapshotSchema.parse({
          version: 1,
          daemonId,
          sessionId: session.id,
          epoch: runtime.epoch,
          seq: 0,
          source: runtime.source,
          turns: turn
            ? [
                {
                  id: turn.id,
                  messageId: turn.messageId,
                  prompt: messages.find((item) => item.message.role === 'user')?.text() ?? '',
                  text: messages
                    .filter((item) => item.message.role === 'assistant')
                    .map((item) => item.text())
                    .join(''),
                  phase,
                  tools: tools.success ? tools.data : [],
                  approval: null,
                  error:
                    phase === 'interrupted' ? '任务已中断；仅恢复观察记录，未自动继续。' : null,
                },
              ]
            : [],
        }),
      ]
    })
  }

  /** KernelService calls this after all owned processes settle and before database close. */
  close(): void {
    if (this.closed) {
      return
    }
    try {
      for (const key of this.pending.keys()) {
        this.flush(key)
      }
    } finally {
      for (const timer of this.timers.values()) {
        clearTimeout(timer)
      }
      this.timers.clear()
      this.closed = true
      this.database.close()
    }
  }
}
