/* oxlint-disable no-await-in-loop -- Batch preflight, writes and conditional reverse compensation preserve order. */
import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { AuditService } from '../security/audit.service.js'
import type { DirectoryWriteService } from '../workspaces/directory-write.service.js'
import type { ChangeReviewService } from './change-review.service.js'
import type { ChangeService } from './change.service.js'
import type {
  ChangeRound,
  Redactor,
  RollbackCommand,
  RollbackRecord,
  RollbackTarget,
} from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'

import { ConflictException } from '@nestjs/common'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'

import { rollbackHistorySchema, rollbackRecordSchema } from '@pi-workbench/shared'

import { changeRollbacks } from '../../infrastructure/database/schema.js'
import { FileRestore, sameBytes } from '../../infrastructure/ledger/file-restore.js'

type Identity = { canonicalPath: string; directoryKey: string }
type Target = {
  fileId: string
  path: string
  current: Buffer | null
  expected: Buffer | null
  target: Buffer | null
}
type Plan = {
  confirmationId: string
  identity: Identity
  record: RollbackRecord
  targets: Target[]
}
const digest = (bytes: Buffer | null) =>
  bytes === null ? null : createHash('sha256').update(bytes).digest('hex')

/** Sole rollback writer. Memory-only single-use confirmation, durable intent before IO,
 * physical leases through final persistence, and conditional compensation on failure.
 * Restart never resumes intent or authorization. KernelService owns coordinated shutdown. */
export class ChangeRollbackService {
  private readonly plans = new Map<string, Plan>()
  private readonly running = new Map<string, Promise<RollbackRecord>>()
  private readonly preparing = new Set<Promise<unknown>>()
  private closing = false
  readonly files = new FileRestore()

  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly changes: ChangeService,
    private readonly review: ChangeReviewService,
    private readonly writes: DirectoryWriteService,
    private readonly audit: AuditService,
    private readonly redactor: Redactor,
  ) {
    for (const row of database.db
      .select()
      .from(changeRollbacks)
      .where(inArray(changeRollbacks.state, ['prepared', 'running']))
      .all()) {
      const record = rollbackRecordSchema.parse(JSON.parse(row.data))
      record.state = 'interrupted'
      record.endedAt = Date.now()
      record.diagnostic = '服务中断；未恢复确认、执行或自动补偿，请核对现场与操作前版本。'
      this.save(record)
    }
  }

  record(sessionId: string, operationId: string): RollbackRecord {
    const row = this.database.db
      .select()
      .from(changeRollbacks)
      .where(eq(changeRollbacks.id, operationId))
      .get()
    if (!row || row.sessionId !== sessionId) {
      throw new ConflictException('回滚操作不属于该会话。')
    }
    return rollbackRecordSchema.parse(this.redactor.value(JSON.parse(row.data)))
  }

  /** Public review facts, not current applicability. Both immutable references must match;
   * compensated/failed/interrupted operations never count as successful file handling. */
  succeededFiles(round: ChangeRound): Map<string, string> {
    const result = new Map<string, string>()
    const rows = this.database.db
      .select()
      .from(changeRollbacks)
      .where(
        and(
          eq(changeRollbacks.turnId, round.turnId),
          eq(changeRollbacks.sessionId, round.sessionId),
          eq(changeRollbacks.state, 'succeeded'),
        ),
      )
      .orderBy(desc(changeRollbacks.sequence))
      .all()
    for (const row of rows) {
      const record = this.record(round.sessionId, row.id)
      if (
        record.state !== 'succeeded' ||
        record.baselineReference !== round.baseline.reference ||
        record.finalReference !== round.final.reference
      ) {
        continue
      }
      for (const file of record.files) {
        if (!result.has(file.fileId)) {
          result.set(file.fileId, record.id)
        }
      }
    }
    return result
  }

  /** Stable descending pagination of durable facts; prepared/interrupted entries carry no permit. */
  history(sessionId: string, before?: number) {
    const rows = this.database.db
      .select()
      .from(changeRollbacks)
      .where(
        and(
          eq(changeRollbacks.sessionId, sessionId),
          before ? lt(changeRollbacks.sequence, before) : undefined,
        ),
      )
      .orderBy(desc(changeRollbacks.sequence))
      .limit(21)
      .all()
    return rollbackHistorySchema.parse(
      this.redactor.value({
        sessionId,
        records: rows.slice(0, 20).map((row) => {
          const { files, ...record } = this.record(sessionId, row.id)
          return Object.assign(record, {
            totalFiles: files.length,
            paths: files.slice(0, 8).map((f) => f.path),
          })
        }),
        next: rows.length > 20 ? rows[19]!.sequence : null,
      }),
    )
  }

  /** Host-only environment facts for this physical directory, across sessions. Repeated on
   * each admitted turn so cold recovery has the same facts; never edits native history,
   * issues a model request or grants permissions. Corrupt records stop dispatch. */
  environmentNote(directoryKey: string): string {
    const rows = this.database.db
      .select()
      .from(changeRollbacks)
      .where(
        and(
          eq(changeRollbacks.directoryKey, directoryKey),
          inArray(changeRollbacks.state, [
            'succeeded',
            'failed',
            'compensated',
            'needs-recovery',
            'interrupted',
          ]),
        ),
      )
      .orderBy(desc(changeRollbacks.sequence))
      .limit(9)
      .all()
    if (!rows.length) {
      return ''
    }
    const records = rows.slice(0, 8).map((row) => {
      const r = this.record(row.sessionId, row.id)
      return {
        operationId: r.id,
        sessionId: r.sessionId,
        turnId: r.turnId,
        result: r.state,
        source: r.source,
        externalConfirmed: r.externalConfirmed,
        before: r.beforeReference,
        after: r.afterReference,
        afterStatus: r.afterStatus,
        files: r.files.length,
        paths: r.files.slice(0, 4).map((f) => f.path.slice(0, 160)),
        endedAt: r.endedAt,
      }
    })
    return `Pi Workbench 文件环境变更记录。文件回滚未撤销消息历史；先前工具结果描述的是当时状态，执行前应重新读取现场。记录不授予任何工具权限。补偿冲突或中断表示结果不确定，不得假定文件已恢复。\n${JSON.stringify({ records, olderOmitted: rows.length > 8 })}`
  }

  private save(record: RollbackRecord): void {
    const clean = rollbackRecordSchema.parse(this.redactor.value(record))
    this.database.db
      .update(changeRollbacks)
      .set({ state: clean.state, data: JSON.stringify(clean) })
      .where(eq(changeRollbacks.id, record.id))
      .run()
  }

  private auditResult(record: RollbackRecord, decision: string): void {
    this.audit.record({
      kind: 'rollback',
      objectId: record.id,
      sessionId: record.sessionId,
      source: 'human',
      actor: record.actor,
      risk: 'L3',
      decision,
      scope: JSON.stringify({
        turnId: record.turnId,
        fileId: record.fileId,
        total: record.files.length,
        targetDigest: createHash('sha256').update(JSON.stringify(record.files)).digest('hex'),
      }),
      reason:
        record.diagnostic ??
        (record.externalConfirmed
          ? '用户单独明确确认覆盖所列外部或未知来源内容。'
          : '用户明确确认回到所选轮次基线。'),
    })
  }

  async prepare(target: RollbackTarget, actor: string) {
    const operation = this.prepareNow(target, actor)
    this.preparing.add(operation)
    try {
      return await operation
    } finally {
      this.preparing.delete(operation)
    }
  }

  private async prepareNow(target: RollbackTarget, actor: string) {
    if (this.closing) {
      throw new ConflictException('服务正在退出，未开始回滚。')
    }
    if (this.plans.size >= 64) {
      throw new ConflictException('待确认回滚达到64项，请先取消或完成。')
    }
    const { record: round, identity, entries } = await this.review.rollbackEntries(target.turnId)
    if (round.sessionId !== target.sessionId || round.outcome === 'active' || !entries) {
      throw new ConflictException('轮次尚未落稳或历史文件版本不可用。')
    }
    const selected =
      target.fileId === null ? entries : entries.filter((e) => e.id === target.fileId)
    if (!selected.length) {
      throw new ConflictException('所选轮次没有可回滚文件。')
    }
    const currentIdentity = this.writes.identify(identity.canonicalPath)
    if (currentIdentity.directoryKey !== identity.directoryKey) {
      throw new ConflictException('物理目录身份已改变。')
    }
    const targets: Target[] = [],
      sources = new Map<string, 'tool-observed' | 'mixed' | 'unknown'>()
    for (const entry of selected) {
      for (const path of new Set(
        [entry.beforePath, entry.afterPath].filter((p): p is string => p !== null),
      )) {
        if (targets.some((t) => t.path === path)) {
          throw new ConflictException('历史路径冲突，未执行。')
        }
        targets.push({
          fileId: entry.id,
          path,
          expected: path === entry.afterPath ? entry.after : null,
          target: path === entry.beforePath ? entry.before : null,
          current: null,
        })
        sources.set(path, entry.file.source)
      }
    }
    await this.changes.ledger.assertRestoreTargets(
      identity,
      targets.map((t) => t.path),
    )
    for (const item of targets) {
      item.current = await this.files.read(identity.canonicalPath, item.path)
    }
    const record: RollbackRecord = {
      id: randomUUID(),
      sessionId: target.sessionId,
      turnId: target.turnId,
      fileId: target.fileId,
      state: 'prepared',
      startedAt: Date.now(),
      endedAt: null,
      baselineReference: round.baseline.reference,
      finalReference: round.final.reference,
      beforeReference: null,
      afterReference: null,
      afterSnapshotId: null,
      afterStatus: 'not-captured',
      attemptReference: null,
      externalConfirmed: false,
      source: 'human',
      actor,
      diagnostic: null,
      files: targets.map((t) => ({
        fileId: t.fileId,
        path: t.path,
        current: digest(t.current),
        expected: digest(t.expected),
        target: digest(t.target),
        source: sources.get(t.path)!,
        conflict: !sameBytes(t.current, t.expected) || sources.get(t.path) !== 'tool-observed',
        written: false,
        compensated: false,
        observedAfter: null,
        observation: 'not-observed',
      })),
    }
    const confirmationId = randomUUID()
    if (this.closing) {
      throw new ConflictException('服务正在退出，本次预检已取消。')
    }
    this.database.db
      .insert(changeRollbacks)
      .values({
        id: record.id,
        sessionId: target.sessionId,
        turnId: target.turnId,
        directoryKey: identity.directoryKey,
        cwd: identity.canonicalPath,
        state: record.state,
        data: JSON.stringify(rollbackRecordSchema.parse(this.redactor.value(record))),
      })
      .run()
    this.plans.set(record.id, { confirmationId, identity, record, targets })
    return { record: this.record(target.sessionId, record.id), confirmationId }
  }

  /** Consume synchronously before awaiting. A lost reply can query the same operation;
   * neither duplicate confirmation nor cancellation can replay an already started write. */
  async command(command: RollbackCommand): Promise<RollbackRecord> {
    const saved = this.record(command.sessionId, command.operationId)
    const active = this.running.get(command.operationId)
    if (active) {
      return active
    }
    if (saved.state !== 'prepared') {
      return saved
    }
    const plan = this.plans.get(command.operationId)
    if (!plan || plan.confirmationId !== command.confirmationId || this.closing) {
      throw new ConflictException('本次确认已失效，请重新预检。')
    }
    if (command.action === 'confirm' && plan.record.files.some((f) => f.conflict)) {
      throw new ConflictException('整批预检有冲突，未写入；覆盖外部或未知内容须单独明确确认。')
    }
    this.plans.delete(command.operationId)
    if (command.action === 'cancel') {
      plan.record.state = 'cancelled'
      plan.record.endedAt = Date.now()
      this.save(plan.record)
      return this.record(command.sessionId, command.operationId)
    }
    plan.record.externalConfirmed = command.action === 'confirm-external'
    const promise = this.execute(plan).finally(() => this.running.delete(command.operationId))
    this.running.set(command.operationId, promise)
    return promise
  }

  private async execute(plan: Plan): Promise<RollbackRecord> {
    const { record, identity, targets } = plan
    let reserved = false,
      durable = false,
      writing = false
    const written: number[] = []
    try {
      const blocker = this.writes.blocker(identity)
      if (blocker) {
        throw new ConflictException(
          `目录被会话 ${blocker.sessionId}／轮次 ${blocker.turnId} 占用，请完成后重新预检。`,
        )
      }
      this.writes.reserve(identity, record.sessionId, record.id)
      reserved = true
      await this.writes.begin(record.id, process.pid)
      this.writes.assertOwner(record.id, identity.canonicalPath)
      // Preflight buffers are not a surviving authorization to use a lost version.
      // Verify the originally bound refs inside the physical lease, before new capture/IO.
      try {
        if (!record.baselineReference || !record.finalReference) {
          throw new Error('缺少原版本引用。')
        }
        await this.changes.ledger.verify(
          identity,
          record.turnId,
          'baseline',
          record.baselineReference,
        )
        await this.changes.ledger.verify(identity, record.turnId, 'final', record.finalReference)
      } catch (error) {
        throw new ConflictException(
          `历史版本失效或无法核对，整批未写入；${this.redactor.text(error instanceof Error ? error.message : '版本不可读。')}`,
        )
      }
      await this.changes.ledger.assertRestoreTargets(
        identity,
        targets.map((t) => t.path),
      )
      for (const t of targets) {
        if (!sameBytes(await this.files.read(identity.canonicalPath, t.path), t.current)) {
          throw new ConflictException('目标在预检后改变，整批未写入；请重新预检。')
        }
      }
      const before = await this.changes.ledger.capture(identity, record.id, 'baseline')
      record.beforeReference = before.reference
      const proof = await this.changes.ledger.verify(
        identity,
        record.id,
        'baseline',
        before.reference!,
      )
      for (const t of targets) {
        if (!sameBytes(proof.get(t.path) ?? null, t.current)) {
          throw new ConflictException('操作前版本与预检不同，整批未写入。')
        }
      }
      record.state = 'running'
      this.database.sqlite.transaction(() => {
        this.save(record)
        this.auditResult(record, 'confirmed')
      })()
      writing = true
      for (const [index, t] of targets.entries()) {
        this.writes.assertOwner(record.id, identity.canonicalPath)
        await this.changes.ledger.assertRestoreTargets(identity, [t.path])
        await this.files.write(identity.canonicalPath, t.path, t.current, t.target)
        written.push(index)
        record.files[index]!.written = true
        this.save(record)
      }
      const after = await this.changes.ledger.capture(identity, record.id, 'final')
      record.afterReference = after.reference
      record.afterSnapshotId = record.id
      record.afterStatus = 'ready'
      const afterFiles = await this.changes.ledger.verify(
        identity,
        record.id,
        'final',
        after.reference!,
      )
      for (const [index, t] of targets.entries()) {
        const actual = await this.files.read(identity.canonicalPath, t.path)
        record.files[index]!.observedAfter = digest(actual)
        record.files[index]!.observation = actual === null ? 'missing' : 'present'
        if (!sameBytes(actual, t.target) || !sameBytes(afterFiles.get(t.path) ?? null, t.target)) {
          throw new Error('写入后现场又发生变化，不能宣称回滚成功。')
        }
      }
      record.state = 'succeeded'
      record.endedAt = Date.now()
      this.database.sqlite.transaction(() => {
        this.save(record)
        this.auditResult(record, 'succeeded')
      })()
      durable = true
    } catch (error) {
      let conflict = false
      for (const index of written.toReversed()) {
        const t = targets[index]!
        try {
          this.writes.assertOwner(record.id, identity.canonicalPath)
          await this.changes.ledger.assertRestoreTargets(identity, [t.path])
          await this.files.write(identity.canonicalPath, t.path, t.target, t.current)
          record.files[index]!.compensated = true
        } catch {
          conflict = true
        }
      }
      record.state = conflict
        ? 'needs-recovery'
        : written.length
          ? 'compensated'
          : writing
            ? 'failed'
            : 'conflict'
      record.endedAt = Date.now()
      record.diagnostic = this.redactor
        .text(error instanceof Error ? error.message : '回滚失败，现场保留。')
        .slice(0, 1000)
      if (conflict) {
        record.diagnostic += ' 条件补偿冲突，保留现场与操作前版本；请人工核对。'
      }
      if (writing) {
        record.attemptReference = record.afterReference
        record.afterReference = null
        record.afterSnapshotId = null
        record.afterStatus = 'unavailable'
        for (const [index, t] of targets.entries()) {
          try {
            const actual = await this.files.read(identity.canonicalPath, t.path)
            record.files[index]!.observedAfter = digest(actual)
            record.files[index]!.observation = actual === null ? 'missing' : 'present'
          } catch {
            record.files[index]!.observation = 'unavailable'
          }
        }
        try {
          const snapshotId = randomUUID(),
            after = await this.changes.ledger.capture(identity, snapshotId, 'final')
          record.afterReference = after.reference
          record.afterSnapshotId = snapshotId
          record.afterStatus = 'ready'
        } catch {
          record.diagnostic += ' 最终现场快照不可用，未伪造操作后版本。'
        }
      }
      this.database.sqlite.transaction(() => {
        this.save(record)
        this.auditResult(record, record.state)
      })()
      durable = true
    } finally {
      if (reserved) {
        await this.writes.finish(record.id, durable)
      }
    }
    return this.record(record.sessionId, record.id)
  }

  /** Close admissions immediately; wait actual IO and durable outcomes before DB shutdown. */
  async close(): Promise<void> {
    this.closing = true
    await Promise.allSettled(this.preparing)
    let failed: unknown
    for (const plan of this.plans.values()) {
      plan.record.state = 'cancelled'
      plan.record.endedAt = Date.now()
      try {
        this.save(plan.record)
      } catch (error) {
        failed ??= error
      }
    }
    this.plans.clear()
    const outcomes = await Promise.allSettled(this.running.values())
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    if (failed || rejected?.status === 'rejected') {
      throw failed ?? rejected?.reason
    }
  }
}
