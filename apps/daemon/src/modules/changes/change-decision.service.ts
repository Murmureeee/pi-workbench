import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { AuditService } from '../security/audit.service.js'
import type { ChangeReviewService } from './change-review.service.js'
import type { ChangeRollbackService } from './change-rollback.service.js'
import type { ChangeAccept, Redactor } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import { ConflictException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { changeDecisionSchema, changeDecisionsSchema } from '@pi-workbench/shared'

import { changeDecisions } from '../../infrastructure/database/schema.js'

/** Retention decisions refer to immutable historical versions. They never touch current
 * files, grant authority or replace the independently computed rollback conditions. */
export class ChangeDecisionService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly review: ChangeReviewService,
    private readonly rollback: ChangeRollbackService,
    private readonly audit: AuditService,
    private readonly redactor: Redactor,
  ) {}

  private decision(turnId: string, fileId: string) {
    const row = this.database.db
      .select()
      .from(changeDecisions)
      .where(and(eq(changeDecisions.turnId, turnId), eq(changeDecisions.fileId, fileId)))
      .get()
    return row ? changeDecisionSchema.parse(this.redactor.value(JSON.parse(row.data))) : null
  }

  /** Full-round count, independent of the paginated file list. Only verified members and
   * succeeded rollback records with the identical historical references contribute. */
  async status(sessionId: string, turnId: string) {
    const { record, entries } = await this.review.rollbackEntries(turnId)
    if (!entries || record.sessionId !== sessionId) {
      throw new ConflictException('该会话的完整历史版本不可用，未推断审查进度。')
    }
    const restored = this.rollback.succeededFiles(record)
    const files = entries.map((entry) => {
      const accepted = this.decision(turnId, entry.id)
      if (
        accepted &&
        (accepted.sessionId !== sessionId ||
          accepted.baselineReference !== record.baseline.reference ||
          accepted.finalReference !== record.final.reference)
      ) {
        throw new ConflictException('审查决定与历史版本不一致。')
      }
      return { fileId: entry.id, accepted, rollbackId: restored.get(entry.id) ?? null }
    })
    return changeDecisionsSchema.parse({
      sessionId,
      turnId,
      baselineReference: record.baseline.reference,
      finalReference: record.final.reference,
      outcome: record.outcome,
      total: files.length,
      processed: files.filter((f) => f.accepted || f.rollbackId).length,
      files,
    })
  }

  /** Insert and audit in one SQLite transaction. Repeating an accepted object returns the
   * original fact. Storage/audit errors roll back together; no optimistic decision exists. */
  async accept(input: ChangeAccept, actor: string) {
    const { record, entries } = await this.review.rollbackEntries(input.turnId)
    if (
      !entries?.some((e) => e.id === input.fileId) ||
      record.sessionId !== input.sessionId ||
      record.baseline.reference !== input.baselineReference ||
      record.final.reference !== input.finalReference
    ) {
      throw new ConflictException('接受目标或历史版本不一致，请重新核对。')
    }
    return this.database.db.transaction(() => {
      const prior = this.decision(input.turnId, input.fileId)
      if (prior) {
        if (
          prior.sessionId !== input.sessionId ||
          prior.baselineReference !== input.baselineReference ||
          prior.finalReference !== input.finalReference
        ) {
          throw new ConflictException('已有决定属于不同历史版本。')
        }
        return prior
      }
      const decision = changeDecisionSchema.parse(
        this.redactor.value({
          ...input,
          id: randomUUID(),
          decision: 'accepted',
          source: 'human',
          actor,
          at: Date.now(),
        }),
      )
      this.database.db
        .insert(changeDecisions)
        .values({
          turnId: input.turnId,
          fileId: input.fileId,
          sessionId: input.sessionId,
          data: JSON.stringify(decision),
        })
        .run()
      this.audit.record({
        kind: 'change-review',
        objectId: decision.id,
        sessionId: input.sessionId,
        source: 'human',
        actor: decision.actor,
        risk: 'L0',
        decision: 'accepted',
        scope: JSON.stringify(input),
        reason: '仅记录保留决定；不修改文件或授权。',
      })
      return decision
    })
  }
}
