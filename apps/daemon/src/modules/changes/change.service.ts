import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { DirectoryWriteService } from '../workspaces/directory-write.service.js'
import type { ChangeCoverage, ChangeRound, FileSnapshot, Redactor } from '@pi-workbench/shared'

import { isAbsolute, relative, sep } from 'node:path'

import { and, desc, eq, gt, lt } from 'drizzle-orm'

import {
  changeCoverageSchema,
  changeHistorySchema,
  changeRoundSchema,
  fileLedgerPolicy,
} from '@pi-workbench/shared'

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
    capacityBytes?: number,
  ) {
    this.ledger = new FileLedger(dataDir, capacityBytes)
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

  /** Display-only scope from verified immutable versions. No permission or source proof.
   * A missing version disables restoration, without replacing its historical metadata.
   * Invocation paths come only from the final host guard, never a renderer path query. */
  async coverage(
    turnId: string,
    invocation?: { tool: string; targetPath: string | null; parameters: string },
  ): Promise<ChangeCoverage> {
    const { record, identity } = this.row(turnId),
      storage = await this.ledger.capacity(identity)
    const reasons: string[] = []
    let valid = true,
      targetProtected = true,
      files = record.baseline.files,
      checking = '写入前基线版本／引用'
    const phase = invocation ? 'baseline' : 'round'
    try {
      const before = await this.snapshotFiles(turnId, 'baseline')
      if (!invocation) {
        checking = '轮次收尾版本／引用'
        const after = await this.snapshotFiles(turnId, 'final')
        files = new Set([...before.keys(), ...after.keys()]).size
      } else if (!['write', 'edit'].includes(invocation.tool)) {
        targetProtected = false
        reasons.push('仅部分文件字节可能受保护；命令的目录外文件、网络、进程等外部副作用不可回滚。')
      } else if (!invocation.targetPath) {
        targetProtected = false
        reasons.push('目标路径未获得物理目录证明，不在可回滚范围。')
      } else {
        checking = '本次目标范围'
        const path = relative(identity.canonicalPath, invocation.targetPath).split(sep).join('/')
        if (!path || path.startsWith('../') || isAbsolute(path)) {
          throw new Error('目录外目标不在可回滚范围。')
        }
        await this.ledger.assertRestoreTargets(identity, [path])
        const excluded = record.baseline.exclusions.find(
          (e) => path === e.path || path.startsWith(e.path + '/'),
        )
        if (excluded) {
          throw new Error(`目标未进入基线：${excluded.reason}。`)
        }
        if (invocation.tool === 'write') {
          const parameters: unknown = JSON.parse(invocation.parameters)
          if (
            parameters &&
            typeof parameters === 'object' &&
            'content' in parameters &&
            typeof parameters.content === 'string' &&
            Buffer.byteLength(parameters.content) > fileLedgerPolicy.fileBytes
          ) {
            throw new Error('新内容超过单文件5 MiB限制，不保证收尾可恢复。')
          }
        }
        reasons.push('目标属于受限普通文件字节；基线已验证，收尾成功后仍须重新预检和明确确认。')
      }
    } catch (error) {
      valid = false
      reasons.push(
        `${checking}无法验证；${this.redactor.text(error instanceof Error ? error.message : '文件版本不可读。')}`,
      )
    }
    const excluded = record.baseline.excluded > 0 || (!invocation && record.final.excluded > 0)
    if (excluded) {
      reasons.push('存在忽略、链接或其他排除项；版本只覆盖实际收录的文件字节。')
    }
    if (record.baseline.status !== 'ready') {
      reasons.push(
        record.baseline.diagnostic ?? '基线不可用，写入暂停；仅单次明确确认可进入不可回滚模式。',
      )
    }
    if (!invocation && record.final.status !== 'ready') {
      reasons.push(record.final.diagnostic ?? '轮次尚未落稳或收尾不可用，禁止回滚。')
    }
    if (storage.state === 'warning') {
      reasons.push('账本容量达到80%预警；旧版本全部保留，不自动回收。')
    }
    if (storage.state === 'full') {
      reasons.push('账本容量已满，新采集暂停；回滚需要保存操作前版本，当前不可执行。')
    }
    if (storage.state === 'unavailable') {
      reasons.push(storage.diagnostic!)
    }
    return changeCoverageSchema.parse(
      this.redactor.value({
        sessionId: record.sessionId,
        turnId,
        checkedAt: Date.now(),
        basis: phase,
        state: !valid ? 'none' : excluded || !targetProtected ? 'partial' : 'full',
        rollbackAvailable:
          !invocation &&
          valid &&
          record.outcome !== 'active' &&
          !['full', 'unavailable'].includes(storage.state),
        files,
        reasons,
        exclusions: [
          ...new Map(
            [...record.baseline.exclusions, ...(!invocation ? record.final.exclusions : [])].map(
              (e) => [JSON.stringify([e.path, e.reason]), e],
            ),
          ).values(),
        ],
        baselineExcluded: record.baseline.excluded,
        finalExcluded: invocation ? 0 : record.final.excluded,
        limits: {
          fileBytes: fileLedgerPolicy.fileBytes,
          snapshotBytes: fileLedgerPolicy.snapshotBytes,
          entries: fileLedgerPolicy.entries,
          depth: fileLedgerPolicy.depth,
        },
        storage,
      }),
    )
  }

  /** Bounded physical-directory chain, including other sessions and interrupted rounds.
   * Missing versions are exposed as unknown dependencies, never inferred from current IO. */
  laterRounds(turnId: string) {
    const { row } = this.row(turnId)
    const rows = this.database.db
      .select()
      .from(changeRounds)
      .where(and(eq(changeRounds.directoryKey, row.directoryKey), gt(changeRounds.id, row.id)))
      .orderBy(desc(changeRounds.id))
      .limit(21)
      .all()
    return {
      rounds: rows.slice(0, 20).map((r) => changeRoundSchema.parse(JSON.parse(r.data))),
      truncated: rows.length > 20,
    }
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
