import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { AuditEntry, AuditQuery, Redactor } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import { and, desc, eq, lt, lte, sql } from 'drizzle-orm'

import { auditEntrySchema, auditPageSchema, auditQuerySchema } from '@pi-workbench/shared'

import { operationAudit, workspaceMeta } from '../../infrastructure/database/schema.js'

const storedEntrySchema = auditEntrySchema.omit({ sequence: true })

/** Daemon-only append boundary. No tool/HTTP writer is exposed. Rows are redacted before
 * durable insertion and again on read as secret knowledge grows. SQLite update/delete
 * triggers protect normal writes, not an OS sandbox against another same-user process.
 * Call record inside the owning mutation's transaction when granting new authority.
 */
export class AuditService {
  private warning: string | null = null
  readonly startedAt: number
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly redactor: Redactor,
  ) {
    database.db
      .insert(workspaceMeta)
      .values({ key: 'operation-audit-start', value: String(Date.now()) })
      .onConflictDoNothing()
      .run()
    const row = database.db
      .select()
      .from(workspaceMeta)
      .where(eq(workspaceMeta.key, 'operation-audit-start'))
      .get()
    this.startedAt = Number(row?.value)
    if (!Number.isSafeInteger(this.startedAt) || this.startedAt < 0) {
      throw new Error('Audit start metadata is invalid')
    }
  }

  record(input: Omit<AuditEntry, 'id' | 'sequence' | 'at'> & { at?: number }): void {
    try {
      const { sequence: _sequence, ...entry } = auditEntrySchema.parse(
        this.redactor.value({
          ...input,
          id: randomUUID(),
          sequence: 1,
          at: input.at ?? Date.now(),
        }),
      )
      this.database.db
        .insert(operationAudit)
        .values({
          id: entry.id,
          kind: entry.kind,
          sessionId: entry.sessionId,
          data: JSON.stringify(entry),
        })
        .run()
    } catch (error) {
      this.warning =
        '至少一条审计写入未完成；请检查本机存储，权限结果以各对象当前状态为准。缺失记录不会伪造补齐。'
      throw error
    }
  }

  /** Revocation must remain effective if audit storage fails. The reader exposes a sticky
   * warning instead of reconstructing missing events or undoing removed authority. */
  recordRevocation(input: Parameters<AuditService['record']>[0]): void {
    try {
      this.record(input)
    } catch {
      this.warning =
        '权限变更已生效，但至少一条撤销审计保存失败；请检查本机存储，缺失记录不会伪造补齐。'
    }
  }

  /** A fixed high-water sequence and exclusive cursor keep a filtered page stable during
   * concurrent appends. Only 50 records are returned; no body, credential or live grant is
   * inferred from historical decisions. Old pre-feature approvals remain in session history.
   */
  page(value: AuditQuery) {
    const query = auditQuerySchema.parse(value)
    const latest =
      this.database.db
        .select({ sequence: sql<number>`coalesce(max(${operationAudit.sequence}), 0)` })
        .from(operationAudit)
        .get()?.sequence ?? 0
    if (query.snapshot !== undefined && query.snapshot > latest) {
      throw new Error('Audit snapshot is not available in this database')
    }
    const snapshot = query.snapshot ?? latest
    const rows = this.database.db
      .select()
      .from(operationAudit)
      .where(
        and(
          lte(operationAudit.sequence, snapshot),
          query.before ? lt(operationAudit.sequence, query.before) : undefined,
          query.kind ? eq(operationAudit.kind, query.kind) : undefined,
          query.sessionId ? eq(operationAudit.sessionId, query.sessionId) : undefined,
        ),
      )
      .orderBy(desc(operationAudit.sequence))
      .limit(51)
      .all()
    const entries = rows.slice(0, 50).map((row) => {
      const stored: unknown = JSON.parse(row.data)
      return auditEntrySchema.parse(
        this.redactor.value({
          ...storedEntrySchema.parse(stored),
          sequence: row.sequence,
        }),
      )
    })
    return auditPageSchema.parse({
      entries,
      snapshot,
      nextBefore: rows.length > 50 ? entries.at(-1)?.sequence : null,
      checkedAt: Date.now(),
      startedAt: this.startedAt,
      warning: this.warning,
      retention: 'originals-retained-no-delete-api',
      exportScope: 'filtered-page-max-50',
    })
  }
}
