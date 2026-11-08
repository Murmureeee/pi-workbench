import type { DirectoryWriteService } from '../workspaces/directory-write.service.js'
import type { ChangeReviewService } from './change-review.service.js'
/* oxlint-disable no-await-in-loop -- Verify bounded immutable versions sequentially to avoid retaining many full trees. */
import type { ChangeService } from './change.service.js'
import type { Redactor } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'

import { changeAvailabilitySchema } from '@pi-workbench/shared'

import { FileRestore, sameBytes } from '../../infrastructure/ledger/file-restore.js'

const digest = (b: Buffer | null) =>
  b === null ? null : createHash('sha256').update(b).digest('hex')

/** Current applicability is a point-in-time observation, never a permit or a replacement
 * for immutable historical Diff. Every mutation still uses fresh lease-owned preflight. */
export class ChangeAvailabilityService {
  private readonly files = new FileRestore()
  constructor(
    private readonly changes: ChangeService,
    private readonly review: ChangeReviewService,
    private readonly writes: DirectoryWriteService,
    private readonly redactor: Redactor,
  ) {}

  async inspect(turnId: string, offset = 0) {
    const { record, identity, entries } = await this.review.rollbackEntries(turnId)
    const chain = this.changes.laterRounds(turnId)
    const files = (entries ?? []).slice(offset, offset + 100).map((e) => ({
      fileId: e.id,
      path: e.file.path,
      state: 'unavailable' as 'matches-final' | 'at-baseline' | 'changed' | 'unavailable',
      requiresExternalConfirmation: e.file.source !== 'tool-observed',
      diagnostic: null as string | null,
      versions: [] as {
        path: string
        baseline: string | null
        final: string | null
        current: string | null
      }[],
      later: [] as {
        sessionId: string
        turnId: string
        baselineReference: string | null
        finalReference: string | null
        relation: 'changed-path' | 'unavailable'
      }[],
    }))
    let diagnostic: string | null = entries ? null : '历史版本不可用，未读取当前文件替代历史。'
    try {
      if (this.writes.identify(identity.canonicalPath).directoryKey !== identity.directoryKey) {
        throw new Error('物理目录身份已改变。')
      }
      for (const [i, e] of (entries ?? []).slice(offset, offset + 100).entries()) {
        const file = files[i]!
        try {
          const paths = [
            ...new Set([e.beforePath, e.afterPath].filter((p): p is string => p !== null)),
          ]
          await this.changes.ledger.assertRestoreTargets(identity, paths)
          let atFinal = true,
            atBaseline = true
          for (const path of paths) {
            const current = await this.files.read(identity.canonicalPath, path),
              before = path === e.beforePath ? e.before : null,
              after = path === e.afterPath ? e.after : null
            atFinal &&= sameBytes(current, after)
            atBaseline &&= sameBytes(current, before)
            file.versions.push({
              path: this.redactor.text(path),
              baseline: digest(before),
              final: digest(after),
              current: digest(current),
            })
          }
          file.state = atFinal ? 'matches-final' : atBaseline ? 'at-baseline' : 'changed'
          file.requiresExternalConfirmation ||= !atFinal
        } catch (error) {
          file.diagnostic = this.redactor.text(
            error instanceof Error ? error.message : '当前文件无法证明版本。',
          )
        }
      }
    } catch (error) {
      diagnostic = this.redactor.text(error instanceof Error ? error.message : '目录不可用。')
    }
    for (const later of chain.rounds) {
      try {
        const before = await this.changes.snapshotFiles(later.turnId, 'baseline'),
          after = await this.changes.snapshotFiles(later.turnId, 'final')
        for (const [i, entry] of (entries ?? []).slice(offset, offset + 100).entries()) {
          const paths = [entry.beforePath, entry.afterPath].filter((p): p is string => p !== null)
          if (paths.some((p) => !sameBytes(before.get(p) ?? null, after.get(p) ?? null))) {
            files[i]!.later.push({
              sessionId: later.sessionId,
              turnId: later.turnId,
              baselineReference: later.baseline.reference,
              finalReference: later.final.reference,
              relation: 'changed-path',
            })
          }
        }
      } catch {
        for (const file of files) {
          file.later.push({
            sessionId: later.sessionId,
            turnId: later.turnId,
            baselineReference: later.baseline.reference,
            finalReference: later.final.reference,
            relation: 'unavailable',
          })
        }
      }
    }
    const blocker = this.writes.blocker(identity)
    return changeAvailabilitySchema.parse(
      this.redactor.value({
        sessionId: record.sessionId,
        turnId,
        checkedAt: Date.now(),
        baselineReference: record.baseline.reference,
        finalReference: record.final.reference,
        diagnostic,
        owner: blocker ? { sessionId: blocker.sessionId, turnId: blocker.turnId } : null,
        laterTruncated: chain.truncated,
        files,
        total: entries?.length ?? 0,
        next: entries && offset + 100 < entries.length ? offset + 100 : null,
      }),
    )
  }
}
