import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { AuditService } from '../security/audit.service.js'
import type {
  HistoryDiagnostic,
  HistoryMessage,
  InputQueueRecord,
  ManagedSession,
  ModelSelection,
  ModelUsageRecord,
  RuntimeSnapshot,
  SessionModelState,
  SessionOrganization,
  SessionOrganize,
  SessionRename,
  SessionSubmission,
  SessionSubmit,
  SessionTitle,
} from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import {
  previewText,
  readNativeHistory,
  readNativeMessage,
  readNativeRange,
  recordedContextWindow,
} from '@pi-workbench/agent-adapter'
import {
  approvalRecordSchema,
  changeReferenceSchema,
  historyPageSchema,
  historyPageSize,
  historyPreviewBytes,
  interruptModelRequest,
  interruptToolObservations,
  managedSessionSchema,
  modelRequestSchema,
  modelSelectionSchema,
  queueRecordSchema,
  runtimeSnapshotSchema,
  sessionModelStateSchema,
  sessionOrganizationSchema,
  sessionUsageSchema,
  submissionSchema,
  sumRecordedTokens,
} from '@pi-workbench/shared'

import {
  inputReferences,
  sessionApprovals,
  sessionChanges,
  sessionConfigurations,
  sessionModelSettings,
  sessionOrganization,
  sessionOrigins,
  sessionQueue,
  sessionRuntimes,
  sessions,
  sessionSubmissions,
  sessionTurns,
} from '../../infrastructure/database/schema.js'

type RuntimeRow = typeof sessionRuntimes.$inferSelect
type TurnRow = typeof sessionTurns.$inferSelect
interface LoadedMessage {
  message: HistoryMessage
  text: () => string
  usage?: ModelUsageRecord
}
interface LoadedHistory {
  messages: LoadedMessage[]
  diagnostics: HistoryDiagnostic[]
  exports: Map<string, () => Buffer>
}

function searchFileStamp(path: string): string[] {
  try {
    const stat = statSync(path, { bigint: true })
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)
  } catch {
    return ['unavailable']
  }
}

/** A stale view or unsafe archive must be refreshed; it never partially saves metadata. */
export class SessionOrganizationConflict extends Error {}

/** A lost CAS never overwrites a title, including late background naming candidates. */
export class SessionTitleConflict extends Error {}

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
    private readonly audit?: AuditService,
  ) {
    this.recoverRecords()
    this.recoverSubmissions()
  }

  list() {
    return this.database.db.select().from(sessions).orderBy(asc(sessions.createdAt)).all()
  }

  /** Lightweight index-only badges remain discoverable even when no view/SDK is mounted.
   * They grant no approval authority and never scan message bodies or admit a kernel. */
  activity() {
    return this.list().map((session) => ({
      id: session.id,
      running: this.database.db
        .select()
        .from(sessionSubmissions)
        .where(eq(sessionSubmissions.sessionId, session.id))
        .all()
        .some((row) => row.status === 'pending' || row.status === 'executing'),
      approvals: this.hasPendingApproval(session.id) ? 1 : 0,
      held: this.database.db
        .select()
        .from(sessionQueue)
        .where(eq(sessionQueue.sessionId, session.id))
        .all()
        .filter((row) => {
          const parsed = queueRecordSchema.safeParse(this.parse(row.data))
          return (
            parsed.success &&
            ['held', 'queued', 'sending', 'uncertain'].includes(parsed.data.status)
          )
        }).length,
    }))
  }

  managedSessions(): ManagedSession[] {
    return this.database.db
      .select()
      .from(sessionConfigurations)
      .all()
      .map((row) => {
        const session = this.database.db
          .select()
          .from(sessions)
          .where(eq(sessions.id, row.sessionId))
          .get()
        if (!session) {
          throw new Error('Session configuration lost its index')
        }
        return managedSessionSchema.parse({
          id: session.id,
          cwd: session.cwd,
          createdAt: session.createdAt,
          title: row.title,
          titleSource: row.titleSource,
          titleVersion: row.titleVersion,
          membershipVersion: row.membershipVersion,
          creationRequestId: row.creationRequestId,
          workspaceId: row.workspaceId,
          configuration: this.parse(row.configuration),
        })
      })
  }

  /** Point lookup of the saved execution binding for read-only environment observation.
   * Project membership and mutable workspace paths must never substitute for this cwd. */
  executionEnvironment(sessionId: string) {
    return this.database.db
      .select({ cwd: sessions.cwd, workspaceId: sessionConfigurations.workspaceId })
      .from(sessions)
      .innerJoin(sessionConfigurations, eq(sessionConfigurations.sessionId, sessions.id))
      .where(eq(sessions.id, sessionId))
      .get()
  }

  origin(sessionId: string) {
    return this.database.db
      .select()
      .from(sessionOrigins)
      .where(eq(sessionOrigins.sessionId, sessionId))
      .get()
  }

  /** Legacy sessions derive their initial selection without writing or opening a kernel. */
  modelState(sessionId: string): SessionModelState {
    const session = this.managedSessions().find((row) => row.id === sessionId)
    if (!session) {
      throw new Error('会话不存在。')
    }
    const row = this.database.db
      .select()
      .from(sessionModelSettings)
      .where(eq(sessionModelSettings.sessionId, sessionId))
      .get()
    const initial = modelSelectionSchema.parse({
      model: session.configuration.model,
      thinking: session.configuration.thinking,
    })
    return sessionModelStateSchema.parse(
      row
        ? {
            ...row,
            requested: this.parse(row.requested),
            effective: this.parse(row.effective),
          }
        : { sessionId, revision: 1, requested: initial, effective: initial, effectiveRevision: 1 },
    )
  }

  /** Selection and saved configuration change in one CAS transaction. Active requests keep
   * their immutable selection; no runtime is started and no source configuration is edited. */
  changeModel(
    sessionId: string,
    selection: ModelSelection,
    expectedRevision: number,
    running: boolean,
  ) {
    return this.database.db.transaction((tx) => {
      const state = this.modelState(sessionId)
      if (this.closed || state.revision !== expectedRevision) {
        throw new SessionOrganizationConflict('模型配置已变化，请刷新核对；原模型保留。')
      }
      const session = this.managedSessions().find((row) => row.id === sessionId)!
      const revision = state.revision + 1
      const next = {
        ...state,
        requested: selection,
        revision,
        ...(!running ? { effective: selection, effectiveRevision: revision } : {}),
      }
      tx.insert(sessionModelSettings)
        .values({
          sessionId,
          revision,
          requested: JSON.stringify(selection),
          effective: JSON.stringify(next.effective),
          effectiveRevision: next.effectiveRevision,
        })
        .onConflictDoUpdate({
          target: sessionModelSettings.sessionId,
          set: {
            revision,
            requested: JSON.stringify(selection),
            effective: JSON.stringify(next.effective),
            effectiveRevision: next.effectiveRevision,
          },
        })
        .run()
      tx.update(sessionConfigurations)
        .set({ configuration: JSON.stringify({ ...session.configuration, ...selection }) })
        .where(eq(sessionConfigurations.sessionId, sessionId))
        .run()
      return sessionModelStateSchema.parse(next)
    })
  }

  /** Only a matched SDK request acknowledgement advances the effective selection. A newer
   * requested revision stays pending; stale acknowledgements cannot replace its intent. */
  modelApplied(sessionId: string, revision: number, selection: ModelSelection): void {
    const state = this.modelState(sessionId)
    if (revision < state.effectiveRevision || revision > state.revision) {
      return
    }
    this.database.db
      .update(sessionModelSettings)
      .set({ effective: JSON.stringify(selection), effectiveRevision: revision })
      .where(eq(sessionModelSettings.sessionId, sessionId))
      .run()
  }

  /** Atomic, metadata-only CAS. The caller synchronously validates the target project.
   * It never touches cwd, model, accepted input, SDK history, files or resource consent. */
  setProject(sessionId: string, projectId: string | null, expectedVersion: number): ManagedSession {
    this.database.db.transaction((tx) => {
      const row = tx
        .select()
        .from(sessionConfigurations)
        .where(eq(sessionConfigurations.sessionId, sessionId))
        .get()
      if (this.closed || !row || row.membershipVersion !== expectedVersion) {
        throw new SessionOrganizationConflict('会话归属已更新，请核对最新归属后再保存。')
      }
      const configuration = managedSessionSchema.shape.configuration.parse(
        this.parse(row.configuration),
      )
      tx.update(sessionConfigurations)
        .set({
          projectId,
          membershipVersion: expectedVersion + 1,
          configuration: JSON.stringify({ ...configuration, projectId }),
        })
        .where(eq(sessionConfigurations.sessionId, sessionId))
        .run()
    })
    return this.managedSessions().find((row) => row.id === sessionId)!
  }

  organizations(): SessionOrganization[] {
    return this.database.db
      .select()
      .from(sessionOrganization)
      .all()
      .map((row) =>
        sessionOrganizationSchema.parse({
          ...row,
          unread: row.manualUnread || row.resultVersion > row.readVersion,
        }),
      )
  }

  /** Canonical title index. SDK message bodies and legacy CLI histories are never rewritten.
   * Optional literal matching is only a title index lookup, not SESSION-12 full-text search. */
  titles(query = ''): SessionTitle[] {
    return this.database.db
      .select({
        sessionId: sessionConfigurations.sessionId,
        title: sessionConfigurations.title,
        titleSource: sessionConfigurations.titleSource,
        titleVersion: sessionConfigurations.titleVersion,
      })
      .from(sessionConfigurations)
      .where(query ? sql`instr(${sessionConfigurations.title}, ${query}) > 0` : undefined)
      .all()
  }

  /** Synchronous SQLite CAS is the only title writer. Automatic candidates additionally bind
   * their creation request and local source; once user-owned, a title cannot revert to local.
   * Failure leaves the previous title/version intact; no SDK admission or JSONL write occurs. */
  rename(sessionId: string, input: SessionRename, localRequestId?: string): SessionTitle {
    if (this.closed) {
      throw new Error('Session store is closed')
    }
    const row = this.database.db
      .update(sessionConfigurations)
      .set({
        title: input.title,
        titleSource: localRequestId ? 'local' : 'user',
        titleVersion: input.expectedVersion + 1,
      })
      .where(
        and(
          eq(sessionConfigurations.sessionId, sessionId),
          eq(sessionConfigurations.titleVersion, input.expectedVersion),
          localRequestId
            ? and(
                eq(sessionConfigurations.creationRequestId, localRequestId),
                eq(sessionConfigurations.titleSource, 'local'),
              )
            : undefined,
        ),
      )
      .returning()
      .get()
    if (!row) {
      throw new SessionTitleConflict('标题已被其他客户端更新，请核对最新版本后再保存。')
    }
    return {
      sessionId,
      title: row.title,
      titleSource: row.titleSource,
      titleVersion: row.titleVersion,
    }
  }

  /** Compare-and-set personal metadata. Read receipts cover only displayed results; a
   * stale receipt cannot clear a later result or manual unread action. Archive checks
   * durable activity inside this transaction; it neither stops tasks nor restores grants.
   */
  organize(sessionId: string, input: SessionOrganize): SessionOrganization {
    if (this.closed) {
      throw new Error('Session store is closed')
    }
    return this.database.db.transaction((tx) => {
      const prior = tx
        .select()
        .from(sessionOrganization)
        .where(eq(sessionOrganization.sessionId, sessionId))
        .get()
      if (!prior || prior.revision !== input.expectedRevision) {
        throw new SessionOrganizationConflict('会话整理状态已变化，请刷新后重试。')
      }
      if (input.action === 'archive' && input.archived) {
        const activity = this.activity().find((item) => item.id === sessionId)
        if (activity?.running || activity?.approvals || activity?.held) {
          throw new SessionOrganizationConflict(
            '会话仍有运行、待审批或待处理任务；请先停止或处理，再确认归档。',
          )
        }
      }
      if (input.action === 'read' && input.throughVersion > prior.resultVersion) {
        throw new SessionOrganizationConflict('阅读版本无效，请刷新内容。')
      }
      const patch =
        input.action === 'pin'
          ? { pinned: input.pinned }
          : input.action === 'archive'
            ? { archived: input.archived }
            : input.action === 'unread'
              ? { manualUnread: true }
              : {
                  manualUnread: false,
                  readVersion: Math.max(prior.readVersion, input.throughVersion),
                }
      const row = { ...prior, ...patch, revision: prior.revision + 1 }
      tx.update(sessionOrganization)
        .set(row)
        .where(eq(sessionOrganization.sessionId, sessionId))
        .run()
      return sessionOrganizationSchema.parse({
        ...row,
        unread: row.manualUnread || row.resultVersion > row.readVersion,
      })
    })
  }

  submission(requestId: string) {
    return this.database.db
      .select()
      .from(sessionSubmissions)
      .where(eq(sessionSubmissions.requestId, requestId))
      .get()
  }

  submissions(sessionId: string): SessionSubmission[] {
    const history = this.load(sessionId)
    return this.database.db
      .select()
      .from(sessionSubmissions)
      .where(eq(sessionSubmissions.sessionId, sessionId))
      .orderBy(asc(sessionSubmissions.createdAt), asc(sessionSubmissions.requestId))
      .all()
      .map((row) => {
        const native = history.messages.find(
          ({ message }) =>
            message.turnId === row.turnId &&
            message.role === 'user' &&
            message.origin === 'sdk-jsonl',
        )
        const { digest: _digest, ...visible } = row
        return submissionSchema.parse({
          ...visible,
          text: row.text ?? native?.text() ?? '原生输入暂不可读，请检查历史诊断。',
        })
      })
  }

  receipt(requestId: string) {
    const row = this.submission(requestId)
    if (!row) {
      return undefined
    }
    const session = this.managedSessions().find((item) => item.id === row.sessionId)
    const submission = this.submissions(row.sessionId).find((item) => item.requestId === requestId)
    if (!session || !submission) {
      throw new Error('Accepted submission lost its session')
    }
    return { session, submission }
  }

  /** Metadata-only detach, synchronously called inside the project removal transaction.
   * Preserves workspace/model/cwd, accepted input digests, runtime state and SDK history.
   * A concurrent admission rechecks current attribution before accepting new input. */
  detachProject(projectId: string): void {
    this.database.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(sessionConfigurations)
        .where(eq(sessionConfigurations.projectId, projectId))
        .all()
      for (const row of rows) {
        const configuration = managedSessionSchema.shape.configuration.parse(
          JSON.parse(row.configuration),
        )
        tx.update(sessionConfigurations)
          .set({
            projectId: null,
            membershipVersion: row.membershipVersion + 1,
            configuration: JSON.stringify({ ...configuration, projectId: null }),
          })
          .where(eq(sessionConfigurations.sessionId, row.sessionId))
          .run()
      }
    })
  }

  /** Stable index, configuration and first input commit in one FULL SQLite transaction,
   * before any SDK startup. A reused request with changed input is never accepted.
   * Pending text is an outbox, retired only after a matching native user entry is readable.
   */
  acceptSubmission(
    input: SessionSubmit,
    digest: string,
    prepared: ManagedSession,
    queueId?: string,
    promptText = input.text,
  ) {
    this.assertWritable(prepared.id)
    return this.database.db.transaction((tx) => {
      const duplicate = tx
        .select()
        .from(sessionSubmissions)
        .where(eq(sessionSubmissions.requestId, input.requestId))
        .get()
      if (duplicate) {
        if (duplicate.digest !== digest) {
          throw new Error('Request ID is already bound to different input')
        }
        return false
      }
      if (
        tx
          .select()
          .from(sessionOrganization)
          .where(eq(sessionOrganization.sessionId, prepared.id))
          .get()?.archived
      ) {
        throw new SessionOrganizationConflict('会话已归档，请先恢复后再发送。草稿仍保留。')
      }
      if (
        tx
          .select()
          .from(sessionSubmissions)
          .where(eq(sessionSubmissions.sessionId, prepared.id))
          .all()
          .some((row) => row.status === 'pending' || row.status === 'executing')
      ) {
        throw new Error('Session already has an accepted task')
      }
      if (
        this.inputQueue(prepared.id).some(
          (row) =>
            ['queued', 'held', 'sending', 'uncertain'].includes(row.status) && row.id !== queueId,
        )
      ) {
        if (!queueId) {
          throw new Error('先处理保留队列，再发送独立任务。')
        }
      }
      if (!input.sessionId) {
        tx.insert(sessions)
          .values({ id: prepared.id, cwd: prepared.cwd, createdAt: prepared.createdAt })
          .run()
        tx.insert(sessionConfigurations)
          .values({
            sessionId: prepared.id,
            creationRequestId: input.requestId,
            projectId: prepared.configuration.projectId,
            workspaceId: prepared.workspaceId,
            configuration: JSON.stringify(prepared.configuration),
            title: prepared.title,
          })
          .run()
        tx.insert(sessionOrganization)
          .values({ sessionId: prepared.id, updatedAt: prepared.createdAt })
          .run()
        tx.insert(sessionOrigins)
          .values({
            sessionId: prepared.id,
            kind: prepared.configuration.workspaceId ? 'workspace' : 'standalone',
            cwd: prepared.cwd,
            workspaceId: prepared.workspaceId,
            projectId: prepared.configuration.projectId,
            recordedAt: prepared.createdAt,
            provenance: 'created',
          })
          .run()
      }
      const acceptedTurnId = randomUUID()
      for (const id of input.references?.ids ?? []) {
        const row = tx.select().from(inputReferences).where(eq(inputReferences.id, id)).get()
        if (
          !row ||
          row.draftId !== input.references?.draftId ||
          (row.sessionId && row.sessionId !== prepared.id)
        ) {
          throw new Error('Input reference no longer belongs to this draft')
        }
        tx.update(inputReferences)
          .set({ sessionId: prepared.id, requestId: input.requestId })
          .where(eq(inputReferences.id, id))
          .run()
      }
      if (queueId) {
        const queued = this.inputQueue(prepared.id).find((item) => item.id === queueId)
        if (!queued || queued.status !== 'sending' || queued.text !== input.text) {
          throw new Error('Queued input changed before admission')
        }
        tx.update(sessionQueue)
          .set({
            data: JSON.stringify({
              ...queued,
              status: 'delivered',
              deliveredTurnId: acceptedTurnId,
              error: null,
              revision: queued.revision + 1,
            }),
          })
          .where(eq(sessionQueue.id, queueId))
          .run()
      }
      tx.insert(sessionSubmissions)
        .values({
          requestId: input.requestId,
          sessionId: prepared.id,
          messageId: randomUUID(),
          turnId: acceptedTurnId,
          digest,
          text: promptText,
          retryOf: input.retryOf,
          status: 'pending',
          createdAt: Date.now(),
        })
        .run()
      const organization = tx
        .select()
        .from(sessionOrganization)
        .where(eq(sessionOrganization.sessionId, prepared.id))
        .get()
      tx.update(sessionOrganization)
        .set({ updatedAt: Date.now(), revision: (organization?.revision ?? 0) + 1 })
        .where(eq(sessionOrganization.sessionId, prepared.id))
        .run()
      return true
    })
  }

  /** Updates an accepted command only. Shutdown may have already closed the store; its
   * durable active record is then recovered as interrupted, never automatically replayed.
   */
  settleSubmission(
    requestId: string,
    status: SessionSubmission['status'],
    error: string | null = null,
  ): void {
    if (this.closed) {
      return
    }
    const row = this.submission(requestId)
    if (!row) {
      throw new Error('Unknown accepted submission')
    }
    if (!['pending', 'executing'].includes(row.status)) {
      return
    }
    const committed = this.load(row.sessionId).messages.some(
      ({ message }) =>
        message.turnId === row.turnId && message.role === 'user' && message.origin === 'sdk-jsonl',
    )
    this.database.db.transaction((tx) => {
      tx.update(sessionSubmissions)
        .set({ status, error, ...(committed ? { text: null } : {}) })
        .where(eq(sessionSubmissions.requestId, requestId))
        .run()
      if (
        ['pending', 'executing'].includes(row.status) &&
        !['pending', 'executing'].includes(status)
      ) {
        const prior = tx
          .select()
          .from(sessionOrganization)
          .where(eq(sessionOrganization.sessionId, row.sessionId))
          .get()
        if (prior) {
          tx.update(sessionOrganization)
            .set({
              resultVersion: prior.resultVersion + 1,
              resultRequestId: requestId,
              revision: prior.revision + 1,
              updatedAt: Date.now(),
            })
            .where(eq(sessionOrganization.sessionId, row.sessionId))
            .run()
        }
      }
    })
  }

  private recoverSubmissions(): void {
    for (const row of this.database.db.select().from(sessionSubmissions).all()) {
      if (!['pending', 'executing'].includes(row.status)) {
        continue
      }
      const native = this.load(row.sessionId).messages.find(
        ({ message }) =>
          message.turnId === row.turnId &&
          message.role === 'assistant' &&
          message.origin === 'sdk-jsonl' &&
          ['stop', 'length', 'error', 'aborted'].includes(message.outcome ?? ''),
      )
      const status =
        native?.message.outcome === 'error'
          ? 'failed'
          : native?.message.outcome === 'aborted'
            ? 'aborted'
            : native
              ? 'completed'
              : 'interrupted'
      this.settleSubmission(
        row.requestId,
        status,
        status === 'interrupted'
          ? '服务已重启；任务结果待确认，未自动重发。'
          : (native?.message.error ?? null),
      )
    }
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
    // Active calls must survive a restart too. Keep the row phase running until a terminal
    // checkpoint; a stopping row must still accept its later terminal capture.
    const terminal = turn.phase !== 'running' && turn.phase !== 'stopping'
    this.database.db
      .update(sessionTurns)
      .set({
        tools: JSON.stringify(turn.tools),
        modelRequest: turn.modelRequest ? JSON.stringify(turn.modelRequest) : null,
        phase: turn.phase === 'stopping' ? 'running' : turn.phase,
      })
      .where(eq(sessionTurns.id, turn.id))
      .run()
    if (terminal) {
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

  /** Queue bodies are host-owned outbox records. Version checks and claims are synchronous
   * on the sole SQLite owner, so edits cannot replace an already selected SDK input. */
  inputQueue(sessionId: string): InputQueueRecord[] {
    return this.database.db
      .select()
      .from(sessionQueue)
      .where(eq(sessionQueue.sessionId, sessionId))
      .all()
      .map((row) => queueRecordSchema.parse(this.parse(row.data)))
      .toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  }

  updateInput(record: InputQueueRecord, expectedRevision: number): InputQueueRecord {
    const current = this.inputQueue(record.sessionId).find((row) => row.id === record.id)
    if (!current || current.revision !== expectedRevision) {
      throw new SessionOrganizationConflict('队列版本已变化；编辑保留，请刷新核对。')
    }
    const next = { ...record, revision: expectedRevision + 1 }
    this.saveQueue(next)
    return next
  }

  /** Pause on stop/failure/shutdown; selected but unacknowledged input stays uncertain and
   * cannot be resumed blindly. Already delivered records are immutable audit evidence. */
  holdInput(sessionId: string): void {
    for (const row of this.inputQueue(sessionId)) {
      if (row.status === 'queued' || row.status === 'sending') {
        this.updateInput(
          { ...row, status: row.status === 'sending' ? 'uncertain' : 'held' },
          row.revision,
        )
      }
    }
  }
  /** A pending record may settle once. Durable decision and append-only audit commit in
   * the same transaction; audit failure cannot create a permit or rewrite a terminal record. */
  saveApproval(value: unknown): void {
    const record = approvalRecordSchema.parse(value)
    this.assertRecordIdentity(record, sessionApprovals)
    this.database.sqlite.transaction(() => {
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
      const data = record.parameters
      const grant =
        data.grant && typeof data.grant === 'object' && 'id' in data.grant ? data.grant : null
      const risk =
        data.risk && typeof data.risk === 'object' && 'level' in data.risk ? data.risk.level : null
      const actor = typeof data.actor === 'string' ? data.actor : null
      this.audit?.record({
        kind: data.kind === 'session-grant' ? 'session-grant' : 'approval',
        objectId: grant && typeof grant.id === 'string' ? grant.id : record.id,
        sessionId: record.sessionId,
        source:
          record.source === 'synthetic-fixture' ? 'synthetic-fixture' : actor ? 'human' : 'host',
        actor,
        risk:
          risk === 'L0' || risk === 'L1' || risk === 'L2' || risk === 'L3'
            ? risk
            : grant
              ? 'L2'
              : 'unknown',
        decision:
          data.kind === 'session-grant' && typeof data.event === 'string'
            ? data.event
            : record.decision,
        scope: JSON.stringify({ epoch: record.epoch, turnId: record.turnId, ...data }),
        reason: record.reason,
      })
    })()
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
        if (parsed.success && ['queued', 'sending'].includes(parsed.data.status)) {
          tx.update(sessionQueue)
            .set({
              data: JSON.stringify({
                ...parsed.data,
                status: parsed.data.status === 'sending' ? 'uncertain' : 'held',
                revision: parsed.data.revision + 1,
              }),
            })
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

  /** Whole-task retry is unsafe after any tool/approval observation, including denial or an
   * unknown record. This check grants no execution permission and never touches native history. */
  retryRequiresReview(sessionId: string, turnId: string): boolean {
    const row = this.database.db
      .select()
      .from(sessionTurns)
      .where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.id, turnId)))
      .get()
    if (row) {
      const tools = runtimeSnapshotSchema.shape.turns.element.shape.tools.safeParse(
        this.parse(row.tools),
      )
      if (!tools.success || tools.data.length > 0) {
        return true
      }
    }
    return this.database.db
      .select()
      .from(sessionApprovals)
      .where(eq(sessionApprovals.sessionId, sessionId))
      .all()
      .some((approvalRow) => {
        const approval = approvalRecordSchema.safeParse(this.parse(approvalRow.data))
        return !approval.success || approval.data.turnId === turnId
      })
  }

  private nativePath(runtime: RuntimeRow) {
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
    return path
  }

  private native(runtime: RuntimeRow) {
    return readNativeHistory(this.nativePath(runtime), runtime.nativeSessionId)
  }

  /** Host-only change token for rebuilding search. Filesystem identities and nanosecond
   * modification/change times detect SDK appends/replacements; no caller path is accepted.
   * Checkpoints are included, but active deltas remain outside persisted search results. */
  searchStamp(sessionId: string): string {
    const runtimes = this.database.db
      .select()
      .from(sessionRuntimes)
      .where(eq(sessionRuntimes.sessionId, sessionId))
      .all()
    const turns = this.database.db
      .select()
      .from(sessionTurns)
      .where(eq(sessionTurns.sessionId, sessionId))
      .all()
    const native = runtimes.map((row) => {
      try {
        return [row.epoch, row.nativeSessionId, searchFileStamp(this.nativePath(row))]
      } catch {
        return [row.epoch, 'unsafe']
      }
    })
    return createHash('sha256')
      .update(
        JSON.stringify([
          native,
          turns.map((row) => [row.id, row.phase, searchFileStamp(this.checkpointPath(row))]),
        ]),
      )
      .digest('hex')
  }

  /** Read-only index source, owned by Sessions. Full original user/assistant text is returned
   * only inside the host; Search must redact before persisting or producing snippets.
   * Stable message IDs allow history to resolve the original even outside its latest page. */
  searchSource(sessionId: string) {
    const loaded = this.load(sessionId)
    return {
      incomplete: loaded.diagnostics.length > 0,
      messages: loaded.messages.flatMap(({ message, text }, position) =>
        message.role === 'user' || message.role === 'assistant'
          ? [
              {
                id: message.id,
                role: message.role,
                position,
                text: text(),
                incomplete:
                  message.origin === 'interrupted-checkpoint' ||
                  ['aborted', 'error', 'interrupted'].includes(message.outcome ?? ''),
              },
            ]
          : [],
      ),
    }
  }

  /** Search reads only outbox metadata; it must not hydrate submitted/native message bodies. */
  searchActivity(sessionId: string) {
    return this.database.db
      .select({ status: sessionSubmissions.status, createdAt: sessionSubmissions.createdAt })
      .from(sessionSubmissions)
      .where(eq(sessionSubmissions.sessionId, sessionId))
      .orderBy(desc(sessionSubmissions.createdAt), desc(sessionSubmissions.requestId))
      .get()
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
          ...(entry.message.reasoning ? { reasoning: entry.message.reasoning } : {}),
          bytes: entry.message.bytes,
          truncated: entry.message.truncated,
          origin: 'sdk-jsonl',
          outcome: entry.message.outcome,
          error: entry.message.error,
        }
        result.messages.push({
          message,
          text: () => readNativeMessage(runtime.sessionFile, entry),
          ...(entry.message.usage
            ? {
                usage: {
                  ...entry.message.usage,
                  messageId: message.id,
                  epoch: message.epoch,
                  turnId: message.turnId,
                  contextWindow: recordedContextWindow(
                    entry.message.usage.provider,
                    entry.message.usage.model,
                  ),
                },
              }
            : {}),
        })
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
              ...(partial.reasoning ? { reasoning: partial.reasoning } : {}),
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

  /** Read-only usage from identity-checked committed records. Partial counters/diagnostics
   * stay visible; paging returns 20 turns and at most 100 requests each, without model calls. */
  usage(sessionId: string, cursor?: string) {
    if (!this.managedSessions().some((session) => session.id === sessionId)) {
      return undefined
    }
    const stamp = this.searchStamp(sessionId)
    const loaded = this.load(sessionId)
    const submissions = this.database.db
      .select()
      .from(sessionSubmissions)
      .where(eq(sessionSubmissions.sessionId, sessionId))
      .orderBy(asc(sessionSubmissions.createdAt), asc(sessionSubmissions.requestId))
      .all()
    const end = cursor ? submissions.findIndex((row) => row.turnId === cursor) : submissions.length
    if (end < 0) {
      throw new Error('用量分页位置已失效，请刷新。')
    }
    const start = Math.max(0, end - 20)
    const records = loaded.messages.flatMap((item) => (item.usage ? [item.usage] : []))
    if (this.searchStamp(sessionId) !== stamp) {
      throw new Error('历史正在更新，请刷新用量；未混合统计。')
    }
    return sessionUsageSchema.parse({
      sessionId,
      observedAt: Date.now(),
      source: 'sdk-jsonl',
      totals: sumRecordedTokens(records),
      latest: records.at(-1) ?? null,
      turns: submissions.slice(start, end).map((row) => {
        const requests = records.filter((record) => record.turnId === row.turnId)
        return {
          turnId: row.turnId,
          status: row.status,
          createdAt: row.createdAt,
          requests: requests.slice(-100),
          totalRequests: requests.length,
        }
      }),
      nextCursor: start > 0 ? (submissions[start]?.turnId ?? null) : null,
      totalTurns: submissions.length,
      diagnostics: loaded.diagnostics.map((item) => item.code),
    })
  }

  /** Newest page by default, at most 100 messages, 64 KiB UTF-8 preview each. Stable IDs anchor
   * earlier pages. A vanished cursor is an explicit refresh error, never a silent history splice. */
  history(sessionId: string, cursor?: string, limit = historyPageSize, around?: string) {
    if (!this.list().some((session) => session.id === sessionId)) {
      return undefined
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > historyPageSize) {
      throw new Error('History limit must be 1..100')
    }
    const loaded = this.load(sessionId)
    const target = around ? loaded.messages.findIndex((item) => item.message.id === around) : -1
    if (around && target < 0) {
      throw new Error('目标消息已不可用，请刷新搜索；未切换到其他消息。')
    }
    const end = around
      ? Math.min(loaded.messages.length, target + Math.ceil(limit / 2))
      : cursor
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
    const messages = loaded.messages.slice(start, end).map((item) => item.message)
    const turnIds = [
      ...new Set(messages.flatMap((message) => (message.turnId ? [message.turnId] : []))),
    ]
    // Page-owned observations are indexed metadata, not reconstructed tool execution.
    // Do not expose other turns merely because their records share the same session.
    const observations = turnIds.length
      ? this.database.db
          .select()
          .from(sessionTurns)
          .where(and(eq(sessionTurns.sessionId, sessionId), inArray(sessionTurns.id, turnIds)))
          .orderBy(asc(sessionTurns.createdAt), asc(sessionTurns.id))
          .all()
      : []
    const toolTimelines = observations.flatMap((turn) => {
      const parsed = runtimeSnapshotSchema.shape.turns.element.shape.tools.safeParse(
        this.parse(turn.tools),
      )
      return parsed.success && parsed.data.length
        ? [
            {
              epoch: turn.epoch,
              turnId: turn.id,
              tools: ['running', 'stopping'].includes(turn.phase)
                ? parsed.data
                : interruptToolObservations(parsed.data),
            },
          ]
        : []
    })
    const modelRequests = observations.flatMap((turn) => {
      const parsed = modelRequestSchema.safeParse(this.parse(turn.modelRequest ?? 'null'))
      return parsed.success
        ? [
            {
              epoch: turn.epoch,
              turnId: turn.id,
              request: ['running', 'stopping'].includes(turn.phase)
                ? parsed.data
                : interruptModelRequest(parsed.data),
            },
          ]
        : []
    })
    return historyPageSchema.parse({
      sessionId,
      source: runtime?.source ?? 'synthetic-ipc-fixture',
      messages,
      toolTimelines,
      modelRequests,
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
      const modelRequest = modelRequestSchema.safeParse(this.parse(turn?.modelRequest ?? 'null'))
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
                  ...(last?.message.reasoning ? { reasoning: last.message.reasoning } : {}),
                  ...(modelRequest.success
                    ? { modelRequest: interruptModelRequest(modelRequest.data) }
                    : {}),
                  tools: tools.success ? interruptToolObservations(tools.data) : [],
                  approval: null,
                  error:
                    phase === 'interrupted'
                      ? '任务已中断；仅恢复观察记录，未自动继续。'
                      : (last?.message.error ?? null),
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
