import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { DirectoryWriteService } from '../workspaces/directory-write.service.js'
import type { ChangeRound, FileSnapshot, Redactor } from '@pi-workbench/shared'

import { and, desc, eq, lt } from 'drizzle-orm'

import { changeHistorySchema, changeRoundSchema } from '@pi-workbench/shared'

import { changeRounds } from '../../infrastructure/database/schema.js'
import { FileLedger } from '../../infrastructure/ledger/file-ledger.js'

type Identity = { directoryKey: string; canonicalPath: string }
const empty = (status: FileSnapshot['status'], diagnostic: string | null = null): FileSnapshot => ({
  status,
  reference: null,
  capturedAt: null,
  files: 0,
  bytes: 0,
  excluded: 0,
  exclusions: [],
  diagnostic,
})

/** Durable round metadata owns no execution permits. The directory lease remains the only
 * writer authority; start/finish are called strictly within that lease's lifecycle. */
export class ChangeService {
  readonly ledger: FileLedger
  constructor(
    private readonly database: WorkspaceDatabase,
    dataDir: string,
    private readonly writes: DirectoryWriteService,
    private readonly redactor: Redactor,
  ) {
    this.ledger = new FileLedger(dataDir)
    writes.setSettlementCheck((turnId) => {
      try {
        return (
          database.db.select().from(changeRounds).where(eq(changeRounds.turnId, turnId)).get()
            ?.outcome !== 'active'
        )
      } catch {
        return false
      }
    })
    // Never use today's cwd to invent the final files of an interrupted historical round.
    for (const row of database.db
      .select()
      .from(changeRounds)
      .where(eq(changeRounds.outcome, 'active'))
      .all()) {
      const record = changeRoundSchema.parse(JSON.parse(row.data))
      record.outcome = 'interrupted'
      record.endedAt = Date.now()
      if (record.baseline.status === 'pending') {
        record.baseline = empty('unavailable', '服务中断，基线未完成。')
      }
      record.final = empty('unavailable', '服务中断，未补造历史收尾版本；未恢复授权或重放。')
      this.save(record)
    }
  }

  /** Only admitted turns get a record. Initial metadata must commit before any SDK dispatch. */
  start(identity: Identity, sessionId: string, turnId: string): void {
    this.writes.assertOwner(turnId, identity.canonicalPath)
    const record: ChangeRound = {
      sessionId,
      turnId,
      cwd: identity.canonicalPath,
      startedAt: Date.now(),
      endedAt: null,
      outcome: 'active',
      baseline: empty('pending'),
      final: empty('pending'),
      provenance: 'uncertain',
      automaticRollback: false,
    }
    this.database.db
      .insert(changeRounds)
      .values({
        turnId,
        sessionId,
        directoryKey: identity.directoryKey,
        cwd: identity.canonicalPath,
        outcome: record.outcome,
        data: this.serialized(record),
      })
      .run()
  }

  private row(turnId: string) {
    const row = this.database.db
      .select()
      .from(changeRounds)
      .where(eq(changeRounds.turnId, turnId))
      .get()
    if (!row) {
      throw new Error('轮次文件版本记录不存在，未执行。')
    }
    return {
      row,
      record: changeRoundSchema.parse(JSON.parse(row.data)),
      identity: { canonicalPath: row.cwd, directoryKey: row.directoryKey },
    }
  }

  private save(record: ChangeRound): void {
    this.database.db
      .update(changeRounds)
      .set({ outcome: record.outcome, data: this.serialized(record) })
      .where(eq(changeRounds.turnId, record.turnId))
      .run()
  }

  private serialized(record: ChangeRound): string {
    // Raw identity columns and ledger bytes are host authority. Display metadata uses the
    // same redaction boundary as history, approvals, HTTP and exported observations.
    return JSON.stringify(changeRoundSchema.parse(this.redactor.value(record)))
  }

  private failed(error: unknown): FileSnapshot {
    return empty(
      'failed',
      this.redactor
        .text(error instanceof Error ? error.message : '文件版本保存失败。')
        .slice(0, 1000),
    )
  }

  /** A capture failure is durable and does not grant a bypass. Mutations still stop at the
   * final one-shot irreversible approval; reads and model reasoning may continue. */
  async prepare(turnId: string): Promise<void> {
    const { record, identity } = this.row(turnId)
    try {
      this.writes.assertOwner(turnId, identity.canonicalPath)
      record.baseline = await this.ledger.capture(identity, turnId, 'baseline')
      this.writes.assertOwner(turnId, identity.canonicalPath)
    } catch (error) {
      record.baseline = this.failed(error)
    }
    this.save(record)
  }

  /** The approval binds the observed baseline state. An already failed baseline needs the
   * existing explicit single-call consent; a newly damaged ready reference denies this call. */
  async baselineBinding(turnId: string): Promise<string> {
    const { record, identity } = this.row(turnId)
    if (record.outcome !== 'active' || record.baseline.status === 'pending') {
      throw new Error('写入前基线尚未完成；未执行。')
    }
    if (record.baseline.status === 'ready' && record.baseline.reference) {
      try {
        await this.ledger.verify(identity, turnId, 'baseline', record.baseline.reference)
      } catch (error) {
        record.baseline = {
          ...record.baseline,
          status: 'failed',
          diagnostic: this.failed(error).diagnostic,
        }
        this.save(record)
        throw new Error('已保存基线校验失败；本次调用未执行，请核对版本状态。', { cause: error })
      }
    }
    return record.baseline.status === 'ready' && record.baseline.reference
      ? record.baseline.reference
      : record.baseline.status
  }

  /** Capture only with proof of actual SDK settlement/exit. Persist failure as an outcome;
   * if this SQLite write fails the caller must retain directory quarantine. */
  async finish(
    turnId: string,
    safe: boolean,
    outcome: Exclude<ChangeRound['outcome'], 'active'>,
  ): Promise<void> {
    const { record, identity } = this.row(turnId)
    if (record.outcome !== 'active') {
      return
    }
    if (record.baseline.status === 'pending') {
      record.baseline = empty('unavailable', '本轮在基线采集前停止，未发送写入。')
    }
    if (safe) {
      try {
        this.writes.assertOwner(turnId, identity.canonicalPath)
        record.final = await this.ledger.capture(identity, turnId, 'final')
        this.writes.assertOwner(turnId, identity.canonicalPath)
      } catch (error) {
        record.final = this.failed(error)
      }
    } else {
      record.final = empty('unavailable', '旧动作退出尚未证实，目录保留隔离；未采集混合收尾。')
    }
    record.outcome = outcome
    record.endedAt = Date.now()
    this.save(record)
  }

  history(sessionId: string, before?: number) {
    const rows = this.database.db
      .select()
      .from(changeRounds)
      .where(
        and(
          eq(changeRounds.sessionId, sessionId),
          before ? lt(changeRounds.id, before) : undefined,
        ),
      )
      .orderBy(desc(changeRounds.id))
      .limit(21)
      .all()
    return changeHistorySchema.parse(
      this.redactor.value({
        sessionId,
        rounds: rows.slice(0, 20).map((row) => changeRoundSchema.parse(JSON.parse(row.data))),
        next: rows.length > 20 ? rows[19]!.id : null,
      }),
    )
  }

  /** Host-only immutable context. Never accepts a client filesystem path. */
  context(turnId: string) {
    return this.row(turnId)
  }

  async snapshotFiles(turnId: string, phase: 'baseline' | 'final'): Promise<Map<string, Buffer>> {
    const { record, identity } = this.row(turnId),
      snapshot = record[phase]
    if (snapshot.status !== 'ready' || !snapshot.reference) {
      throw new Error('文件版本不可用。')
    }
    return this.ledger.verify(identity, turnId, phase, snapshot.reference)
  }

  /** Host-only raw recovery proof. No HTTP path exposes bytes or restoration in CHANGE-01. */
  async readVersion(
    turnId: string,
    phase: 'baseline' | 'final',
    path: string,
  ): Promise<Buffer | null> {
    const { record, identity } = this.row(turnId),
      snapshot = record[phase]
    if (snapshot.status !== 'ready' || !snapshot.reference) {
      throw new Error('文件版本不可用。')
    }
    return (await this.ledger.verify(identity, turnId, phase, snapshot.reference)).get(path) ?? null
  }
}
