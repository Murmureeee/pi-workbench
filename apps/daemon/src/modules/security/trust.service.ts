import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { TrustedContext, TrustRecord, TrustSnapshot } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { trustGrantSchema, trustRecordSchema, trustSnapshotSchema } from '@pi-workbench/shared'

import { resourceTrust } from '../../infrastructure/database/schema.js'
import { discoverTrust } from './trust-discovery.js'

/** Daemon-owned resource consent. No project setting, SDK extension or model content can
 * write this store. Grants pin source, canonical project and bytes; restart can reuse a
 * matching grant. Revocation affects the next turn, never edits history or an active snapshot.
 */
export class TrustService {
  private readonly active = new Map<string, TrustSnapshot['activeTurns'][number]>()

  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly userDirectory?: string,
  ) {}

  private records(): TrustRecord[] {
    return this.database.db
      .select()
      .from(resourceTrust)
      .all()
      .map((row) => {
        const value: unknown = JSON.parse(row.data)
        return trustRecordSchema.parse(value)
      })
  }

  inspect(project?: string): TrustSnapshot {
    const records = this.records()
    const discovered = project ? discoverTrust(project, this.userDirectory) : undefined
    return trustSnapshotSchema.parse({
      version: 1,
      project: discovered?.project ?? null,
      resources: (discovered?.resources ?? []).map(({ view }) => {
        const previous = records.filter((record) => record.id === view.id)
        const matching = previous.find(
          (record) => !record.revokedAt && record.fingerprint === view.fingerprint,
        )
        view.trust = view.diagnostic
          ? 'blocked'
          : matching
            ? 'trusted'
            : previous.length
              ? previous.some((record) => !record.revokedAt)
                ? 'changed'
                : 'revoked'
              : 'untrusted'
        return view
      }),
      records,
      activeTurns: [...this.active.values()],
      diagnostics: discovered?.diagnostics ?? [],
      persistence: 'fingerprint-until-revoked',
      revocation: 'next-turn',
      execution: 'deny-all',
    })
  }

  /** Reinspect at the decision boundary. A stale browser preview cannot approve new bytes.
   * Persist only metadata, not source text, credentials or settings. DB failure grants nothing.
   */
  grant(input: unknown, clientId: string): TrustRecord {
    const request = trustGrantSchema.parse(input)
    const snapshot = this.inspect(request.project)
    const resource = snapshot.resources.find((item) => item.id === request.id)
    if (!resource || resource.diagnostic || resource.fingerprint !== request.fingerprint) {
      throw new Error('来源或内容已改变，或资源无法完整检查；请刷新后重新确认。')
    }
    const old = snapshot.records.find(
      (record) =>
        record.id === resource.id &&
        record.fingerprint === resource.fingerprint &&
        !record.revokedAt,
    )
    if (old) {
      return old
    }
    if (snapshot.records.length >= 5000) {
      throw new Error('信任记录已达 5000 条；未授予新信任。')
    }
    const { preview: _preview, diagnostic: _diagnostic, trust: _trust, ...metadata } = resource
    const record = trustRecordSchema.parse({
      ...metadata,
      recordId: randomUUID(),
      grantedAt: Date.now(),
      grantedBy: clientId,
      revokedAt: null,
    })
    this.database.db
      .insert(resourceTrust)
      .values({ id: record.recordId, data: JSON.stringify(record) })
      .run()
    return record
  }

  /** Idempotent single-record revoke; no restoration of old execution/approval permissions. */
  revoke(recordId: string): boolean {
    const record = this.records().find((item) => item.recordId === recordId)
    if (!record) {
      return false
    }
    if (!record.revokedAt) {
      this.database.db
        .update(resourceTrust)
        .set({ data: JSON.stringify({ ...record, revokedAt: Date.now() }) })
        .where(eq(resourceTrust.id, recordId))
        .run()
    }
    return true
  }

  /** Resolve immediately before admission into SDK prompt, after any kernel/model wait.
   * No file path is passed to the SDK to discover or reread. The exact inspected bytes travel
   * in private IPC. Every next turn replaces its system context, including an empty snapshot.
   * Native extensions, scripts, settings and installs remain disabled even when trusted.
   */
  beginTurn(project: string, sessionId: string, turnId: string): TrustedContext[] {
    const records = this.records(),
      discovered = discoverTrust(project, this.userDirectory)
    const selected: TrustedContext[] = []
    let bytes = 0
    for (const resource of discovered.resources) {
      const { view, content } = resource
      if (
        view.kind !== 'context' ||
        view.diagnostic ||
        !view.fingerprint ||
        content === undefined ||
        !records.some(
          (record) =>
            record.id === view.id && record.fingerprint === view.fingerprint && !record.revokedAt,
        )
      ) {
        continue
      }
      bytes += Buffer.byteLength(content)
      if (selected.length >= 128 || bytes > 512 * 1024) {
        throw new Error('受信任文本超过本轮 512 KiB / 128 项上限，未开始模型请求。')
      }
      selected.push({ id: view.id, path: view.path, fingerprint: view.fingerprint, content })
    }
    this.active.set(turnId, {
      project: discovered.project,
      sessionId,
      turnId,
      resources: selected.map(({ id, fingerprint }) => ({ id, fingerprint })),
    })
    return selected
  }

  endTurn(turnId: string): void {
    this.active.delete(turnId)
  }
}
