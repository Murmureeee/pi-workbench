import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { ChangeService } from './change.service.js'
import type {
  ChangeToolObservation,
  ExecutionRequest,
  FileObservation,
  Redactor,
} from '@pi-workbench/shared'

import { createHash } from 'node:crypto'
import { relative, resolve, sep } from 'node:path'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  changeSourcesSchema,
  changeToolObservationSchema,
  reconcileChangeSource,
} from '@pi-workbench/shared'

import { changeToolObservations } from '../../infrastructure/database/schema.js'
import { fileKey, observeFile } from '../../infrastructure/ledger/file-observation.js'

const unavailable = (): FileObservation => ({ status: 'unavailable', sha256: null })
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
type Active = {
  record: ChangeToolObservation
  cwd: string
  target: string | null
  overlapping: boolean
}

/** Durable file observations belong to the host's final execution boundary. SDK prose,
 * public tool.updated events, approvals alone and directory metadata never create proof.
 * No state here is an execution permit or a rollback eligibility decision. */
export class ChangeProvenanceService {
  private readonly active = new Map<string, Active>()
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly changes: ChangeService,
    private readonly redactor: Redactor,
  ) {
    for (const row of database.db.select().from(changeToolObservations).all()) {
      const record = changeToolObservationSchema.parse(JSON.parse(row.data))
      if (record.status === 'running') {
        record.status = 'interrupted'
        record.endedAt = Date.now()
        record.diagnostic = '服务中断，工具末态未证实；未补造文件观察或恢复授权。'
        this.save(record)
      }
    }
  }

  private save(record: ChangeToolObservation): void {
    this.database.db
      .update(changeToolObservations)
      .set({ data: JSON.stringify(changeToolObservationSchema.parse(this.redactor.value(record))) })
      .where(eq(changeToolObservations.requestId, record.id))
      .run()
  }

  observations(turnId: string): ChangeToolObservation[] {
    return this.database.db
      .select()
      .from(changeToolObservations)
      .where(eq(changeToolObservations.turnId, turnId))
      .orderBy(changeToolObservations.id)
      .limit(128)
      .all()
      .map((row) => changeToolObservationSchema.parse(JSON.parse(row.data)))
  }

  private async probe(active: Active, phase: 'before' | 'after') {
    if (!active.target) {
      return null
    }
    try {
      const result = await observeFile(active.cwd, active.target)
      active.record[phase] = result.observation
      return result.bytes
    } catch (error) {
      active.record[phase] = unavailable()
      active.record.diagnostic = this.redactor
        .text(error instanceof Error ? error.message : '工具文件观察失败。')
        .slice(0, 1000)
      return null
    }
  }

  /** Persist first, then collect stable pre-image immediately before the final permit.
   * Raw parameters/bytes live only in this call; SQLite stores bounded hashes/identities. */
  async begin(
    turnId: string,
    epoch: string,
    request: ExecutionRequest,
    current: () => boolean,
  ): Promise<void> {
    if (request.tool === 'read') {
      return
    }
    if (this.observations(turnId).length >= 128 || this.active.has(request.id)) {
      throw new Error('本轮工具来源观察超过128项或调用身份重复；未执行。')
    }
    const { record: round, identity } = this.changes.context(turnId)
    if (round.outcome !== 'active') {
      throw new Error('工具来源观察轮次已结束；未执行。')
    }
    const fields = z.record(z.string(), z.unknown()).parse(JSON.parse(request.parameters))
    const target =
      ['write', 'edit'].includes(request.tool) && typeof fields.path === 'string'
        ? relative(identity.canonicalPath, resolve(identity.canonicalPath, fields.path))
            .split(sep)
            .join('/')
        : null
    const record: ChangeToolObservation = {
      id: request.id,
      sessionId: round.sessionId,
      epoch,
      turnId,
      callId: request.callId,
      digest: request.digest,
      tool: request.tool,
      fileId: target ? fileKey(target) : null,
      path: target ? this.redactor.text(target) : null,
      status: 'running',
      before: unavailable(),
      after: unavailable(),
      expected: null,
      startedAt: Date.now(),
      endedAt: null,
      diagnostic: target ? null : '命令的文件与外部副作用无法限定，来源不确定。',
    }
    this.database.db
      .insert(changeToolObservations)
      .values({ requestId: request.id, turnId, data: JSON.stringify(record) })
      .run()
    const active: Active = { record, cwd: identity.canonicalPath, target, overlapping: false }
    for (const other of this.active.values()) {
      if (
        other.record.turnId === turnId &&
        (other.record.fileId === record.fileId || !other.target || !target)
      ) {
        active.overlapping = true
        other.overlapping = true
        other.record.expected = null
        other.record.diagnostic = '工具观察区间重叠，不能证明单一路径的修改顺序。'
        this.save(other.record)
      }
    }
    this.active.set(request.id, active)
    const bytes = await this.probe(active, 'before')
    if (
      this.active.get(request.id) !== active ||
      active.record.status !== 'running' ||
      !current()
    ) {
      throw new Error('工具观察期间任务已失效；未发放许可。')
    }
    if (!active.overlapping) {
      if (request.tool === 'write' && typeof fields.content === 'string') {
        record.expected = digest(Buffer.from(fields.content, 'utf8'))
      }
      // The SDK also supports fuzzy edits. Only an exact unique UTF-8 replacement has a
      // derivable expected image; every other accepted edit remains explicitly unknown.
      if (request.tool === 'edit' && bytes && Array.isArray(fields.edits)) {
        const text = bytes.toString('utf8')
        const positions = fields.edits
          .map((value: unknown) => {
            const parsed = z.object({ oldText: z.string(), newText: z.string() }).safeParse(value)
            if (!parsed.success) {
              return null
            }
            const edit = parsed.data
            if (
              typeof edit.oldText !== 'string' ||
              typeof edit.newText !== 'string' ||
              !edit.oldText ||
              /\r/.test(edit.oldText + edit.newText)
            ) {
              return null
            }
            const at = text.indexOf(edit.oldText)
            return at >= 0 && text.indexOf(edit.oldText, at + 1) === -1
              ? { at, length: edit.oldText.length, text: edit.newText }
              : null
          })
          .toSorted((a, b) => (a?.at ?? -1) - (b?.at ?? -1))
        if (
          Buffer.from(text, 'utf8').equals(bytes) &&
          !/\r/.test(text) &&
          !text.startsWith('\ufeff') &&
          positions.length &&
          positions.every(
            (item, i) => item && (!i || item.at >= positions[i - 1]!.at + positions[i - 1]!.length),
          )
        ) {
          let expected = text
          for (const item of positions.toReversed()) {
            expected =
              expected.slice(0, item!.at) + item!.text + expected.slice(item!.at + item!.length)
          }
          record.expected = digest(expected)
        }
      }
    } else {
      record.diagnostic = '工具观察区间重叠，不能证明单一路径的修改顺序。'
    }
    this.save(record)
  }

  /** The SDK awaits this private acknowledgement after the actual execute settled. On
   * cancellation/IPC failure no completion is invented; turn settlement closes pending rows. */
  async complete(
    turnId: string,
    id: string,
    requestDigest: string,
    succeeded: boolean,
  ): Promise<void> {
    const active = this.active.get(id)
    if (!active || active.record.turnId !== turnId || active.record.digest !== requestDigest) {
      throw new Error('工具来源完成身份无效。')
    }
    await this.probe(active, 'after')
    if (this.active.get(id) !== active || active.record.status !== 'running') {
      throw new Error('工具来源完成已经失效。')
    }
    if (active.overlapping) {
      active.record.expected = null
    }
    active.record.status = succeeded ? 'completed' : 'failed'
    active.record.endedAt = Date.now()
    this.save(active.record)
    this.active.delete(id)
  }

  /** Called only at the existing SDK settlement/exit boundary, before round finalization. */
  settle(turnId: string): void {
    for (const [id, active] of this.active) {
      if (active.record.turnId !== turnId) {
        continue
      }
      active.record.status = 'interrupted'
      active.record.endedAt = Date.now()
      active.record.expected = null
      active.record.after = unavailable()
      active.record.diagnostic = '工具完成观察未证实；保留实际副作用为未知，不重放。'
      this.save(active.record)
      this.active.delete(id)
    }
  }

  async analyze(
    turnId: string,
    snapshots?: { baseline: Map<string, Buffer>; final: Map<string, Buffer> },
  ) {
    const { record } = this.changes.context(turnId),
      observations = this.observations(turnId),
      baseline =
        snapshots?.baseline ??
        (record.baseline.status === 'ready'
          ? await this.changes.snapshotFiles(turnId, 'baseline')
          : new Map<string, Buffer>()),
      final =
        snapshots?.final ??
        (record.final.status === 'ready'
          ? await this.changes.snapshotFiles(turnId, 'final')
          : new Map<string, Buffer>()),
      complete =
        record.outcome !== 'active' &&
        record.baseline.status === 'ready' &&
        record.final.status === 'ready'
    const files = new Map<string, { path: string; before: string | null; after: string | null }>()
    for (const path of new Set([...baseline.keys(), ...final.keys()])) {
      const before = baseline.has(path) ? digest(baseline.get(path)!) : null,
        after = final.has(path) ? digest(final.get(path)!) : null
      if (before !== after || observations.some((item) => item.fileId === fileKey(path))) {
        files.set(fileKey(path), { path, before, after })
      }
    }
    for (const item of observations) {
      if (item.fileId && !files.has(item.fileId)) {
        files.set(item.fileId, { path: item.path ?? '无法确认路径', before: null, after: null })
      }
    }
    const all = [...files]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([id, file]) =>
        reconcileChangeSource(
          id,
          this.redactor.text(file.path),
          file.before,
          file.after,
          observations,
          complete && (file.before !== null || file.after !== null),
        ),
      )
    return {
      sessionId: record.sessionId,
      turnId,
      files: all,
      complete,
      observations: observations.length,
      diagnostic: complete ? null : '轮次或文件版本尚不完整；不以当前目录补造历史，不作独占归属。',
    }
  }

  async sources(turnId: string, offset = 0) {
    const result = await this.analyze(turnId)
    return changeSourcesSchema.parse(
      this.redactor.value({
        ...result,
        files: result.files.slice(offset, offset + 100),
        total: result.files.length,
        next: offset + 100 < result.files.length ? offset + 100 : null,
        automaticRollback: false,
      }),
    )
  }
}
